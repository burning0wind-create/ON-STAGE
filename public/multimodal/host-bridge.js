import {integration} from './app.js';
import './host-layout.js';
let parentContext=null,lastState='',saveSeq=0;
const send=(type,data={})=>parent.postMessage({channel:'onstage-multimodal',type,...data},location.origin);
window.addEventListener('message',async event=>{
  if(event.origin!==location.origin||event.source!==parent||event.data?.channel!=='onstage-host')return;
  const {requestId,type,data}=event.data;
  try{
    let result;
    if(type==='context'){parentContext=data;integration.context(data);result=true;}
    else if(type==='start'){if(!parentContext?.sessionId)throw Error('请先选择面试场次');result=integration.start();}
    else if(type==='stop'){result=integration.stop();}
    else if(type==='camera'){await integration.camera();result=true;}
    else if(type==='load'){integration.load(data);result=true;}
    else if(type==='view'){document.body.dataset.hostView=data;result=true;}
    else throw Error('不支持的采集操作');
    send('reply',{requestId,result});
  }catch(error){send('reply',{requestId,error:error.message});}
});
window.addEventListener('multimodal-complete',event=>{const {videoBlob,...capture}=event.detail;if(capture.host_context?.sessionId)send('capture',{capture,sequence:++saveSeq});});
document.getElementById('reflectionForm').addEventListener('change',()=>{const selected=integration.current();if(selected?.host_context){const {videoBlob,...capture}=selected;send('capture',{capture,sequence:++saveSeq});}});
setInterval(()=>{const state=integration.state();const signature=JSON.stringify(state);if(lastState!==signature){lastState=signature;send('state',{state});}},500);
new ResizeObserver(()=>send('height',{height:Math.ceil(document.body.getBoundingClientRect().height)})).observe(document.body);
send('ready');
