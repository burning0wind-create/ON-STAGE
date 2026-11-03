import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { OnStage } from './app.js';
import { modelFromEnv } from './ai.js';
import { parseMaterial } from './materials.js';
import { TEMPLATE_SEEDS,STAGES,DIMENSIONS,fail,required } from './domain.js';
import { targetLabel } from '../public/catalog-state.js';
import { getExamLibrary } from './exam-library.js';
import { reportMarkdown } from './report-export.js';
import {attachCapture,getCapture} from './multimodal.js';
import {modelSettings,validateModelSettings,testModelSettings,saveModelSettings} from './model-settings.js';

const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.webm':'video/webm','.otf':'font/otf'};
function json(res,data,status=200) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req,max=24*1024*1024) {
  let n=0;const chunks=[];
  for await(const chunk of req) {n+=chunk.length;if(n>max) fail('上传内容超过 24 MB',413);chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function input(req) {try{return JSON.parse((await body(req,1024*1024)).toString('utf8'));}catch(e){if(e.status)throw e;fail('JSON 请求格式无效');}}
export function createServer({store=new Store(process.env.DATA_DIR||'data'),llm=modelFromEnv(),env=process.env,settingsFile=fileURLToPath(new URL('../.env.local',import.meta.url)),testConnection=testModelSettings}={}) {
  const app=new OnStage(store,llm);
  let runtimeEnv={...env},settingsBusy=false;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const host=req.headers.host??'';
      if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) fail('原型仅允许本机访问',403);
      if(req.headers.origin && ![`http://${host}`].includes(req.headers.origin)) fail('请求来源无效',403);
      const url=new URL(req.url,`http://${host}`), route=url.pathname;
      if(route.startsWith('/multimodal/')){
        res.setHeader('X-Frame-Options','SAMEORIGIN');
        res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'");
      }
      const captureRoute=route.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/multimodal(?:\/([a-zA-Z0-9_-]+))?$/);
      if(captureRoute){
        const [,sid,key]=captureRoute;
        if(req.method==='GET')return json(res,key?getCapture(store,sid,key):(app.get(sid).multimodal||[]));
        if(req.method==='POST'&&!key){if(app.busy.has(sid))fail('本场正在保存回答，请稍后重试采集保存',409);let data;try{data=JSON.parse((await body(req,64*1024*1024)).toString('utf8'));}catch(e){if(e.status)throw e;fail('多模态JSON格式无效');}if(app.busy.has(sid))fail('本场正在保存回答，请稍后重试采集保存',409);return json(res,attachCapture(store,sid,data),201);}
      }
      if(route==='/api/config'&&req.method==='GET') return json(res,{name:'ON STAGE',mode:llm?'llm':'demo',searchConfigured:!!env.SEARCH_API_KEY,templates:TEMPLATE_SEEDS,stages:STAGES,dimensions:DIMENSIONS});
      if(route==='/api/model-settings'&&req.method==='GET')return json(res,modelSettings(runtimeEnv));
      if(['/api/model-settings','/api/model-settings/test'].includes(route)&&req.method==='POST'){
        if(!req.headers['content-type']?.startsWith('application/json'))fail('请使用 JSON 请求',415);
        if(settingsBusy||app.busy.size)fail('正在处理请求，请稍后再修改模型设置',409);
        settingsBusy=true;
        try{
          const settings=validateModelSettings(await input(req),runtimeEnv);
          await testConnection(settings);
          if(route.endsWith('/test'))return json(res,{ok:true,message:'连接成功'});
          if(app.busy.size)fail('正在保存面试回答，请稍后再启用模型',409);
          saveModelSettings(settingsFile,settings);
          runtimeEnv={...runtimeEnv,...settings};llm=modelFromEnv(runtimeEnv);app.llm=llm;
          return json(res,{...modelSettings(runtimeEnv),mode:'llm'});
        }finally{settingsBusy=false;}
      }
      if(route==='/api/exam-library'&&req.method==='GET') return json(res,getExamLibrary());
      if(route==='/api/materials'&&req.method==='POST') {
        const bytes=await body(req);
        let form;try{form=await new Request('http://localhost/upload',{method:'POST',headers:{'content-type':req.headers['content-type']??''},body:bytes}).formData();}catch{fail('上传表单无效');}
        const file=form.get('file');if(!file||typeof file.arrayBuffer!=='function') fail('请选择文件');
        const binary=Buffer.from(await file.arrayBuffer());
        const material=await parseMaterial({name:file.name,bytes:binary,kind:String(form.get('kind')),suppliedText:String(form.get('suppliedText')??'')});
        store.saveUpload(material.id,binary);store.put('materials',material.id,material);return json(res,material,201);
      }
      if(route==='/api/materials'&&req.method==='GET') return json(res,store.list('materials').map(({pages,...m})=>m));
      const materialMatch=route.match(/^\/api\/materials\/([a-zA-Z0-9_-]+)\/file$/);
      if(materialMatch&&req.method==='GET') {
        const material=store.get('materials',materialMatch[1])??fail('材料不存在',404);
        const file=store.file('uploads',material.id).replace(/\.json$/,'.bin');
        const contentType=material.extension==='.pdf'?'application/pdf':mime[material.extension]??'text/plain; charset=utf-8';
        res.writeHead(200,{'Content-Type':contentType,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(material.name)}`,'Cache-Control':'no-store'});
        return fs.createReadStream(file).pipe(res);
      }
      if(route==='/api/profiles'&&req.method==='POST') return json(res,app.profile(await input(req)),201);
      if(route==='/api/profiles'&&req.method==='GET') return json(res,store.list('profiles'));
      if(route==='/api/sessions'&&req.method==='POST') return json(res,await app.start((await input(req)).profileId),201);
      if(route==='/api/sessions'&&req.method==='GET') return json(res,store.list('sessions').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(({materials,sources,plan,turns,sensors,...s})=>s));
      const match=route.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)(?:\/(answer|action|sensors|export|improvements))?$/);
      if(match) {
        const [,sid,action]=match;
        if(!action&&req.method==='GET') return json(res,app.get(sid));
        if(action==='answer'&&req.method==='POST') return json(res,await app.answer(sid,await input(req)));
        if(action==='action'&&req.method==='POST') return json(res,await app.advance(sid,(await input(req)).action));
        if(action==='sensors'&&req.method==='POST') return json(res,app.sensors(sid,(await input(req)).events));
        if(action==='improvements'&&req.method==='POST') {const data=await input(req);return json(res,app.checkImprovement(sid,data.index,data.checked));}
        if(action==='export'&&req.method==='GET') {
          const s=app.get(sid);if(!s.report) fail('请先结束面试并生成报告');
          const markdown=url.searchParams.get('format')==='md';
          res.writeHead(200,{'Content-Type':markdown?'text/markdown; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="on-stage-${sid}.${markdown?'md':'json'}"`});
          const multimodal=s.multimodal||[];
          return res.end(markdown?reportMarkdown(s)+(multimodal.length?'\n\n## 多模态行为复盘\n'+multimodal.map(c=>`\n- 片段 ${c.id}：${(c.duration_ms/1000).toFixed(1)}秒。${c.analysis.summary}`).join('\n')+'\n\n动作观察不计入专业训练分。':''):JSON.stringify({profile:s.profile,turns:s.turns,report:s.report,multimodal},null,2));
        }
      }
      if(route==='/api/sources'&&req.method==='GET') return json(res,store.list('sources'));
      if(route==='/api/sources'&&req.method==='POST') return json(res,app.addSource(await input(req)),201);
      if(route==='/api/search'&&req.method==='POST') {
        if(!env.SEARCH_API_KEY) fail('尚未配置联网检索，可手动添加官方链接与经验贴',503);
        const p=await input(req),school=required(p.school,'院校'),major=required(p.major,'专业'),college=String(p.college??'').slice(0,200);
        const response=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:env.SEARCH_API_KEY,query:`${school} ${college} ${major} ${String(p.year??'').slice(0,10)} 面试 考核细则 作品集 经验`,max_results:5}),signal:AbortSignal.timeout(20000)});
        if(!response.ok) fail('检索服务暂不可用',502);
        const data=await response.json();
        return json(res,{results:(data.results??[]).map(x=>({title:x.title,url:x.url,summary:x.content,type:'experience',school,college,major,retrievedAt:new Date().toISOString(),verified:false,confidence:'pending_verification'}))});
      }
      if(route.startsWith('/api/')) fail('接口不存在',404);
      if(req.method!=='GET'&&req.method!=='HEAD') fail('方法不支持',405);
      const relative=decodeURIComponent(route==='/'?'index.html':route.slice(1));
      const file=path.resolve(publicDir,relative);
      if(!file.startsWith(publicDir)||!fs.existsSync(file)||!fs.statSync(file).isFile()) fail('页面不存在',404);
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-cache'});
      if(req.method==='HEAD') return res.end();fs.createReadStream(file).pipe(res);
    } catch(e) {if(!res.headersSent)json(res,{error:e.status?e.message:'服务暂不可用，请稍后重试'},e.status??500);else res.end();}
  });
  server.requestTimeout=120000;
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT)||4318;
  createServer().listen(port,'127.0.0.1',()=>console.log(`ON STAGE ready · http://127.0.0.1:${port}`));
}
