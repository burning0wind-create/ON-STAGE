import test from 'node:test';
import assert from 'node:assert/strict';
import {SelfCamera} from '../public/self-camera.js';
function fixture(){const events=[],commands=[];let ended;const track={readyState:'live',addEventListener:(name,fn)=>ended=fn,removeEventListener:()=>{},stop:()=>{track.readyState='ended';}};const stream={getVideoTracks:()=>[track],getTracks:()=>[track]};let active=null;const bridge={setCamera:async enabled=>{commands.push(enabled);active=enabled?stream:null;},getCameraStream:()=>active};const camera=new SelfCamera({bridge,onState:s=>events.push({...s})});return {camera,bridge,stream,track,events,commands,end:()=>ended?.()};}
test('小窗复用现有流，收起和放大不重开摄像头，关闭交由采集模块释放',async()=>{
 const f=fixture();await f.camera.open();await f.camera.open();assert.deepEqual(f.commands,[true]);assert.equal(f.camera.stream,f.stream);
 const video={play:()=>Promise.resolve()};f.camera.bind(video);assert.equal(video.srcObject,f.stream);assert.equal(video.muted,true);assert.equal(video.playsInline,true);
 f.camera.setView('collapsed');f.camera.setView('expanded');assert.deepEqual(f.commands,[true]);assert.equal(f.camera.state.view,'expanded');
 await f.camera.close();assert.deepEqual(f.commands,[true,false]);assert.equal(f.camera.stream,null);assert.equal(f.camera.state.status,'off');
});
test('权限失败不显示假画面，设备断开停止预览，重新连接可恢复',async()=>{
 const f=fixture(),original=f.bridge.setCamera;f.bridge.setCamera=async()=>{throw Error('摄像头权限未获允许');};await f.camera.open();assert.equal(f.camera.state.status,'error');assert.match(f.camera.state.error,/权限/);assert.equal(f.camera.stream,null);
 f.bridge.setCamera=original;await f.camera.open();f.end();assert.equal(f.camera.state.status,'error');assert.equal(f.camera.stream,null);assert.match(f.camera.state.error,/断开/);
});
test('打开期间离开会关闭且忽略迟到的授权结果，卸载同步释放已连接轨道',async()=>{
 const f=fixture();let resolve;f.bridge.setCamera=enabled=>enabled?new Promise(r=>resolve=r):Promise.resolve();const pending=f.camera.open();await f.camera.close();resolve();await pending;assert.equal(f.camera.state.status,'off');assert.equal(f.camera.stream,null);
 const g=fixture();await g.camera.open();g.camera.destroy();assert.equal(g.track.readyState,'ended');assert.equal(g.camera.stream,null);
});
