import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Store} from '../src/store.js';
import {buildInterviewReport} from '../public/multimodal/interview-report.js';
import {summarizeAuxiliaryCaptures} from '../public/multimodal/auxiliary-scores.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const [sid,expectedTime,flag]=process.argv.slice(2);
if(!/^[a-zA-Z0-9_-]{1,128}$/.test(sid||'')||!expectedTime)throw Error('Usage: node scripts/backfill-multimodal.mjs SESSION_ID EXPECTED_INTERVIEW_TIME [--write]');
const store=new Store(path.join(root,'data')),session=store.get('sessions',sid);
if(!session||session.status!=='complete'||session.profile.interviewTime!==expectedTime)throw Error('场次时间或状态不匹配，未修改记录');
const original=structuredClone(session),records=[];
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const answersBefore=fingerprint(session.turns),professionalBefore=fingerprint(session.report);
for(const summary of session.multimodal||[]){
  const saved=store.get('captures',summary.id);
  if(saved?.sessionId!==sid)throw Error('采集所属场次不匹配');
  const updated=structuredClone(saved);updated.capture.analysis=buildInterviewReport(updated.capture);
  records.push({id:summary.id,original:saved,updated});summary.analysis=updated.capture.analysis;
}
if(!records.length)throw Error('本场没有可补算的多模态记录');
session.report.multimodalEvaluation={...summarizeAuxiliaryCaptures(session.multimodal),backfilled_at:new Date().toISOString(),interviewTime:expectedTime};
if(fingerprint(session.turns)!==answersBefore)throw Error('回答被意外修改');
const reportCheck={...session.report};delete reportCheck.multimodalEvaluation;
const originalCheck={...original.report};delete originalCheck.multimodalEvaluation;
if(fingerprint(reportCheck)!==fingerprint(originalCheck))throw Error('原专业评价被意外修改');
let backup=null;
if(flag==='--write'){
  const backupDir=path.join(store.root,'backups');fs.mkdirSync(backupDir,{recursive:true});
  backup=path.join(backupDir,`multimodal-${sid}-${Date.now()}.json`);
  fs.writeFileSync(backup,JSON.stringify({session:original,captures:records.map(r=>r.original),answer_sha256:answersBefore,report_sha256:professionalBefore},null,2),{mode:0o600,flag:'wx'});
  for(const record of records)store.put('captures',record.id,record.updated);
  store.put('sessions',sid,session);
}
console.log(JSON.stringify({written:flag==='--write',sessionId:sid,interviewTime:expectedTime,backup,answers_unchanged:true,professional_scores_unchanged:true,captures:session.report.multimodalEvaluation.captures.map(c=>({id:c.captureId,items:c.scores.items.map(i=>({label:i.label,value:i.value,status:i.status_label}))}))},null,2));
