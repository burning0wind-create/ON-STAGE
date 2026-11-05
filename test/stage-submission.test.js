import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {createServer} from '../src/server.js';
import {STAGES} from '../src/domain.js';
import {completeInterviewAnswer} from '../public/interview-completion.js';

const answers=[
  'I interviewed students and tested two prototypes before choosing the final design.',
  '作品集项目中，我负责用户访谈、交互原型和可用性验证，并记录设计取舍。',
  '我把访谈中的共同问题转为可测的设计标准，再用任务完成情况验证判断。',
  '我会标注生成式工具和团队成员的贡献，取得研究同意，并说明个人负责的部分。'
];

async function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onstage-stage-submission-'));
  const store=new Store(root),server=createServer({store,llm:null,env:{}}),requests=[];
  t.after(async()=>{
    if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    const checked=path.resolve(root);
    assert.ok(checked.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(checked).startsWith('onstage-stage-submission-'),'cleanup must stay inside this temporary test fixture');
    fs.rmSync(checked,{recursive:true,force:true});
  });
  for(const kind of ['resume','portfolio'])store.put('materials',kind,{id:kind,kind,name:kind+'.txt',text:'虚构的四环节提交回归材料。',status:'parsed',hash:kind});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function post(url,body){
    requests.push({url,body:structuredClone(body)});
    const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.error||'HTTP request failed'),{status:response.status});
    return data;
  }
  const profile=await post('/api/profiles',{
    nickname:'四环节提交测试',school:'虚构测试设计学院',college:'设计学院',major:'设计学',year:'2027',admissionType:'推免面试',interviewTime:'2026-12-01T10:00:00+08:00',attempt:1,
    materialIds:['resume','portfolio'],rulesText:'仅用于自动化测试的四环节面试细则。',rubricText:'仅用于测试的训练评分文本。',stages:STAGES
  });
  const session=await post('/api/sessions',{profileId:profile.id});
  const get=async()=>{const response=await fetch(base+'/api/sessions/'+session.id);assert.equal(response.status,200);return response.json();};
  const read=()=>store.get('sessions',session.id);
  return {session,post,get,read,requests};
}

function checkSaved(saved,index,questionId){
  assert.equal(saved.status,'active');assert.equal(saved.stageIndex,index);
  const answer=saved.turns.at(-1);
  assert.equal(answer.role,'candidate');assert.equal(answer.questionId,questionId);assert.equal(answer.stageId,STAGES[index].id);
  assert.equal(answer.content,answers[index]);assert.equal(answer.inputMode,index===1?'text':'speech');
  assert.equal(saved.turns.filter(turn=>turn.role==='candidate'&&turn.questionId===questionId).length,1);
}

function checkComplete(session,questionIds){
  assert.equal(session.status,'complete');assert.equal(session.stageIndex,3);assert.ok(session.report);
  assert.equal(session.report.coverage.answered,4);assert.equal(session.report.trainingTotal,null,'offline flow must not invent a score');
  const questions=session.turns.filter(turn=>turn.role==='interviewer'),responses=session.turns.filter(turn=>turn.role==='candidate');
  assert.equal(questions.length,4);assert.equal(responses.length,4);assert.equal(new Set(questionIds).size,4);
  for(let i=0;i<STAGES.length;i++){
    assert.equal(questions[i].id,questionIds[i]);assert.equal(questions[i].stageId,STAGES[i].id);
    const matched=responses.filter(turn=>turn.questionId===questionIds[i]);assert.equal(matched.length,1);assert.equal(matched[0].stageId,STAGES[i].id);assert.equal(matched[0].content,answers[i]);
  }
}

const complete=(session,index,dependencies)=>completeInterviewAnswer({session,answer:answers[index],inputMode:index===1?'text':'speech',durationMs:9000+index},dependencies);
const unavailable=label=>Object.assign(new Error(label),{status:503});

test('真实HTTP四环节逐题保存后再切换，末环节结束生成报告且每题只保存一份回答',async t=>{
  const f=await fixture(t),questionIds=[];let current=f.session;
  for(let i=0;i<STAGES.length;i++){
    assert.equal(current.stageIndex,i);assert.equal(current.turns.at(-1).stageId,STAGES[i].id);
    const questionId=current.turns.at(-1).id;questionIds.push(questionId);
    let savedBeforeAdvance=false;
    current=await complete(current,i,{post:f.post,onSaved:saved=>{
      checkSaved(saved,i,questionId);checkSaved(f.read(),i,questionId);savedBeforeAdvance=true;
    }});
    assert.equal(savedBeforeAdvance,true);assert.deepEqual(await f.get(),current);
    if(i<3){assert.equal(current.status,'active');assert.equal(current.stageIndex,i+1);assert.equal(current.turns.at(-1).role,'interviewer');assert.notEqual(current.turns.at(-1).id,questionId);}
  }
  checkComplete(current,questionIds);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/answer')).length,4);
  assert.deepEqual(f.requests.filter(r=>r.url.endsWith('/action')).map(r=>r.body.action),['next','next','next','finish']);
});

test('每个环节首次保存前503均保留当前题，重试后四环节正常完成且不会提前切换',async t=>{
  const f=await fixture(t),questionIds=[];let current=f.session;
  for(let i=0;i<STAGES.length;i++){
    const before=structuredClone(await f.get()),questionId=current.turns.at(-1).id;questionIds.push(questionId);
    let savedCalls=0,blocked=true;
    const post=async(url,body)=>{
      if(blocked&&url.endsWith('/answer')){blocked=false;throw unavailable('模拟保存前503');}
      return f.post(url,body);
    };
    const sentBefore=f.requests.length;
    await assert.rejects(complete(current,i,{post,onSaved:()=>savedCalls++}),error=>error.status===503);
    assert.equal(savedCalls,0);assert.equal(f.requests.length,sentBefore,'no advance request may follow a failed save');
    assert.deepEqual(await f.get(),before);assert.equal(current.turns.at(-1).id,questionId);
    current=await complete(current,i,{post,onSaved:saved=>{savedCalls++;checkSaved(saved,i,questionId);}});
    assert.equal(savedCalls,1);
  }
  checkComplete(await f.get(),questionIds);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/answer')).length,4);
});

test('每个环节保存后切换或生成报告前503可从已保存状态恢复，不重新提交答案',async t=>{
  const f=await fixture(t),questionIds=[];let current=f.session;
  for(let i=0;i<STAGES.length;i++){
    const questionId=current.turns.at(-1).id;questionIds.push(questionId);
    let saved,blocked=true;
    const post=async(url,body)=>{
      if(blocked&&url.endsWith('/action')){blocked=false;throw unavailable('模拟切换前503');}
      return f.post(url,body);
    };
    await assert.rejects(complete(current,i,{post,onSaved:value=>{saved=value;}}),error=>/回答已保存/.test(error.message)&&error.cause?.status===503);
    checkSaved(saved,i,questionId);assert.deepEqual(await f.get(),saved);
    const sentBefore=f.requests.length;
    await assert.rejects(complete(saved,i,{post:f.post}),/当前没有可提交的问题/);
    assert.equal(f.requests.length,sentBefore,'the recovery state must not send an answer twice');
    current=await f.post(`/api/sessions/${saved.id}/action`,{action:i===3?'finish':'next'});
    assert.equal(current.turns.filter(turn=>turn.role==='candidate'&&turn.questionId===questionId).length,1);
  }
  checkComplete(await f.get(),questionIds);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/answer')).length,4);
  assert.deepEqual(f.requests.filter(r=>r.url.endsWith('/action')).map(r=>r.body.action),['next','next','next','finish']);
});
