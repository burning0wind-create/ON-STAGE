// WitMotion BLE 5.0: 20-byte 55 61 packets, signed little-endian words.
// Protocol reference: WITMOTION/WitBluetooth_BWT901BLE5_0 (official SDK).
export const WIT_SERVICE = '0000ffe5-0000-1000-8000-00805f9a34fb';
export const WIT_NOTIFY = '0000ffe4-0000-1000-8000-00805f9a34fb';
export const STALE_MS = 800;

export class WitBleParser {
  constructor() { this.buffer=[]; this.packets=0; this.skippedRegisters=0; this.discardedBytes=0; }
  feed(input) {
    const bytes=input instanceof DataView ? new Uint8Array(input.buffer,input.byteOffset,input.byteLength) : new Uint8Array(input.buffer||input,input.byteOffset||0,input.byteLength);
    this.buffer.push(...bytes); const samples=[];
    while(this.buffer.length>=2) {
      if(this.buffer[0]!==0x55 || ![0x61,0x71].includes(this.buffer[1])) {this.buffer.shift();this.discardedBytes++;continue;}
      if(this.buffer.length<20)break;
      const packet=Uint8Array.from(this.buffer.splice(0,20));
      if(packet[1]===0x71) {this.skippedRegisters++;continue;}
      const view=new DataView(packet.buffer),word=i=>view.getInt16(2+i*2,true);
      samples.push({acc_g:[0,1,2].map(i=>word(i)*16/32768),gyro_dps:[3,4,5].map(i=>word(i)*2000/32768),euler_deg:[6,7,8].map(i=>word(i)*180/32768),raw_packet_hex:[...packet].map(b=>b.toString(16).padStart(2,'0')).join('')});
      this.packets++;
    }
    return samples;
  }
}

const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
const norm=v=>Math.hypot(...v);
export const normalize=v=>v.map(x=>x/norm(v));
// Gravity direction in sensor axes under the conventional ZYX Euler rotation.
// Comparing directions removes heading/yaw; it is inclination change, not a body joint angle.
export function gravityDirection(euler) {
  if(!Array.isArray(euler)||euler.length!==3||euler.some(v=>!Number.isFinite(v)))throw new TypeError('Three finite Euler angles required');
  const [r,p]=euler.map(v=>v*Math.PI/180);
  return [-Math.sin(p),Math.sin(r)*Math.cos(p),Math.cos(r)*Math.cos(p)];
}
export function vectorAngle(a,b) {return Math.acos(Math.max(-1,Math.min(1,dot(a,b)/(norm(a)*norm(b)))))*180/Math.PI;}
export function relativeTilt(euler,baseline) {return vectorAngle(gravityDirection(euler),baseline.gravity_sensor);}
export function latestFreshSample(history,time,maxAgeMs=STALE_MS) {
  for(let i=history.length-1;i>=0;i--){const sample=history[i];if(sample.receive_host_perf_ms<=time){const age=time-sample.receive_host_perf_ms;return age<=maxAgeMs?{...sample,age_ms:age}:null;}}
  return null;
}

export class BaselineWindow {
  constructor(start) {this.start=start;this.samples=[];}
  add(sample) {
    this.samples.push(sample);
    if(sample.receive_host_perf_ms-this.start<3000)return null;
    if(this.samples.length<10)throw new Error('校准数据不足，请检查蓝牙接收频率后重试。');
    const directions=this.samples.map(s=>gravityDirection(s.euler_deg));
    const sum=directions.reduce((v,d)=>v.map((n,i)=>n+d[i]),[0,0,0]);
    if(norm(sum)/directions.length<.5)throw new Error('校准期间姿态变化过大，请保持静止后重试。');
    const mean=normalize(sum);
    const spread=Math.max(...directions.map(d=>vectorAngle(d,mean)));
    const moving=this.samples.some((s,i)=>norm(s.gyro_dps)>12 || Math.abs(norm(s.acc_g)-1)>.2 || (i&&s.receive_host_perf_ms-this.samples[i-1].receive_host_perf_ms>STALE_MS));
    if(moving||spread>2)throw new Error('这3秒内存在移动或数据间断，请保持自然坐姿静止后重新校准。');
    return {id:`baseline-${Date.now()}`,created_at:new Date().toISOString(),gravity_sensor:mean,sample_count:this.samples.length,duration_ms:sample.receive_host_perf_ms-this.start,max_deviation_deg:spread,method:'mean_sensor_gravity_direction_from_ZYX_Euler',meaning:'relative_to_personal_seated_baseline_not_anatomical_angle'};
  }
}

export class TiltTracker {
  constructor({threshold=12,exitThreshold=8,minDurationMs=1000,settleMs=500,staleMs=STALE_MS}={}) {
    this.options={threshold,exitThreshold,minDurationMs,settleMs,staleMs};this.baseline=null;this.reset();
  }
  reset() {this.lastSeen=null;this.smoothed=null;this.start=null;this.quietStart=null;this.peak=0;this.unknownStart=null;}
  setBaseline(baseline) {this.baseline=baseline;this.reset();}
  finish(time,reason) {
    const start=this.start;this.start=null;this.quietStart=null;
    if(start===null||time-start<this.options.minDurationMs)return null;
    return {type:'imu_tilt',start_ms:start,end_ms:time,duration_ms:time-start,peak_tilt_deg:this.peak,end_reason:reason,baseline_id:this.baseline?.id};
  }
  tick(time) {
    const events=[];
    if(this.lastSeen!==null&&time-this.lastSeen>this.options.staleMs&&this.unknownStart===null) {
      const event=this.finish(this.lastSeen,'signal_gap');if(event)events.push(event);
      this.unknownStart=this.lastSeen+this.options.staleMs;this.smoothed=null;
    }
    return events;
  }
  update(sample) {
    const time=sample.receive_host_perf_ms;
    if(this.lastSeen!==null&&time<=this.lastSeen)return {ignored:true,events:[],tilt_deg:null};
    const events=this.tick(time);
    if(this.unknownStart!==null) {events.push({type:'imu_unobserved',start_ms:this.unknownStart,end_ms:time,duration_ms:time-this.unknownStart,reason:'no_fresh_ble_sample_not_proof_of_stationary'});this.unknownStart=null;}
    const raw=this.baseline?relativeTilt(sample.euler_deg,this.baseline):null;
    if(raw!==null) {
      const alpha=this.lastSeen===null?1:1-Math.exp(-(time-this.lastSeen)/180);
      this.smoothed=this.smoothed===null?raw:this.smoothed+alpha*(raw-this.smoothed);
      if(this.smoothed>=this.options.threshold) {if(this.start===null)this.start=time;this.peak=Math.max(this.start===time?0:this.peak,this.smoothed);this.quietStart=null;}
      else if(this.start!==null&&this.smoothed<=this.options.exitThreshold) {if(this.quietStart===null)this.quietStart=time;if(time-this.quietStart>=this.options.settleMs){const event=this.finish(this.quietStart,'returned_to_baseline');if(event)events.push(event);}}
      else if(this.start!==null)this.quietStart=null;
    }
    this.lastSeen=time;
    return {ignored:false,events,raw_tilt_deg:raw,tilt_deg:this.smoothed,tilted:this.start!==null&&time-this.start>=this.options.minDurationMs};
  }
  flush(time) {
    const events=this.tick(time),event=this.finish(this.lastSeen??time,'session_end');if(event)events.push(event);
    if(this.unknownStart!==null){events.push({type:'imu_unobserved',start_ms:this.unknownStart,end_ms:time,duration_ms:time-this.unknownStart,reason:'no_fresh_ble_sample_not_proof_of_stationary'});this.unknownStart=null;}
    return events;
  }
}
