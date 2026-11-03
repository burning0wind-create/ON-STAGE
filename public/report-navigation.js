// Report navigation stays inside the page: URL hashes belong to the app router.
export const stageReviewId=id=>'review-stage-'+encodeURIComponent(String(id??'unassigned'));
export function reviewGroups(session){
  const answers=(session.turns??[]).filter(t=>t.role==='candidate');
  const ids=[...new Set([...(session.profile?.stages??[]).map(s=>s.id),...answers.map(t=>t.stageId)])];
  return ids.map(id=>({id,answers:answers.filter(t=>t.stageId===id)})).filter(g=>g.answers.length);
}

export function revealReviewTarget(target,{reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false,schedule=setTimeout}={}){
  if(!target)return false;
  for(let node=target.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;
  if(!target.hasAttribute('tabindex'))target.setAttribute('tabindex','-1');
  target.focus({preventScroll:true});
  target.scrollIntoView({block:'start',behavior:reducedMotion?'instant':'smooth'});
  target.classList.add('answer-highlight');
  schedule(()=>target.classList.remove('answer-highlight'),2200);
  return true;
}

function detailKeys(root){
  return [...root.querySelectorAll('details')].map((node,index)=>{
    const answer=node.closest('.answer-record');
    return [node,answer?answer.id+':'+(node.dataset.reviewDetail??index):(node.id||node.className)+':'+(node.querySelector('summary')?.textContent??'')];
  });
}
// A background score update must not close what the reader opened or move their place.
export function captureReportReading(root){
  const opened=detailKeys(root).filter(([node])=>node.open).map(([,key])=>key);
  const anchor=[...root.querySelectorAll('.answer-record,.review-stage-heading,.scoring-progress,.result-overview,.viz-card')].find(n=>n.id&&n.getBoundingClientRect().bottom>80);
  const active=root.ownerDocument.activeElement;
  const focusDetail=active?.tagName==='SUMMARY'?detailKeys(root).find(([node])=>node===active.parentElement)?.[1]:null;
  return {opened,anchorId:anchor?.id,top:anchor?.getBoundingClientRect().top,focusId:root.contains(active)?active?.id:null,focusDetail};
}
export function restoreReportReading(root,state){
  if(!state)return;
  const opened=new Set(state.opened);
  for(const [node,key]of detailKeys(root))node.open=opened.has(key);
  const doc=root.ownerDocument,focus=state.focusId?doc.getElementById(state.focusId):state.focusDetail?detailKeys(root).find(([,key])=>key===state.focusDetail)?.[0].querySelector('summary'):null;
  focus?.focus({preventScroll:true});
  const anchor=state.anchorId?doc.getElementById(state.anchorId):null;
  if(anchor&&Number.isFinite(state.top))doc.defaultView.scrollBy({top:anchor.getBoundingClientRect().top-state.top,behavior:'instant'});
}
