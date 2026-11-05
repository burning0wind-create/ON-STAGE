import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceInterview} from '../public/voice-interview.js';

const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(options={}){
 let now=0,next=1;const timers=new Map(),engines=[],utterances=[],states=[],transcripts=[],prompts=[],errors=[];
 class Recognition{
  constructor(){engines.push(this);}
  start(){this.started=true;this.onstart?.();}
  stop(){this.stopped=true;if(this.endOnStop!==false)this.onend?.();}
  abort(){this.aborted=true;this.onend?.();}
  result(parts){this.onresult?.({resultIndex:0,results:parts.map(([text,final])=>Object.assign([{transcript:text}],{isFinal:final}))});}
 }
 class Utterance{constructor(text){this.text=text;}}
 const env={SpeechRecognition:Recognition,SpeechSynthesisUtterance:Utterance,speechSynthesis:{speak:u=>utterances.push(u),cancel(){this.cancelled=true;},getVoices:()=>[{lang:'en-US',name:'English'},{lang:'zh-CN',name:'Chinese'}]},setTimeout:(fn,delay)=>{const id=next++;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
 const voice=new VoiceInterview({env,onState:s=>states.push(s),onTranscript:t=>transcripts.push(t),onSilencePrompt:p=>prompts.push(p),onError:e=>errors.push(e),silenceMs:15000,drainMs:350,...options});
 const ctx={sessionId:'s1',questionId:'q1',text:'Please introduce your project.',language:'en-US',stageId:'english',active:true,answered:false,consent:true,draft:''};
 async function tick(ms){const target=now+ms;for(;;){const pending=[...timers.entries()].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!pending)break;now=pending[1].at;timers.delete(pending[0]);pending[1].fn();await flush();}now=target;await flush();}
 async function ask(context=ctx){const p=voice.sync(context);await flush();return p;}
 async function finishQuestion(){const u=utterances.at(-1);u.onstart?.();u.onend?.();await flush();}
 return {voice,ctx,env,timers,engines,utterances,states,transcripts,prompts,errors,tick,ask,finishQuestion};
}

test('new question automatically speaks once in stage language, then starts consented real-time transcription',async()=>{
 const f=fixture();void f.ask();await flush();assert.equal(f.utterances.length,1);assert.equal(f.engines.length,0);assert.equal(f.utterances[0].lang,'en-US');
 await f.finishQuestion();assert.equal(f.engines.length,1);assert.equal(f.engines[0].interimResults,true);assert.equal(f.engines[0].continuous,true);assert.equal(f.voice.state.phase,'listening');
 await f.voice.sync(f.ctx);assert.equal(f.utterances.length,1);assert.equal(f.engines.length,1);
 const r=f.engines[0];r.result([['I designed',false]]);assert.equal(f.voice.state.interimText,'I designed');
 r.result([['I designed a service.',true],['My evidence',false]]);assert.equal(f.voice.state.finalText,'I designed a service.');assert.equal(f.voice.state.interimText,'My evidence');
 r.result([['I designed a service.',true],['My evidence is interviews.',true]]);assert.equal(f.voice.state.text,'I designed a service. My evidence is interviews.');f.voice.destroy();
});

test('no microphone is opened without explicit speech consent, even after automatic reading',async()=>{
 const f=fixture();void f.ask({...f.ctx,consent:false});await flush();await f.finishQuestion();assert.equal(f.engines.length,0);assert.equal(f.voice.state.phase,'ready');
 await f.voice.listen();assert.equal(f.engines.length,0);assert.match(f.voice.state.message,/启用语音转写/);
 await f.voice.sync({...f.ctx,consent:true});assert.equal(f.engines.length,1);f.voice.destroy();
});

test('finishing drains final recognition output instead of losing the last interim sentence',async()=>{
 const f=fixture();void f.ask();await flush();await f.finishQuestion();const r=f.engines[0];r.result([['最后一句',false]]);r.endOnStop=false;
 const completion=f.voice.finish();assert.equal(r.stopped,true);r.result([['最后一句已完整识别。',true]]);r.onend();
 assert.equal(await completion,'最后一句已完整识别。');assert.equal(f.voice.state.interimText,'');assert.equal(f.engines.length,1);f.voice.destroy();
});

test('bounded drain preserves interim text when browser never sends a final/end event',async()=>{
 const f=fixture();void f.ask();await flush();await f.finishQuestion();const r=f.engines[0];r.result([['保留未最终确认的内容',false]]);r.endOnStop=false;
 const completion=f.voice.finish();await f.tick(350);assert.equal(await completion,'保留未最终确认的内容');assert.equal(r.aborted,true);assert.equal(f.voice.state.phase,'ready');f.voice.destroy();
});

test('silence only asks for confirmation after answer activity and never submits or advances',async()=>{
 const f=fixture();void f.ask();await flush();await f.finishQuestion();await f.tick(18000);assert.equal(f.prompts.length,0);assert.equal(f.voice.state.phase,'listening');
 const r=f.engines[0];r.result([['有内容的回答',true]]);await f.tick(14999);assert.equal(f.prompts.length,0);await f.tick(1);
 assert.equal(f.prompts.length,1);assert.equal(f.prompts[0].questionId,'q1');assert.equal(f.voice.state.phase,'confirm');assert.equal(f.voice.context.questionId,'q1');
 await f.voice.continueAnswer();assert.equal(f.voice.state.phase,'listening');assert.equal(f.engines.length,2);assert.equal(f.voice.state.finalText,'有内容的回答');f.voice.destroy();
});

test('continuing keeps the draft without repeatedly prompting on empty browser events or recognition restarts',async()=>{
 const f=fixture();void f.ask();await flush();await f.finishQuestion();
 const old=f.engines[0];old.result([['已有回答',true]]);await f.tick(15000);assert.equal(f.prompts.length,1);
 await f.voice.continueAnswer();const resumed=f.engines.at(-1);
 resumed.result([['',false]]);resumed.onspeechend();await f.tick(20000);
 assert.equal(f.prompts.length,1);assert.equal(f.voice.state.phase,'listening');assert.equal(f.voice.state.text,'已有回答');
 resumed.onend();await f.tick(400);f.engines.at(-1).onspeechend();await f.tick(30000);
 assert.equal(f.prompts.length,1);assert.equal(f.voice.state.phase,'listening');
 // A delayed callback from the stopped engine must not affect this answer segment.
 old.result([['迟到的旧识别',true]]);old.onspeechend();await f.tick(15000);
 assert.equal(f.prompts.length,1);assert.equal(f.voice.state.text,'已有回答');f.voice.destroy();
});

test('only new continued content rearms the silence prompt and identical result callbacks do not delay it',async()=>{
 const f=fixture();void f.ask();await flush();await f.finishQuestion();f.engines[0].result([['前一段回答',true]]);await f.tick(15000);
 await f.voice.continueAnswer();await f.voice.continueAnswer();assert.equal(f.engines.length,2);
 const r=f.engines.at(-1);r.result([['补充研究方法',true]]);await f.tick(10000);
 r.result([['补充研究方法',true]]);await f.tick(5000);
 assert.equal(f.prompts.length,2);assert.equal(f.voice.state.phase,'confirm');assert.equal(f.voice.state.text,'前一段回答 补充研究方法');
 await f.voice.continueAnswer();f.engines.at(-1).onspeechend();await f.tick(45000);
 assert.equal(f.prompts.length,2);assert.equal(f.voice.state.text,'前一段回答 补充研究方法');f.voice.destroy();
});

test('delayed transcription cannot trigger a silence dialog while the candidate is still speaking',async()=>{
 const f=fixture();void f.ask();await flush();await f.finishQuestion();const r=f.engines[0];
 r.onspeechstart();r.result([['我正在继续解释设计决策',false]]);await f.tick(20000);
 assert.equal(f.prompts.length,0);assert.equal(f.voice.state.phase,'listening');
 r.onspeechend();await f.tick(14999);assert.equal(f.prompts.length,0);await f.tick(1);
 assert.equal(f.prompts.length,1);assert.equal(f.voice.state.text,'我正在继续解释设计决策');f.voice.destroy();
});

test('repeat preserves existing answer and stops recognition before reading, so the question is not transcribed',async()=>{
 const f=fixture();void f.ask();await flush();await f.finishQuestion();f.engines[0].result([['My prior answer.',true]]);
 const repeat=f.voice.repeatQuestion();await flush();assert.equal(f.engines[0].stopped,true);assert.equal(f.utterances.length,2);assert.equal(f.voice.state.finalText,'My prior answer.');assert.equal(f.voice.recognition,null);
 await f.finishQuestion();await repeat;assert.equal(f.engines.length,2);f.engines[1].result([['Further detail.',true]]);assert.equal(f.voice.state.text,'My prior answer. Further detail.');f.voice.destroy();
});

test('new question cancels old speech and ignores stale recognition callbacks',async()=>{
 const f=fixture();void f.ask();await flush();await f.finishQuestion();const old=f.engines[0];old.result([['Old answer',false]]);
 void f.voice.sync({...f.ctx,questionId:'q2',language:'zh-CN',stageId:'portfolio',text:'请介绍作品。'});await flush();assert.equal(old.aborted,true);old.result([['stale result',true]]);
 assert.equal(f.voice.state.text,'');assert.equal(f.utterances.at(-1).lang,'zh-CN');await f.finishQuestion();assert.equal(f.engines.length,2);f.voice.destroy();
});

test('pause and same-question render do not reopen microphone or repeat the question',async()=>{
 const f=fixture();void f.ask();await flush();await f.finishQuestion();f.engines[0].result([['saved',false]]);
 await f.voice.sync({...f.ctx,active:false});assert.equal(f.voice.state.phase,'paused');await f.tick(20000);assert.equal(f.prompts.length,0);
 await f.voice.sync({...f.ctx,active:true});assert.equal(f.engines.length,1);assert.equal(f.utterances.length,1);assert.equal(f.voice.state.text,'saved');
 await f.voice.continueAnswer();assert.equal(f.engines.length,2);f.voice.destroy();
});

test('autoplay failure provides a manual fallback and does not open microphone after a late end event',async()=>{
 const f=fixture();void f.ask();await flush();const u=f.utterances[0];u.onerror({error:'not-allowed'});u.onend();await flush();assert.equal(f.voice.state.phase,'ready');assert.match(f.voice.state.message,/重复问题/);assert.equal(f.engines.length,0);
 void f.voice.repeatQuestion();await flush();await f.finishQuestion();assert.equal(f.engines.length,1);f.voice.destroy();
});

test('unavailable recognition, network error and repeated empty restarts stop gracefully without a retry loop',async()=>{
 const f=fixture();f.voice.Recognition=null;void f.ask();await flush();await f.finishQuestion();assert.equal(f.voice.state.phase,'unsupported');f.voice.destroy();
 const g=fixture();void g.ask();await flush();await g.finishQuestion();g.engines[0].result([['preserved',false]]);g.engines[0].onerror({error:'network'});assert.equal(g.voice.state.phase,'error');assert.equal(g.voice.state.text,'preserved');await g.tick(60000);assert.equal(g.engines.length,1);g.voice.destroy();
 const h=fixture();void h.ask();await flush();await h.finishQuestion();for(let i=0;i<3;i++){h.engines.at(-1).onend();await h.tick(400);}assert.equal(h.engines.length,3);assert.equal(h.voice.state.phase,'ready');await h.tick(10000);assert.equal(h.engines.length,3);h.voice.destroy();
});

test('double sync of a new question only starts one automatic utterance, and manual stop stays stopped across renders',async()=>{
 const f=fixture();const first=f.voice.sync(f.ctx),second=f.voice.sync(f.ctx);await flush();assert.equal(f.utterances.length,1);await f.finishQuestion();await Promise.all([first,second]);
 await f.voice.stop();await f.voice.sync(f.ctx);assert.equal(f.voice.recognition,null);assert.equal(f.engines.length,1);assert.equal(f.utterances.length,1);f.voice.destroy();
});

test('continue during a pending stop waits for final text and then reopens listening once',async()=>{
 const f=fixture();void f.ask();await flush();await f.finishQuestion();const old=f.engines[0];old.result([['前一段',false]]);old.endOnStop=false;
 const stopped=f.voice.stop(),continued=f.voice.continueAnswer();old.result([['前一段完整内容',true]]);old.onend();await Promise.all([stopped,continued]);
 assert.equal(f.engines.length,2);assert.equal(f.voice.state.phase,'listening');assert.equal(f.voice.state.finalText,'前一段完整内容');f.voice.destroy();
});

test('a later stop cancels an earlier repeat still waiting to drain recognition',async()=>{
 const f=fixture();void f.ask();await flush();await f.finishQuestion();const old=f.engines[0];old.endOnStop=false;old.result([['保存回答',false]]);
 const repeat=f.voice.repeatQuestion(),stop=f.voice.stop({phase:'paused'});old.onend();await Promise.all([repeat,stop]);
 assert.equal(f.utterances.length,1);assert.equal(f.voice.state.phase,'paused');assert.equal(f.voice.state.text,'保存回答');f.voice.destroy();
});

test('English stage always uses en-US for reading and recognition, including old profiles and retries',async()=>{
 const f=fixture();void f.ask({...f.ctx,language:'zh-CN'});await flush();assert.equal(f.utterances[0].lang,'en-US');
 await f.finishQuestion();assert.equal(f.engines[0].lang,'en-US');assert.equal(f.voice.state.language,'en-US');
 f.engines[0].result([['My project explored inclusive design.',true]]);await f.voice.stop();await f.voice.continueAnswer();
 assert.equal(f.engines[1].lang,'en-US');assert.equal(f.voice.state.text,'My project explored inclusive design.');
 void f.voice.sync({...f.ctx,questionId:'q2',stageId:'portfolio',language:'zh-CN'});await flush();await f.finishQuestion();
 assert.equal(f.engines[2].lang,'zh-CN');assert.equal(f.voice.state.language,'zh-CN');f.voice.destroy();
});

test('network failures remain explicit and do not auto-retry, repeatedly notify, submit or lose the draft',async()=>{
 const f=fixture();void f.ask();await flush();await f.finishQuestion();f.engines[0].result([['Existing English answer.',false]]);
 f.engines[0].onerror({error:'network'});assert.equal(f.voice.state.errorCode,'network');assert.equal(f.voice.state.phase,'error');
 assert.match(f.voice.state.message,/提问、评分模型.*独立连接/);assert.equal(f.errors.length,1);
 await f.tick(60000);assert.equal(f.engines.length,1);assert.equal(f.prompts.length,0);
 for(let i=0;i<2;i++){await f.voice.continueAnswer();assert.equal(f.voice.state.errorCode,null);f.engines.at(-1).onerror({error:'network'});await f.tick(30000);}
 assert.equal(f.errors.length,1);assert.equal(f.voice.state.errorCode,'network');assert.equal(f.voice.state.text,'Existing English answer.');assert.equal(f.prompts.length,0);
 await f.voice.continueAnswer();f.engines.at(-1).result([['More evidence.',true]]);f.engines.at(-1).onerror({error:'network'});
 assert.equal(f.errors.length,2);assert.equal(f.voice.state.text,'Existing English answer. More evidence.');f.voice.destroy();
});

test('typing English corrections keeps spaces and line breaks instead of merging words on each input event',()=>{
 const f=fixture();
 for(const text of ['My ','My design ','My design project.\n','My design project.\n More details. ']){
  f.voice.setDraft(text);assert.equal(f.voice.state.text,text);assert.equal(f.transcripts.at(-1).text,text);
 }
 f.voice.destroy();
});
