import { id,hash,fail,required,cacheKey,sessionIdentity,validateStages,validateOfficialRubric,makePlan,sourceRecord } from './domain.js';
import { preparePlan,evaluateAnswer,evaluateOfficial,buildReport,unassessedEvaluation } from './ai.js';
import {summarizeAuxiliaryCaptures} from '../public/multimodal/auxiliary-scores.js';
import { resolveCatalogTarget } from './catalog.js';
import { buildTrainingRubric } from '../public/rubrics.js';
import { getExamRecord } from './exam-library.js';

export class OnStage {
  constructor(store,llm=null) {this.store=store;this.llm=llm;this.busy=new Set();}
  profile(input) {
    let target;try {target=resolveCatalogTarget(input);}catch(e){fail(e.message);}
    input={...input,...target};
    const identity=sessionIdentity(input); cacheKey(identity);
    if(!Array.isArray(input.materialIds)||input.materialIds.length>30) fail('材料列表无效');
    const materials=input.materialIds.map(id=>this.store.get('materials',id)??fail('材料不存在'));
    for(const kind of ['resume','portfolio']) if(!materials.some(m=>m.kind===kind)) fail('请先上传简历与作品集');
    const rulesText=String(input.rulesText??'').trim()||materials.filter(m=>m.kind==='rules').map(m=>m.text).join('\n');
    const rubricText=String(input.rubricText??'').trim()||materials.filter(m=>m.kind==='rubric').map(m=>m.text).join('\n');
    if(!rulesText || !rubricText) fail('每个院校专业需上传或填写考核细则和评分标准');
    if(rulesText.length>120000||rubricText.length>120000) fail('细则内容过长');
    let examLibrary=null;
    if(input.examLibraryId){
      let record;try{record=getExamRecord(input.examLibraryId,{...target,year:input.year,admissionType:input.admissionType});}catch(e){fail(e.message);}
      const normalized=items=>(items??[]).map(({name,weight,criterion})=>({name,weight,criterion}));
      examLibrary={...record,userEdited:rulesText!==record.rulesText||rubricText!==record.rubricText||JSON.stringify(normalized(input.officialRubric))!==JSON.stringify(normalized(record.officialRubric))};
    }
    const profile={id:id(),...identity,...target,trainingRubric:buildTrainingRubric(target),year:required(String(input.year),'招生年份',10),admissionType:required(input.admissionType,'招生类型',80),stages:validateStages(input.stages),materialIds:input.materialIds,rulesText,rubricText,officialRubric:validateOfficialRubric(input.officialRubric),confirmed:true,createdAt:new Date().toISOString()};
    profile.examLibraryId=examLibrary?.id??null;profile.examLibrary=examLibrary;
    this.store.put('profiles',profile.id,profile);return profile;
  }
  async start(profileId) {
    const profile=this.store.get('profiles',profileId)??fail('设置不存在',404);
    profile.trainingRubric??=buildTrainingRubric(profile);
    const key=cacheKey(profile);
    if(this.busy.has(key)) fail('正在生成本场计划，请稍候',409);
    this.busy.add(key);
    try {
      const existing=this.store.list('sessions').find(s=>s.cacheKey===key);
      if(existing) fail('此场身份已创建，请继续该场，或修改面试时间／模拟次数',409);
      const materials=profile.materialIds.map(id=>this.store.get('materials',id));
      const fingerprint=hash({profile,materials:materials.map(m=>m.hash)});
      const session={id:id(),profile,rubric:structuredClone(profile.trainingRubric),materials,sources:this.store.list('sources').filter(s=>s.school===profile.school&&s.major===profile.major&&(!s.college||s.college===profile.college)),createdAt:new Date().toISOString(),lastResumedAt:new Date().toISOString(),activeMs:0,status:'active',mode:this.llm?'llm':'demo',cacheKey:key,fingerprint,identityScope:hash([profile.nickname,profile.school,profile.college,profile.programId||profile.major,profile.directionId,profile.year,profile.admissionType]),rubricHash:hash([profile.rulesText,profile.rubricText,profile.officialRubric,profile.trainingRubric,profile.stages]),stageIndex:0,turns:[],sensors:[],warnings:[]};
      const cached=this.store.get('plans',key);
      let plan=cached?.fingerprint===fingerprint?cached.plan:null;
      if(!plan) {
        plan=makePlan(profile,materials);
        try {plan=await preparePlan(this.llm,session,plan);} catch {session.warnings.push('模型预分析未完成，本场使用已配置的练习计划。');}
        this.store.put('plans',key,{key,fingerprint,identity:sessionIdentity(profile),plan});
      }
      session.plan=plan;
      this.addOpening(session);
      return this.save(session);
    } finally {this.busy.delete(key);}
  }
  get(id) {return this.store.get('sessions',id)??fail('面试不存在',404);}
  save(s) {return this.store.put('sessions',s.id,s);}
  addOpening(s) {
    const stage=s.profile.stages[s.stageIndex];
    const opening=s.plan.layers.strategy.find(x=>(x.stageId??x.id)===stage.id)?.opening??stage.question;
    s.turns.push({id:id(),role:'interviewer',stageId:stage.id,content:opening,createdAt:new Date().toISOString()});
  }
  async exclusive(sid, fn) {
    if(this.busy.has(sid)) fail('本场面试正在处理上一项操作',409);
    this.busy.add(sid);try{return await fn(this.get(sid));}finally{this.busy.delete(sid);}
  }
  async answer(sid,input) {
    return this.exclusive(sid,async s=>{
      if(s.status!=='active') fail('请先恢复面试');
      const question=s.turns.at(-1);
      if(question?.role!=='interviewer') fail('本题已回答，请继续追问或进入下一环节');
      if(s.turns.length>=160) fail('本场已达到问答上限，请结束并复盘');
      const answer=required(input.answer,'回答',20000);
      if(input.questionId!==question.id) fail('题目已更新，请刷新后继续',409);
      const responseId=id(),evidenceQuestion={...question,responseId};
      let evaluation;
      try {evaluation=await evaluateAnswer(this.llm,s,evidenceQuestion,answer);} catch {evaluation=s.rubric?unassessedEvaluation(s,evidenceQuestion,{mode:'unavailable',feedback:'模型评价暂不可用；回答已保存，本题不计分。'}):await evaluateAnswer(null,s,question,answer);evaluation.mode='unavailable';evaluation.feedback='模型评价暂不可用；回答已保存，本题不计分。';}
      s.turns.push({id:responseId,role:'candidate',stageId:question.stageId,questionId:question.id,content:answer,createdAt:new Date().toISOString(),durationMs:Math.min(Math.max(Number(input.durationMs)||0,0),3600000),inputMode:input.inputMode==='speech'?'speech':'text',evaluation});
      return this.save(s);
    });
  }
  async advance(sid,action) {
    return this.exclusive(sid,async s=>{
      if(s.status==='complete') fail('本场已结束');
      if(action==='pause') {if(s.status==='active')s.activeMs+=Date.now()-Date.parse(s.lastResumedAt);s.status='paused';return this.save(s);}
      if(action==='resume') {if(s.status==='paused')s.lastResumedAt=new Date().toISOString();s.status='active';return this.save(s);}
      if(s.status!=='active') fail('请先恢复面试');
      if(action==='skip') {
        const question=s.turns.at(-1);if(question?.role!=='interviewer')fail('本题已处理，请选择继续追问或进入下一环节');
        if(s.turns.length>=160)fail('本场已达到问答上限，请结束并复盘');
        const responseId=id();
        s.turns.push({id:responseId,role:'candidate',stageId:question.stageId,questionId:question.id,content:'',skipped:true,inputMode:'skipped',createdAt:new Date().toISOString(),evaluation:unassessedEvaluation(s,{...question,responseId},{mode:s.mode,status:'skipped'})});
      }else if(action==='followup') {
        const last=s.turns.at(-1);
        if(last?.role!=='candidate') fail('请先回答当前问题');
        if(s.turns.length>=160)fail('本场已达到问答上限，请结束并复盘');
        const followup=last.evaluation.followup||'请进一步说明你的判断依据。';
        s.turns.push({id:id(),role:'interviewer',stageId:last.stageId,content:followup,createdAt:new Date().toISOString()});
      } else if(action==='next') {
        if(s.turns.at(-1)?.role!=='candidate') fail('请先回答当前环节问题');
        if(s.stageIndex+1>=s.profile.stages.length) fail('已经是最后一个环节，请结束并复盘');
        s.stageIndex++;this.addOpening(s);
      } else if(action==='finish') {
        try{s.official=await evaluateOfficial(this.llm,s);}catch{s.official={status:'unavailable',total:null,items:[],note:'模型院校评分暂不可用，未生成成绩。'};}
        s.activeMs+=Date.now()-Date.parse(s.lastResumedAt);s.status='complete';s.completedAt=new Date().toISOString();
        s.report=buildReport(s,this.store.list('sessions'));
        s.report.multimodalEvaluation=summarizeAuxiliaryCaptures(s.multimodal);
      } else fail('不支持的面试操作');
      return this.save(s);
    });
  }
  sensors(sid,events) {
    if(this.busy.has(sid)) fail('面试正在处理，请稍后提交状态事件',409);
    const s=this.get(sid);
    if(s.status==='complete') fail('面试已结束');
    if(!Array.isArray(events)||events.length>200) fail('事件数量无效');
    if(s.sensors.length+events.length>10000) fail('状态事件数量已达上限');
    for(const e of events) {
      if(!['camera','audio','hand','imu','gaze'].includes(e.channel)||typeof e.atMs!=='number'||!Number.isFinite(e.atMs)||e.atMs<0||!['device_state','speech_interval','tracking_state'].includes(e.type)) fail('状态事件无效');
      s.sensors.push({channel:e.channel,type:e.type,atMs:e.atMs,value:String(e.value??'').slice(0,120),source:'client',receivedAt:new Date().toISOString()});
    }
    return this.save(s);
  }
  addSource(input) {const source={...sourceRecord(input),school:required(input.school,'院校'),college:input.college?required(input.college,'学院'):'',major:required(input.major,'专业')};return this.store.put('sources',source.id,source);}
  checkImprovement(sid,index,checked) {
    if(this.busy.has(sid)) fail('本场正在处理其他操作',409);
    const s=this.get(sid);
    if(s.status!=='complete'||!Number.isInteger(index)||!s.report?.improvements[index]||typeof checked!=='boolean') fail('改进项无效');
    s.report.improvements[index].checked=checked;return this.save(s);
  }
}
