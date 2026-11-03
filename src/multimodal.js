import {validateImportedSession,buildInterviewReport} from '../public/multimodal/interview-report.js';
import {id,fail} from './domain.js';
import {summarizeAuxiliaryCaptures} from '../public/multimodal/auxiliary-scores.js';

export function transcriptForCapture(turns,capture) {
  const start=(capture.host_time_origin_epoch_ms||0)+(capture.record_start_host_perf_ms||0);
  const duration=capture.duration_ms,segments=[];
  if(!start)return {kind:'imported',title:'没有可对齐的问答时间',segments};
  const at=turn=>Date.parse(turn.createdAt);
  for(let i=0;i<turns.length;i++){
    const turn=turns[i],next=turns[i+1];let from=at(turn),to=next?at(next):start+duration;
    if(turn.role==='candidate'){
      const question=turns.find(t=>t.id===turn.questionId);
      to=at(turn);from=Math.max(question?at(question):to, to-Math.max(0,turn.durationMs||0));
      if(!turn.durationMs)from=question?at(question):to;
    }else if(next?.role==='candidate'&&next.durationMs)to=Math.max(from,at(next)-next.durationMs);
    if(!Number.isFinite(from)||!Number.isFinite(to))continue;
    const a=Math.max(0,from-start),b=Math.min(duration,to-start);
    if(b>a)segments.push({start_ms:a,end_ms:b,speaker:turn.role==='candidate'?'考生':'考官',text:turn.skipped?'本题已跳过':turn.content,question_id:turn.questionId||turn.id});
  }
  return {kind:'imported',title:'本场问答（按提问与提交时间近似对齐，非逐词转写）',segments:segments.sort((a,b)=>a.start_ms-b.start_ms)};
}
export function attachCapture(store,sid,input) {
  const session=store.get('sessions',sid)??fail('面试不存在',404);
  let capture;try{capture=validateImportedSession(input);}catch(e){fail(e.message);}
  if(capture.host_context?.sessionId!==sid)fail('多模态记录不属于本场面试',409);
  if(typeof capture.id!=='string'||!capture.id||capture.id.length>128)fail('采集片段标识无效');
  const existing=(session.multimodal||[]).find(x=>x.captureId===capture.id);
  const key=existing?.id||id();
  capture={...capture,analysis:buildInterviewReport(capture),transcript:transcriptForCapture(session.turns,capture)};
  delete capture.videoBlob;
  const summary={id:key,captureId:capture.id,duration_ms:capture.duration_ms,created_at:capture.created_at,analysis:capture.analysis};
  store.put('captures',key,{id:key,sessionId:sid,capture});
  session.multimodal=[...(session.multimodal||[]).filter(x=>x.id!==key),summary];
  if(session.report)session.report.multimodalEvaluation=summarizeAuxiliaryCaptures(session.multimodal);
  if(!existing){
    for(const channel of [capture.frames.length?'camera':null,capture.frames.some(f=>f.hands.length)?'hand':null,capture.imu?.samples.length?'imu':null].filter(Boolean))session.sensors.push({channel,type:'tracking_state',value:'multimodal_capture_saved',source:'local_adapter',atMs:Math.max(0,(capture.host_time_origin_epoch_ms||0)+(capture.record_start_host_perf_ms||0)-Date.parse(session.createdAt)),receivedAt:new Date().toISOString()});
  }
  store.put('sessions',sid,session);return summary;
}
export function getCapture(store,sid,key) {
  const session=store.get('sessions',sid)??fail('面试不存在',404);
  const saved=store.get('captures',key)??fail('多模态记录不存在',404);
  if(saved.sessionId!==sid)fail('多模态记录不属于本场面试',404);
  return {...saved.capture,interview_time:session.profile.interviewTime,transcript:transcriptForCapture(session.turns,saved.capture)};
}
