import {WitBleParser,WIT_SERVICE,WIT_NOTIFY} from './imu-math.js';

export class WitBleClient extends EventTarget {
  constructor(bluetooth=globalThis.navigator?.bluetooth) {super();this.bluetooth=bluetooth;this.device=null;this.characteristic=null;this.connected=false;this.busy=false;this.parser=new WitBleParser();this.attempt=0;}
  emit(type,detail) {this.dispatchEvent(new CustomEvent(type,{detail}));}
  async connect(showAll=false) {
    if(!this.bluetooth)throw new Error('当前浏览器没有提供蓝牙接口。请用系统 Chrome 或 Edge 打开本地地址。');
    if(this.busy||this.connected)return;
    this.busy=true;this.emit('state',{phase:'choosing'});const attempt=++this.attempt;
    try {
      const device=await this.bluetooth.requestDevice({...(showAll?{acceptAllDevices:true}:{filters:[{namePrefix:'WT'},{namePrefix:'BWT'},{services:[WIT_SERVICE]}]}),optionalServices:[WIT_SERVICE]});
      if(attempt!==this.attempt)return;
      this.device=device;this.emit('state',{phase:'connecting',name:device.name});
      this.disconnectListener=()=>{
        if(this.device!==device)return;
        this.characteristic?.removeEventListener('characteristicvaluechanged',this.notifyListener);
        device.removeEventListener('gattserverdisconnected',this.disconnectListener);
        this.connected=false;this.characteristic=null;this.device=null;
        this.emit('state',{phase:'disconnected',name:device.name});
      };
      device.addEventListener('gattserverdisconnected',this.disconnectListener);
      const server=await device.gatt.connect();
      const service=await server.getPrimaryService(WIT_SERVICE);
      const characteristic=await service.getCharacteristic(WIT_NOTIFY);
      if(!characteristic.properties.notify&&!characteristic.properties.indicate)throw new Error('目标特征不支持数据通知，请核对设备型号。');
      this.parser=new WitBleParser();
      this.notifyListener=event=>{
        const received=performance.now();
        for(const sample of this.parser.feed(event.target.value))this.emit('sample',{...sample,receive_host_perf_ms:received,receive_host_epoch_ms:performance.timeOrigin+received});
      };
      this.characteristic=characteristic;characteristic.addEventListener('characteristicvaluechanged',this.notifyListener);
      await characteristic.startNotifications();
      if(attempt!==this.attempt){await this.disconnect();return;}
      this.connected=true;this.emit('state',{phase:'connected',name:device.name});
    } catch(error) {
      await this.disconnect();
      const message=error.name==='NotFoundError'?'未选到传感器或未找到BLE服务。请开启设备、退出占用它的手机App/维特软件，再重试。':error.name==='SecurityError'?'浏览器未允许蓝牙访问，请用系统 Chrome/Edge 在本地地址中连接。':`蓝牙连接失败：${error.message}`;
      throw new Error(message);
    } finally {this.busy=false;this.emit('state',{phase:this.connected?'connected':'idle',name:this.device?.name});}
  }
  async disconnect() {
    ++this.attempt;
    const device=this.device,characteristic=this.characteristic;
    this.connected=false;this.characteristic=null;this.device=null;
    if(characteristic&&this.notifyListener){characteristic.removeEventListener('characteristicvaluechanged',this.notifyListener);try{await characteristic.stopNotifications();}catch{}}
    if(device){device.removeEventListener('gattserverdisconnected',this.disconnectListener);if(device.gatt?.connected)device.gatt.disconnect();}
    this.emit('state',{phase:'disconnected'});
  }
}
