import {WitBleClient} from './imu-ble.js';
import {BaselineWindow,TiltTracker,STALE_MS,WIT_SERVICE,WIT_NOTIFY,latestFreshSample} from './imu-math.js';
const $=id=>document.getElementById(id);

export class ImuPanel {
  constructor({onSample=()=>{},onEvents=()=>{},onState=()=>{}}={}) {
    this.client=new WitBleClient();this.posture=new TiltTracker();this.history=[];this.latest=null;this.baseline=null;this.calibration=null;this.recording=false;this.phase='idle';this.connectionGeneration=0;
    this.onSample=onSample;this.onEvents=onEvents;this.onState=onState;
    this.client.addEventListener('sample',({detail})=>this.receive(detail));
    this.client.addEventListener('state',({detail})=>{
      this.phase=detail.phase;
      if(detail.phase==='connecting'){this.connectionGeneration++;this.latest=null;this.history=[];this.baseline=null;this.calibration=null;this.posture.setBaseline(null);}
      if(detail.phase==='disconnected'){this.calibration=null;if(!this.recording){this.baseline=null;this.posture.setBaseline(null);}this.message('蓝牙已断开。请重新连接并校准；过期数值不会作为当前姿态。');}
      if(detail.phase==='choosing')this.message('在浏览器弹窗中选择你的 WT901BLE / BWT901 设备。');
      if(detail.phase==='connecting')this.message(`正在连接 ${detail.name||'传感器'} 并订阅姿态数据……`);
      if(detail.phase==='connected')this.message(`已连接 ${detail.name||'IMU'}，等待有效的姿态数据包。`);
      this.render();this.onState();
    });
    $('imuConnect').onclick=async()=>{try{await this.client.connect($('imuShowAll').checked);}catch(error){this.message(error.message,true);}};
    $('imuDisconnect').onclick=()=>this.client.disconnect();
    $('imuCalibrate').onclick=()=>{if(!this.isFresh||this.recording)return;this.calibration=new BaselineWindow(performance.now());this.message('正在采集3秒基准：请在完成佩戴后，保持自然坐姿静止。');this.render();};
    $('imuThreshold').onchange=()=>{
      const value=Number($('imuThreshold').value);$('imuThreshold').value=Math.max(3,Math.min(60,Number.isFinite(value)?value:12));
      this.posture.options.threshold=Number($('imuThreshold').value);this.posture.options.exitThreshold=this.posture.options.threshold*2/3;this.posture.reset();
    };
    this.timer=setInterval(()=>{
      const now=performance.now();this.onEvents(this.posture.tick(now));
      if(this.calibration&&now-this.calibration.start>8000){this.calibration=null;this.message('校准超时：没有持续收到足够数据，请检查蓝牙连接后重试。',true);}
      this.render();this.onState();
    },200);
    if(!this.client.bluetooth)this.message('此浏览器没有蓝牙接口。请复制本地地址到系统 Chrome 或 Edge；内嵌预览可能不支持设备选择。',true);
    this.render();
  }
  message(text,error=false) {$('imuMessage').textContent=text;$('imuMessage').classList.toggle('error',error);}
  get isFresh() {return this.client.connected&&!!this.latest&&performance.now()-this.latest.receive_host_perf_ms<=STALE_MS;}
  receive(sample) {
    if(!this.latest)this.message('已收到姿态数据。请先固定佩戴，再保持自然坐姿校准3秒。');
    if(this.calibration) {
      try {
        const baseline=this.calibration.add(sample);
        if(baseline){this.baseline=baseline;this.posture.setBaseline(baseline);this.calibration=null;this.message('基准已记录。请分别前倾、侧倾和转身，检查偏离角是否符合实际；重新佩戴后需重新校准。');}
      } catch(error){this.calibration=null;this.message(error.message,true);}
    }
    const result=this.posture.update(sample);
    this.latest={...sample,connection_generation:this.connectionGeneration,tilt_deg:result.ignored?this.latest?.tilt_deg??null:result.tilt_deg,raw_tilt_deg:result.raw_tilt_deg??null,baseline_id:this.baseline?.id??null,tilted:result.tilted??false};
    this.history.push(this.latest);this.history=this.history.filter(s=>sample.receive_host_perf_ms-s.receive_host_perf_ms<5000);
    this.onSample(this.latest);this.onEvents(result.events);
  }
  snapshotAt(perf) {
    return latestFreshSample(this.history,perf);
  }
  setRecording(recording) {this.recording=recording;this.render();}
  beginSession() {this.posture.reset();if(this.isFresh){this.posture.lastSeen=this.latest.receive_host_perf_ms;this.posture.smoothed=this.latest.tilt_deg;}return this.metadata();}
  endSession(now) {const events=this.posture.flush(now);this.posture.reset();if(!this.client.connected){this.baseline=null;this.posture.setBaseline(null);}return events;}
  metadata() {return {transport:'WebBluetooth',device_name:this.client.device?.name||null,protocol:'WitMotion BLE 5.0 55 61 20-byte',service_uuid:WIT_SERVICE,notify_uuid:WIT_NOTIFY,baseline:this.baseline?structuredClone(this.baseline):null,settings:{...this.posture.options},timebase:'host BLE notification arrival; device measurement timestamps unavailable',units:{acc_g:'g',gyro_dps:'deg/s',euler_deg:'sensor X/Y/Z degrees',tilt_deg:'smoothed inclination change from seated baseline'},integrity:'55 61 packets have no checksum; structural parsing is not integrity verification'};}
  render() {
    const fresh=this.isFresh,latest=this.latest,now=performance.now();
    $('imuConnect').disabled=this.client.busy||this.client.connected||this.recording;
    $('imuDisconnect').disabled=!this.client.connected&&!this.client.busy;
    $('imuCalibrate').disabled=!fresh||this.recording||!!this.calibration;
    $('imuThreshold').disabled=this.recording||!!this.calibration;$('imuShowAll').disabled=this.client.busy||this.client.connected||this.recording;
    $('imuConnection').textContent=this.client.busy?'连接中':this.client.connected?(fresh?'数据接收中':'已连接 数据未更新'):'未连接';
    $('imuDot').className=`status-dot ${fresh?'ready':this.client.busy?'loading':''}`;
    $('imuDeviceName').textContent=this.client.device?.name||'WitMotion BLE 5.0';
    const recent=this.history.filter(s=>now-s.receive_host_perf_ms<2000);
    const span=recent.length>1?recent.at(-1).receive_host_perf_ms-recent[0].receive_host_perf_ms:0;
    $('imuRate').textContent=fresh&&span>0?`${((recent.length-1)/(span/1000)).toFixed(1)} Hz`:'—';
    $('imuAge').textContent=latest?`${Math.round(now-latest.receive_host_perf_ms)} ms${fresh?'':' 已过期'}`:'等待数据';
    const tilt=fresh&&latest?.tilt_deg!=null?latest.tilt_deg:null;
    $('imuTilt').textContent=tilt===null?'—':tilt.toFixed(1);$('imuTiltState').textContent=!fresh?'姿态未知':!this.baseline?'请先校准自然坐姿':latest.tilted?'已形成持续偏离候选':'相对个人基准';
    $('imuTiltBar').style.width=`${Math.min(100,(tilt??0)/45*100)}%`;
    $('imuTiltBar').classList.toggle('over',!!latest?.tilted&&fresh);
    $('imuAngles').textContent=fresh?latest.euler_deg.map(v=>v.toFixed(1)+'°').join(' / '):'— / — / —';
    $('imuAcceleration').textContent=fresh?latest.acc_g.map(v=>v.toFixed(2)).join(' / '):'— / — / —';
    $('imuGyro').textContent=fresh?latest.gyro_dps.map(v=>v.toFixed(1)).join(' / '):'— / — / —';
    $('imuCalibration').textContent=this.calibration?`基准采集中 ${Math.min(3,(now-this.calibration.start)/1000).toFixed(1)} / 3秒`:this.baseline?`已校准 ${this.baseline.sample_count} 帧`:'尚未校准';
    $('imuPacketCount').textContent=`${this.client.parser.packets} 个有效格式包 ${this.client.parser.discardedBytes} 个丢弃字节`;
  }
  close() {clearInterval(this.timer);this.client.disconnect();}
}
