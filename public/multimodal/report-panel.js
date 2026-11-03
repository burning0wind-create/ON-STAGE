import {buildInterviewReport,reportToMarkdown,formatTime} from './interview-report.js';
const $=id=>document.getElementById(id);
const element=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
const percent=v=>v===null?'—':`${Math.round(v*100)}%`;
const seconds=v=>`${(v/1000).toFixed(1)}秒`;

export class ReportPanel {
  constructor({onSeek,onDownload}) {
    this.onSeek=onSeek;this.onDownload=onDownload;this.session=null;this.previous=null;
    $('reflectionForm').addEventListener('change',()=>this.commit());
    $('reflectionNotes').addEventListener('input',()=>{if(this.session){this.session.reflection={...this.session.reflection,notes:$('reflectionNotes').value.slice(0,2000)};}});
    $('downloadReport').onclick=()=>{if(!this.session)return;this.commit();this.onDownload(new Blob([reportToMarkdown(this.session.analysis)],{type:'text/markdown;charset=utf-8'}),`${this.session.id}-review.md`);};
  }
  show(session,{recording=false,previous=null,scroll=false}={}) {
    $('reflectionSaved').textContent='选填，修改后自动保存。';
    this.session=recording?null:session;this.previous=previous;
    $('reportBody').hidden=!this.session;$('reportEmpty').hidden=!!this.session;
    $('downloadReport').disabled=!this.session;
    if(!this.session){$('reportEmpty').textContent=recording?'正在记录。结束后会自动生成姿态、手部表现和练习建议。':'完成一轮记录后自动生成结果，也可以导入已导出的会话JSON进行复盘。';$('reportStatus').textContent=recording?'记录中':'等待记录';return;}
    this.session.analysis=buildInterviewReport(this.session);this.render(this.session.analysis);this.fillForm();
    if(scroll)$('resultsSection').scrollIntoView({behavior:'smooth',block:'start'});
  }
  fillForm() {
    const r=this.session.analysis.reflection;
    for(const [key,id] of Object.entries({stress:'reflectionStress',attention:'reflectionAttention',effort:'reflectionEffort',structure:'reflectionStructure',gesture_help:'reflectionGesture',context:'reflectionContext'}))$(id).value=r[key]===null?'':String(r[key]);
    $('reflectionNotes').value=r.notes;
  }
  commit() {
    if(!this.session)return;
    const score=id=>$(id).value===''?null:Number($(id).value);
    this.session.reflection={stress:score('reflectionStress'),attention:score('reflectionAttention'),effort:score('reflectionEffort'),structure:score('reflectionStructure'),gesture_help:$('reflectionGesture').value,context:$('reflectionContext').value,notes:$('reflectionNotes').value.slice(0,2000)};
    this.session.analysis=buildInterviewReport(this.session);this.render(this.session.analysis);
    $('reflectionSaved').textContent='已保存';
  }
  render(report) {
    const p=report.metrics.posture,h=report.metrics.hands;
    const REFERENCES=report.references;
    $('reportStatus').textContent=report.status;$('reportSummary').textContent=report.summary;
    $('reportSource').textContent=this.session.interview_time?`面试时间 ${this.session.interview_time.replace('T',' ')}`:`${report.origin} ${this.session.source?.name||'记录'} ${this.session.created_at?new Date(this.session.created_at).toLocaleString():''}`;
    if(window.parent!==window){const header=document.querySelector('.results-header > div');if($('reportSource').parentElement!==header)header.append($('reportStatus'),$('reportSource'));}
    const metrics=$('reportMetrics');metrics.replaceChildren();
    const jointReady=p.calibrated_ms>=3000&&h.visible_ms>=3000;
    for(const [label,value,detail] of [['记录时长',seconds(report.duration_ms),'按本轮时间轴统计'],['可用基准角度覆盖',p.requested&&p.calibrated?percent(p.calibrated_coverage):'未评价',p.requested?(p.calibrated?'已校准样本的时间覆盖':'缺少个人坐姿基准'):'本轮未采集IMU'],['手部可见覆盖',h.requested?percent(h.coverage):'未评价','未检出与采样间断均不当作静止'],['同步变化时长',jointReady?seconds(report.metrics.cooccurrence_ms):'未评价',jointReady?'只描述两路动作的时间重叠':'需要两路均有足够有效数据']]){
      const card=element('div',undefined,'report-metric');card.append(element('span',label),element('strong',value),element('small',detail));metrics.append(card);
    }
    let auxiliary=$('auxiliaryScores');
    if(!auxiliary){auxiliary=element('section',undefined,'auxiliary-scores');auxiliary.id='auxiliaryScores';$('reportMetrics').before(auxiliary);}
    auxiliary.replaceChildren(element('h3','多模态评分与改善建议'),element('p',report.auxiliary_scores.scope,'auxiliary-caption'));
    const scoreGrid=element('div',undefined,'auxiliary-score-grid');
    for(const item of report.auxiliary_scores.items){
      const card=element('article');card.dataset.modality=item.id;
      const advice=item.advice;
      const names={hand_activity:'手部动作',posture_deviation:'身体姿态',voice_prosody:'语音语气'};
      const header=element('div',undefined,'auxiliary-card-heading');header.append(element('h4',names[item.id]||item.label),element('span',item.status_label,'auxiliary-state'));card.append(header);
      const value=element('strong',item.value===null?'—':item.value.toFixed(1),'auxiliary-value');
      if(item.value!==null)value.append(element('small',' / 100'));
      const missingLabels={hand_activity:'缺少有效手部数据',posture_deviation:'缺少已校准姿态数据',voice_prosody:'缺少本人回答音频'};
      card.append(value,element('p',item.value===null?missingLabels[item.id]:item.label,'auxiliary-index-label'));
      if(advice){
        const improvement=element('div',undefined,'auxiliary-improvement');
        improvement.append(element('span',advice.type,'auxiliary-advice-type'),element('h5',advice.title),element('p',advice.detail));
        const exercise=element('div',undefined,'auxiliary-exercise');exercise.append(element('span','下一轮练习'),element('p',advice.exercise));improvement.append(exercise);card.append(improvement);
      }
      const moment=report.moments.find(m=>m.type===(item.id==='hand_activity'?'hand_movement':item.id==='posture_deviation'?'imu_tilt':''));
      const actions=element('div',undefined,'auxiliary-review-actions');
      if(moment){const seek=element('button',`回看片段 ${formatTime(moment.start_ms)}`,'secondary auxiliary-seek');seek.type='button';seek.onclick=()=>this.onSeek(this.session,moment.event);actions.append(seek);}
      card.append(actions);
      const details=element('details');details.append(element('summary','数据与计算依据'),element('p',item.detail),element('p',advice?.basis||item.interpretation),element('p',item.formula),element('p',item.interpretation));
      for(const id of item.references){const ref=REFERENCES.find(r=>r.id===id);if(ref){const link=element('a',ref.label);link.href=ref.url;link.target='_blank';link.rel='noopener noreferrer';details.append(link);}}
      card.append(details);scoreGrid.append(card);
    }
    auxiliary.append(scoreGrid);
    const posture=$('postureResult'),hands=$('handResult');posture.replaceChildren();hands.replaceChildren();
    posture.append(element('p','身体姿态','result-label'),element('h3',report.auxiliary_scores.items[1].status==='review_signal'?'先检查佩戴与基准':!p.requested?'未采集姿态':!p.calibrated?'先完成坐姿校准':p.calibrated_ms<3000||(p.calibrated_coverage??0)<.5?'姿态证据不足':p.deviation_episodes?`${p.deviation_episodes}段持续变化可回看`:'本轮以个人基准附近为主'));
    posture.append(element('p',p.calibrated&&p.sample_count?`相对偏离：中位数 ${p.median_tilt_deg??'—'}°，P95 ${p.p95_tilt_deg??'—'}°，峰值 ${p.peak_tilt_deg??'—'}°。持续偏离累计 ${seconds(p.deviation_ms)}。`:'连接、固定并校准后，才能比较相对个人坐姿的变化。'),element('small','变化大小不直接对应紧张、专注或坐姿好坏。'));
    hands.append(element('p','手部移动','result-label'),element('h3',!h.requested?'未采集手部':h.visible_ms<3000||(h.coverage??0)<.5?'手部证据不足':h.movement_episodes?`${h.movement_episodes}个移动时段待确认作用`:'未形成持续移动片段'));
    hands.append(element('p',h.visible_ms?`可见移动累计 ${seconds(h.movement_ms)}，占可见时间 ${percent(h.movement_share_visible)}；速度中位数 ${h.median_speed??'—'} 掌宽/秒。`:'没有足够可见画面，不能把未检出解释为动作少。'),element('small','双手同时移动合并为一个时段；尚未自动识别动作的语义。'));
    $('reportInsights').replaceChildren();
    for(const insight of report.insights){
      const card=element('article',undefined,'report-insight');card.append(element('h3',insight.title),element('p',insight.observation,'insight-observation'),element('p',insight.meaning),element('p',`下一步：${insight.practice}`,'insight-practice'));
      const refs=element('div',undefined,'insight-references');refs.append(element('span','依据：'));
      for(const id of insight.references){const ref=REFERENCES.find(r=>r.id===id);if(!ref)continue;const a=element('a',ref.label);a.href=ref.url;a.target='_blank';a.rel='noopener noreferrer';refs.append(a);}card.append(refs);$('reportInsights').append(card);
    }
    $('reportMoments').replaceChildren();
    if(!report.moments.length)$('reportMoments').append(element('p','本轮没有已完成的动作或人工标记片段。可以结合题目回看整段回答。','muted'));
    report.moments.forEach(moment=>{
      const card=element('article',undefined,'report-moment');card.append(element('span',`${formatTime(moment.start_ms)} — ${formatTime(moment.end_ms)}`,'moment-time'),element('strong',moment.title),element('p',moment.prompt));
      const button=element('button',this.session.source.type==='video'?'定位录像':'查看时间位置','button');button.onclick=()=>this.onSeek(this.session,moment.event);card.append(button);$('reportMoments').append(card);
    });
    $('reportQuestions').replaceChildren();
    if(!report.questions.length){const tr=element('tr');const td=element('td','没有题号记录；下一轮可填写或切换题号。');td.colSpan=5;tr.append(td);$('reportQuestions').append(tr);}
    report.questions.forEach(q=>{const tr=element('tr');[q.question_id,`${formatTime(q.start_ms)}–${formatTime(q.end_ms)}`,q.metrics.posture.requested&&q.metrics.posture.calibrated?`${q.metrics.posture.deviation_episodes}段 / ${seconds(q.metrics.posture.deviation_ms)}`:'未评价',q.metrics.hands.requested?percent(q.metrics.hands.coverage):'未评价',q.metrics.hands.requested?`${q.metrics.hands.movement_episodes}段`:'未评价'].forEach(v=>tr.append(element('td',v)));$('reportQuestions').append(tr);});
    $('reportNextSteps').replaceChildren();report.next_steps.forEach(step=>{const li=element('li');li.append(element('strong',step.title),element('p',step.detail),element('small',`建议来源：${step.basis}`));$('reportNextSteps').append(li);});
    const r=report.reflection,fields=[];if(r.stress!==null)fields.push(`本人自报紧张 ${r.stress}/10`);if(r.attention!==null)fields.push(`本人自报注意集中 ${r.attention}/10`);if(r.effort!==null)fields.push(`本人自报组织费力 ${r.effort}/10`);if(r.structure!==null)fields.push(`同伴评结构清晰 ${r.structure}/5`);
    $('reflectionEvidence').textContent=fields.length?`已补充：${fields.join('；')}。这些来自填写者，不是传感器推断。`:'按需补充，帮助确定下一轮目标。';
    const comparison=$('reportComparison');comparison.replaceChildren();
    if(this.previous){
      const previous=buildInterviewReport(this.previous),table=element('table'),thead=element('thead'),head=element('tr');['观察指标','上一轮','本轮'].forEach(s=>head.append(element('th',s)));thead.append(head);table.append(thead);const tbody=element('tbody');
      const entries=[['姿态偏离占有效时间',previous.metrics.posture.deviation_share,p.deviation_share,previous.metrics.posture.calibrated&&p.calibrated],['手部可见覆盖',previous.metrics.hands.coverage,h.coverage,previous.metrics.hands.requested&&h.requested],['移动占可见时间',previous.metrics.hands.movement_share_visible,h.movement_share_visible,previous.metrics.hands.requested&&h.requested]];
      for(const [label,a,b,available]of entries){const row=element('tr');[label,available?percent(a):'不可直接对照',available?percent(b):'不可直接对照'].forEach(s=>row.append(element('td',s)));tbody.append(row);}table.append(tbody);comparison.append(table,element('p','这些变化不自动代表进步或退步。比较时还需考虑题目、机位、佩戴和记录长度。','field-help'));
      if(this.previous.imu?.baseline?.id!==this.session.imu?.baseline?.id)comparison.append(element('p','两轮坐姿基准不同，姿态数据仅供描述性对照。','field-help'));
    }else comparison.append(element('p','记录第二轮后显示与前一轮的数据对照；以回答更清楚、本人更舒适作为练习目标。','muted'));
    $('reportReferences').replaceChildren();for(const ref of REFERENCES){const item=element('li'),a=element('a',`${ref.label} ${ref.title}`);a.href=ref.url;a.target='_blank';a.rel='noopener noreferrer';item.append(a,element('p',ref.finding));$('reportReferences').append(item);}
    $('reportLimits').replaceChildren(...report.limits.map(text=>element('li',text)));
  }
}
