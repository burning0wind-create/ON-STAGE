// Evidence contract adapted from Interview Master's evaluation principles.
// A quoted response is an observation, not verification of the student's history.
export const EVIDENCE_STATUSES = Object.freeze(['observed','partly_observed','not_assessed','skipped','insufficient_evidence']);
const SCORED_STATUSES = new Set(['observed','partly_observed']);
const STATUS_LABELS = {observed:'已观察',partly_observed:'部分观察',not_assessed:'未考察',skipped:'已跳过',insufficient_evidence:'证据不足'};
const text = (value,limit=2000) => String(value??'').trim().slice(0,limit);
const normalizedQuote = value => String(value??'').normalize('NFKC').replace(/\s+/gu,'').toLocaleLowerCase('en-US');
const applies = (dimension,stageId) => !Array.isArray(dimension.stages)||!dimension.stages.length||dimension.stages.includes(stageId);
const mean = values => values.length?Math.round(values.reduce((n,x)=>n+x,0)/values.length*10)/10:null;
function requireText(value,label) { const result=text(value);if(!result)throw new Error(`${label}不能为空`);return result; }
function checkedCounterevidence(raw,answer,dimensionId) {
  if(raw==null)return [];
  if(!Array.isArray(raw)||raw.length>20)throw new Error('反证记录格式无效');
  return raw.map(c=>{
    if(!c||typeof c!=='object')throw new Error('反证记录格式无效');
    const quote=requireText(c.quote,'反证原文');
    if(!answer.includes(quote))throw new Error('反证必须逐字来自本次回答');
    return {dimensionId,quote,reason:requireText(c.reason,'反证说明'),correction:requireText(c.correction,'修正说明')};
  });
}
function validateGroup(raw,definitions,answer,question,group,rootCounterevidence) {
  if(!Array.isArray(raw))throw new Error(`${group==='professional'?'专业':'表达'}评分格式无效`);
  const allowedIds=new Set(definitions.map(d=>d.id)), seen=new Set();
  for(const item of raw){
    if(!item||!allowedIds.has(item.id)||seen.has(item.id))throw new Error('评分维度未知或重复');
    seen.add(item.id);
  }
  return definitions.map(d=>{
    const x=raw.find(item=>item.id===d.id);
    if(!x)throw new Error(`缺少评分维度：${d.name??d.id}`);
    if(!EVIDENCE_STATUSES.includes(x.status))throw new Error('证据状态无效');
    if(x.score!==null&&(typeof x.score!=='number'||!Number.isFinite(x.score)||x.score<1||x.score>5))throw new Error('评分必须为 1–5 或 null');
    if(x.score!==null&&!SCORED_STATUSES.has(x.status))throw new Error('未考察、跳过或证据不足的项目不能评分');
    if(x.score===null&&SCORED_STATUSES.has(x.status))throw new Error('已观察或部分观察必须提供质量分；未能评价时请标为证据不足');
    if(!applies(d,question.stageId)&&(!['not_assessed','skipped'].includes(x.status)||x.score!==null))throw new Error('当前环节不适用该评分维度');
    const quote=text(x.quote,20000);
    if(quote&&!answer.includes(quote))throw new Error('证据引文必须逐字来自本次回答');
    if(x.score!==null&&!quote)throw new Error('评分缺少可核对的回答原文');
    const reason=x.score!==null?requireText(x.reason,'评分理由'):text(x.reason);
    const limitation=x.score!==null?requireText(x.limitation,'证据边界'):text(x.limitation);
    const nextProbe=x.score!==null?requireText(x.nextProbe,'下一步追问'):text(x.nextProbe||d.nextProbe);
    const localCounterevidence=checkedCounterevidence(x.counterevidence,answer,d.id);
    const counterevidence=[...localCounterevidence,...rootCounterevidence.filter(c=>c.dimensionId===d.id&&(c.group??group)===group)];
    return {id:d.id,dimensionId:d.id,name:d.name,group,status:x.status,statusLabel:STATUS_LABELS[x.status],score:x.score,quote,reason,quality:reason,finding:text(x.finding,100),limitation,nextProbe,improvement:text(x.improvement),responseId:question.responseId??question.answerId??null,questionId:question.id,stageId:question.stageId,question:text(question.content,3000),counterevidence};
  });
}

export function validateEvidenceEvaluation(data,answer,question,rubric) {
  if(!data||typeof data!=='object'||typeof answer!=='string'||!question?.id||!text(question.responseId??question.answerId)||!text(question.stageId)||!rubric?.dimensions||!Array.isArray(rubric.languageDimensions))throw new Error('证据评价输入无效，需关联题目、回答和环节');
  const roots=data.counterevidence??[];
  if(!Array.isArray(roots)||roots.length>40)throw new Error('反证记录格式无效');
  const allDefinitions=[...rubric.dimensions.map(d=>({...d,group:'professional'})),...rubric.languageDimensions.map(d=>({...d,group:'language'}))];
  const rootCounterevidence=roots.map(c=>{
    const d=allDefinitions.find(d=>d.id===c?.dimensionId&&(!c.group||d.group===c.group));
    if(!d)throw new Error('反证所属维度无效');
    return {...checkedCounterevidence([c],answer,d.id)[0],group:d.group};
  });
  return {
    dimensions:validateGroup(data.dimensions,rubric.dimensions,answer,question,'professional',rootCounterevidence),
    languageDimensions:validateGroup(data.languageDimensions,rubric.languageDimensions,answer,question,'language',rootCounterevidence),
    feedback:text(data.feedback,4000),followup:text(data.followup,1500),improvedAnswer:text(data.improvedAnswer,6000),exercise:text(data.exercise,3000),
    counterevidence:rootCounterevidence,
  };
}

// A response may support multiple dimensions; within one dimension repeated
// wording remains one observation. Scores never rise merely from repetition.
export function aggregateEvidence(session,rubric) {
  const answers=(session.turns??[]).filter(t=>t.role==='candidate');
  const evidenceLedger=[], warnings=[], groups={professional:rubric.dimensions,language:rubric.languageDimensions??[]};
  const buckets=new Map();
  let legacy=false;
  for(const [responseIndex,response] of answers.entries()) {
    const evaluation=response.evaluation??{};
    for(const [group,definitions] of Object.entries(groups)) {
      const items=group==='professional'?evaluation.dimensions:evaluation.languageDimensions;
      if(!Array.isArray(items)) {if(group==='professional'&&evaluation.dimensions)legacy=true;continue;}
      for(const definition of definitions) {
        const item=items.find(d=>d.id===definition.id);
        if(!item)continue;
        if(!EVIDENCE_STATUSES.includes(item.status)){legacy=true;continue;}
        const stageId=response.stageId;
        const quote=text(item.quote,20000);
        const score=item.score;
        const validQuote=!quote||String(response.content??'').includes(quote);
        const scorable=!response.skipped&&applies(definition,stageId)&&SCORED_STATUSES.has(item.status)&&typeof score==='number'&&Number.isFinite(score)&&score>=1&&score<=5&&quote&&validQuote&&text(item.reason)&&text(item.limitation)&&text(item.nextProbe);
        const status=response.skipped?'skipped':SCORED_STATUSES.has(item.status)&&!scorable?'insufficient_evidence':item.status;
        const validCounterevidence=(Array.isArray(item.counterevidence)?item.counterevidence:[]).filter(c=>c&&text(c.quote)&&String(response.content??'').includes(text(c.quote))&&text(c.reason)&&text(c.correction)).map(c=>({dimensionId:definition.id,quote:text(c.quote),reason:text(c.reason),correction:text(c.correction)}));
        const recordId=`evidence-${response.id??responseIndex}-${group}-${definition.id}`;
        const record={id:recordId,responseId:response.id??null,questionId:response.questionId??item.questionId??null,dimensionId:definition.id,name:definition.name,group,stageId,question:text((session.turns??[]).find(t=>t.id===response.questionId)?.content??item.question,3000),status,statusLabel:STATUS_LABELS[status],score:scorable?score:null,quote:validQuote?quote:'',reason:text(item.reason),quality:text(item.reason),finding:text(item.finding,100),limitation:text(item.limitation),nextProbe:text(item.nextProbe||definition.nextProbe),improvement:text(item.improvement),counterevidence:validCounterevidence,duplicateOf:null,independent:false,assisted:response.assisted===true||evaluation.assisted===true||session.assisted===true};
        const key=`${group}:${definition.id}`;
        if(!buckets.has(key))buckets.set(key,[]);
        const observations=buckets.get(key);
        if(scorable) {
          const prior=observations.find(r=>r.score!==null&&normalizedQuote(r.quote)===normalizedQuote(quote));
          if(prior)record.duplicateOf=prior.id;
          else record.independent=true;
        }
        if(score!==null&&score!==undefined&&!scorable)warnings.push({responseId:record.responseId,dimensionId:definition.id,reason:'评分证据或环节约束不完整，已排除该分数'});
        observations.push(record);evidenceLedger.push(record);
      }
    }
  }
  function aggregateGroup(group,definitions) {
    return definitions.map(d=>{
      const records=buckets.get(`${group}:${d.id}`)??[];
      const independent=records.filter(r=>r.independent&&r.score!==null);
      const observed=independent.filter(r=>r.status==='observed');
      let status='not_assessed';
      if(observed.length)status='observed';
      else if(independent.some(r=>r.status==='partly_observed'))status='partly_observed';
      else if(records.some(r=>r.status==='insufficient_evidence'))status='insufficient_evidence';
      else if(records.length&&records.every(r=>r.status==='skipped'))status='skipped';
      return {...d,status,statusLabel:STATUS_LABELS[status],score:mean(independent.map(r=>r.score)),observedAnswers:independent.length,independentEvidenceCount:independent.length,fullyObservedAnswers:observed.length,duplicateEvidenceCount:records.filter(r=>r.duplicateOf).length,evidence:records};
    });
  }
  const dimensions=aggregateGroup('professional',groups.professional),languageDimensions=aggregateGroup('language',groups.language);
  const criticalIds=Array.isArray(rubric.criticalDimensions)?rubric.criticalDimensions:dimensions.filter(d=>d.critical).map(d=>d.id);
  const criticalMissing=dimensions.filter(d=>criticalIds.includes(d.id)&&(d.status!=='observed'||d.score===null)).map(d=>({id:d.id,name:d.name,status:d.status,nextProbe:d.nextProbe??''}));
  const assessed=dimensions.filter(d=>d.status==='observed'&&d.score!==null).length;
  const partial=dimensions.filter(d=>d.status==='partly_observed'&&d.score!==null).length;
  const assisted=session.assisted===true||evidenceLedger.some(r=>r.assisted);
  const complete=dimensions.length>0&&assessed===dimensions.length&&!criticalMissing.length&&!legacy&&!assisted;
  const trainingTotal=complete?Math.round(dimensions.reduce((n,d)=>n+d.score/5*d.weight,0)):null;
  const nextProbes=dimensions.filter(d=>d.status!=='observed'||d.score===null).map(d=>({dimensionId:d.id,dimension:d.name,status:d.status,question:d.evidence.find(r=>r.nextProbe)?.nextProbe||d.nextProbe||'请补充能说明该能力的回答证据。'}));
  const improvementMap=new Map();
  for(const d of dimensions)for(const r of d.evidence){if(r.improvement&&!r.duplicateOf){const key=`${d.id}:${normalizedQuote(r.improvement)}`;if(!improvementMap.has(key))improvementMap.set(key,{dimensionId:d.id,dimension:d.name,suggestion:r.improvement,quote:r.quote,responseId:r.responseId,checked:false,score:r.score});}}
  const improvements=[...improvementMap.values()].sort((a,b)=>(a.score??6)-(b.score??6));
  const assessmentStatus=legacy?'legacy':assisted?'assisted_practice':complete?'complete':assessed||partial?'partial':'unassessed';
  return {dimensions,languageDimensions,trainingTotal,coverage:{assessed,total:dimensions.length,partial,unassessed:dimensions.length-assessed-partial,criticalMissing,answered:answers.filter(t=>!t.skipped).length,skipped:answers.filter(t=>t.skipped).length,stageIds:[...new Set(answers.filter(t=>!t.skipped).map(t=>t.stageId).filter(Boolean))]},evidenceLedger,nextProbes,improvements,assessmentStatus,assisted,legacy,warnings};
}
