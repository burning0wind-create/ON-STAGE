import {MotionTracker, toCsv} from './motion.js';
import {ImuPanel} from './imu-panel.js';
import {buildInterviewReport,validateImportedSession} from './interview-report.js';
import {ReportPanel} from './report-panel.js';
import {ReviewPanel,makeMarker} from './review-panel.js';

const $ = id => document.getElementById(id);
const video = $('video'), canvas = $('overlay'), ctx = canvas.getContext('2d');
const links = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
let worker, ready = false, loading, inFlight = false, generation = 0;
let stream, source = null, objectUrl, sourceStart = 0, lastSent = -Infinity, lastSourceTime = -1;
const options = () => ({enterSpeed: Number($('motionThreshold').value), exitSpeed: Number($('motionThreshold').value) * .55});
let tracker = makeTracker(), active = null, sessions = [], latestHands = [], mediaRecorder;
let frameTotal = 0, frameDetected = 0, frameTimes = [], sourceOperation = 0;
let cameraRequest=null,cameraError='';
let imu=null;
let reportPanel=null;
let hostContext=null;
let reviewPanel=null;
const reviewVideoUrls=new Map();
function makeTracker() { return new MotionTracker(options()); }
function tell(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
const timeText = ms => { const t = Math.max(0, ms) / 1000; return `${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(1).padStart(4,'0')}`; };
function sourceTime() { return source?.type === 'camera' ? performance.now() - sourceStart : source?.type === 'video' ? video.currentTime * 1000 : 0; }
function recordingNow() {return active?.source.type==='imu'?performance.now():sourceTime();}
function resetTracking() { tracker = makeTracker(); latestHands = []; lastSourceTime = -1; frameTotal = frameDetected = 0; frameTimes = []; generation++; draw([]); for(const id of ['handCount','actualFps','latency','coverage'])$(id).textContent='—';$('handCards').replaceChildren(); }
function updateControls() {
  const canRecord=!active&&((ready&&source&&source.type!=='image')||imu?.isFresh);
  $('startRecording').disabled = !canRecord;
  $('imuRecord').disabled = !canRecord;$('imuStopRecord').disabled=!active;
  $('stopRecording').disabled = !active;
  $('recordBadge').hidden = !active;
  for (const id of ['motionThreshold','targetFps','recordVideo','sessionSelect']) $(id).disabled = !!active;
  $('stopSource').disabled = !source;
  const selected = selectedSession();
  reviewPanel?.show(selected,{recording:!!active});
  for (const id of ['exportJson','exportCsv','exportEvents']) $(id).disabled = !selected || !!active;
  $('downloadVideo').disabled = !selected?.videoBlob || !!active;
  $('exportImu').disabled=!selected?.imu?.samples.length||!!active;
  $('importSession').disabled=!!active;$('downloadReport').disabled=!selected||!!active;
  imu?.setRecording(!!active);
}
async function loadModel() {
  if (ready) return;
  if (loading) return loading;
  $('modelState').textContent = '正在加载识别模型';
  $('modelDot').className = 'status-dot loading';
  $('loadModel').disabled = true;
  loading = new Promise((resolve,reject) => {
    worker = new Worker(new URL('./inference-worker.js', import.meta.url), {type:'module'});
    const timeout = setTimeout(() => reject(new Error('模型初始化超时，请检查本地模型文件是否齐全，并使用桌面版 Chrome 或 Edge。')), 90000);
    worker.onmessage = ({data}) => {
      if (data.type === 'ready') { clearTimeout(timeout); ready = true; resolve(); }
      else if (data.type === 'error') { clearTimeout(timeout); reject(new Error(data.message)); }
      else if (data.type === 'result') { inFlight = false; if (data.token === generation) handleResult(data); }
      else if (data.type === 'frameError') { inFlight = false; tell(`本帧识别失败：${data.message}`,true); }
    };
    worker.onerror = event => {
      clearTimeout(timeout); inFlight = false;
      const error = new Error(event.message || '识别线程启动失败');
      if(ready) {if(active)stopRecording('worker_error');ready=false;worker?.terminate();worker=null;$('modelState').textContent='识别线程中断';$('modelDot').className='status-dot error';$('loadModel').disabled=false;$('loadModel').textContent='重新加载';tell(error.message,true);updateControls();}
      else reject(error);
    };
    worker.postMessage({type:'init'});
  });
  try {
    await loading;
    $('modelState').textContent = '本地模型已就绪'; $('modelDetail').textContent = '最多 2 只手 CPU / WebAssembly';
    $('modelDot').className = 'status-dot ready'; $('loadModel').textContent = '已加载';
    tell('模型已就绪');
  } catch (error) {
    ready = false; worker?.terminate(); worker = null;
    $('modelState').textContent = '模型加载失败'; $('modelDot').className = 'status-dot error'; $('loadModel').disabled = false;
    tell(error.message,true); throw error;
  } finally { loading = null; updateControls(); }
}
function dimensions() { return source?.type === 'image' ? [$('sampleImage').naturalWidth,$('sampleImage').naturalHeight] : [video.videoWidth,video.videoHeight]; }
function sizeStage() {
  const [w,h] = dimensions();
  if (!w || !h) return;
  canvas.width = w; canvas.height = h; $('stage').style.aspectRatio = '16/9';
  video.style.transform = $('mirror').checked ? 'scaleX(-1)' : 'none';
  $('sampleImage').style.transform = video.style.transform;
}
async function sendFrame() {
  if (!ready || !source || inFlight) return;
  const [w,h] = dimensions(); if (!w || !h) return;
  const t = sourceTime();
  if (source.type !== 'image' && Math.abs(t-lastSourceTime) < .1) return;
  const token = generation, capturePerf = performance.now();
  lastSourceTime = t; inFlight = true;
  try {
    const bitmap = await createImageBitmap(source.type === 'image' ? $('sampleImage') : video);
    if (token !== generation) { bitmap.close(); inFlight = false; return; }
    worker.postMessage({type:'frame',bitmap,token,sourceTime:t,capturePerf,width:w,height:h,inferenceTimestamp:performance.now()},[bitmap]);
  } catch (error) { inFlight = false; tell(`无法读取画面：${error.message}`,true); }
}
function loop(now) {
  if (source && source.type !== 'image' && !video.paused && now-lastSent >= 1000/Number($('targetFps').value)) { lastSent = now; sendFrame(); }
  if (source||active) {
    $('clock').textContent = timeText(active ? recordingNow()-active.source_start_ms : sourceTime());
    if(active?.source.type==='imu')active.duration_ms=performance.now()-active.record_start_host_perf_ms;
    if (source?.type === 'video' && Number.isFinite(video.duration)) { $('seek').value = video.currentTime; $('duration').textContent = timeText(video.duration*1000); }
  }
  requestAnimationFrame(loop);
}
function handleResult(data) {
  const result = tracker.update(data.hands,data.sourceTime,data.width,data.height);
  if (result.ignored) return;
  latestHands = result.hands; frameTotal++; if (result.hands.length) frameDetected++;
  const now = performance.now(); frameTimes.push(now); frameTimes = frameTimes.filter(t => now-t < 2000);
  $('handCount').textContent = result.hands.length;
  $('actualFps').textContent = frameTimes.length > 1 ? ((frameTimes.length-1)/((now-frameTimes[0])/1000)).toFixed(1) : '—';
  $('latency').textContent = Math.round(data.latency);
  $('coverage').textContent = `${Math.round(frameDetected/frameTotal*100)}%`;
  $('detectionBadge').hidden = false;
  $('detectionBadge').textContent = result.hands.length ? `已检出 ${result.hands.length} 只手` : '未检出手部 状态未知';
  $('handCards').replaceChildren();
  if (!result.hands.length) { const p = document.createElement('p'); p.className='muted'; p.textContent='当前未检出手部。检查遮挡、距离和光线；这不等于手没有活动。'; $('handCards').append(p); }
  for (const hand of result.hands) {
    const card = document.createElement('div'); card.className='hand-info';
    const title = document.createElement('strong'); title.textContent=`轨迹 #${hand.id} 模型标签 ${hand.label || '未知'}`;
    const detail = document.createElement('span'); detail.textContent=`${hand.speed === null ? '建立轨迹' : `${hand.speed.toFixed(2)} 掌宽/秒`} ${hand.moving ? '持续移动' : '未持续移动'}${hand.nearEdge ? ' 接近边缘' : ''}`;
    card.append(title,detail); $('handCards').append(card);
  }
  draw(result.hands);
  if (active&&active.source.type!=='imu') {
    active.frames.push({t_ms:round(data.sourceTime-active.source_start_ms),source_time_ms:round(data.sourceTime),capture_host_perf_ms:round(data.capturePerf),capture_host_epoch_ms:round(performance.timeOrigin+data.capturePerf),question_id:$('questionId').value,width:data.width,height:data.height,inference_latency_ms:round(data.latency),observed:result.hands.length>0,hands:result.hands.map(({trail,...hand})=>hand),imu:active.imu?imu.snapshotAt(data.capturePerf):null});
    appendEvents(result.events);
    active.duration_ms = Math.max(0,data.sourceTime-active.source_start_ms);
    if (active.frames.length % 10 === 0) renderReview();
    if (active.frames.length >= 18000) { stopRecording('frame_limit'); tell('已达到本轮 18,000 帧上限，请先导出，再开始下一轮。'); }
  }
}
const round = n => Math.round(n*1000)/1000;
function draw(hands) {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const x = v => $('mirror').checked ? canvas.width-v : v;
  hands.forEach((hand,i) => {
    const color = i ? '#ffcc85' : '#85ead4'; ctx.strokeStyle=color; ctx.fillStyle=color;
    ctx.lineWidth=Math.max(2,canvas.width/500);
    if ($('showTrail').checked && hand.trail.length>1) { ctx.beginPath(); hand.trail.forEach((p,j)=> j ? ctx.lineTo(x(p.x),p.y) : ctx.moveTo(x(p.x),p.y)); ctx.stroke(); }
    if ($('showSkeleton').checked) {
      for (const [a,b] of links) { const p=hand.landmarks[a],q=hand.landmarks[b]; ctx.beginPath();ctx.moveTo(x(p.x*canvas.width),p.y*canvas.height);ctx.lineTo(x(q.x*canvas.width),q.y*canvas.height);ctx.stroke(); }
      for (const p of hand.landmarks) { ctx.beginPath();ctx.arc(x(p.x*canvas.width),p.y*canvas.height,Math.max(3,canvas.width/300),0,Math.PI*2);ctx.fill(); }
    }
    ctx.font=`600 ${Math.max(15,canvas.width/48)}px sans-serif`;ctx.fillText(`#${hand.id}`,Math.max(4,Math.min(canvas.width-50,x(hand.center.x)+10)),Math.max(24,hand.center.y-20));
  });
}
async function refreshCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return tell('浏览器不支持摄像头设备接口。请使用桌面版 Chrome 或 Edge，并通过 localhost 打开。',true);
  try { const selected=$('cameraSelect').value; const devices=await navigator.mediaDevices.enumerateDevices(); $('cameraSelect').replaceChildren(new Option('系统默认摄像头','')); devices.filter(d=>d.kind==='videoinput').forEach((d,i)=>$('cameraSelect').add(new Option(d.label||`摄像头 ${i+1}`,d.deviceId))); $('cameraSelect').value=selected; } catch(error) {tell(`无法列出设备：${error.message}`,true);}
}
function closeSource() {
  if(active) stopRecording('source_closed');
  generation++; const previous=stream;stream=null;previous?.getTracks().forEach(track=>track.stop()); video.pause(); video.srcObject=null; video.removeAttribute('src'); video.load();
  if(objectUrl) URL.revokeObjectURL(objectUrl); objectUrl=null; source=null;
  video.hidden=true; $('sampleImage').hidden=true; $('empty').hidden=false; $('mediaBar').hidden=true; $('playPause').hidden=true; $('detectionBadge').hidden=true;$('stage').style.aspectRatio='16/9';
  $('sourceName').textContent='尚未连接'; $('sourceBadge').textContent='等待输入';$('clock').textContent='00:00.0'; resetTracking(); updateControls();
}
function showSource(type,name) {
  source={type,name,id:crypto.randomUUID()}; $('empty').hidden=true; video.hidden=type==='image'; $('sampleImage').hidden=type!=='image';
  $('sourceName').textContent=name; $('sourceBadge').textContent=type==='camera'?'实时摄像头':type==='video'?'本地录像':'官方测试图';
  $('playPause').hidden=type!=='video'; $('mediaBar').hidden=type!=='video';
  $('cameraTab').classList.toggle('active',type==='camera');$('sampleButton').classList.toggle('active',type==='image');document.querySelector('.file-label').classList.toggle('active',type==='video');
  sizeStage(); resetTracking(); updateControls();
}
function cameraStream(){return source?.type==='camera'&&stream?.getVideoTracks().some(track=>track.readyState==='live')?stream:null;}
function startCamera() {
  if(cameraStream())return Promise.resolve(stream);
  if(cameraRequest?.op===sourceOperation)return cameraRequest.promise;
  const op=++sourceOperation;closeSource();cameraError='';
  const promise=acquireCamera(op).finally(()=>{if(cameraRequest?.promise===promise)cameraRequest=null;});
  cameraRequest={op,promise};return promise;
}
async function acquireCamera(op) {
  tell('正在请求摄像头权限，请在浏览器弹窗中允许。');
  try {
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('请通过 http://localhost 或 http://127.0.0.1 打开，并使用桌面版 Chrome / Edge。');
    const id=$('cameraSelect').value;
    const acquired=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},...(id?{deviceId:{exact:id}}:{})},audio:false});
    if(op!==sourceOperation) {acquired.getTracks().forEach(t=>t.stop());return;}
    stream=acquired; video.srcObject=stream; await video.play();
    if(op!==sourceOperation){acquired.getTracks().forEach(t=>t.stop());return null;}
    sourceStart=performance.now(); showSource('camera',stream.getVideoTracks()[0]?.label||'实时摄像头');
    for(const track of acquired.getVideoTracks())track.addEventListener('ended',()=>{if(stream!==acquired||source?.type!=='camera')return;++sourceOperation;closeSource();tell('摄像头连接已结束，可重新开启。',true);});
    // Self preview is available immediately; tracking initialization never blocks it.
    void refreshCameras();void loadModel().catch(()=>{});
    tell('摄像头已连接');
    return acquired;
  } catch(error) { if(op!==sourceOperation)return null;closeSource();const messages={NotAllowedError:'摄像头权限未获允许。请在地址栏的站点权限中允许摄像头后重试。',NotFoundError:'未找到摄像头。请连接设备，或先使用官方测试图与本地录像。',NotReadableError:'摄像头无法读取，可能正被会议或录屏软件占用。关闭占用程序后重试。'};cameraError=messages[error.name]||error.message;tell(cameraError,true);return null; }
}
async function useSample() {
  const op=++sourceOperation; closeSource();
  try { const img=$('sampleImage'); img.src='./samples/woman_hands.jpg'; await img.decode();if(op!==sourceOperation)return; showSource('image','MediaPipe 官方样例'); await loadModel();if(op!==sourceOperation)return; await sendFrame(); tell('测试图已载入'); } catch(error) {if(op===sourceOperation)tell(error.message,true);}
}
async function useFile(file) {
  const op=++sourceOperation; closeSource(); if(!file)return;
  objectUrl=URL.createObjectURL(file);video.src=objectUrl;
  try { await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('录像无法解码，请尝试 MP4/H.264 或 WebM。'));video.load();});
    if(op!==sourceOperation)return;showSource('video',file.name);$('seek').max=Number.isFinite(video.duration)?video.duration:0;await loadModel();if(op!==sourceOperation)return;await sendFrame();tell('录像已载入，开始记录后自动播放。');
  } catch(error) {if(op===sourceOperation){closeSource();tell(error.message,true);}}
}
function startRecording() {
  const visual=ready&&source&&source.type!=='image';
  if(active||(!visual&&!imu?.isFresh))return;
  const recordSource=visual?{...source}:{type:'imu',name:'IMU独立记录',id:crypto.randomUUID()};
  resetTracking();
  const startPerf=performance.now();
  active={schema_version:'multimodal-debug/1.1',id:`session-${Date.now()}`,created_at:new Date().toISOString(),source:recordSource,source_start_ms:recordSource.type==='imu'?startPerf:sourceTime(),host_time_origin_epoch_ms:performance.timeOrigin,record_start_host_perf_ms:startPerf,model:visual?{name:'MediaPipe Hand Landmarker',version:'1.1.1',max_hands:2}:null,settings:{...tracker.options,target_fps:Number($('targetFps').value)},coordinates:{origin:'raw_image_top_left',xy:'normalized_image_coordinates; display_mirror_does_not_change_export',z:'model_relative_depth_not_metric_distance',speed:'smoothed_image_palm_widths_per_second',track_id:'short_term_association_not_person_identity'},timebase:{t_ms:'milliseconds from this recording start; source clock for video, host clock for BLE',source_time_ms:recordSource.type==='video'?'video.currentTime * 1000':recordSource.type==='imu'?'host performance.now':'performance.now - camera_source_start_perf',capture_host_perf_ms:'frame capture on this page monotonic clock',capture_host_epoch_ms:'performance.timeOrigin + capture_host_perf_ms; host alignment approximate',imu_alignment:'BLE arrival time minus record_start_host_perf_ms; frame snapshot uses only latest non-future sample no older than 800ms; not hardware synchronization'},frames:[],events:[],duration_ms:0};
  if(recordSource.type!=='video'&&imu.isFresh)active.imu={...imu.beginSession(),samples:[]};
  active.question_markers=[{t_ms:0,question_id:$('questionId').value.trim()||'未标注题目'}];
  if(hostContext)active.host_context=structuredClone(hostContext);
  sessions.push(active);refreshSessions(active.id);
  let recordWarning='';
  if(recordSource.type==='camera'&&$('recordVideo').checked) {
    try {const session=active,chunks=[];const mime=['video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type)); const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});mediaRecorder=recorder;session.video_start_host_perf_ms=performance.now();recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.onstop=()=>{session.videoBlob=new Blob(chunks,{type:recorder.mimeType||'video/webm'});if(mediaRecorder===recorder)mediaRecorder=null;updateControls();};recorder.start(1000);} catch(error) {active.video_error=error.message;recordWarning=`特征记录已开始，但录像未启动：${error.message}`;}
  }
  updateControls();renderReview();showReport(false);
  if(recordSource.type==='video'&&video.paused) video.play().catch(error=>tell(error.message,true));
  tell(recordWarning||(recordSource.type==='imu'?'正在独立记录IMU。保持佩戴固定，按实际动作检查数据。':active.imu?'正在同步记录摄像头和IMU。题号、时间戳与人工标记将一起保存。':'正在记录摄像头关键点与事件。'),!!recordWarning);
}
function onImuSample(sample) {
  if(!active?.imu||sample.receive_host_perf_ms<active.record_start_host_perf_ms)return;
  active.imu.samples.push({...sample,t_ms:round(sample.receive_host_perf_ms-active.record_start_host_perf_ms),question_id:$('questionId').value});
  if(active.source.type==='imu')active.duration_ms=sample.receive_host_perf_ms-active.record_start_host_perf_ms;
  if(active.imu.samples.length%20===0)renderReview();
  if(active.imu.samples.length>=90000){stopRecording('imu_sample_limit');tell('本轮已达到90,000条IMU数据上限，请导出后再开始新一轮。');}
}
function onImuEvents(events) {
  if(!active?.imu||!events.length)return;
  appendEvents(events.map(event=>({...event,origin:'imu',start_ms:active.source_start_ms+Math.max(0,event.start_ms-active.record_start_host_perf_ms),end_ms:active.source_start_ms+Math.max(0,event.end_ms-active.record_start_host_perf_ms)})));
  renderReview();
}
function appendEvents(events) {
  if(!active)return;
  for(const event of events) active.events.push({...event,source_start_ms:event.start_ms,source_end_ms:event.end_ms,start_ms:round(event.start_ms-active.source_start_ms),end_ms:round(event.end_ms-active.source_start_ms)});
}
function stopRecording(reason='manual') {
  if(!active)return;
  const end=recordingNow();if(active.source.type!=='imu')appendEvents(tracker.flush(end));
  if(active.imu){onImuEvents(imu.endSession(performance.now()));active.imu.diagnostics_at_end={format_packets:imu.client.parser.packets,discarded_bytes:imu.client.parser.discardedBytes};}
  active.duration_ms=Math.max(0,end-active.source_start_ms);active.ended_at=new Date().toISOString();active.end_reason=reason;
  active.quality={sampled_frames:active.frames.length,frames_with_hands:active.frames.filter(f=>f.observed).length,meaning:'detection coverage is not accuracy'};
  if(mediaRecorder?.state==='recording')mediaRecorder.stop();
  active.analysis=buildInterviewReport(active);
  window.dispatchEvent(new CustomEvent('multimodal-complete',{detail:active}));
  active=null;tracker=makeTracker();generation++;lastSourceTime=-1;updateControls();renderReview();showReport(true);tell('本轮复盘已生成');
}
function showReport(scroll=false) {
  const selected=selectedSession(),index=sessions.indexOf(selected);
  reportPanel?.show(selected,{recording:!!active,previous:index>0?sessions[index-1]:null,scroll});
}
function refreshSessions(id) { $('sessionSelect').replaceChildren(...sessions.map((s,i)=>new Option(`第 ${i+1} 轮 ${s.source.name}`,s.id)));$('sessionSelect').value=id; }
function selectedSession() {return sessions.find(s=>s.id===$('sessionSelect').value);}
const eventName=event=>event.type==='hand_movement'?`手部移动 #${event.track_id}`:event.type==='hands_unobserved'?'手部未检出':event.type==='imu_tilt'?'躯干姿态偏离':event.type==='imu_unobserved'?'IMU数据间断':'人工标记';
function renderReview() {
  const session=selectedSession();$('timeline').replaceChildren();$('eventRows').replaceChildren();
  const cursor=document.createElement('i');cursor.id='timelineCursor';cursor.className='timeline-cursor';cursor.hidden=!session||!!active;$('timeline').append(cursor);
  reviewPanel?.show(session,{recording:!!active});
  if(!session||!session.events.length) {const span=document.createElement('span');span.textContent=session?'暂未形成事件片段；移动结束后显示，未知区间在恢复检出或记录结束时显示。':'开始一轮记录后，将显示移动候选、未检出区间和人工标记。';$('timeline').append(span);const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=4;td.className='table-empty';td.textContent='尚无事件。';tr.append(td);$('eventRows').append(tr);return;}
  const duration=Math.max(1000,session.duration_ms);
  for(const event of session.events) {
    const bar=document.createElement('button');bar.className=`timeline-event ${['hands_unobserved','imu_unobserved'].includes(event.type)?'unknown':event.type==='imu_tilt'?'posture':event.type==='manual_marker'?'manual':''}`;
    bar.style.left=`${Math.min(99,event.start_ms/duration*100)}%`;bar.style.width=`${Math.max(.8,Math.min(100-event.start_ms/duration*100,((event.end_ms-event.start_ms)/duration*100)))}%`;
    bar.title=`${timeText(event.start_ms)} ${eventName(event)}`;bar.setAttribute('aria-label',bar.title);bar.onclick=()=>reviewEvent(session,event);$('timeline').append(bar);
  }
  for(const event of [...session.events].reverse().slice(0,200)) {
    const tr=document.createElement('tr');const description=event.type==='hands_unobserved'?'未检出，状态未知':event.type==='imu_unobserved'?'没有新鲜蓝牙数据，不能解释为静止':event.type==='imu_tilt'?`峰值 ${event.peak_tilt_deg.toFixed(1)}° 相对坐姿基准`:`持续 ${(event.duration_ms/1000).toFixed(1)} 秒 图像移动`;
    const values=[event.type==='manual_marker'?'人工':event.origin==='imu'?'IMU / 规则':'摄像头 / 规则',`${timeText(event.start_ms)} – ${timeText(event.end_ms)}`,eventName(event),event.note||description];
    values.forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td);});tr.onclick=()=>reviewEvent(session,event);$('eventRows').append(tr);
  }
}
function reviewEvent(session,event) {
  if(active){$('markerFeedback').textContent='录制中，结束记录后可定位片段。';$('markerFeedback').scrollIntoView({behavior:'smooth',block:'center'});return;}
  if(source?.type==='video'&&source.id===session.source.id)video.pause();
  $('sessionSelect').value=session.id;
  renderReview();
  reviewPanel.select(event.start_ms,`${eventName(event)} ${timeText(event.start_ms)}–${timeText(event.end_ms)}`);
  $('reviewInspector').scrollIntoView({behavior:'smooth',block:'center'});
}
function reviewMedia(session) {
  if(session.videoBlob){
    const old=reviewVideoUrls.get(session.id);
    if(old?.blob!==session.videoBlob){if(old)URL.revokeObjectURL(old.url);reviewVideoUrls.set(session.id,{blob:session.videoBlob,url:URL.createObjectURL(session.videoBlob)});}
    return {url:reviewVideoUrls.get(session.id).url,offsetMs:session.source?.type==='video'?(session.source_start_ms||0):(session.record_start_host_perf_ms||0)-(session.video_start_host_perf_ms||session.record_start_host_perf_ms||0)};
  }
  if(source?.type==='video'&&source.id===session.source?.id&&objectUrl)return {url:objectUrl,offsetMs:session.source_start_ms||0};
  return null;
}
function addReviewMarker(cursor) {
  const session=active||selectedSession();if(!session)return;
  const time=active?Math.max(0,recordingNow()-active.source_start_ms):cursor;
  if(active)session.duration_ms=Math.max(session.duration_ms,time);
  const marker=makeMarker(session,time,$('noteText').value);
  session.events.push(marker);$('noteText').value='';
  renderReview();
  if(!active){showReport(false);reviewPanel.select(marker.start_ms,`人工标记 ${timeText(marker.start_ms)}`);}
  if(!active&&session.host_context)window.dispatchEvent(new CustomEvent('multimodal-complete',{detail:session}));
  $('markerFeedback').textContent=`已标记 ${timeText(marker.start_ms)}：${marker.note}`;
}
function download(blob,name) {const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function exportData(type) {
  const session=selectedSession();if(!session)return;
  if(type==='video')return session.videoBlob&&download(session.videoBlob,`${session.id}.webm`);
  if(type==='json') {session.analysis=buildInterviewReport(session);const {videoBlob,...data}=session;return download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),`${session.id}.json`);}
  if(type==='events')return download(new Blob([toCsv(session.events,['type','origin','track_id','start_ms','end_ms','duration_ms','source_start_ms','source_end_ms','peak_speed_palm_widths_s','peak_tilt_deg','baseline_id','end_reason','reason','note'])],{type:'text/csv;charset=utf-8'}),`${session.id}-events.csv`);
  if(type==='imu'){
    const rows=(session.imu?.samples||[]).map(s=>({t_ms:s.t_ms,receive_host_perf_ms:s.receive_host_perf_ms,receive_host_epoch_ms:s.receive_host_epoch_ms,question_id:s.question_id,acc_x_g:s.acc_g[0],acc_y_g:s.acc_g[1],acc_z_g:s.acc_g[2],gyro_x_dps:s.gyro_dps[0],gyro_y_dps:s.gyro_dps[1],gyro_z_dps:s.gyro_dps[2],angle_x_deg:s.euler_deg[0],angle_y_deg:s.euler_deg[1],angle_z_deg:s.euler_deg[2],tilt_deg:s.tilt_deg,raw_tilt_deg:s.raw_tilt_deg,baseline_id:s.baseline_id,connection_generation:s.connection_generation,raw_packet_hex:s.raw_packet_hex}));
    return download(new Blob([toCsv(rows,['t_ms','receive_host_perf_ms','receive_host_epoch_ms','question_id','acc_x_g','acc_y_g','acc_z_g','gyro_x_dps','gyro_y_dps','gyro_z_dps','angle_x_deg','angle_y_deg','angle_z_deg','tilt_deg','raw_tilt_deg','baseline_id','connection_generation','raw_packet_hex'])],{type:'text/csv;charset=utf-8'}),`${session.id}-imu.csv`);
  }
  const rows=session.frames.flatMap(frame=>(frame.hands.length?frame.hands:[null]).map(hand=>({t_ms:frame.t_ms,source_time_ms:frame.source_time_ms,capture_host_epoch_ms:frame.capture_host_epoch_ms,question_id:frame.question_id,observed:frame.observed,hand_count:frame.hands.length,track_id:hand?.id,model_label:hand?.label,center_x_px:hand?.center.x,center_y_px:hand?.center.y,palm_width_px:hand?.palmWidth,speed_palm_widths_s:hand?.speed,moving:hand?.moving,near_edge:hand?.nearEdge,inference_latency_ms:frame.inference_latency_ms,imu_available:!!frame.imu,imu_age_ms:frame.imu?.age_ms,imu_tilt_deg:frame.imu?.tilt_deg,imu_angle_x_deg:frame.imu?.euler_deg[0],imu_angle_y_deg:frame.imu?.euler_deg[1],imu_angle_z_deg:frame.imu?.euler_deg[2]})));
  download(new Blob([toCsv(rows,['t_ms','source_time_ms','capture_host_epoch_ms','question_id','observed','hand_count','track_id','model_label','center_x_px','center_y_px','palm_width_px','speed_palm_widths_s','moving','near_edge','inference_latency_ms','imu_available','imu_age_ms','imu_tilt_deg','imu_angle_x_deg','imu_angle_y_deg','imu_angle_z_deg'])],{type:'text/csv;charset=utf-8'}),`${session.id}-frames.csv`);
}
$('loadModel').onclick=()=>loadModel().catch(()=>{});
for(const id of ['startCamera','cameraButton','cameraTab'])$(id).onclick=startCamera;
$('sampleButton').onclick=useSample;$('videoFile').onchange=e=>{useFile(e.target.files[0]);e.target.value='';};
$('stopSource').onclick=()=>{++sourceOperation;closeSource();tell('输入已关闭，摄像头已释放。');};$('refreshCameras').onclick=refreshCameras;
$('playPause').onclick=()=>video.paused?video.play().catch(error=>tell(error.message,true)):video.pause();
video.onplay=()=>{$('playPause').textContent='暂停录像';};video.onpause=()=>{$('playPause').textContent='播放录像';};
video.onended=()=>{if(active)stopRecording('video_ended');};
video.onseeking=()=>{if(source?.type!=='video')return;if(active)stopRecording('seek');resetTracking();};
video.onseeked=()=>sendFrame();$('seek').oninput=()=>{if(source?.type==='video')video.currentTime=Number($('seek').value);};
for(const id of ['mirror','showSkeleton','showTrail'])$(id).onchange=()=>{sizeStage();draw(latestHands);};
$('motionThreshold').onchange=()=>{let n=Number($('motionThreshold').value);$('motionThreshold').value=Math.max(.2,Math.min(10,Number.isFinite(n)?n:1));resetTracking();};
$('startRecording').onclick=startRecording;$('stopRecording').onclick=()=>stopRecording();$('sessionSelect').onchange=()=>{renderReview();updateControls();showReport(false);};
$('questionId').addEventListener('change',()=>{if(active)active.question_markers.push({t_ms:round(Math.max(0,recordingNow()-active.source_start_ms)),question_id:$('questionId').value.trim()||'未标注题目'});});
$('imuRecord').onclick=startRecording;$('imuStopRecord').onclick=()=>stopRecording();
$('exportJson').onclick=()=>exportData('json');$('exportCsv').onclick=()=>exportData('csv');$('exportEvents').onclick=()=>exportData('events');$('downloadVideo').onclick=()=>exportData('video');
$('exportImu').onclick=()=>exportData('imu');
$('importSession').onchange=async event=>{
  const file=event.target.files[0];event.target.value='';if(!file||active)return;
  try{
    if(file.size>64*1024*1024)throw new Error('会话JSON超过64MB，请使用较短记录。');
    const session=validateImportedSession(JSON.parse(await file.text()));if(active)throw new Error('请先结束当前记录，再导入历史会话。');
    const originalId=String(session.id||'record');session.original_id=originalId;session.id=sessions.some(s=>s.id===originalId)?`${originalId}-import-${Date.now()}`:originalId;session.record_origin='imported_json';
    sessions.push(session);refreshSessions(session.id);renderReview();updateControls();showReport(true);tell('历史复盘已载入');
  }catch(error){tell(`导入失败：${error.message}`,true);}
};
window.addEventListener('beforeunload',event=>{if(sessions.length){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{stream?.getTracks().forEach(t=>t.stop());worker?.terminate();imu?.close();for(const entry of reviewVideoUrls.values())URL.revokeObjectURL(entry.url);});
imu=new ImuPanel({onSample:onImuSample,onEvents:onImuEvents,onState:updateControls});
for(const id of ['reflectionStress','reflectionAttention','reflectionEffort'])for(let n=0;n<=10;n++)$(id).add(new Option(String(n),String(n)));
for(let n=1;n<=5;n++)$('reflectionStructure').add(new Option(String(n),String(n)));
reportPanel=new ReportPanel({onSeek:reviewEvent,onDownload:download});
reviewPanel=new ReviewPanel({getMedia:reviewMedia,onMarker:addReviewMarker,onPosition:(time,session)=>{const cursor=$('timelineCursor');if(cursor&&session){cursor.style.left=`${Math.min(99.5,time/Math.max(1,session.duration_ms)*100)}%`;cursor.title=timeText(time);}}});
showReport(false);
requestAnimationFrame(loop);refreshCameras();updateControls();
export const integration={
  current:()=>selectedSession(),
  state:()=>({camera:!!cameraStream(),cameraError,imu:!!imu?.isFresh,calibrated:!!imu?.baseline,modelReady:ready,recording:!!active}),
  context(value){hostContext=value;const question=value?.questionId||'未标注题目';if($('questionId').value!==question){$('questionId').value=question;$('questionId').dispatchEvent(new Event('change'));}},
  start(){if(active)return true;if(source?.type==='video'&&video.ended)return false;if(!hostContext?.sessionId||!((ready&&source&&source.type!=='image')||imu?.isFresh))return false;startRecording();return !!active;},
  stop(){if(active)stopRecording('onstage_pause_or_finish');return true;},
  camera:()=>source?.type==='camera'?integration.setCamera(false):integration.setCamera(true),
  cameraStream,
  async setCamera(enabled){
    if(!enabled){++sourceOperation;closeSource();cameraError='';tell('摄像头已关闭。');return true;}
    const opened=await startCamera();if(!opened||!cameraStream())throw Error(cameraError||'摄像头开启已取消。');return true;
  },
  load(value){if(active)throw Error('请先暂停采集，再查看复盘');const data=validateImportedSession(value);const existing=sessions.find(s=>s.id===data.id);if(existing){const blob=existing.videoBlob;Object.assign(existing,data);if(blob)existing.videoBlob=blob;}else sessions.push(data);refreshSessions(data.id);renderReview();updateControls();showReport(false);}
};
