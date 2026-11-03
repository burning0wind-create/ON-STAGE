const stylesheet=document.createElement('link');
stylesheet.rel='stylesheet';stylesheet.href='/model-settings.css';document.head.append(stylesheet);
const toggle=document.createElement('button');
toggle.id='model-settings-toggle';toggle.className='theme-toggle';toggle.type='button';toggle.dataset.shellControl='';
toggle.setAttribute('aria-label','模型设置');toggle.title='模型设置';
toggle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 1v3m6-3v3M9 20v3m6-3v3M1 9h3m-3 6h3m16-6h3m-3 6h3M9 9h6v6H9z"/></svg><span class="theme-label">模型设置</span>';
document.querySelector('.appearance-actions').prepend(toggle);
const dialog=document.createElement('dialog');
dialog.className='model-settings-dialog';dialog.setAttribute('aria-labelledby','model-settings-title');
dialog.innerHTML=`<form id="model-settings-form">
  <header><div><h2 id="model-settings-title">模型设置</h2><p id="model-settings-state">正在读取配置</p></div><button type="button" data-shell-control class="secondary model-settings-close" aria-label="关闭模型设置">关闭</button></header>
  <label for="model-base-url">接口基础地址</label><input id="model-base-url" name="baseUrl" type="url" required placeholder="https://…/v1" autocomplete="off" spellcheck="false">
  <p class="model-field-hint">兼容 Chat Completions，不包含 /chat/completions。</p>
  <label for="model-name">模型名称或接入点 ID</label><input id="model-name" name="model" required placeholder="填写服务商提供的模型标识" autocomplete="off" spellcheck="false">
  <label for="model-api-key">API 密钥</label><input id="model-api-key" name="apiKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="填写 API Key">
  <p class="model-field-hint">密钥仅保存在本机。启用后，面试材料与回答将发送至该接口进行分析。</p>
  <p class="model-settings-result" role="status" aria-live="polite"></p>
  <footer><button type="button" class="secondary" data-shell-control id="model-test">测试连接</button><button type="submit" class="primary" data-shell-control id="model-save">保存并启用</button></footer>
</form>`;
document.body.append(dialog);
const form=dialog.querySelector('form'),result=dialog.querySelector('.model-settings-result'),state=dialog.querySelector('#model-settings-state');
const field=name=>form.elements.namedItem(name);
let pending=false;
async function request(route,values){
  const response=await fetch(route,values?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)}:{});
  const data=await response.json();if(!response.ok)throw Error(data.error||'请求失败，请重试');return data;
}
function showResult(text,error=false){result.textContent=text;result.classList.toggle('is-error',error);}
toggle.addEventListener('click',async()=>{
  form.reset();field('apiKey').required=false;showResult('');state.textContent='正在读取配置';
  dialog.showModal();field('baseUrl').focus();
  form.querySelectorAll('input,button:not(.model-settings-close)').forEach(element=>element.disabled=true);
  try{
    const data=await request('/api/model-settings');
    field('baseUrl').value=data.baseUrl;field('model').value=data.model;field('apiKey').required=!data.hasApiKey;
    field('apiKey').placeholder=data.hasApiKey?'已保存，留空保持现有密钥':'填写 API Key';
    state.textContent=data.configured?'评分模型已配置':'尚未连接评分模型';
  }catch(error){showResult(error.message,true);state.textContent='配置读取失败';}
  finally{form.querySelectorAll('input,button').forEach(element=>element.disabled=false);}
});
dialog.querySelector('.model-settings-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('cancel',event=>{if(pending)event.preventDefault();});
dialog.addEventListener('close',()=>{field('apiKey').value='';toggle.focus();});
form.addEventListener('input',()=>{if(!pending)showResult('');});
async function submit(save){
  if(pending||!form.reportValidity())return;
  pending=true;const values={baseUrl:field('baseUrl').value,model:field('model').value,apiKey:field('apiKey').value};
  form.querySelectorAll('input,button').forEach(element=>element.disabled=true);
  showResult(save?'正在验证并保存配置…':'正在测试连接…');
  try{
    await request(save?'/api/model-settings':'/api/model-settings/test',values);
    if(save){
      field('apiKey').value='';field('apiKey').required=false;field('apiKey').placeholder='已保存，留空保持现有密钥';
      state.textContent='评分模型已连接';document.querySelector('#runtime-mode').textContent='模型已连接';
      window.dispatchEvent(new CustomEvent('onstage-model-configured',{detail:{mode:'llm'}}));
      showResult('已启用。后续回答将进行评分，历史回答暂不自动补评。');
    }else showResult('连接成功，保存后启用评分。');
  }catch(error){showResult(error.message,true);}
  finally{pending=false;form.querySelectorAll('input,button').forEach(element=>element.disabled=false);}
}
dialog.querySelector('#model-test').addEventListener('click',()=>submit(false));
form.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();submit(true);});
