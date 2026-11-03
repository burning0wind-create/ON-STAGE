import test from 'node:test';
import assert from 'node:assert/strict';
import {MultimodalHost} from '../public/multimodal-host.js';

function fixture(){
 const videoTrack={kind:'video',readyState:'live'},stream={getVideoTracks:()=>[videoTrack]},commands=[],events=[];
 let current=null;
 const host=Object.create(MultimodalHost.prototype);
 host.frame={contentWindow:{onstageCameraPreview:{getStream:()=>current}}};host.state={};
 host.status=()=>{};host.notifyCameraState=()=>events.push({...host.state});
 host.request=async type=>{commands.push(type);if(type==='camera-on')current=stream;else if(type==='camera-off')current=null;return true;};
 return {host,stream,commands,events,setCurrent:value=>current=value};
}

test('本人预览读取采集模块同一个视频流，不申请第二个麦克风或摄像头流',async()=>{
 const f=fixture();assert.equal(f.host.getCameraStream(),null);
 assert.equal(await f.host.setCamera(true),f.stream);assert.equal(f.host.getCameraStream(),f.stream);
 assert.deepEqual(f.commands,['camera-on']);assert.equal(f.events.at(-1).camera,true);
 assert.equal(await f.host.setCamera(false),null);assert.equal(f.host.getCameraStream(),null);assert.equal(f.events.at(-1).camera,false);
});

test('权限或采集桥访问失败保留可重试错误，并取消可能仍在等待授权的摄像头开启',async()=>{
 const f=fixture();f.host.request=async type=>{f.commands.push(type);if(type==='camera-on')throw Error('permission timeout');return true;};
 await assert.rejects(f.host.setCamera(true),/permission timeout/);assert.deepEqual(f.commands,['camera-on','camera-off']);
 Object.defineProperty(f.host.frame,'contentWindow',{get(){throw Error('cross origin');}});assert.equal(f.host.getCameraStream(),null);
});

test('旧开启请求完成时不会覆盖后来的关闭状态',async()=>{
 const f=fixture();let resolveOpen;
 f.host.request=type=>{f.commands.push(type);return type==='camera-on'?new Promise(resolve=>resolveOpen=resolve):Promise.resolve(true);};
 const opening=f.host.setCamera(true);await f.host.setCamera(false);resolveOpen(true);assert.equal(await opening,null);assert.equal(f.host.state.camera,false);assert.equal(f.events.length,1);
});

test('旧请求超时不会关闭已经由新操作管理的摄像头',async()=>{
 const f=fixture();let rejectOpen;
 f.host.request=type=>{f.commands.push(type);return type==='camera-on'?new Promise((_,reject)=>rejectOpen=reject):Promise.resolve(true);};
 const opening=f.host.setCamera(true);await f.host.setCamera(false);rejectOpen(Error('old timeout'));await assert.rejects(opening,/old timeout/);assert.deepEqual(f.commands,['camera-on','camera-off']);
});
