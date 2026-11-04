import test from 'node:test';
import assert from 'node:assert/strict';
import {AnswerConfirmation} from '../public/answer-confirmation.js';
function fixture(){let context={sessionId:'s',questionId:'q',active:true,consent:true},text='已有回答';const calls=[];const voice={state:{recognitionSupported:true},stop:async()=>text,continueAnswer:async()=>calls.push('continue')};const flow=new AnswerConfirmation({voice,getContext:()=>context,onShow:r=>calls.push(['show',r]),onHide:()=>calls.push('hide'),onSubmit:async()=>calls.push('submit')});return{flow,voice,calls,setContext:v=>context={...context,...v},setText:v=>text=v};}
test('回答完毕或停顿仅打开确认，选择继续保留本题，不保存或跳转',async()=>{
 for(const reason of ['manual','silence']){const f=fixture();await f.flow.open(reason);assert.equal(f.calls[0][1].text,'已有回答');assert.ok(!f.calls.includes('submit'));await f.flow.continue();assert.ok(f.calls.includes('continue'));assert.ok(!f.calls.includes('submit'));assert.equal(f.flow.review,null);}
});
test('只有确认提交会提交一次，关闭或迟到的本题确认不会提交另一题',async()=>{
 const f=fixture();await f.flow.open();await f.flow.confirm();await f.flow.confirm();assert.equal(f.calls.filter(c=>c==='submit').length,1);
 const g=fixture();await g.flow.open();g.setContext({questionId:'q2'});await g.flow.confirm();assert.ok(!g.calls.includes('submit'));
});
test('整理末句时离开取消弹窗，文字辅助返回不会突然开启麦克风',async()=>{
 const f=fixture();let resolve;f.voice.stop=()=>new Promise(r=>resolve=r);const open=f.flow.open();f.flow.dismiss();resolve('保留的末句');await open;assert.ok(!f.calls.some(c=>Array.isArray(c)&&c[0]==='show'));
 const g=fixture();g.setContext({consent:false});await g.flow.open();await g.flow.continue();assert.ok(!g.calls.includes('continue'));assert.ok(!g.calls.includes('submit'));
 const h=fixture();h.flow.onShow=()=>false;await h.flow.open();assert.equal(h.flow.review,null);h.flow.onShow=()=>{};await h.flow.open();assert.ok(h.flow.review);
});
