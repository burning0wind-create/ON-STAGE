import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {OnStage} from '../src/app.js';
import {createServer} from '../src/server.js';
import {buildReport} from '../src/ai.js';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'onstage-delete-test-'));
 t.after(()=>{const resolved=path.resolve(root);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('onstage-delete-test-'));fs.rmSync(resolved,{recursive:true,force:true});});
 const store=new Store(path.join(root,'data')),app=new OnStage(store);
 for(const id of ['first','second'])store.put('sessions',id,{id,status:'complete',createdAt:'2026-11-01T00:00:00Z',profile:{attempt:id==='first'?1:2},turns:[],sensors:[],materials:[],sources:[],identityScope:'same',rubricHash:'same',mode:'demo',report:{dimensions:[],trainingTotal:70,improvements:[]},multimodal:[{id:'capture-'+id}]});
 store.put('materials','resume',{id:'resume',kind:'resume',text:'虚构测试材料'});store.put('profiles','profile',{id:'profile',materialIds:['resume']});store.saveUpload('resume',Buffer.from('test upload'));
 store.put('captures','capture-first',{id:'capture-first',sessionId:'first',capture:{id:'source-first'}});
 store.put('score-revisions','revision',{sessionId:'first',snapshot:{id:'first'}});
 return {root,store,app};
}

test('删除必须明确确认，只移除指定已完成记录，保留材料、采集和历史快照供恢复',async t=>{
 const {store,app}=fixture(t),before=structuredClone(app.get('second'));
 for(const input of [{},{confirm:false},{confirm:'true'}])await assert.rejects(app.deleteSession('first',input),error=>error.status===400);
 const saved=app.get('first');assert.equal(saved.status,'complete');
 assert.deepEqual(await app.deleteSession('first',{confirm:true}),{deleted:true,id:'first',recoverable:true});
 assert.deepEqual(app.listSessions().map(s=>s.id),['second']);assert.throws(()=>app.get('first'),error=>error.status===404);
 const deleted=store.get('sessions','first');assert.equal(deleted.status,'deleted');assert.equal(deleted.previousStatus,'complete');assert.ok(Number.isFinite(Date.parse(deleted.deletedAt)));
 assert.deepEqual(app.get('second'),before);assert.ok(store.get('materials','resume'));assert.ok(store.get('profiles','profile'));assert.ok(store.get('captures','capture-first'));assert.ok(store.get('score-revisions','revision'));assert.ok(fs.existsSync(store.file('uploads','resume').replace(/\.json$/,'.bin')));
 await assert.rejects(app.deleteSession('first',{confirm:true}),error=>error.status===404);
 const report=buildReport({...before,id:'new'},app.listSessions());assert.equal(report.comparison?.sessionId,'second');
});

test('活动面试、评分任务及并发操作均不能被删除；恢复评分不触碰已删除记录',async t=>{
 const {store,app}=fixture(t);for(const status of ['active','paused']){store.put('sessions','first',{...app.get('first'),status});await assert.rejects(app.deleteSession('first',{confirm:true}),error=>error.status===409);}
 store.put('sessions','first',{...app.get('first'),status:'complete'});app.jobs.set('first',Promise.resolve());await assert.rejects(app.deleteSession('first',{confirm:true}),error=>error.status===409);app.jobs.clear();
 app.busy.add('first');await assert.rejects(app.deleteSession('first',{confirm:true}),error=>error.status===409);app.busy.clear();
 await app.deleteSession('first',{confirm:true});const deleted=store.get('sessions','first');deleted.scoringPolicy={version:'test'};deleted.scoringJob={status:'running'};deleted.turns=[{role:'candidate',scoring:{status:'pending'}}];store.put('sessions','first',deleted);
 let started=0;app.startScoring=()=>started++;app.recoverScoring();assert.equal(started,0);assert.equal(store.get('sessions','first').status,'deleted');
});

test('HTTP确认删除后列表、复盘导出和采集读写不可访问，并保留来源校验',async t=>{
 const {root,store}=fixture(t),server=createServer({store,llm:null,env:{},settingsFile:path.join(root,'.env')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const base=`http://127.0.0.1:${server.address().port}`,del=(body,extra={})=>fetch(base+'/api/sessions/first',{method:'DELETE',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
 assert.equal((await del({confirm:true},{Origin:'https://outside.example'})).status,403);
 assert.equal((await del({})).status,400);assert.equal((await del({confirm:'true'})).status,400);
 assert.equal((await fetch(base+'/api/sessions/first')).status,200);
 const response=await del({confirm:true});assert.equal(response.status,200);assert.deepEqual(await response.json(),{deleted:true,id:'first',recoverable:true});
 const listed=await (await fetch(base+'/api/sessions')).json();assert.deepEqual(listed.map(s=>s.id),['second']);
 for(const suffix of ['', '/export','/export?format=md','/multimodal','/multimodal/capture-first'])assert.equal((await fetch(base+'/api/sessions/first'+suffix)).status,404,suffix);
 assert.equal((await fetch(base+'/api/sessions/first/multimodal',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
 assert.equal((await del({confirm:true})).status,404);
 assert.equal((await fetch(base+'/api/sessions/second')).status,200);
});
