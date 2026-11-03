import fs from 'node:fs';
import { fail } from './domain.js';
import { createLlm } from './llm/provider.js';

export function modelSettings(env) {
  return {baseUrl:env.LLM_BASE_URL||'',model:env.LLM_MODEL||'',hasApiKey:!!env.LLM_API_KEY,configured:!!(env.LLM_BASE_URL&&env.LLM_MODEL&&env.LLM_API_KEY)};
}

export function validateModelSettings(input,env) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('模型设置格式无效');
  let url;
  try {url=new URL(String(input.baseUrl||'').trim());} catch {fail('请填写有效的接口地址');}
  if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol))fail('接口地址不能包含账号、查询参数或片段');
  if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))fail('远程接口请使用 HTTPS');
  if(/\/(chat\/completions|responses)\/?$/.test(url.pathname))fail('请填写基础地址，不包含 /chat/completions 或 /responses');
  const model=String(input.model||'').trim();
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,199}$/.test(model))fail('请填写有效的模型名称或接入点 ID');
  // An empty password field retains the server-side key; it is never returned to the browser.
  const apiKey=String(input.apiKey||env.LLM_API_KEY||'').trim();
  if(!apiKey||apiKey.length>4096||/[\s'"`#]/.test(apiKey))fail('请填写有效的 API 密钥');
  if(!input.apiKey&&env.LLM_API_KEY&&url.href.replace(/\/$/,'')!==String(env.LLM_BASE_URL||'').replace(/\/$/,''))fail('更换接口地址时，请重新填写 API 密钥');
  return {LLM_BASE_URL:url.href.replace(/\/$/,''),LLM_MODEL:model,LLM_API_KEY:apiKey};
}

export async function testModelSettings(settings,create=createLlm) {
  let reply;
  try {
    const chat=create({baseUrl:settings.LLM_BASE_URL,model:settings.LLM_MODEL,apiKey:settings.LLM_API_KEY});
    reply=await chat([{role:'user',content:'Connection test. Return JSON only: {"ok":true}.'}],{timeoutMs:15000,maxTokens:128});
  } catch(error) {
    if(error.status===401||error.status===403)fail('认证失败，请检查 API 密钥及模型权限',502);
    if(error.status===404)fail('未找到接口或模型，请检查基础地址和模型名称',502);
    if(error.status===429)fail('模型服务限流或额度不足，请检查账户状态',502);
    fail('连接测试失败，请检查接口地址、网络与模型配置',502);
  }
  if(typeof reply!=='string'||!reply.trim())fail('接口未返回文本，请检查模型是否支持对话',502);
}

export function saveModelSettings(file,settings) {
  let content='';
  try {content=fs.readFileSync(file,'utf8');} catch(error) {if(error.code!=='ENOENT')throw error;}
  for(const [key,value] of Object.entries(settings)) {
    const line=`${key}="${value}"`;
    const pattern=new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`,'gm');
    content=pattern.test(content)?content.replace(pattern,()=>line):`${content}${content&&!content.endsWith('\n')?'\n':''}${line}\n`;
  }
  const temporary=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary,content,{mode:0o600});
  fs.renameSync(temporary,file);
}
