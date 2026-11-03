// Present saved judgments in layers; this renderer never produces a new score.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];
const labels={observed:'已观察',partly_observed:'部分观察',not_assessed:'未考察',skipped:'已跳过',insufficient_evidence:'证据不足'};
function text(value){
  if(value==null)return '';
  if(typeof value==='string'||typeof value==='number')return String(value).trim();
  if(Array.isArray(value))return value.map(text).filter(Boolean).join('；');
  if(typeof value==='object'){
    for(const key of ['text','content','suggestion','improvement','question','reason','summary'])if(value[key]!=null)return text(value[key]);
    try{return JSON.stringify(value);}catch{return '';}
  }
  return '';
}
const scored=d=>typeof d?.score==='number'&&Number.isFinite(d.score)&&d.score>=1&&d.score<=5&&(!d.status||['observed','partly_observed'].includes(d.status))&&d.gradingStatus!=='pending'&&!d.scoringPending;
const short=(value,max=340)=>{const content=text(value);if(content.length<=max)return content;const end=content.slice(0,max).search(/[。！？][^。！？]*$/u);return (end>max/2?content.slice(0,end+1):content.slice(0,max))+'…';};
function splitFeedback(raw){
  const feedback=text(raw),markers=[...feedback.matchAll(/(专业方面|专业评价|专业反馈|语言方面|语言评价|语言反馈|表达方面|表达反馈)[：:]\s*/gu)];
  const result={professional:'',language:'',general:feedback};
  if(!markers.length)return result;
  for(let i=0;i<markers.length;i++){
    const marker=markers[i],group=marker[1].startsWith('专业')?'professional':'language';
    result[group]+=(result[group]?'\n':'')+feedback.slice(marker.index+marker[0].length,markers[i+1]?.index??feedback.length).trim();
  }
  result.general=feedback.slice(0,markers[0].index).trim();return result;
}
function summaryBlock(title,content,kind){return content?`<section class="af-summary-block af-summary-${kind}"><h4>${title}</h4><p>${esc(short(content))}</p></section>`:'';}
function issueFromFeedback(feedback){
  return (text(feedback).match(/[^。！？\n；;]*(?:主要缺口|主要问题|不足之处|需要改进|仍需补充|尚需补充)[^。！？\n；;]*[。！？]?/u)?.[0]??'').trim();
}
function dimensionBody(d,{priority=false,group='professional',key='dimension'}={}){
  const name=text(d.name??d.id)||'评价维度',reason=text(d.reason??d.quality),quote=text(d.quote),improvement=text(d.improvement),probe=text(d.nextProbe),limitation=text(d.limitation);
  return `<article class="af-dimension ${priority?'af-dimension-priority':''}"><div class="af-dimension-heading"><div><span class="af-dimension-group">${group==='language'?'表达反馈':'专业反馈'}</span><h5>${esc(name)}</h5></div><span class="af-dimension-score">${scored(d)?`${d.score}<small> / 5</small>`:esc(d.gradingStatus==='pending'||d.scoringPending?'待补评':labels[d.status]??'未评分')}</span></div>${text(d.finding)?`<p class="af-finding">${esc(text(d.finding))}</p>`:''}${reason?`<div class="af-reason"><h6>为什么这样判断</h6><p>${esc(reason)}</p></div>`:''}${quote?`<details class="af-evidence" data-review-detail="${esc(key)}-evidence"><summary>核对回答依据</summary><blockquote>${esc(quote)}</blockquote><p class="af-caption">引文来自本题回答；是评价依据，不代表经历已被独立核实。</p></details>`:''}${improvement?`<div class="af-action"><h6>下一步怎么补</h6><p>${esc(improvement)}</p></div>`:''}${probe?`<div class="af-probe"><h6>${improvement?'用这道追问检验':'下一步要说清楚'}</h6><p>${esc(probe)}</p></div>`:''}${limitation?(priority?`<div class="af-boundary"><h6>评价边界</h6><p>${esc(limitation)}</p></div>`:`<details class="af-boundary" data-review-detail="${esc(key)}-boundary"><summary>查看评价边界</summary><p>${esc(limitation)}</p></details>`):''}</article>`;
}
export function renderAnswerFeedback(turn={}){
  if(turn.skipped)return '<div class="af-feedback af-empty"><p>本题已跳过，不生成回答质量判断。</p></div>';
  const ev=turn.evaluation??{},professional=list(ev.dimensions),language=list(ev.languageDimensions),all=[...professional.map((d,i)=>({d,group:'professional',key:'professional-'+i})),...language.map((d,i)=>({d,group:'language',key:'language-'+i}))];
  const observed=all.filter(({d})=>scored(d)),pending=turn.scoring?.status==='pending'||turn.scoring?.status==='running'||ev.mode==='unavailable',partial=['partial','degraded'].includes(turn.scoring?.status)||all.some(({d})=>d.gradingStatus==='pending'||d.scoringPending);
  const parts=splitFeedback(ev.feedback),feedback=text(ev.feedback),issue=issueFromFeedback(feedback);
  if(issue)for(const group of ['professional','language','general'])parts[group]=parts[group].replace(issue,'').trim().replace(/[；;]\s*$/u,'').trim();
  // Scores determine presentation order only. A missing score never becomes a weakness.
  const priorities=observed.filter(({d})=>(text(d.improvement)||text(d.nextProbe)||text(d.limitation))&&text(d.quote)).sort((a,b)=>a.d.score-b.d.score).slice(0,2);
  const remaining=all.filter(item=>!priorities.includes(item)),unscored=all.filter(({d})=>!scored(d));
  const state=pending?(observed.length?'部分评价已保存，其余仍待补评。以下仅展示已保存的判断。':'回答已保存，内容评价尚未完成。评分状态不代表回答质量。'):partial?'本题仍有评分项待补评；以下判断只适用于已完成评价的内容。':ev.mode==='demo'?'当前为流程演示，尚未生成专业内容评价。':'';
  const noJudgment=!observed.length&&(pending||ev.mode==='demo');
  return `<section class="af-feedback" aria-label="本题分层评价"><div class="af-heading"><div><span class="af-eyebrow">从判断到改进</span><h4>本题评价</h4></div>${observed.length?`<span class="af-observed-count">${observed.length} 项已有评分依据</span>`:''}</div>${state?`<p class="af-state" role="status">${esc(state)}</p>`:''}${!noJudgment?`<div class="af-summary">${summaryBlock('专业内容',parts.professional,'professional')}${summaryBlock('语言表达',parts.language,'language')}${summaryBlock('评价摘要',parts.general,'general')}</div>${issue?`<aside class="af-issue"><span class="af-issue-label">重点解读 · 评价中指出的缺口</span><p>${esc(issue)}</p></aside>`:''}${priorities.length?`<section class="af-priorities"><div class="af-section-heading"><h4>优先看这 ${priorities.length} 项</h4><span>按已保存评分排序，评价边界不等于能力缺点</span></div><div class="af-priority-grid">${priorities.map(({d,group,key})=>dimensionBody(d,{priority:true,group,key})).join('')}</div></section>`:''}`:''}${remaining.length&&!noJudgment?`<details class="af-dimension-details" data-review-detail="feedback-dimensions"><summary>查看${priorities.length?'其余':'各项'}专业与表达评价 <span>${remaining.length} 项</span></summary><div class="af-dimension-grid">${remaining.map(({d,group,key})=>dimensionBody(d,{group,key})).join('')}</div></details>`:''}${unscored.length&&!noJudgment?`<p class="af-unscored-note">${unscored.length} 项没有可用分数；“未考察”“证据不足”和“待补评”不等于能力低分。</p>`:''}${feedback?`<details class="af-source-feedback" data-review-detail="feedback-full"><summary>查看原始评价全文</summary><p>${esc(feedback)}</p></details>`:''}${(text(ev.improvedAnswer)||text(ev.exercise))&&!noJudgment?`<details class="af-coaching" data-review-detail="feedback-coaching"><summary>组织表达与下一步练习</summary>${text(ev.improvedAnswer)?`<div class="af-coaching-block"><h5>表达组织示范</h5><p>${esc(text(ev.improvedAnswer))}</p><p class="af-caption">这是表达组织建议，不是新增的个人经历或评分证据。</p></div>`:''}${text(ev.exercise)?`<div class="af-coaching-block"><h5>下一步练习</h5><p>${esc(text(ev.exercise))}</p></div>`:''}</details>`:''}${!feedback&&!all.length&&!state?'<p class="af-empty">本题暂无已保存的评价内容。</p>':''}</section>`;
}
