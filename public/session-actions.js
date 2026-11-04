const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const removable=session=>session?.status==='complete'&&typeof session.id==='string'&&session.id.length>0;

export function renderDeleteButton(session,{compact=false}={}){
  if(!removable(session))return '';
  const profile=session.profile??{},target=[profile.school,profile.major,profile.interviewTime,profile.attempt?'第 '+profile.attempt+' 次':''].filter(Boolean).join('，');
  return `<button type="button" class="${compact?'small ':''}session-delete-button" data-delete-session="${esc(session.id)}" aria-label="删除记录${target?'：'+esc(target):''}">删除记录</button>`;
}

export function renderDeleteConfirmation(session){
  if(!removable(session))return '';
  const p=session.profile??{},major=[p.majorCode,p.major,p.direction].filter(Boolean).join(' / ');
  const fields=[['院校',p.school],['学院',p.college],['专业',major],['面试时间',String(p.interviewTime??'').replace('T',' ')],['模拟次数',p.attempt==null?'':`第 ${p.attempt} 次`],['昵称',p.nickname]];
  return `<h2 id="delete-session-title">删除这场面试记录？</h2><p id="delete-session-description">记录将从历史列表移除，并保留本地恢复备份。上传的简历、作品集不受影响。</p><dl class="session-delete-meta">${fields.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value||'未填写')}</dd></div>`).join('')}</dl><p id="delete-session-error" class="session-delete-error" role="alert" hidden></p><div class="session-delete-actions"><button type="button" class="primary" data-delete-cancel>保留记录</button><button type="button" class="danger session-delete-confirm" data-delete-confirm="${esc(session.id)}">确认删除</button></div>`;
}
