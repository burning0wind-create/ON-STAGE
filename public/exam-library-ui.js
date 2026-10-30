// Pure rendering helpers: source facts stay distinct from training judgements.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeURL(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:'#';}catch{return '#';}}
const scopeNames={interview:'面试',materials:'材料审查',written:'笔试',exclusion:'校方另行审查'};
const sourceLink=(url,label)=>`<a href="${esc(safeURL(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
const unique=values=>[...new Set(values.filter(x=>x!==null&&x!==undefined&&String(x)!==''))];
const badge=(label,kind='')=>`<span class="exam-tag ${kind}">${esc(label)}</span>`;

export function examMatches(record,target){
  if(!record||!target||record.verification!=='official'||record.loadable!==true)return false;
  return record.schoolId===target.schoolId&&record.collegeId===target.collegeId
    &&(record.programCodes??[]).includes(String(target.majorCode??target.programCode??''))
    &&String(record.year)===String(target.year)&&record.admissionType===target.admissionType
    &&(!record.directionIds?.length||record.directionIds.includes(String(target.directionId??'')));
}

function targetName(target={}){
  return [target.school,target.college,[target.majorCode,target.major].filter(Boolean).join(' '),target.direction,target.year?`${target.year} 年`:null,target.admissionType].filter(Boolean).join(' / ');
}

export function renderLibraryLink(library,target={}){
  const matches=(library?.records??[]).filter(r=>examMatches(r,target));
  const loaded=matches.find(r=>r.id===target.examLibraryId),source=loaded??matches[0];
  const title=loaded?'已载入官网考核依据':matches.length?`找到 ${matches.length} 条匹配的官网考核资料`:'查阅目标院校的官网考核资料';
  const description=loaded?`${loaded.title} · 核验 ${loaded.checkedAt??library.checkedAt??'日期待核验'}。编辑后按本人确认内容使用。`:matches.length?'学校、学院、专业、年份和招生类型均匹配。可载入细则，查看已公布的权重与考核边界。':'按学校、学院、专业、招生年份和类型匹配；未收录的规则可继续上传或填写。';
  return `<aside class="exam-library-callout" aria-label="官网考核库匹配"><div><span class="exam-kicker">OFFICIAL ASSESSMENT LIBRARY</span><h3>${esc(title)}</h3><p>${esc(description)}</p>${source?`<div class="exam-callout-source">${sourceLink(source.url,source.college+' · '+source.year+' 年'+source.admissionType)}</div>`:''}</div><a class="button secondary small" href="#exam-library">打开考核库 <span aria-hidden="true">↗</span></a></aside>`;
}

function selectFilter(name,label,values,value){
  return `<label class="field"><span>${esc(label)}</span><select data-library-filter="${esc(name)}"><option value="">全部${esc(label)}</option>${values.map(v=>`<option value="${esc(v.value)}" ${String(v.value)===String(value??'')?'selected':''}>${esc(v.label)}</option>`).join('')}</select></label>`;
}
function duration(stage){
  if(stage.minutes!=null)return `${stage.minutes} 分钟`;
  if(stage.minMinutes!=null&&stage.maxMinutes!=null)return `${stage.minMinutes}–${stage.maxMinutes} 分钟`;
  if(stage.minMinutes!=null)return `不少于 ${stage.minMinutes} 分钟`;
  if(stage.maxMinutes!=null)return `不超过 ${stage.maxMinutes} 分钟`;
  return '时长未公布';
}
function programLabels(record,templates){
  const college=templates.find(s=>s.id===record.schoolId)?.colleges?.find(c=>c.id===record.collegeId);
  return record.programCodes.map(code=>{
    const program=college?.programs?.find(p=>p.code===code);
    return [code,program?.name].filter(Boolean).join(' ');
  });
}
function examCard(record,target,templates){
  const verified=record.verification==='official',matches=examMatches(record,target);
  const completeWeights=verified&&record.officialRubric?.length>0&&record.officialRubric.reduce((n,d)=>n+d.weight,0)===100;
  const weightText=completeWeights?record.officialRubric.map(d=>`${d.name} ${d.weight}%`).join(' / '):verified?'面试内部权重未公布':'原文待核验，暂无可用权重';
  const items=record.assessmentItems??[],notes=[...(record.notes??[]),...(record.exclusions??[])];
  return `<article class="exam-record ${matches?'exam-record-matched':''}" id="exam-${esc(record.id)}"><div class="exam-record-heading"><div><div class="exam-record-tags">${badge(`${record.year} 年`)}${badge(record.admissionType)}${badge(verified?'官网已核验':'原文待核验',verified?'verified':'pending')}${matches?badge('匹配当前设置','matched'):''}</div><h3>${esc(record.title)}</h3><p class="exam-programs">${esc(programLabels(record,templates).join(' · '))}${record.directionNames?.length?`<span>限定方向：${esc(record.directionNames.join(' / '))}</span>`:''}</p></div><button type="button" class="small ${matches?'':'secondary'}" data-load-exam="${esc(record.id)}" ${matches?'':'disabled'}>${matches?'载入本场细则':verified&&record.loadable?'仅供查阅':'待核验'}</button></div>
    <div class="exam-facts"><div><span>面试满分</span><strong>${record.totalScore==null?'未核验':`${esc(record.totalScore)} <small>分</small>`}</strong></div><div><span>面试合格线</span><strong class="exam-small-fact">${record.passThreshold==null?(verified?'未公布':'待核验'):`${esc(record.passThreshold)} 分`}</strong></div><div class="exam-weight-fact"><span>${completeWeights?'官网面试分项权重':'权重公开情况'}</span><p>${esc(weightText)}</p></div></div>
    ${completeWeights?'<p class="exam-load-note">权重依据官网，评分观察要求经 ON STAGE 转译；请核对原文。</p>':''}<details class="exam-details"><summary>考核内容、环节与适用边界</summary><div class="exam-stage-list">${(record.stages??[]).map(s=>`<div>${badge(scopeNames[s.scope]??s.scope)}<span>${esc(s.name)}</span><strong>${esc(duration(s))}</strong></div>`).join('')}</div>${items.length?`<div class="scroll-table"><table class="exam-items"><thead><tr><th>范围</th><th>考察内容</th><th>满分 / 占比</th><th>说明</th></tr></thead><tbody>${items.map(item=>`<tr><td>${badge(scopeNames[item.scope]??item.scope)}</td><td>${esc(item.name)}</td><td>${item.maxScore==null?'未量化':`${esc(item.maxScore)} 分`}${item.weight==null?'':` / ${esc(item.weight)}%`}</td><td>${esc(item.description)}</td></tr>`).join('')}</tbody></table></div>`:''}${record.formula?`<div class="exam-formula"><strong>成绩规则</strong><p>${esc(record.formula)}</p></div>`:''}${notes.length?`<ul class="exam-notes">${notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:''}</details>
    <div class="exam-record-footer"><div class="exam-source-links">${sourceLink(record.url,'官网原文')}${record.documentUrl?sourceLink(record.documentUrl,/\.pdf(?:[?#]|$)/i.test(record.documentUrl)?'官方 PDF':'学院详情'):''}</div><span>发布 ${esc(record.publishedAt??'待核验')} · 核验 ${esc(record.checkedAt??'—')}</span></div>${!matches&&verified&&record.loadable?'<p class="exam-load-note">载入前请在面试设置中选择对应的学校、学院、专业、年份、招生类型及适用方向。</p>':''}</article>`;
}

export function renderExamLibrary({library={records:[]},templates=[],target={},filter={}}={}){
  const records=library.records??[],official=records.filter(r=>r.verification==='official'),pending=records.filter(r=>r.verification!=='official');
  const schools=unique(records.map(r=>r.schoolId)).map(id=>({value:id,label:records.find(r=>r.schoolId===id).school}));
  const colleges=unique(records.filter(r=>!filter.schoolId||r.schoolId===filter.schoolId).map(r=>r.collegeId)).map(id=>{const r=records.find(r=>r.collegeId===id);return {value:id,label:filter.schoolId?r.college:`${r.school} · ${r.college}`};});
  const years=unique(records.map(r=>r.year)).sort((a,b)=>b-a).map(y=>({value:y,label:`${y} 年`}));
  const types=unique(records.map(r=>r.admissionType)).map(t=>({value:t,label:t}));
  const shown=records.filter(r=>(!filter.schoolId||r.schoolId===filter.schoolId)&&(!filter.collegeId||r.collegeId===filter.collegeId)&&(!filter.year||String(r.year)===String(filter.year))&&(!filter.admissionType||r.admissionType===filter.admissionType));
  const groups=unique(shown.map(r=>r.collegeId)).map(id=>shown.filter(r=>r.collegeId===id));
  return `<div class="page-heading"><div><p class="eyebrow">SCHOOL / COLLEGE / PROGRAMME</p><h1>官网考核库</h1><p class="subtle">查看院校公布的考核环节与权重，为每一场排练找到依据。</p></div><a class="button secondary small" href="#setup">返回面试设置</a></div>
    <section class="exam-library-intro"><div><span class="exam-kicker">SOURCED, SCOPED, VERSIONED</span><h2>让评分有据可查</h2><p>官网未公布的面试内部权重保持为空。材料审核、笔试、面试与录取成绩规则分别记录，训练量表另行标识。</p><span class="exam-version">核验日期 ${esc(library.checkedAt??'—')} · ${esc(library.version??'')}</span></div><div class="exam-library-stats"><div><strong>${schools.length}</strong><span>目标学校</span></div><div><strong>${unique(records.map(r=>r.collegeId)).length}</strong><span>学院范围</span></div><div><strong>${official.length}</strong><span>已核验规则</span></div><div><strong>${pending.length}</strong><span>待核验线索</span></div></div></section>
    <div class="exam-current-target"><span>当前面试目标</span><p>${esc(targetName(target)||'尚未设置；请先选择学校、学院和专业。')}</p><small>只有与本场目标完全匹配的已核验条目可以载入。</small></div>
    <section class="card exam-filter-card" aria-label="筛选考核资料"><div class="exam-library-filters">${selectFilter('schoolId','学校',schools,filter.schoolId)}${selectFilter('collegeId','学院',colleges,filter.collegeId)}${selectFilter('year','入学年份',years,filter.year)}${selectFilter('admissionType','招生类型',types,filter.admissionType)}</div></section>
    <div class="exam-result-heading"><span>考核资料</span><span>${shown.length} 条 · 按学校 / 学院归档</span></div>${groups.length?groups.map(group=>`<section class="exam-college-group"><div class="exam-college-heading"><h2>${esc(group[0].school)} <span>/</span> ${esc(group[0].college)}</h2><span>${group.length} 条</span></div>${group.map(r=>examCard(r,target,templates)).join('')}</section>`).join(''):'<div class="card empty"><h2>此筛选下暂无考核资料</h2><p>可调整学校、学院、年份或招生类型，或返回设置上传官网细则。</p></div>'}<p class="page-note exam-library-footnote">考核库保存本次核验的资料版本。院校后续更正及专项计划请以官网最新通知为准。加载规则后，开始面试前仍需确认本场适用范围。</p>`;
}
