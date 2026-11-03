import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {Store} from '../src/store.js';
import {modelFromEnv,evaluateAnswer,evaluateOfficial,buildReport} from '../src/ai.js';

const store=new Store(fileURLToPath(new URL('../data/',import.meta.url)));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const [sid,time,action,planId]=process.argv.slice(2);
if(!/^[a-zA-Z0-9_-]{1,128}$/.test(sid||'')||!time)throw Error('Specify session ID and expected interview time');
const original=store.get('sessions',sid);
if(!original||original.status!=='complete'||original.profile.interviewTime!==time)throw Error('Session time or status mismatch');
if(action==='--apply'){
  const plan=store.get('regrades',planId);
  if(!plan||plan.sessionId!==sid||plan.originalHash!==hash(original))throw Error('Saved record changed or grading plan is invalid');
  const backup=path.join(store.root,'backups',`content-${sid}-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,JSON.stringify(original,null,2),{flag:'wx',mode:0o600});
  store.put('sessions',sid,plan.updated);
  console.log(JSON.stringify({applied:true,sessionId:sid,backup,assessmentStatus:plan.updated.report.assessmentStatus,trainingTotal:plan.updated.report.trainingTotal,dimensions:plan.updated.report.dimensions.map(d=>({name:d.name,status:d.status,score:d.score}))}));
}else if(action==='--prepare'){
  const configured=modelFromEnv();if(!configured)throw Error('Scoring model is not configured');
  const llm=(messages,options)=>configured(messages,{...options,timeoutMs:120000});
  const updated=structuredClone(original),answers=updated.turns.filter(t=>t.role==='candidate'&&!t.skipped);
  for(const [index,answer] of answers.entries()){
    const question=updated.turns.find(q=>q.role==='interviewer'&&q.id===answer.questionId);if(!question)throw Error('Question association missing');
    try{answer.evaluation=await evaluateAnswer(llm,updated,{...question,responseId:answer.id},answer.content);}
    catch(error){console.error(JSON.stringify({answer:index+1,error:error.status?`Model request HTTP ${error.status}`:String(error.message).slice(0,250)}));process.exitCode=1;break;}
    console.log(JSON.stringify({answer:index+1,scored:answer.evaluation.dimensions.filter(d=>d.score!==null).length}));
  }
  if(!process.exitCode){
    try{updated.official=await evaluateOfficial(llm,updated);}catch(error){console.error(JSON.stringify({official:true,error:error.status?`Model request HTTP ${error.status}`:String(error.message).slice(0,250)}));process.exitCode=1;}
    if(process.exitCode)process.exit(process.exitCode);
    const multimodalEvaluation=original.report.multimodalEvaluation;
    updated.report=buildReport(updated,store.list('sessions'));
    if(multimodalEvaluation)updated.report.multimodalEvaluation=multimodalEvaluation;
    updated.contentRegrade={at:new Date().toISOString(),method:'configured_model_using_frozen_rubric',previousMode:original.mode};
    if(hash(updated.turns.map(({evaluation,...turn})=>turn))!==hash(original.turns.map(({evaluation,...turn})=>turn)))throw Error('Original answers changed');
    if(hash(updated.multimodal)!==hash(original.multimodal))throw Error('Multimodal evidence changed');
    const id=randomUUID();store.put('regrades',id,{id,sessionId:sid,originalHash:hash(original),updated});
    console.log(JSON.stringify({prepared:true,planId:id,assessmentStatus:updated.report.assessmentStatus,trainingTotal:updated.report.trainingTotal,dimensions:updated.report.dimensions.map(d=>({name:d.name,status:d.status,score:d.score}))}));
  }
}else throw Error('Choose --prepare or --apply PLAN_ID');
