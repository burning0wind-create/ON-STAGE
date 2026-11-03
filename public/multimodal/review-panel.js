import {demoTranscript,activeTurn} from './transcript.js';
const $=id=>document.getElementById(id);
export const clampTime=(time,duration)=>Math.max(0,Math.min(Number.isFinite(duration)?duration:0,Number.isFinite(time)?time:0));
export function sampleAt(samples,time,maxAge) {
  let latest=null;
  for(const sample of samples||[])if(Number.isFinite(sample.t_ms)&&sample.t_ms<=time&&(!latest||sample.t_ms>=latest.t_ms))latest=sample;
  return latest&&time-latest.t_ms<=maxAge?latest:null;
}
export function makeMarker(session,time,note) {
  const t=Math.round(clampTime(time,session.duration_ms)*1000)/1000;
  const sourceTime=(session.source_start_ms||0)+t;
  return {type:'manual_marker',start_ms:t,end_ms:t,duration_ms:0,source_start_ms:sourceTime,source_end_ms:sourceTime,note:String(note||'希望回看').trim().slice(0,240)||'希望回看'};
}
const format=ms=>{const s=Math.max(0,ms)/1000;return `${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(1).padStart(4,'0')}`;};
const edges=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

export class ReviewPanel {
  constructor({getMedia,onPosition,onMarker}) {
    this.getMedia=getMedia;this.onPosition=onPosition;this.onMarker=onMarker;this.session=null;this.cursor=0;this.recording=false;this.media=null;this.turnNodes=[];this.activeIndex=-1;
    $('reviewSeek').oninput=()=>this.select(Number($('reviewSeek').value));
    $('reviewVideo').onloadedmetadata=()=>this.seekVideo();
    $('reviewVideo').ontimeupdate=()=>{if(this.media&&this.session&&!this.recording){this.cursor=clampTime($('reviewVideo').currentTime*1000-this.media.offsetMs,this.session.duration_ms);this.position();this.snapshot();}};
    $('addMarker').onclick=()=>this.onMarker(this.recording?null:this.cursor);
    $('noteText').onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();if(!$('addMarker').disabled)$('addMarker').click();}};
    $('loadDemoTranscript').onclick=()=>{if(!this.session||this.recording)return;this.session.transcript=demoTranscript(this.session.duration_ms);this.renderTranscript();this.highlightTranscript();};
    $('reviewVideoFile').onchange=event=>{const file=event.target.files[0];event.target.value='';if(!file||!this.session||this.recording)return;this.session.videoBlob=file;this.show(this.session);};
    $('reviewVideo').onerror=()=>{if(!this.session||this.recording||!this.media)return;this.mediaErrorUrl=this.media.url;$('reviewMediaHint').textContent='录像无法读取，请重新加载';$('reviewVideo').hidden=true;$('reviewCanvas').hidden=false;this.snapshot();};
    window.addEventListener('onstage-appearance',()=>{if(this.session&&!this.recording)this.snapshot();});
  }
  show(session,{recording=false}={}) {
    const changed=this.session?.id!==session?.id,stopped=this.recording&&!recording;
    this.session=session;this.recording=recording;
    $('addMarker').disabled=!session;
    $('noteText').disabled=!session;
    $('loadDemoTranscript').disabled=!session||recording;$('reviewVideoFile').disabled=!session||recording;
    $('addMarker').textContent=recording?'标记当前时刻':'标记选中时刻';
    $('reviewInspector').hidden=!session||recording;
    if(!session){$('reviewVideo').pause();return;}
    if(changed||stopped){this.cursor=recording?0:session.duration_ms;$('reviewSelection').textContent='选择片段或拖动时间轴';$('markerFeedback').textContent='';}
    if(recording){$('reviewVideo').pause();return;}
    if(changed||this.renderedTranscript!==session.transcript)this.renderTranscript();
    $('reviewSeek').max=session.duration_ms;
    const media=this.getMedia(session);
    if(this.media?.url!==media?.url){$('reviewVideo').pause();this.media=media;if(media)$('reviewVideo').src=media.url;else{$('reviewVideo').removeAttribute('src');$('reviewVideo').load();}}
    else this.media=media;
    const failed=media&&this.mediaErrorUrl===media.url;
    $('reviewVideo').hidden=!media||!!failed;$('reviewCanvas').hidden=!!media&&!failed;
    $('reviewMediaHint').textContent=failed?'录像无法读取，请重新加载':media?'摄像头录像':'未保存画面，可加载本轮录像';
    if(changed||stopped){this.select(this.cursor);}
    else this.position();
  }
  select(time,label) {
    if(!this.session||this.recording)return;
    this.cursor=clampTime(time,this.session.duration_ms);
    if(label)$('reviewSelection').textContent=label;
    this.seekVideo();this.position();this.snapshot();
  }
  seekVideo() {
    const video=$('reviewVideo');if(!this.media||!this.session||this.recording||video.readyState<1)return;
    video.pause();const seconds=(this.media.offsetMs+this.cursor)/1000;
    video.currentTime=Math.max(0,Math.min(seconds,Number.isFinite(video.duration)?Math.max(0,video.duration-.001):seconds));
  }
  position() {
    $('reviewTime').textContent=format(this.cursor);$('reviewSeek').value=this.cursor;
    this.highlightTranscript();
    this.onPosition(this.cursor,this.session);
  }
  renderTranscript() {
    const transcript=this.session.transcript;this.renderedTranscript=transcript;this.activeIndex=-1;this.turnNodes=[];
    const list=$('transcriptList');list.replaceChildren();
    $('transcriptNotice').textContent=transcript?.kind==='synthetic'?'虚构测试对话，用于验证同步，并非录音转写':transcript?(transcript.title||'本场问答记录'):'尚无对话记录，可载入虚构测试对话';
    for(const segment of transcript?.segments||[]){
      const item=document.createElement('div');item.setAttribute('role','listitem');
      const button=document.createElement('button');button.type='button';button.className='transcript-turn';
      const heading=document.createElement('span');heading.className='transcript-meta';heading.textContent=`${segment.speaker} ${format(segment.start_ms)}–${format(segment.end_ms)}`;
      const text=document.createElement('span');text.textContent=segment.text;button.append(heading,text);button.onclick=()=>this.select(segment.start_ms,`${segment.speaker} ${format(segment.start_ms)}`);
      item.append(button);list.append(item);this.turnNodes.push(button);
    }
  }
  highlightTranscript() {
    const index=activeTurn(this.session?.transcript?.segments,this.cursor,this.session?.duration_ms);
    if(index===this.activeIndex)return;
    if(this.turnNodes[this.activeIndex])this.turnNodes[this.activeIndex].removeAttribute('aria-current');
    this.activeIndex=index;
    const node=this.turnNodes[index];if(!node)return;node.setAttribute('aria-current','true');
    const list=$('transcriptList'),top=node.offsetTop-list.offsetTop;
    if(top<list.scrollTop||top+node.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=Math.max(0,top-16);
  }
  snapshot() {
    const frame=sampleAt(this.session.frames,this.cursor,300),imu=sampleAt(this.session.imu?.samples,this.cursor,800);
    const canvas=$('reviewCanvas'),ctx=canvas.getContext('2d');canvas.width=640;canvas.height=360;
    const appearance=getComputedStyle(document.documentElement);
    ctx.fillStyle=appearance.getPropertyValue('--review-canvas-bg').trim()||'#edf3eb';ctx.fillRect(0,0,640,360);ctx.lineWidth=3;
    for(const [i,hand] of (frame?.hands||[]).entries()){
      ctx.strokeStyle=ctx.fillStyle=appearance.getPropertyValue(i?'--review-hand-second':'--review-hand-first').trim()||(i?'#986d32':'#176b58');
      for(const [a,b] of edges){const p=hand.landmarks[a],q=hand.landmarks[b];ctx.beginPath();ctx.moveTo(p.x*640,p.y*360);ctx.lineTo(q.x*640,q.y*360);ctx.stroke();}
      for(const p of hand.landmarks){ctx.beginPath();ctx.arc(p.x*640,p.y*360,4,0,Math.PI*2);ctx.fill();}
    }
    $('reviewHands').textContent=frame?frame.hands.length?`${frame.hands.length}只手`:'未检出手部':'该时刻无有效手部帧';
    $('reviewTilt').textContent=Number.isFinite(imu?.tilt_deg)?`姿态偏离 ${imu.tilt_deg.toFixed(1)}°`:'该时刻无有效姿态';
  }
}
