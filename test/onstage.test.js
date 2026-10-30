import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { OnStage } from '../src/app.js';
import { cacheKey,STAGES,DIMENSIONS,validateOfficialRubric,sourceRecord } from '../src/domain.js';
import { validateEvaluation,buildReport,evaluateOfficial } from '../src/ai.js';
import { parseMaterial } from '../src/materials.js';
import { createServer } from '../src/server.js';

function fixture(t,llm=null) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onstage-test-'));
  t.after(()=>{const checked=path.resolve(root);if(!checked.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(checked).startsWith('onstage-test-'))throw Error('Unsafe test cleanup');fs.rmSync(checked,{recursive:true,force:true});});
  const store=new Store(root),app=new OnStage(store,llm);
  for(const kind of ['resume','portfolio'])store.put('materials',kind,{id:kind,kind,name:`${kind}.txt`,text:'设计研究项目：个人负责访谈、原型与验证。',status:'parsed',hash:kind});
  const input={nickname:'练习同学',school:'测试设计学院',college:'设计学院',major:'交互设计',year:'2027',admissionType:'推免面试',interviewTime:'2026-11-02T10:00:00+08:00',attempt:1,materialIds:['resume','portfolio'],rulesText:'本测试考察作品讲述与英语表达。',rubricText:'仅用于测试的评分文本。',stages:STAGES.slice(0,2)};
  return {root,store,app,input};
}
function scored(answer='我通过访谈形成研究问题。') {return {dimensions:DIMENSIONS.map(d=>({id:d.id,score:3,quote:answer,reason:'说明了基本研究步骤。',improvement:'补充验证与反思。'})),feedback:'请补充验证。',followup:'如何验证你的判断？'};}
test('场次身份包含昵称、院校、专业、时间与次数，且无明文身份路径',()=>{
  const input={nickname:'甲',school:'甲校',major:'设计学',interviewTime:'2026-11-02T10:00:00+08:00',attempt:1};
  const original=cacheKey(input);assert.match(original,/^[a-f0-9]{64}$/);
  for(const [key,value] of Object.entries({nickname:'乙',school:'乙校',major:'艺术设计',interviewTime:'2026-11-03T10:00:00+08:00',attempt:2}))assert.notEqual(original,cacheKey({...input,[key]:value}));
  assert.throws(()=>cacheKey({...input,attempt:0}));assert.throws(()=>cacheKey({...input,interviewTime:'tomorrow'}));
});
test('档案路径拒绝穿越',t=>{const {store}=fixture(t);assert.throws(()=>store.get('sessions','../private'));assert.throws(()=>store.get('../sessions','abc'));});
test('设置要求简历、作品集、院校考核细则与评分文本',t=>{
  const {app,input}=fixture(t);assert.throws(()=>app.profile({...input,rulesText:''}),/细则/);assert.throws(()=>app.profile({...input,materialIds:['resume']}),/作品集/);
  const p=app.profile(input);assert.equal(p.school,input.school);assert.equal(p.officialRubric,null);
});
test('院校权重必须完整、唯一且合计 100%，不能用训练权重冒充',()=>{
  const rubric=[{id:'a',name:'专业',weight:70,criterion:'说明作品设计依据'},{id:'b',name:'英语',weight:30,criterion:'回答英文问题'}];
  assert.equal(validateOfficialRubric(rubric).length,2);
  assert.throws(()=>validateOfficialRubric([{...rubric[0],weight:60}]));
  assert.throws(()=>validateOfficialRubric([{...rubric[0],weight:50},{...rubric[0],weight:50}]));
});
test('无模型可完成面试流程，但不会产生虚构分数',async t=>{
  const {app,input}=fixture(t);const p=app.profile(input);let s=await app.start(p.id);
  assert.equal(Object.keys(s.plan.layers).length,7);assert.equal(s.mode,'demo');
  s=await app.answer(s.id,{questionId:s.turns.at(-1).id,answer:'我通过访谈形成研究问题。'});
  assert.ok(s.turns.at(-1).evaluation.dimensions.every(x=>x.score===null));
  s=await app.advance(s.id,'followup');assert.equal(s.turns.at(-1).role,'interviewer');
  s=await app.answer(s.id,{questionId:s.turns.at(-1).id,answer:'我会用可用性测试验证原型。'});
  s=await app.advance(s.id,'next');assert.equal(s.stageIndex,1);
  s=await app.answer(s.id,{questionId:s.turns.at(-1).id,answer:'我负责用户访谈和原型验证。'});
  s=await app.advance(s.id,'finish');assert.equal(s.status,'complete');assert.equal(s.report.trainingTotal,null);assert.equal(s.report.official.total,null);assert.equal(s.report.coverage.answered,3);
});
test('同一场不可重复创建，防止重用错误的材料快照',async t=>{
  const {app,input}=fixture(t);const p=app.profile(input);await app.start(p.id);await assert.rejects(()=>app.start(p.id),/此场身份已创建/);
  const p2=app.profile({...input,attempt:2});assert.equal((await app.start(p2.id)).profile.attempt,2);
});
test('暂停拒绝提交，恢复后可回答；双击提交不会新增重复答案',async t=>{
  const {app,input}=fixture(t);let s=await app.start(app.profile(input).id);const questionId=s.turns.at(-1).id;
  await app.advance(s.id,'pause');await assert.rejects(()=>app.answer(s.id,{questionId,answer:'回答'}),/恢复/);await app.advance(s.id,'resume');
  s=await app.answer(s.id,{questionId,answer:'回答问题并说明设计依据。'});await assert.rejects(()=>app.answer(s.id,{questionId,answer:'重复回答'}),/已回答/);
  assert.equal(app.get(s.id).turns.filter(t=>t.role==='candidate').length,1);
});
test('评分必须引用学生原文，证据不足为 null',()=>{
  const answer='我通过访谈形成研究问题。';assert.equal(validateEvaluation(scored(answer),answer).dimensions[0].score,3);
  assert.throws(()=>validateEvaluation(scored('模型编造的一句话'),answer),/原文/);
  const data=scored(answer);data.dimensions[0]={id:'logic',score:null,quote:'',reason:'未考察'};assert.equal(validateEvaluation(data,answer).dimensions[0].score,null);
  data.dimensions[1].score=NaN;assert.throws(()=>validateEvaluation(data,answer));
});
test('模型输出错误时保存回答而不退回关键词打分',async t=>{
  const {app,input}=fixture(t,async()=>'{"dimensions":[]}');let s=await app.start(app.profile(input).id);s=await app.answer(s.id,{questionId:s.turns.at(-1).id,answer:'首先其次最后，提升了 100 倍。'});
  assert.equal(s.turns.at(-1).evaluation.mode,'unavailable');assert.ok(s.turns.at(-1).evaluation.dimensions.every(d=>d.score===null));
});
test('院校总分由固定权重计算，缺失证据不补零',async()=>{
  const session={profile:{officialRubric:[{id:'portfolio',name:'作品',weight:60,criterion:'设计依据'},{id:'english',name:'英语',weight:40,criterion:'表达'}]},materials:[],sources:[],turns:[{role:'candidate',content:'我负责用户研究。'}]};
  const llm=async()=>JSON.stringify({items:[{id:'portfolio',score:80,quote:'我负责用户研究。',reason:'证据'},{id:'english',score:60,quote:'我负责用户研究。',reason:'证据'}]});
  assert.equal((await evaluateOfficial(llm,session)).total,72);
  const partial=async()=>JSON.stringify({items:[{id:'portfolio',score:80,quote:'我负责用户研究。'},{id:'english',score:null,quote:''}]});assert.equal((await evaluateOfficial(partial,session)).total,null);
});
test('跨次比较隔离专业和评分版本，传感器事件不影响内容评分',t=>{
  const {app,input}=fixture(t);const p=app.profile(input);const session={id:'s',profile:p,mode:'llm',identityScope:'scope',rubricHash:'rubric',sensors:[{channel:'gaze'}],turns:[{role:'candidate',stageId:'english',content:'证据',evaluation:scored('证据')}]};
  const report=buildReport(session,[]);assert.equal(report.trainingTotal,60);
  assert.equal(buildReport({...session,sensors:[]},[]).trainingTotal,60);
  const previous={...session,id:'old',createdAt:'2026-01-01',status:'complete',identityScope:'another',report};assert.equal(buildReport(session,[previous]).comparison,null);
  assert.ok(buildReport(session,[{...previous,identityScope:'scope'}]).comparison);
});
test('传感器未接入时保持空值，事件验证数值与类型',async t=>{
  const {app,input}=fixture(t);const s=await app.start(app.profile(input).id);assert.deepEqual(s.sensors,[]);
  assert.throws(()=>app.sensors(s.id,[{channel:'gaze',atMs:NaN,type:'tracking_state'}]));
  assert.equal(app.sensors(s.id,[{channel:'camera',atMs:100,type:'device_state',value:'preview_on'}]).sensors.length,1);
});
test('经验贴与标为官方的链接均保留未核验状态，不自动成为考试事实',()=>{
  assert.equal(sourceRecord({url:'https://example.org',title:'经验',type:'experience'}).confidence,'anecdotal');assert.equal(sourceRecord({url:'https://example.org',title:'规则',type:'official'}).verified,false);assert.throws(()=>sourceRecord({url:'javascript:alert(1)',title:'坏链接'}));
});
test('文本与不可读材料具有不同状态',async()=>{
  const text=await parseMaterial({name:'简历.txt',bytes:Buffer.from('设计学学生，作品与研究经历。'),kind:'resume'});assert.equal(text.status,'parsed');assert.ok(text.text.includes('设计学'));
  const image=await parseMaterial({name:'作品.png',bytes:Buffer.from([137,80,78,71]),kind:'portfolio'});assert.equal(image.status,'needs_text');
  const broken=await parseMaterial({name:'扫描.pdf',bytes:Buffer.from('%PDF-incomplete'),kind:'rules'});assert.equal(broken.status,'needs_text');
});
test('文字型 PDF 保留页码并提取内容',async()=>{
  const stream='BT /F1 16 Tf 30 150 Td (Design evidence) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const result=await parseMaterial({name:'portfolio.pdf',bytes:Buffer.from(pdf),kind:'portfolio'});assert.equal(result.status,'parsed');assert.equal(result.pages[0].page,1);assert.match(result.text,/Design evidence/);
});
test('改进清单勾选会保存至档案',async t=>{
  const {app,input}=fixture(t);let s=await app.start(app.profile(input).id);s=await app.advance(s.id,'finish');s.report.improvements=[{dimension:'逻辑结构',suggestion:'补充依据',checked:false}];app.save(s);
  app.checkImprovement(s.id,0,true);assert.equal(app.get(s.id).report.improvements[0].checked,true);assert.throws(()=>app.checkImprovement(s.id,2,true));
});
test('HTTP 完整链路、上传、导出、跨来源请求与路径边界',async t=>{
  const {store}=fixture(t);const server=createServer({store,llm:null,env:{}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const cfg=await fetch(base+'/api/config');assert.equal(cfg.status,200);assert.equal((await cfg.json()).mode,'demo');
  assert.equal((await fetch(base+'/api/profiles',{method:'POST',headers:{Origin:'https://outside.example'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/profiles',{method:'POST',body:'bad JSON'})).status,400);
  assert.equal((await fetch(base+'/%2e%2e%2f.env')).status,404);
  const form=new FormData();form.append('kind','resume');form.append('file',new Blob(['测试简历'],{type:'text/plain'}),'resume.txt');const upload=await fetch(base+'/api/materials',{method:'POST',body:form});assert.equal(upload.status,201);
  const material=await upload.json();assert.equal((await fetch(base+`/api/materials/${material.id}/file`)).status,200);
  const profile={nickname:'测试',school:'测试学校',college:'设计学院',major:'设计学',year:'2027',admissionType:'复试',interviewTime:'2026-12-01T09:00+08:00',attempt:1,materialIds:[material.id,'portfolio'],rulesText:'测试细则',rubricText:'测试标准',stages:[STAGES[1]]};
  const send=async(url,body)=>{const r=await fetch(base+url,{method:'POST',body:JSON.stringify(body)});assert.ok(r.ok);return r.json();};
  const p=await send('/api/profiles',profile);let s=await send('/api/sessions',{profileId:p.id});s=await send(`/api/sessions/${s.id}/answer`,{questionId:s.turns.at(-1).id,answer:'本项目由我负责访谈与验证。'});await send(`/api/sessions/${s.id}/action`,{action:'finish'});
  const exported=await fetch(base+`/api/sessions/${s.id}/export?format=md`);assert.equal(exported.status,200);assert.match(await exported.text(),/ON STAGE/);
});
