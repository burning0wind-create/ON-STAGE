import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildTrainingRubric} from '../public/rubrics.js';
import {scoringPolicy,performanceSummary,diagnose,salvageEvaluation} from '../src/scoring.js';
import {evaluateCore} from '../src/core-evaluation.js';
import {createLlm} from '../src/llm/provider.js';
import {Store} from '../src/store.js';
import {OnStage} from '../src/app.js';
import {reportMarkdown} from '../src/report-export.js';
import {scoringPanel} from '../public/scoring-ui.js';
import {createServer} from '../src/server.js';
const rubric=buildTrainingRubric({majorCode:'140300'}),answer='我只做了初步访谈，没有验证结论。';
const question={id:'q',responseId:'a',role:'interviewer',stageId:'portfolio',content:'说明依据',scoringTargets:['logic','evidence','decision']};
function data(q=question,text=answer){const item=d=>({id:d.id,status:d.stages.includes(q.stageId)?'partly_observed':'not_assessed',score:d.stages.includes(q.stageId)?2:null,quote:d.stages.includes(q.stageId)?text:'',reason:'解释停留在初步描述',limitation:'只依据本人回答',nextProbe:'如何验证？'});return{dimensions:rubric.dimensions.map(item),languageDimensions:rubric.languageDimensions.map(item),feedback:'需补充依据',followup:'请补充验证'};}
function session(){return{id:'session',rubric,profile:{stages:[{id:'portfolio',name:'作品'},{id:'ethics',name:'伦理'}]},scoringPolicy:scoringPolicy([{id:'portfolio'},{id:'ethics'}]),turns:[question,{id:'a',role:'candidate',stageId:'portfolio',questionId:'q',content:answer,evaluation:{mode:'llm',...salvageEvaluation(data(),answer,question,rubric)}}],sensors:[]};}
test('部分观察也产生有范围的表现分，能力覆盖不被伪造为完整',()=>{const s=session(),p=performanceSummary(s,rubric);assert.equal(p.total,40);assert.equal(p.completed,1);assert.equal(p.totalStageWeight,50);assert.equal(p.scoredStageWeight,40);assert.equal(p.abilityCoverage,6);assert.equal(p.stages[1].score,null);assert.match(p.scope,/已评分范围/);});
test('一项伪造引文不会清空其他合格分项，也不会放过伪造项',()=>{const d=data();d.dimensions[0].quote='虚构引文';const s=salvageEvaluation(d,answer,question,rubric);assert.equal(s.dimensions[0].score,null);assert.equal(s.dimensions[1].score,2);assert.equal(s.validationErrors.length,1);});
test('暂时错误重试，格式修复保留前次合格评分',async()=>{let calls=0;const d=data();d.dimensions[0].quote='错误引文';const result=await evaluateCore(async()=>{calls++;if(calls===1)throw Object.assign(Error('provider secret sk-never-save'),{status:429});return JSON.stringify(calls===2?d:data());},session(),question,answer);assert.equal(calls,3);assert.equal(result.scoring.status,'complete');assert.equal(result.dimensions[0].score,2);assert.doesNotMatch(JSON.stringify(result.scoring),/sk-never-save/);assert.equal(result.scoring.diagnostics[0].code,'rate_limit');});
test('认证失败不盲目重试、缺少模型不编造分数',async()=>{let calls=0;const result=await evaluateCore(async()=>{calls++;throw Object.assign(Error('secret'),{status:401});},session(),question,answer);assert.equal(calls,1);assert.equal(result.scoring.status,'pending');assert.ok(result.dimensions.every(d=>d.score===null));assert.equal(diagnose({name:'TimeoutError'}).code,'timeout');assert.equal((await evaluateCore(null,session(),question,answer)).scoring.diagnostics[0].code,'not_configured');});
test('重复证据、语言分及设备数据不抬高表现分，辅助练习不汇总',()=>{const s=session(),before=performanceSummary(s,rubric).total;s.turns.push({...s.turns[1],id:'again'});s.sensors=[{channel:'gaze'}];s.turns[1].evaluation.languageDimensions.forEach(d=>d.score=5);assert.equal(performanceSummary(s,rubric).total,before);s.assisted=true;assert.equal(performanceSummary(s,rubric).total,null);});
test('后台任务保存评分中状态，允许继续下一环节；重启恢复任务且保留原回答',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'onstage-jobs-'));t.after(()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 const store=new Store(root),s=session();s.status='active';s.profile.stages=[{id:'portfolio',name:'作品',question:'解释作品'},{id:'ethics',name:'伦理',question:'解释伦理'}];s.plan={layers:{strategy:[]}};s.stageIndex=0;s.turns=[question];store.put('sessions',s.id,s);
 let release;const gate=new Promise(resolve=>release=resolve);const app=new OnStage(store,async messages=>{await gate;const input=JSON.parse(messages[1].content);return JSON.stringify(data(input.question,input.answer));});
 const submitted=await app.submitAnswer(s.id,{questionId:'q',answer});assert.equal(submitted.turns.at(-1).content,answer);assert.equal(submitted.turns.at(-1).scoring.status,'pending');
 await app.advance(s.id,'next');assert.equal(app.get(s.id).stageIndex,1);release();await app.jobs.get(s.id);assert.equal(app.get(s.id).turns[1].scoring.status,'complete');assert.equal(app.get(s.id).turns.at(-1).stageId,'ethics');
 const saved=app.get(s.id);saved.turns[1].evaluation={dimensions:[],languageDimensions:[]};saved.turns[1].scoring={status:'running'};store.put('sessions',saved.id,saved);const restarted=new OnStage(store,async messages=>{const input=JSON.parse(messages[1].content);return JSON.stringify(data(input.question,input.answer));});restarted.recoverScoring();await restarted.jobs.get(saved.id);assert.equal(restarted.get(saved.id).turns[1].content,answer);assert.equal(restarted.get(saved.id).turns[1].scoring.status,'complete');
});
test('OpenAI使用严格结构输出，识别被截断的响应',async t=>{const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);let body;globalThis.fetch=async(_,opts)=>{body=JSON.parse(opts.body);return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{}'}}]}));};const llm=createLlm({apiKey:'test',baseUrl:'https://api.openai.com/v1',model:'gpt-4.1-mini'});await assert.rejects(()=>llm([{role:'user',content:'JSON'}],{jsonSchema:{type:'object',properties:{},additionalProperties:false}}),e=>e.code==='incomplete');assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);});
test('报告与界面保留待补评原因、分数适用范围和逐题分数',()=>{const s=session(),perf=performanceSummary(s,rubric);s.report={performance:perf,rubric,dimensions:[],trainingTotal:perf.total,coverage:{},official:{}};s.turns[1].scoring={status:'pending',diagnostics:[{code:'timeout',message:'评分请求超时'}]};const ui=scoringPanel(s);assert.match(ui,/评分请求超时/);assert.match(ui,/重试未完成评分/);assert.match(ui,/已作答/);assert.match(reportMarkdown(s),/本场作答表现参考分：40/);});
test('非预设考察项即使获得高分，也不会临时改变本题和环节权重',()=>{const s=session();for(const d of s.turns[1].evaluation.dimensions)if(!question.scoringTargets.includes(d.id))d.score=5;assert.equal(performanceSummary(s,rubric).total,40);});
test('HTTP提交先返回已保存状态，结束后自动更新报告，补评保留历史快照',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'onstage-http-jobs-'));const store=new Store(root),s=session();s.status='active';s.createdAt=new Date().toISOString();s.lastResumedAt=s.createdAt;s.activeMs=0;s.profile.stages=[{id:'portfolio',name:'作品',question:'解释作品'}];s.plan={layers:{strategy:[]}};s.stageIndex=0;s.turns=[question];store.put('sessions',s.id,s);
 let release;const gate=new Promise(resolve=>release=resolve);const llm=async messages=>{await gate;const input=JSON.parse(messages[1].content);return JSON.stringify(data(input.question,input.answer));};
 const server=createServer({store,llm,env:{}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{release();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,send=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok);return r;};
 const response=await send('/api/sessions/session/answer',{questionId:'q',answer});assert.equal(response.status,202);assert.equal((await response.json()).turns.at(-1).content,answer);
 await send('/api/sessions/session/action',{action:'finish'});assert.equal(store.get('sessions','session').report.performance.pending,1);release();
 for(let i=0;i<50&&store.get('sessions','session').scoringJob?.status!=='idle';i++)await new Promise(resolve=>setTimeout(resolve,10));
 const complete=store.get('sessions','session');assert.equal(complete.report.performance.completed,1);assert.equal(complete.report.trainingTotal,40);assert.equal(complete.report.performance.pending,0);
 await send('/api/sessions/session/action',{action:'retry-scores'});assert.equal(store.list('score-revisions').length,1);
 for(let i=0;i<50&&store.get('sessions','session').scoringJob?.status!=='idle';i++)await new Promise(resolve=>setTimeout(resolve,10));
 const md=await(await fetch(base+'/api/sessions/session/export?format=md')).text();assert.match(md,/本场作答表现参考分：40/);assert.match(md,/待补评0题/);
});
