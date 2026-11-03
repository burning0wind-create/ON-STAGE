// Preview the capture module's existing stream; never open a second camera.
export class SelfCamera {
  constructor({bridge,onState=()=>{}}){this.bridge=bridge;this.onState=onState;this.state={status:'off',view:'normal',error:''};this.stream=null;this.operation=0;this.closing=false;this.trackListeners=[];}
  emit(state){this.state={...this.state,...state};this.onState(this.state);}
  setStream(stream){
    for(const [track,listener]of this.trackListeners)track.removeEventListener?.('ended',listener);
    this.trackListeners=[];this.stream=stream;
    for(const track of stream?.getVideoTracks?.()??[]){const listener=()=>{if(this.stream===stream){this.setStream(null);this.emit({status:'error',error:'摄像头已断开，可重新开启。'});}};track.addEventListener?.('ended',listener);this.trackListeners.push([track,listener]);}
  }
  async open(){
    if(['requesting','active'].includes(this.state.status))return;
    const operation=++this.operation;this.closing=false;this.emit({status:'requesting',view:'normal',error:''});
    try{
      await this.bridge.setCamera(true);
      if(operation!==this.operation)return;
      const stream=this.bridge.getCameraStream();
      if(!stream)throw Error('没有收到摄像头画面，请检查权限或设备后重试。');
      this.setStream(stream);this.emit({status:'active',error:''});
    }catch(error){if(operation===this.operation){this.setStream(null);this.emit({status:'error',error:error.message||'无法开启摄像头，请重试。'});}}
  }
  async close(){
    const operation=++this.operation;this.closing=true;this.setStream(null);this.emit({status:'off',view:'normal',error:''});
    try{await this.bridge.setCamera(false);}catch(error){if(operation===this.operation)this.emit({status:'error',error:'摄像头关闭未确认，请检查浏览器的摄像头指示。'});}
    finally{if(operation===this.operation)this.closing=false;}
  }
  refresh(){
    if(this.closing)return;
    const stream=this.bridge.getCameraStream();
    if(stream){if(this.stream!==stream)this.setStream(stream);if(this.state.status!=='active')this.emit({status:'active',error:''});}
    else if(this.state.status==='active'){this.setStream(null);this.emit({status:'off',view:'normal',error:''});}
  }
  setView(view){if(this.state.status!=='active'||!['normal','collapsed','expanded'].includes(view))return;this.emit({view});}
  bind(video){
    if(!video)return;
    video.muted=true;video.playsInline=true;
    if(video.srcObject!==this.stream)video.srcObject=this.stream;
    if(this.stream)video.play()?.catch(()=>{if(this.state.status==='active'&&!this.state.error)this.emit({error:'画面暂未播放，可关闭后重新开启。'});});
  }
  destroy(){this.operation++;const stream=this.stream;this.setStream(null);for(const track of stream?.getTracks?.()??[])track.stop();}
}
