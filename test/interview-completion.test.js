import test from 'node:test';
import assert from 'node:assert/strict';
import {completeInterviewAnswer} from '../public/interview-completion.js';
const session=()=>({id:'s',status:'active',stageIndex:0,profile:{stages:[{id:'english'},{id:'design'}]},turns:[{id:'q',role:'interviewer'}]});
test('回答保存后才切换环节，识别结果以真实questionId提交',async()=>{
 const s=session(),calls=[];let savedState;
 const next=await completeInterviewAnswer({session:s,answer:'  final speech text  ',inputMode:'speech',durationMs:9000},{post:async(url,body)=>{calls.push([url,body]);return calls.length===1?{...s,turns:[...s.turns,{id:'a',role:'candidate'}]}:{...s,stageIndex:1};},onSaved:saved=>savedState=saved});
 assert.deepEqual(calls,[['/api/sessions/s/answer',{answer:'final speech text',questionId:'q',inputMode:'speech',durationMs:9000}],['/api/sessions/s/action',{action:'next'}]]);assert.equal(savedState.turns.at(-1).role,'candidate');assert.equal(next.stageIndex,1);
});
test('最后环节回答结束后生成复盘，空回答不会进入下一环节',async()=>{
 const s=session();s.stageIndex=1;const actions=[];
 await completeInterviewAnswer({session:s,answer:'最后一题'},{post:async(url,body)=>{actions.push(body);return s;}});assert.equal(actions[1].action,'finish');
 let sent=false;await assert.rejects(completeInterviewAnswer({session:s,answer:' '},{post:()=>{sent=true;}}),/还没有识别/);assert.equal(sent,false);
});
test('保存失败不切换，保存后切换失败保留已保存状态供恢复',async()=>{
 const s=session();let calls=0,kept;
 await assert.rejects(completeInterviewAnswer({session:s,answer:'回答'},{post:async()=>{calls++;throw Error('offline');}}),/offline/);assert.equal(calls,1);
 calls=0;await assert.rejects(completeInterviewAnswer({session:s,answer:'回答'},{post:async()=>{if(++calls===1)return {...s,turns:[{role:'candidate'}]};throw Error('transition offline');},onSaved:saved=>kept=saved}),/回答已保存/);assert.equal(kept.turns.at(-1).role,'candidate');assert.equal(calls,2);
});
