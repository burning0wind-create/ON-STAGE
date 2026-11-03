export class MultimodalHost {
  constructor({api,post,toast}) {
    Object.assign(this,{api,post,toast});this.root=document.getElementById('multimodal-root');this.frame=document.getElementById('multimodal-frame');this.requests=new Map();this.pending=new Set();this.failed=new Map();this.sequence=0;this.revision=0;this.state={};this.suspended=false;
    this.ready=new Promise(resolve=>this.resolveReady=resolve);
    window.addEventListener('message',event=>this.message(event));
    document.getElementById('mm-captures').onchange=()=>this.loadCapture();
    document.getElementById('mm-refresh').onclick=()=>this.refresh().catch(e=>toast(e.message));
    document.getElementById('mm-retry').onclick=()=>this.retry().catch(e=>toast(e.message));
    document.getElementById('mm-enabled').onchange=()=>{if(this.enabled())this.maybeStart();else this.stop().catch(e=>toast(e.message));};
    this.frame.src='/multimodal/index.html';
  }
  enabled(){return document.getElementById('mm-enabled').checked;}
  async request(type,data) {
    await Promise.race([this.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('采集模块尚未就绪，请刷新后重试')),15000))]);
    const requestId=++this.sequence;
    return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{this.requests.delete(requestId);reject(Error('采集模块响应超时'));},10000);this.requests.set(requestId,{resolve,reject,timeout});this.frame.contentWindow.postMessage({channel:'onstage-host',type,data,requestId},location.origin);});
  }
  message(event) {
    if(event.origin!==location.origin||event.source!==this.frame.contentWindow||event.data?.channel!=='onstage-multimodal')return;
    const m=event.data;
    if(m.type==='ready')this.resolveReady();
    if(m.type==='reply'){const request=this.requests.get(m.requestId);if(request){clearTimeout(request.timeout);this.requests.delete(m.requestId);m.error?request.reject(Error(m.error)):request.resolve(m.result);}}
    if(m.type==='height'&&Number.isFinite(m.height))this.frame.style.height=`${Math.max(280,Math.min(200000,m.height+8))}px`;
    if(m.type==='state'){this.state=m.state;this.status();this.maybeStart();}
    if(m.type==='capture')this.persist(m.capture);
  }
  status() {
    const labels=[this.state.recording?'正在记录':'未录制',this.state.camera?'摄像头已连接':'摄像头未连接',this.state.imu?(this.state.calibrated?'IMU已校准':'IMU待校准'):'IMU未连接'];
    document.getElementById('mm-status').textContent=labels.join(' / ');
    const camera=document.getElementById('device-camera-state'),imu=document.getElementById('device-imu-state');
    if(camera){camera.textContent=this.state.camera?'已连接':'未连接';camera.dataset.ready=String(!!this.state.camera);}
    if(imu){imu.textContent=this.state.imu?(this.state.calibrated?'已校准':'待校准'):'未连接';imu.dataset.ready=String(!!this.state.imu&&!!this.state.calibrated);}
  }
  async sync(page,session) {
    const revision=++this.revision,changed=this.session?.id!==session?.id;
    if(changed&&this.state.recording)await this.stop();
    if(revision!==this.revision)return;
    this.session=session;this.page=page;this.suspended=session?.status!=='active';
    this.root.hidden=!['devices','interview','reports'].includes(page)||(page!=='devices'&&!session)||(page==='reports'&&!session?.report);
    document.getElementById('mm-title').textContent=page==='reports'?'多模态评分与改善建议':'多模态采集';
    document.getElementById('mm-report-tools').hidden=page!=='reports';
    document.getElementById('mm-status').hidden=page==='reports';
    if(page!=='reports')this.frame.hidden=false;
    document.getElementById('mm-toggle').hidden=page==='reports';
    this.status();
    for(const id of ['mm-enabled','mm-refresh','mm-retry'])document.getElementById(id).disabled=false;
    await this.ready;if(revision!==this.revision)return;
    const question=[...(session?.turns||[])].reverse().find(t=>t.role==='interviewer');
    await this.request('context',session?{sessionId:session.id,questionId:question?.id||'Q1',status:session.status}:null);
    if(revision!==this.revision)return;this.contextSession=session?.id;
    await this.request('view',page==='reports'?'reports':page==='devices'?'devices':'interview');
    if(page==='reports'){await this.refresh();if(revision===this.revision)await this.loadCapture();}
    else this.maybeStart();
  }
  async maybeStart() {
    if(this.starting||this.suspended||!this.enabled()||this.page!=='interview'||this.session?.status!=='active'||this.contextSession!==this.session.id||this.state.recording)return;
    this.starting=true;try{await this.request('start');}catch(e){this.toast(e.message);}finally{this.starting=false;}
  }
  persist(capture) {
    const sid=capture?.host_context?.sessionId;if(!sid)return;
    const key=`${sid}/${capture.id}`;
    const task=this.post(`/api/sessions/${encodeURIComponent(sid)}/multimodal`,capture).then(()=>{
      this.failed.delete(key);document.getElementById('mm-saved').textContent='行为记录已保存';
    }).catch(error=>{this.failed.set(key,capture);document.getElementById('mm-saved').textContent=`保存未完成：${error.message}，请重试或先导出JSON`;}).finally(()=>{this.pending.delete(task);document.getElementById('mm-retry').hidden=!this.failed.size;});
    this.pending.add(task);return task;
  }
  async retry(){await Promise.all([...this.failed.values()].map(c=>this.persist(c)));if(this.failed.size)throw Error('多模态记录尚未保存，请导出采集JSON后重试');}
  async stop() {this.suspended=true;await this.request('stop');await Promise.all([...this.pending]);if(this.failed.size)await this.retry();}
  async refresh() {
    if(!this.session)return;
    const sid=this.session.id,items=await this.api(`/api/sessions/${sid}/multimodal`);if(this.session?.id!==sid)return;
    const select=document.getElementById('mm-captures'),previous=select.value;
    select.replaceChildren(...items.map((x,i)=>new Option(`片段 ${i+1} (${(x.duration_ms/1000).toFixed(1)}秒)`,x.id)));
    if(!items.length)select.add(new Option('本场没有多模态记录',''));
    select.value=items.some(x=>x.id===previous)?previous:items.at(-1)?.id||'';
    if(this.page==='reports'){this.frame.hidden=!items.length;document.getElementById('mm-report-tools').hidden=items.length<=1;}
    select.disabled=items.length<=1;
    document.getElementById('mm-saved').textContent=items.length?`本场已保存 ${items.length} 段采集记录`:'本场未采集行为数据';
  }
  async loadCapture() {
    const id=document.getElementById('mm-captures').value;if(!id||!this.session)return;
    const sid=this.session.id,data=await this.api(`/api/sessions/${sid}/multimodal/${id}`);if(this.session?.id!==sid)return;
    await this.request('load',data);
  }
  async camera(){document.getElementById('multimodal-root').hidden=false;await this.request('camera');window.scrollTo({top:window.scrollY+this.root.getBoundingClientRect().top-24,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
}
