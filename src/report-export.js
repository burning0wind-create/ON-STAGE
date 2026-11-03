import { targetLabel } from '../public/catalog-state.js';

const labels={observed:'已观察',partly_observed:'部分观察',not_assessed:'未考察',skipped:'已跳过',insufficient_evidence:'证据不足',unassessed:'未评估',not_configured:'未配置',partial:'部分评价',complete:'完整覆盖',assessed:'已评价',assisted_practice:'辅助练习',legacy:'历史量表记录'};
// Escape supplied text so an exported answer cannot become active Markdown/HTML.
const inline=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_{}\[\]#!|]/g,'\\$&').replace(/\r?\n/g,' / ');
const quote=value=>String(value??'').split(/\r?\n/).map(line=>`> ${inline(line)}`).join('\n');
const state=value=>labels[value]??inline(value||'未评估');
const number=(value,suffix='')=>typeof value==='number'&&Number.isFinite(value)?`${value}${suffix}`:'未评分';
const list=value=>Array.isArray(value)?value:[];
const link=(title,url)=>{
  try {const u=new URL(url);if(!['https:','http:'].includes(u.protocol))return inline(title);return `[${inline(title)}](<${u.href.replace(/>/g,'%3E')}>)`;}
  catch {return inline(title);}
};
function evidenceBlock(e,{legacy=false}={}) {
  const out=[];
  if(!legacy)out.push(`状态：${state(e.status)}；质量：${number(e.score,' / 5')}；${e.duplicateOf?`重复证据（不重复计分），原记录 ${inline(e.duplicateOf)}`:e.independent?'独立证据':'未计入独立评分'}`);
  out.push(`题目 ID：${inline(e.questionId||'未记录')}；回答 ID：${inline(e.responseId||'未记录')}；环节：${inline(e.stageId||'未记录')}`);
  if(e.question)out.push(`题目：${inline(e.question)}`);
  if(e.quote)out.push(quote(e.quote));
  else out.push('无可引用回答证据；缺失不补零。');
  if(e.reason)out.push(`评价理由：${inline(e.reason)}`);
  if(e.limitation)out.push(`证据边界：${inline(e.limitation)}`);
  if(e.nextProbe)out.push(`下一步追问：${inline(e.nextProbe)}`);
  for(const c of list(e.counterevidence))out.push(`反证：\n\n${quote(c.quote)}\n\n反证说明：${inline(c.reason)}\n\n评价修正：${inline(c.correction)}`);
  return out.join('\n\n');
}
function dimensionSummary(dimensions,{language=false,legacy=false}={}) {
  return list(dimensions).map(d=>`| ${inline(d.name??d.id)} | ${language?'独立反馈':number(d.weight,'%')} | ${legacy?'历史评价':state(d.status)} | ${number(d.score,' / 5')} | ${number(d.independentEvidenceCount??d.observedAnswers)} |`).join('\n');
}

/** Export the saved report and its frozen criteria, never rebuild today's rubric. */
export function reportMarkdown(session) {
  const s=session??{},p=s.profile??{},r=s.report??{},rubric=r.rubric??s.rubric;
  const legacy=!rubric;
  const out=['# ON STAGE · 升学面试复盘',`${inline(p.nickname)} · ${inline(targetLabel(p))}`,`第 ${inline(p.attempt)} 次 · ${inline(p.interviewTime)}；招生年份：${inline(p.year)}；类型：${inline(p.admissionType)}`,`场次 ID：${inline(s.id)}；生成时间：${inline(r.generatedAt||'未记录')}`,`模式：${s.contentRegrade?.method==='assistant_rubric_review'?'本助手按原量表补评':s.mode==='demo'?'流程演示':s.mode==='llm'?'模型评价':'未完成模型评价'}；评价状态：${legacy?'历史量表记录':state(r.assessmentStatus)}`,`专业训练总分：${number(r.trainingTotal,' / 100')}；院校标准练习总分：${number(r.official?.total,' / 100')}`,inline(r.note||'未观察到不等于低分。练习反馈不代表官方考试成绩。')];
  if(legacy)out.push('历史报告没有新版证据状态和量表快照；保留原始结果，不补造新版覆盖状态。');
  const c=r.coverage??{};
  out.push('## 覆盖范围',`专业已观察 ${number(c.assessed)} / ${number(c.total)}；部分观察 ${number(c.partial)}；未充分考察 ${number(c.unassessed)}；已作答 ${number(c.answered)}；已跳过 ${number(c.skipped)}。`,`已作答环节：${list(c.stageIds).map(inline).join('、')||'无'}`);
  if(list(c.criticalMissing).length)out.push(`关键维度待补证：${c.criticalMissing.map(d=>inline(typeof d==='string'?d:d.name??d.id)).join('、')}。覆盖不完整时不生成完整能力结论。`);
  if(rubric){
    out.push('## 本场训练量表快照',`${inline(rubric.name)}；版本：${inline(rubric.version)}；量表 ID：${inline(rubric.id)}`,inline(rubric.rationale),'权重与行为锚点由 ON STAGE 拟定，属于待校准训练标准；不是院校官方权重。');
    if(rubric.source)out.push(`评价原则参考：${link(rubric.source.title,rubric.source.url)}`);
    for(const d of list(rubric.dimensions))out.push(`### ${inline(d.name)} · ${number(d.weight,'%')}${d.critical?' · 关键维度':''}`,`标准：${inline(d.criterion)}`,`1 分：${inline(d.anchors?.[0])}\n\n3 分：${inline(d.anchors?.[1])}\n\n5 分：${inline(d.anchors?.[2])}`,`所需证据：${inline(d.evidenceExpected)}；适用环节：${list(d.stages).map(inline).join('、')}`);
  }
  out.push('## 专业回答质量','| 维度 | 权重 | 观察状态 | 质量分 | 独立证据数 |\n|---|---|---|---|---|\n'+dimensionSummary(r.dimensions,{legacy}));
  if(list(r.languageDimensions).length)out.push('## 独立表达反馈','表达不纳入专业训练总分；文字不能证明发音、口音、语气或真实语速。','| 维度 | 计分关系 | 观察状态 | 质量分 | 独立证据数 |\n|---|---|---|---|---|\n'+dimensionSummary(r.languageDimensions,{language:true}),...list(rubric?.languageDimensions).map(d=>`### ${inline(d.name)}\n\n${inline(d.criterion)}\n\n1 分：${inline(d.anchors?.[0])}；3 分：${inline(d.anchors?.[1])}；5 分：${inline(d.anchors?.[2])}`));
  out.push('## 院校规则与来源快照');
  const source=p.examLibrary;
  if(source){
    out.push(`${link(source.title||'官网考核库来源',source.url)}；记录 ID：${inline(source.id)}；核验状态：${inline(source.verification)}；发布日期：${inline(source.publishedAt||'未记录')}；核验时间：${inline(source.checkedAt)}`,`规则范围：${inline(source.year)}年 ${inline(source.admissionType)} · ${inline(source.college||p.college)}；专业代码：${list(source.programCodes).map(inline).join('、')||'见确认目标'}；方向：${list(source.directionIds).map(inline).join('、')||'见原文适用范围'}。`);
    if(source.documentUrl)out.push(`原始附件：${link('官网考核文件',source.documentUrl)}`);
    if(list(source.assessmentItems).length)out.push('已公开的项目（笔试、材料和面试分别保留，不合并成面试维度）：',...source.assessmentItems.map(item=>`- ${inline(item.name)}；范围：${inline(item.scope)}；满分：${number(item.maxScore)}；权重：${number(item.weight,'%')}；${inline(item.description)}`));
    if(source.notes)out.push(`来源备注：${inline(Array.isArray(source.notes)?source.notes.join('；'):source.notes)}`);
  }else out.push('未使用内置官网考核库；以本场保存并确认的材料为依据。');
  if(p.rulesText)out.push('### 本场考核细则',quote(p.rulesText));
  if(p.rubricText)out.push('### 本场评分标准文本',quote(p.rubricText));
  if(list(p.officialRubric).length)out.push('### 本场确认的院校评分项',...p.officialRubric.map(d=>`${inline(d.name)}：${number(d.weight,'%')}；依据：${inline(d.criterion??d.description)}`));
  out.push(`院校练习评价：${state(r.official?.status)}。${inline(r.official?.note)}`);
  for(const e of list(r.official?.items))out.push(`### ${inline(e.name??e.id)} · ${number(e.weight,'%')} · ${state(e.status)} · ${number(e.score,' / 100')}`,`题目 ID：${inline(e.questionId||'未记录')}；回答 ID：${inline(e.responseId||'未记录')}`,e.quote?quote(e.quote):'无可引用证据；不补零。',`理由：${inline(e.reason)}\n\n证据边界：${inline(e.limitation)}\n\n下一步追问：${inline(e.nextProbe)}`);
  out.push('## 证据账本');
  const ledger=list(r.evidenceLedger);
  if(ledger.length)for(const e of ledger)out.push(`### ${inline(e.name??e.dimensionId)} · ${e.group==='language'?'独立表达':'专业能力'} · ${inline(e.id)}`,evidenceBlock(e));
  else if(legacy)for(const d of list(r.dimensions))for(const e of list(d.evidence))out.push(`### ${inline(d.name)}`,evidenceBlock(e,{legacy:true}));
  else out.push('本场尚无证据记录。');
  if(list(r.nextProbes).length)out.push('## 待补证的追问',...r.nextProbes.map(x=>`- ${inline(x.dimension??x.dimensionId)}：${inline(x.question)}`));
  out.push('## 本次优先改进');
  const improvements=list(r.improvements).slice(0,2);
  out.push(...(improvements.length?improvements.map(x=>`- [${x.checked?'x':' '}] ${inline(x.dimension??x.dimensionId)}：${inline(x.suggestion)}${x.responseId?`（回答 ID：${inline(x.responseId)}）`:''}`):['尚无足够观察证据，不生成改进结论。']));
  const coaching=list(s.turns).filter(t=>t.role==='candidate'&&(t.evaluation?.improvedAnswer||t.evaluation?.exercise));
  if(coaching.length){out.push('## 改写示例与小练习','改写用于复盘，不新增个人经历；看过示例后的练习应标为辅助练习。');for(const t of coaching){out.push(`### 回答 ${inline(t.id)}`);if(t.evaluation.improvedAnswer)out.push('改写建议：',quote(t.evaluation.improvedAnswer));if(t.evaluation.exercise)out.push(`下一步练习：${inline(t.evaluation.exercise)}`);}}
  if(r.comparison)out.push('## 同条件历史对照',`对照场次：${inline(r.comparison.sessionId)}；第 ${inline(r.comparison.attempt)} 次。仅显示可比较的已观察维度。`,...list(r.comparison.items).map(d=>`- ${inline(d.name??d.id)}：${typeof d.change==='number'?`${d.change>0?'+':''}${d.change}`:'不可比较'}`));
  out.push('## 对话记录');
  for(const t of list(s.turns))out.push(`### ${t.role==='candidate'?'学生':'考官'} · ${inline(t.id)} · ${inline(t.stageId)}`,t.role==='candidate'?`对应题目 ID：${inline(t.questionId||'未记录')}${t.assisted?'；辅助练习':''}`:'',t.skipped?'本题已跳过；无分数，不作为答错。':quote(t.content));
  if(s.contentRegrade)out.push('## 内容补评来源',inline(s.contentRegrade.sourceLabel||s.contentRegrade.method),`评阅记录：${inline(s.contentRegrade.reviewId||'')}；时间：${inline(s.contentRegrade.at)}`,inline(s.contentRegrade.limitations||''));
  if(r.multimodalEvaluation?.captures?.length){
    out.push('## 多模态辅助指数',r.multimodalEvaluation.scope,'指数不是表现优劣分，缺失数据不补零。');
    for(const capture of r.multimodalEvaluation.captures){out.push(`### 片段 ${inline(capture.captureId)}`);for(const item of capture.scores.items)out.push(`- ${inline(item.label)}：${item.value===null?'未评价':number(item.value,' / 100')}（${inline(item.status_label)}）。${inline(item.detail)} ${inline(item.recommendation)}`);out.push(`规则版本：${inline(capture.scores.version)}。公式与门槛为项目操作定义。`);}
  }
  return out.filter(x=>x!==undefined&&x!=='').join('\n\n')+'\n';
}
