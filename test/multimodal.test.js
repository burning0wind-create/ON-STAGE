import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {OnStage} from '../src/app.js';
import {STAGES} from '../src/domain.js';
import {attachCapture,getCapture,transcriptForCapture} from '../src/multimodal.js';
import {createServer} from '../src/server.js';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onstage-mm-'));
  t.after(()=>{if(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('onstage-mm-'))fs.rmSync(root,{recursive:true,force:true});});
  const store=new Store(root);for(const kind of ['resume','portfolio'])store.put('materials',kind,{id:kind,kind,name:kind+'.txt',text:'虚构测试项目',hash:kind});
  return {store,app:new OnStage(store),input:{nickname:'多模态联调测试',school:'测试学校',college:'设计学院',major:'设计学',year:'2027',admissionType:'复试',interviewTime:'2026-12-01T09:00+08:00',attempt:1,materialIds:['resume','portfolio'],rulesText:'测试细则',rubricText:'测试标准',stages:[STAGES[1]]}};
}
function capture(s){return {id:'capture-test',source:{type:'camera'},duration_ms:10000,frames:[],events:[],host_time_origin_epoch_ms:Date.parse(s.createdAt),record_start_host_perf_ms:0,host_context:{sessionId:s.id},created_at:s.createdAt};}
test('capture binds to the correct interview, recomputes results, and upserts markers',async t=>{
  const {app,store,input}=fixture(t);const s=await app.start(app.profile(input).id),c=capture(s);c.analysis={fake:'untrusted'};
  const a=attachCapture(store,s.id,c);assert.equal(a.analysis.fake,undefined);assert.equal(getCapture(store,s.id,a.id).host_context.sessionId,s.id);
  c.events.push({type:'manual_marker',start_ms:2000,end_ms:2000,note:'回看'});assert.equal(attachCapture(store,s.id,c).id,a.id);assert.equal(app.get(s.id).multimodal.length,1);
  assert.equal(getCapture(store,s.id,a.id).events[0].note,'回看');assert.throws(()=>attachCapture(store,s.id,{...c,host_context:{sessionId:'other'}}));
  const other=await app.start(app.profile({...input,attempt:2}).id);assert.throws(()=>getCapture(store,other.id,a.id));
});
test('stored behavior does not change content scores and remains readable after finish',async t=>{
  const {app,store,input}=fixture(t);let s=await app.start(app.profile(input).id);const a=attachCapture(store,s.id,capture(s));
  s=await app.answer(s.id,{questionId:s.turns.at(-1).id,answer:'这是测试回答，没有实际面试评分。'});s=await app.advance(s.id,'finish');assert.equal(s.report.trainingTotal,null);assert.ok(getCapture(store,s.id,a.id));
  const c=getCapture(store,s.id,a.id);c.events.push({type:'manual_marker',start_ms:100,end_ms:100,note:'结束后补充'});attachCapture(store,s.id,c);assert.equal(app.get(s.id).report.trainingTotal,null);
});
test('submitted answers align to their speaking interval instead of the following silence',()=>{
  const epoch=Date.parse('2026-11-01T00:00:00Z');const at=s=>new Date(epoch+s*1000).toISOString();
  const turns=[{id:'q',role:'interviewer',content:'问题',createdAt:at(0)},{role:'candidate',questionId:'q',content:'真实回答',createdAt:at(12),durationMs:10000}];
  const tr=transcriptForCapture(turns,{host_time_origin_epoch_ms:epoch,record_start_host_perf_ms:5000,duration_ms:10000});
  assert.equal(tr.kind,'imported');assert.deepEqual(tr.segments.map(s=>[s.start_ms,s.end_ms,s.text]),[[0,7000,'真实回答']]);assert.match(tr.title,/非逐词/);
});
test('HTTP capture persistence, static WASM and framing keep loopback and same-origin boundaries',async t=>{
  const {app,store,input}=fixture(t);const s=await app.start(app.profile(input).id);const server=createServer({store,llm:null,env:{}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`,url=base+`/api/sessions/${s.id}/multimodal`;
  const response=await fetch(url,{method:'POST',body:JSON.stringify(capture(s))});assert.equal(response.status,201);const result=await response.json();assert.equal((await (await fetch(url)).json()).length,1);
  assert.equal((await fetch(url+'/'+result.id)).status,200);assert.equal((await fetch(url,{method:'POST',headers:{Origin:'https://outside.example'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/')).headers.get('x-frame-options'),'DENY');const child=await fetch(base+'/multimodal/index.html');assert.equal(child.headers.get('x-frame-options'),'SAMEORIGIN');assert.match(child.headers.get('content-security-policy'),/wasm-unsafe-eval/);
  const esm=await fetch(base+'/multimodal/vendor/vision_bundle.mjs',{method:'HEAD'});assert.match(esm.headers.get('content-type'),/javascript/);
  const wasm=await fetch(base+'/multimodal/vendor/wasm/vision_wasm_module_internal.wasm',{method:'HEAD'});assert.equal(wasm.status,200);assert.equal(wasm.headers.get('content-type'),'application/wasm');
});
