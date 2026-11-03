import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {createServer} from '../src/server.js';
import {renderInterview} from '../public/interview-view.js';

test('真实页面安全策略允许四环节头像加载，渲染不依赖被禁止的内联样式',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'onstage-portrait-'));
 const server=createServer({store:new Store(path.join(temp,'data')),llm:null,env:{},settingsFile:path.join(temp,'.env')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});const checked=path.resolve(temp);assert.ok(checked.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(checked).startsWith('onstage-portrait-'));fs.rmSync(checked,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`,page=await fetch(base),html=await page.text(),csp=page.headers.get('content-security-policy');
 assert.match(csp,/(?:^|;)\s*style-src 'self';/);assert.match(csp,/img-src 'self'/);assert.doesNotMatch(csp,/'unsafe-inline'/);
 const href=html.match(/href="([^"\s]*interview-experience\.css[^"\s]*)"/)?.[1];assert.ok(href);
 const cssResponse=await fetch(base+href);assert.equal(cssResponse.status,200);const css=await cssResponse.text();
 assert.match(css,/\.iv-portrait\s*\{[^}]*object-fit:cover/);assert.doesNotMatch(css,/z-index:\s*-\d/);
 const stages=['english','portfolio','design','ethics'].map(id=>({id,name:id,language:id==='english'?'en-US':'zh-CN',minutes:3}));
 const expected=['english','portfolio','research','qualities'];
 for(let i=0;i<stages.length;i++){
   const rendered=renderInterview({status:'active',stageIndex:i,profile:{stages},turns:[{id:'q',role:'interviewer',stageId:stages[i].id,content:'本题问题'}]});
   assert.doesNotMatch(rendered,/\sstyle\s*=/i);
   const portrait=[...rendered.matchAll(/<img\b[^>]*>/g)].map(m=>m[0]).find(tag=>/class="iv-portrait"/.test(tag));assert.ok(portrait);
   const src=portrait.match(/\bsrc="([^"]+)"/)?.[1];assert.equal(src,`/assets/examiners/${expected[i]}.png`);
   const image=await fetch(base+src);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
   const bytes=Buffer.from(await image.arrayBuffer());assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
   assert.ok(bytes.length>10000);const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);assert.ok(Math.abs(width/height-421/237)<.01,'素材与Figma画面槽比例一致');
 }
});
