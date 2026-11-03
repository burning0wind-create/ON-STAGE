import {stageReviewId,reviewGroups} from './report-navigation.js';
import {renderAnswerFeedback} from './answer-feedback.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={english:'英语问答',portfolio:'作品集答辩',design:'设计专业问答',ethics:'综合素质与伦理'};
export function renderAnswerReview(s,{stages=[]}={}){
  const answers=(s.turns??[]).filter(t=>t.role==='candidate'),groups=reviewGroups(s);
  return `<section class="card report-questions" id="answer-records"><div class="report-section-heading"><div><p class="eyebrow">ANSWER BY ANSWER</p><h2>问答回看</h2></div><span class="subtle">按环节回看，逐题找到改进方向</span></div>${groups.map(group=>{
    const id=stageReviewId(group.id),name=names[group.id]??stages.find(st=>st.id===group.id)?.name??s.profile?.stages?.find(st=>st.id===group.id)?.name??'面试回答';
    return `<section class="review-stage" id="${esc(id)}" tabindex="-1" data-review-stage="${esc(group.id)}" aria-labelledby="${esc(id)}-heading"><div class="review-stage-heading"><div><h3 id="${esc(id)}-heading">${esc(name)}</h3><span>${group.answers.length} 道问答</span></div><button type="button" class="review-back" id="back-${esc(id)}" data-jump-overview>返回环节表现 ↑</button></div><div class="review-question-links" role="group" aria-label="${esc(name)}题目导航">${group.answers.map(t=>`<button type="button" id="review-link-${esc(t.id)}" data-jump-answer="${esc(t.id)}" aria-controls="answer-${esc(t.id)}">第 ${answers.indexOf(t)+1} 题${t.skipped?' · 已跳过':''}</button>`).join('')}</div>${group.answers.map(t=>{
      const index=answers.indexOf(t),q=s.turns.find(q=>q.id===t.questionId);
      return `<article class="answer-record" id="answer-${esc(t.id)}" tabindex="-1" data-stage-id="${esc(group.id)}" aria-labelledby="question-${esc(t.id)}"><div class="answer-record-heading"><span class="question-index">${String(index+1).padStart(2,'0')}</span><div><span class="subtle">${esc(name)}</span><h4 id="question-${esc(t.id)}">${esc(q?.content??'本题回答')}</h4></div></div>${t.skipped?'':'<div class="answer-original-label">我的回答</div><blockquote class="original-answer">'+esc(t.content)+'</blockquote>'}${renderAnswerFeedback(t)}</article>`;
    }).join('')}</section>`;
  }).join('')||'<div class="empty">本场尚未作答</div>'}</section>`;
}
