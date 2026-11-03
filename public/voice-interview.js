// Browser speech orchestration only. This controller never submits answers or advances stages.
const join=(...parts)=>parts.map(x=>String(x??'').trim()).filter(Boolean).join(' ');
const errors={
 'not-allowed':'麦克风权限未开启。允许浏览器使用麦克风后，可点击继续回答；也可以使用文字辅助。',
 'service-not-allowed':'当前浏览器语音服务不可用，可以使用文字辅助。',
 'audio-capture':'没有可用的麦克风，请检查设备后重试。',
 'network':'语音转写连接中断，已有文字已保留。请重试或使用文字辅助。',
 'no-speech':'暂未识别到语音，点击继续回答即可重新开始。',
 'language-not-supported':'当前浏览器不支持这个环节的转写语言，可以使用文字辅助。'
};
export class VoiceInterview{
 constructor({env=globalThis,onState=()=>{},onTranscript=()=>{},onSilencePrompt=()=>{},onError=()=>{},silenceMs=15000,drainMs=350,startTimeoutMs=3000}={}){
  this.env=env;this.Recognition=env.SpeechRecognition??env.webkitSpeechRecognition;this.synth=env.speechSynthesis;this.Utterance=env.SpeechSynthesisUtterance;
  this.onState=onState;this.onTranscript=onTranscript;this.onSilencePrompt=onSilencePrompt;this.onError=onError;
  this.silenceMs=silenceMs;this.drainMs=drainMs;this.startTimeoutMs=startTimeoutMs;
  this.schedule=(env.setTimeout??setTimeout).bind(env);this.unschedule=(env.clearTimeout??clearTimeout).bind(env);
  this.context={};this.phase='idle';this.message='';this.finalText='';this.interimText='';this.hasSpeech=false;
  this.generation=0;this.speechToken=0;this.commandToken=0;this.spokenKey=null;this.key=null;this.recognition=null;this.destroyed=false;this.restartAttempts=0;this.wantListening=false;
 }
 get state(){return {phase:this.phase,finalText:this.finalText,interimText:this.interimText,text:join(this.finalText,this.interimText),message:this.message,hasSpeech:this.hasSpeech,recognitionSupported:!!this.Recognition,ttsSupported:!!(this.synth&&this.Utterance)};}
 emit(phase=this.phase,message=this.message){if(this.destroyed)return;this.phase=phase;this.message=message;this.onState(this.state);}
 transcript(){if(!this.destroyed)this.onTranscript({finalText:this.finalText,interimText:this.interimText,text:join(this.finalText,this.interimText)});}
 clearTimer(name){if(this[name]!=null){this.unschedule(this[name]);this[name]=null;}}
 clearListeningTimers(){this.clearTimer('silenceTimer');this.clearTimer('restartTimer');}
 allowed(){return !!(this.context.active&&!this.context.answered&&this.context.questionId&&!this.destroyed);}
 async sync(context={}){
  if(this.destroyed)return;
  const key=context.questionId?String(context.sessionId??'')+':'+context.questionId:null;
  const changed=key!==this.key;
  if(changed){
   this.generation++;this.commandToken++;this.wantListening=false;this.clearListeningTimers();this.cancelSpeech();this.abortRecognition();
   this.key=key;this.finalText=String(context.draft??'');this.interimText='';this.hasSpeech=false;this.restartAttempts=0;
  }
  const previousConsent=this.context.consent;this.context={...context};
  if(changed)this.transcript();
  if(!this.allowed()){await this.stop({phase:context.active?'ready':'paused'});return;}
  if(this.spokenKey!==key){this.spokenKey=key;await this.speakQuestion();return;}
  if(previousConsent&&!context.consent){await this.stop();return;}
  if(!previousConsent&&context.consent&&!['speaking','connecting','listening','processing'].includes(this.phase))await this.listen();
 }
 setDraft(text){
  this.finalText=String(text??'');this.interimText='';
  const session=this.recognition;
  if(session){session.base=this.finalText;session.ignoreThrough=Math.max(-1,...session.results.keys());session.results.clear();}
  this.transcript();this.emit();
 }
 cancelSpeech(){
  this.speechToken++;this.clearTimer('speechStartTimer');this.clearTimer('speechEndTimer');
  const resolve=this.speechResolve;this.speechResolve=null;
  try{this.synth?.cancel();}catch{}
  resolve?.();
 }
 async begin(){return this.speakQuestion();}
 async repeatQuestion(){return this.speakQuestion();}
 async speakQuestion(){
  if(!this.allowed())return;
  const generation=this.generation,command=this.commandToken+1;
  await this.stop();
  if(command!==this.commandToken||generation!==this.generation||!this.allowed())return;
  if(!this.synth||!this.Utterance){this.emit('ready','当前浏览器不支持问题朗读，请查看屏幕上的问题。');if(this.context.consent)await this.listen();return;}
  const text=String(this.context.text??'').trim();if(!text){this.emit('ready','等待考官问题');return;}
  const token=++this.speechToken;
  const utterance=new this.Utterance(text);utterance.lang=this.context.language||'zh-CN';utterance.rate=.96;
  try{
   const voices=this.synth.getVoices?.()??[],matches=voices.filter(v=>(v.lang??'').toLowerCase().startsWith(utterance.lang.split('-')[0].toLowerCase()));
   const index={english:0,portfolio:1,design:0,ethics:2}[this.context.stageId]??0;if(matches.length)utterance.voice=matches[index%matches.length];
  }catch{}
  this.emit('speaking','考官正在提问');
  return new Promise(resolve=>{
   let done=false;
   this.speechResolve=resolve;
   const valid=()=>!done&&!this.destroyed&&token===this.speechToken&&generation===this.generation;
   const complete=(success,message)=>{
    if(!valid())return;done=true;this.clearTimer('speechStartTimer');this.clearTimer('speechEndTimer');this.speechResolve=null;resolve();
    this.emit('ready',message??(this.context.consent?'请开始回答':'问题已读完，启用语音转写后开始回答'));
    if(success&&this.context.consent&&this.allowed())void this.listen();
   };
   utterance.onstart=()=>{if(!valid())return;this.clearTimer('speechStartTimer');this.emit('speaking','考官正在提问');};
   utterance.onend=()=>complete(true);
   utterance.onerror=event=>complete(false,event?.error==='not-allowed'?'浏览器暂未允许自动朗读，请点击“重复问题”开始。':'问题朗读未完成，请点击“重复问题”或查看问题文字。');
   this.speechStartTimer=this.schedule(()=>{if(!valid())return;this.cancelSpeech();this.emit('ready','浏览器暂未开始朗读，请点击“重复问题”开始。');},this.startTimeoutMs);
   this.speechEndTimer=this.schedule(()=>{if(!valid())return;this.cancelSpeech();this.emit('ready','朗读已停止，可重复问题或开始回答。');},Math.min(180000,Math.max(20000,text.length*200+15000)));
   try{this.synth.speak(utterance);}catch{complete(false,'问题朗读不可用，请查看问题文字或重试。');}
  });
 }
 async listen(){
  if(!this.allowed())return;
  if(!this.context.consent){this.emit('ready','请先启用语音转写；音频可能由浏览器语音服务商处理。');return;}
  if(!this.Recognition){this.emit('unsupported','当前浏览器不支持实时语音转写，请使用文字辅助。');return;}
  if(this.recognition&&!this.recognition.closing)return;
  const generation=this.generation,command=++this.commandToken;
  this.cancelSpeech();this.clearTimer('restartTimer');this.wantListening=true;
  if(this.recognition?.closing)await this.drainRecognition();
  if(command!==this.commandToken||generation!==this.generation||!this.allowed()||!this.context.consent||!this.wantListening)return;
  this.startRecognition();
 }
 startRecognition(){
  if(!this.allowed()||!this.context.consent||!this.wantListening||this.recognition)return;
  let engine;try{engine=new this.Recognition();}catch{this.fail('audio-capture');return;}
  const session={engine,generation:this.generation,base:this.finalText,results:new Map(),ignoreThrough:-1,closing:false,settled:false};
  this.recognition=session;engine.lang=this.context.language||'zh-CN';engine.continuous=true;engine.interimResults=true;
  this.emit('connecting','正在连接语音转写…');
  engine.onstart=()=>{if(!this.validRecognition(session))return;this.clearTimer('recognitionStartTimer');this.emit('listening','正在聆听，请自然回答');};
  engine.onspeechstart=()=>{if(this.validRecognition(session)){this.hasSpeech=true;this.clearTimer('silenceTimer');}};
  engine.onspeechend=()=>{if(this.validRecognition(session))this.armSilence();};
  engine.onresult=event=>{
   if(!this.validRecognition(session))return;
   for(let i=event.resultIndex??0;i<(event.results?.length??0);i++){
    if(i<=session.ignoreThrough)continue;
    const result=event.results[i],content=String(result?.[0]?.transcript??'').trim();
    session.results.set(i,{text:content,final:!!result?.isFinal});
   }
   this.updateSessionText(session);
   if(join(this.finalText,this.interimText).trim()){this.hasSpeech=true;this.restartAttempts=0;this.armSilence();}
  };
  engine.onerror=event=>{if(!this.validRecognition(session)||session.closing)return;this.fail(event.error??'network');};
  engine.onend=()=>{
   if(!this.validRecognition(session))return;
   const wasClosing=session.closing;this.settleRecognition(session);
   if(wasClosing||!this.wantListening||!this.allowed()||!this.context.consent)return;
   if(this.restartAttempts<2){this.restartAttempts++;this.restartTimer=this.schedule(()=>this.startRecognition(),400);}
   else{this.wantListening=false;this.emit('ready','转写已暂停，已有内容已保留。点击继续回答即可恢复。');}
  };
  this.recognitionStartTimer=this.schedule(()=>{if(!this.validRecognition(session)||session.closing)return;this.fail('start-timeout');},this.startTimeoutMs);
  try{engine.start();}catch{this.fail('start-failed');}
 }
 validRecognition(session){return !this.destroyed&&this.recognition===session&&session.generation===this.generation&&!session.settled;}
 updateSessionText(session){
  const parts=[...session.results.entries()].sort((a,b)=>a[0]-b[0]).map(([,r])=>r);
  this.finalText=join(session.base,...parts.filter(r=>r.final).map(r=>r.text));this.interimText=join(...parts.filter(r=>!r.final).map(r=>r.text));
  this.transcript();this.emit();
 }
 settleRecognition(session){
  if(session.settled)return;
  this.clearTimer('recognitionStartTimer');
  if(session.generation===this.generation){this.updateSessionText(session);this.finalText=join(this.finalText,this.interimText);this.interimText='';this.transcript();}
  session.settled=true;this.clearTimer('drainTimer');if(this.recognition===session)this.recognition=null;
  session.resolve?.(this.finalText);
 }
 abortRecognition(){
  const session=this.recognition;if(!session)return;session.closing=true;
  this.clearTimer('recognitionStartTimer');this.clearTimer('drainTimer');this.recognition=null;session.settled=true;session.resolve?.(this.finalText);
  try{session.engine.abort?.();}catch{}
 }
 async drainRecognition(){
  const session=this.recognition;if(!session)return this.finalText;
  if(session.promise)return session.promise;
  session.closing=true;this.clearTimer('recognitionStartTimer');
  session.promise=new Promise(resolve=>{session.resolve=resolve;this.drainTimer=this.schedule(()=>{this.settleRecognition(session);try{session.engine.abort?.();}catch{}},this.drainMs);});
  try{session.engine.stop();}catch{this.settleRecognition(session);}
  return session.promise;
 }
 armSilence(){
  this.clearTimer('silenceTimer');
  if(!this.hasSpeech||!this.wantListening||!this.allowed()||!join(this.finalText,this.interimText).trim()||this.recognition?.closing)return;
  this.silenceTimer=this.schedule(async()=>{
   if(!this.allowed()||!this.wantListening||!this.hasSpeech)return;
   const generation=this.generation,command=++this.commandToken;this.wantListening=false;this.clearListeningTimers();await this.drainRecognition();
   if(command!==this.commandToken||generation!==this.generation||!this.allowed())return;
   this.emit('confirm','已经有一段时间没有说话，是否回答完毕？');this.onSilencePrompt({text:this.finalText,questionId:this.context.questionId});
  },this.silenceMs);
 }
 fail(code){
  this.commandToken++;
  this.wantListening=false;this.clearListeningTimers();
  const message=errors[code]??'语音转写暂未启动，已有内容已保留。请点击继续回答或使用文字辅助。';
  const session=this.recognition;if(session){this.settleRecognition(session);try{session.engine.abort?.();}catch{}}
  this.emit('error',message);this.onError({code,message});
 }
 async stop({phase='ready'}={}){
  const command=++this.commandToken;
  this.wantListening=false;this.clearListeningTimers();this.cancelSpeech();
  const generation=this.generation;
  const text=await this.drainRecognition();
  if(command===this.commandToken&&generation===this.generation)this.emit(phase,phase==='paused'?'语音已暂停':'');
  return text;
 }
 async finish(){this.emit('processing','正在整理最后一句回答…');return this.stop({phase:'ready'});}
 async continueAnswer(){this.clearListeningTimers();return this.listen();}
 destroy(){this.wantListening=false;this.clearListeningTimers();this.cancelSpeech();this.abortRecognition();this.destroyed=true;}
}
