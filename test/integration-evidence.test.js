import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { OnStage } from '../src/app.js';
import { STAGES } from '../src/domain.js';
import { getExamLibrary } from '../src/exam-library.js';
import { evaluateOfficial } from '../src/ai.js';
import { createServer } from '../src/server.js';

function fixture(t,llm=null){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onstage-integration-'));
  t.after(()=>{const resolved=path.resolve(root);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('onstage-integration-'));fs.rmSync(resolved,{recursive:true,force:true});});
  const store=new Store(root),app=new OnStage(store,llm);
  for(const kind of ['resume','portfolio'])store.put('materials',kind,{id:kind,kind,name:kind+'.txt',text:'虚构测试作品与研究',status:'parsed',hash:kind});
  const record=getExamLibrary().records.find(r=>r.id==='hunan-design-2027-recommended');
  const input={nickname:'集成测试',schoolId:'hunan',school:'湖南大学',collegeId:'hunan-design',programId:'hunan-design-140300',year:'2027',admissionType:'推免面试',interviewTime:'2026-11-01T10:00',attempt:1,materialIds:['resume','portfolio'],stages:STAGES,rulesText:record.rulesText,rubricText:record.rubricText,officialRubric:record.officialRubric,examLibraryId:record.id};
  return {store,app,input,record};
}
test('官网记录校验后保存独立快照，客户端不能伪造专业训练量表',async t=>{
  const {app,input,record}=fixture(t);
  const profile=app.profile({...input,trainingRubric:{id:'forged',dimensions:[]}});
  assert.equal(profile.examLibrary.userEdited,false);assert.notEqual(profile.trainingRubric.id,'forged');
  record.title='changed';assert.notEqual(profile.examLibrary.title,record.title);
  let session=await app.start(profile.id);const frozen=structuredClone(session.rubric);
  profile.trainingRubric.dimensions[0].weight=99;
  assert.deepEqual(app.get(session.id).rubric,frozen);
  session=await app.advance(session.id,'skip');
  assert.equal(session.turns.at(-1).skipped,true);
  session=await app.advance(session.id,'finish');
  assert.equal(session.report.coverage.answered,0);assert.equal(session.report.coverage.skipped,1);
  assert.equal(session.report.trainingTotal,null);assert.equal(session.report.official.total,null);
});
test('跨年份、学院和未核验官网依据不能进入本场',t=>{
  const {app,input}=fixture(t);
  assert.throws(()=>app.profile({...input,year:'2026'}),/不匹配/);
  assert.throws(()=>app.profile({...input,schoolId:'jiangnan',school:'江南大学',collegeId:'jiangnan-003',programId:'jiangnan-003-140300'}),/不匹配/);
  assert.throws(()=>app.profile({...input,schoolId:'tongji',school:'同济大学',collegeId:'tongji-270',programId:'tongji-270-140300',examLibraryId:'tongji-design-2027-pending'}),/尚待核验/);
  assert.equal(app.profile({...input,rulesText:input.rulesText+'\n本人补充练习安排'}).examLibrary.userEdited,true);
});
test('新版评分接口绑定真实回答ID；模型无效证据降级保存而不评分',async t=>{
  let rubric;
  const llm=async messages=>{
    if(messages[0].content.includes('七层预分析'))throw Error('test uses configured plan');
    const {question,answer}=JSON.parse(messages[1].content.split('\n').at(-1));
    const item=d=>({id:d.id,status:d.stages.includes(question.stageId)?'observed':'not_assessed',score:d.stages.includes(question.stageId)?3:null,quote:d.stages.includes(question.stageId)?answer:'',reason:'观察到具体解释',limitation:'材料未经独立验证',nextProbe:'还需什么证据？'});
    return JSON.stringify({dimensions:rubric.dimensions.map(item),languageDimensions:rubric.languageDimensions.map(item),followup:'替代方案是什么？'});
  };
  const {app,input}=fixture(t,llm);const profile=app.profile(input);let s=await app.start(profile.id);rubric=s.rubric;
  s=await app.answer(s.id,{questionId:s.turns.at(-1).id,answer:'测试回答中的项目验证过程。'});
  const turn=s.turns.at(-1);assert.equal(turn.evaluation.mode,'llm');
  assert.equal(turn.evaluation.dimensions[0].responseId,turn.id);
  assert.equal(turn.evaluation.dimensions[0].questionId,turn.questionId);
  app.llm=async()=>JSON.stringify({dimensions:[]});s=await app.advance(s.id,'followup');
  s=await app.answer(s.id,{questionId:s.turns.at(-1).id,answer:'需要保留的第二条回答。'});
  assert.equal(s.turns.at(-1).content,'需要保留的第二条回答。');
  assert.equal(s.turns.at(-1).evaluation.mode,'unavailable');
  assert.ok(s.turns.at(-1).evaluation.dimensions.every(d=>d.score===null));
});
test('院校评价拒绝跨题引用，并禁止辅助练习汇总',async t=>{
  const {app,input}=fixture(t);let s=await app.start(app.profile(input).id);
  s=await app.answer(s.id,{questionId:s.turns.at(-1).id,answer:'测试证据原文。'});
  const response=s.turns.at(-1);
  const data={items:s.profile.officialRubric.map(d=>({id:d.id,status:'observed',score:80,quote:response.content,responseId:response.id,questionId:response.questionId,reason:'本题解释',limitation:'仅本题证据',nextProbe:'补充验证'}))};
  assert.equal((await evaluateOfficial(async()=>JSON.stringify(data),s)).total,80);
  assert.equal((await evaluateOfficial(async()=>JSON.stringify(data),{...s,assisted:true})).total,null);
  data.items[0].responseId='another-answer';
  await assert.rejects(()=>evaluateOfficial(async()=>JSON.stringify(data),s),/证据记录不完整/);
});
test('官网考核库API返回版本化数据，报告导出保留本场依据和跳过状态',async t=>{
  const {store,app,input}=fixture(t);let s=await app.start(app.profile(input).id);
  await app.advance(s.id,'skip');s=await app.advance(s.id,'finish');
  const server=createServer({store,llm:null,env:{}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const library=await(await fetch(base+'/api/exam-library')).json();assert.ok(library.version);assert.equal(library.records.length,9);
  const output=await(await fetch(`${base}/api/sessions/${s.id}/export?format=md`)).text();
  assert.match(output,/onstage-evidence-v1/);assert.match(output,/跳过/);assert.match(output,/design\.hnu\.edu\.cn/);
});
