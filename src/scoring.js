import {validateGroup,aggregateEvidence} from './evidence.js';

export const SCORING_VERSION='answer-performance-v2';
const TARGETS={english:['logic','evidence'],portfolio:['logic','evidence','decision'],design:['logic','knowledge','reflection'],ethics:['ethics']};
export function questionTargets(rubric,stageId){return (TARGETS[stageId]??[]).filter(id=>rubric.dimensions.some(d=>d.id===id&&(!d.stages||d.stages.includes(stageId))));}
export function scoringPolicy(stages){return {version:SCORING_VERSION,stageWeights:Object.fromEntries(stages.map(s=>[s.id,({english:20,portfolio:40,design:30,ethics:10})[s.id]??1])),note:'按已取得有效评分的环节权重归一化；未完成评分或未考察范围单列，不补零。'};}
export function diagnose(error){
  const status=Number(error?.status)||null,message=String(error?.message??'');
  const code=error?.code??(status===429?'rate_limit':status===401||status===403?'authentication':status?'http':/timeout|abort/i.test(message+' '+error?.name)?'timeout':/fetch|network|connect/i.test(message)?'network':'validation');
  const labels={rate_limit:'服务限流或额度不足',authentication:'模型认证或权限失败',http:'模型服务请求失败',timeout:'评分请求超时',network:'模型网络连接失败',validation:'模型评分格式或证据校验失败',evidence_quote:'评分引用未能对应回答原文',score_fields:'评分理由或证据边界字段缺失',score_status:'评分状态与本题范围不一致',json_format:'模型返回不是完整JSON',incomplete:'模型返回被截断',refusal:'模型未完成该项评价',not_configured:'尚未连接评分模型'};
  // Never persist provider bodies, credentials, or raw exception messages.
  return {code,httpStatus:status,message:labels[code]??'评分暂未完成',at:new Date().toISOString()};
}
export function salvageEvaluation(data,answer,question,rubric){
  const errors=[];
  const group=(key,defs,name)=>defs.map(d=>{
    const candidates=Array.isArray(data?.[key])?data[key].filter(x=>x?.id===d.id):[];
    try{if(candidates.length!==1)throw Error('Missing or duplicate dimension');return validateGroup(candidates,[d],answer,question,name)[0];}
    catch(error){const message=String(error?.message??'');const code=/引文|原文/.test(message)?'evidence_quote':/理由|边界|追问/.test(message)?'score_fields':/状态|环节|不能评分/.test(message)?'score_status':'validation';errors.push({group:name,id:d.id,code});return {gradingStatus:'pending',id:d.id,name:d.name,status:'not_assessed',score:null,quote:'',reason:'本项尚待模型补评',limitation:'未生成合格的原文评价',nextProbe:d.nextProbe??'请补充具体依据',responseId:question.responseId,questionId:question.id};}
  });
  const result={dimensions:group('dimensions',rubric.dimensions,'professional'),languageDimensions:group('languageDimensions',rubric.languageDimensions,'language'),feedback:String(data?.feedback??'').slice(0,2500),followup:String(data?.followup??'').slice(0,1500),improvedAnswer:'',exercise:'',validationErrors:errors};
  return result;
}
export function scoreProgress(turn,rubric,question){
  if(turn.skipped)return {status:'skipped',score:null};
  const targets=question?.scoringTargets??questionTargets(rubric,turn.stageId);
  const dimensions=turn.evaluation?.dimensions??[];
  const scored=targets.filter(id=>dimensions.some(d=>d.id===id&&typeof d.score==='number'&&d.score>=1&&d.score<=5&&['observed','partly_observed'].includes(d.status)&&d.quote&&d.reason&&d.limitation&&d.nextProbe&&(turn.content===undefined||turn.content.includes(d.quote))));
  const selected=dimensions.filter(d=>scored.includes(d.id));
  const weight=selected.reduce((n,d)=>n+(rubric.dimensions.find(x=>x.id===d.id)?.weight??0),0);
  const score=weight?Math.round(selected.reduce((n,d)=>n+d.score/5*(rubric.dimensions.find(x=>x.id===d.id)?.weight??0),0)/weight*1000)/10:null;
  return {status:scored.length&&scored.length===targets.length?'complete':scored.length?'partial':'pending',score,targets,scored,missing:targets.filter(id=>!scored.includes(id))};
}
export function performanceSummary(session,rubric){
  const aggregate=aggregateEvidence(session,rubric),answers=session.turns.filter(t=>t.role==='candidate'&&!t.skipped);
  const questions=answers.map(t=>({responseId:t.id,questionId:t.questionId,stageId:t.stageId,...scoreProgress(t,rubric,session.turns.find(q=>q.id===t.questionId)),diagnostics:t.scoring?.diagnostics??[]}));
  const stages=session.profile.stages.map(stage=>{
    const records=aggregate.evidenceLedger.filter(e=>e.group==='professional'&&e.stageId===stage.id&&e.independent&&e.score!==null&&(session.turns.find(q=>q.id===e.questionId)?.scoringTargets??questionTargets(rubric,stage.id)).includes(e.dimensionId));
    const ids=[...new Set(records.map(e=>e.dimensionId))];
    const dims=ids.map(id=>{const values=records.filter(e=>e.dimensionId===id);return {weight:rubric.dimensions.find(d=>d.id===id)?.weight??0,score:values.reduce((n,e)=>n+e.score,0)/values.length};});
    const weight=dims.reduce((n,d)=>n+d.weight,0);
    return {id:stage.id,name:stage.name,weight:session.scoringPolicy.stageWeights[stage.id],score:weight?Math.round(dims.reduce((n,d)=>n+d.score/5*d.weight,0)/weight*1000)/10:null};
  });
  const assessed=stages.filter(s=>s.score!==null),weight=assessed.reduce((n,s)=>n+s.weight,0),allWeight=stages.reduce((n,s)=>n+s.weight,0);
  const total=weight&&!aggregate.assisted&&!aggregate.legacy?Math.round(assessed.reduce((n,s)=>n+s.score*s.weight,0)/weight*10)/10:null;
  return {version:SCORING_VERSION,total,questions,stages,answered:answers.length,completed:questions.filter(q=>q.status==='complete').length,pending:questions.filter(q=>q.status!=='complete').length,scoredStageWeight:weight,totalStageWeight:allWeight,abilityCoverage:aggregate.dimensions.filter(d=>d.score!==null).length,scope:'已评分范围的本场作答表现，不代表完整能力或官方考试成绩'};
}
