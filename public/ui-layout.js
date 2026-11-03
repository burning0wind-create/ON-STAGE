// Reorder existing content without changing interview data or scoring logic.
function fold(root,node,title){
  if(!node)return;
  const details=document.createElement('details');details.className='disclosure-section';
  const summary=document.createElement('summary');summary.textContent=title;
  node.before(details);details.append(summary,node);
}
export function organizePage(root,page){
  if(page==='setup')fold(root,root.querySelector('.rubric-section'),'查看本场练习评价标准');
  if(page!=='reports')return;
  const summary=(root.querySelector('.scoring-progress')??root.querySelector('.assessment-summary')),practice=root.querySelector('.next-practice'),answers=root.querySelector('.report-questions');
  if(summary&&practice)summary.after(practice);
  if(practice&&answers)practice.after(answers);
  const again=root.querySelector('[data-action="new-attempt"]');
  if(again){const actions=again.closest('.form-actions');actions.classList.add('result-next-action');const intro=document.createElement('div');intro.innerHTML='<strong>让下一次，更进一步。</strong><p>沿用本次目标与材料，开始新的练习。</p>';actions.prepend(intro);}
  fold(root,root.querySelector('.coverage-panel'),'答题与考察覆盖');
  fold(root,root.querySelector('.evidence-ledger'),'评分依据与原文证据');
  const professional=root.querySelector('.score-dimensions')?.closest('section.card');
  if(professional&&!professional.classList.contains('language-feedback'))fold(root,professional,'专业能力评价');
  fold(root,root.querySelector('.language-feedback')?.closest('.report-two-column'),'表达与院校评分');
  fold(root,root.querySelector('.sensor-grid')?.closest('.report-two-column'),'历史对照与采集状态');
  for(const statuses of root.querySelectorAll('.question-statuses'))fold(root,statuses,'查看分项评价');
  const pending=root.querySelector('.assessment-score');
  if(pending&&pending.querySelector('strong')?.textContent==='暂不汇总')pending.classList.add('score-pending');
}
