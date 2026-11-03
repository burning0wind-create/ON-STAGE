export const AUXILIARY_VERSION='multimodal-indices/1.0';
export const AUXILIARY_REFERENCES=[
  {id:'openopaf-2024',label:'Ochoa与Zhao，2024',title:'OpenOPAF: An Open Source Multimodal System for Automated Feedback for Oral Presentations',url:'https://doi.org/10.18608/jla.2024.8411'},
  {id:'gestures-2024',label:'Ter Bekke等，2024',title:'Hand gestures have predictive potential during conversation',url:'https://doi.org/10.1111/cogs.13407'},
  {id:'interviews-2024',label:'Tescari与Bangerter，2024',title:'Nonverbal Behavior in Selection Interviews: Relation to Communion, Agency, and Interview Performance',url:'https://doi.org/10.1027/1866-5888/a000350'},
  {id:'posture-2025',label:'Niebuhr与Taghva，2025',title:'Posture and Gestures Can Affect the Prosodic Speaker Impact in a Remote Presentation',url:'https://doi.org/10.1515/9783111060309-007'},
  {id:'prosody-2026',label:'Lin等，2026',title:'Speaking to Win: How Prosodic Features Predict Success in Mandarin Public Speaking Competitions',url:'https://doi.org/10.21437/SpeechProsody.2026-161'}
];
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const index=(part,total)=>finite(part)&&finite(total)&&total>0&&part>=0&&part<=total?Math.round(1000*part/total)/10:null;
const percent=v=>finite(v)?`${(100*v).toFixed(1)}%`:'未记录';
export function practiceAdvice(item,metrics){
  if(item.id==='hand_activity'){
    if(item.status!=='measured')return {type:'采集优先',title:'先让双手持续入镜',detail:'将镜头略向下调整，拍到前臂与桌面附近的双手，再判断哪些动作需要改善。',exercise:'完整回答一道题，检查双手是否持续可见。',basis:'本轮手部数据覆盖不足，无法概括整场动作。'};
    if(item.value>=50)return {type:'片段练习',title:'减少与内容无关的重复手部动作',detail:'先回看是否存在反复摆手、搓手等无关动作；如有，可在一个要点结束后让双手自然停放，保留说明步骤或强调重点的手势。',exercise:'用60秒讲清三个要点，每讲完一点自然停顿，比较动作与内容是否配合。',basis:`可见时间内约${item.value.toFixed(1)}%处于移动状态；活动比例不能识别动作意图，也不表示手势过多。`};
    return {type:'片段练习',title:'让手势配合步骤与重点',detail:'讲到流程、对比或数量时保留自然手势，其余时间舒适停放双手，不必刻意增加或减少动作。',exercise:'用60秒解释一个设计流程，回看手势是否与步骤一致。',basis:'本轮有足够手部可见数据；动作多少本身不判断表达好坏。'};
  }
  if(item.id==='posture_deviation'){
    if(item.status==='review_signal')return {type:'校准优先',title:'先固定设备，再练习坐姿',detail:'本轮存在大幅设备旋转。先确认IMU固定在躯干并重新校准；佩戴确认后，再练习减少与表达无关的前后晃动和反复转身。',exercise:'自然坐稳并静置校准3秒，再回答60秒，保留正常呼吸与必要的舒适调整。',basis:'角度记录尚不能可靠区分身体变化、设备移位或手持转动。'};
    if(item.status!=='measured')return {type:'采集优先',title:'先完成佩戴与坐姿校准',detail:'将IMU固定在躯干，保持自然坐姿完成校准后，再记录姿态变化。',exercise:'先校准3秒，再完整回答一道题，检查连接是否稳定。',basis:'本轮缺少足够的已校准姿态数据。'};
    if(item.value>=50)return {type:'片段练习',title:'减少与表达无关的身体晃动',detail:'回看持续偏离片段。若存在反复摇晃或转身，可让双脚与座椅形成舒适支撑，在要点之间自然回到坐姿基准。',exercise:'回答60秒，比较是否更舒适、表达更连贯，不以全程静止为目标。',basis:`相对个人基准的持续偏离占有效时间${item.value.toFixed(1)}%；偏离不等于坐姿错误。`};
    return {type:'片段练习',title:'保持舒适支撑，保留自然调整',detail:'在座椅上保持舒适支撑，强调重点时可以自然前倾，避免为了降低指数刻意僵坐。',exercise:'用同一题型再练习一轮，优先比较回答清晰度和舒适感。',basis:'指数描述相对基准的变化，不是坐姿优劣分。'};
  }
  return {type:'通用练习',title:'每句突出一个重点，句间自然停顿',detail:'先说结论，再补充理由；讲完一个意思后自然停顿，保持音量可听清。该建议不代表本场语气存在问题。',exercise:'另行录制一段30秒回答，回听重点、停顿与句尾音量；补充本人音频后才能分析语气。',basis:'本场未保存本人回答音频，不能判断实际语速、音高或停顿。'};
}
export function buildAuxiliaryScores(metrics,session={}){
  const h=metrics.hands||{},p=metrics.posture||{};
  const handValue=index(h.movement_ms,h.visible_ms);
  const handReady=handValue!==null&&h.visible_ms>=10000&&h.coverage>=.5&&metrics.duration_ms>=10000;
  const postureValue=p.calibrated?index(p.deviation_ms,p.calibrated_ms):null;
  const rotationReview=postureValue!==null&&finite(p.p95_tilt_deg)&&p.p95_tilt_deg>=90;
  const postureReady=postureValue!==null&&p.calibrated_ms>=10000&&p.calibrated_coverage>=.5&&!rotationReview;
  const threshold=session.imu?.settings?.threshold??12;
  const item=(id,label,value,status,statusLabel,detail,formula,interpretation,recommendation,references)=>({id,label,value,scale:100,status,status_label:statusLabel,detail,formula,interpretation,recommendation,references,performance_score:null});
  const result={version:AUXILIARY_VERSION,advice_version:'practice-advice/1.0',kind:'descriptive_measurement',scope:'辅助指数不表示表现优劣，不计入回答专业总分。',
    criteria:{minimum_observed_ms:10000,minimum_coverage:.5,posture_review_p95_deg:90,practice_prompt_index:50,threshold_source:'项目工程初值，50只切换练习提示，非论文验证的升学面试合格线'},
    items:[
      item('hand_activity','手部活动指数',handValue,handReady?'measured':handValue===null?'not_recorded':'limited_sample',handReady?'可描述本轮':handValue===null?'未评价':'局部样本',
        `移动 ${((h.movement_ms||0)/1000).toFixed(1)} 秒 / 可见 ${((h.visible_ms||0)/1000).toFixed(1)} 秒；覆盖 ${percent(h.coverage)}。`,
        '100 × 可见移动时长 / 手部有效可见时长','数值越高，表示有效画面内活动越多；不区分解释性手势与无关动作。',
        handReady?'结合对应回答回看动作是否帮助说明步骤、对比或重点。':'先调整机位，让前臂与双手持续入镜；局部样本不代表整场。',['gestures-2024','interviews-2024']),
      item('posture_deviation','姿态偏离指数',postureValue,rotationReview?'review_signal':postureReady?'measured':postureValue===null?'not_recorded':'limited_sample',rotationReview?'需检查佩戴':postureReady?'可描述本轮':postureValue===null?'未评价':'覆盖不足',
        p.calibrated?`偏离 ${((p.deviation_ms||0)/1000).toFixed(1)} 秒 / 有效 ${((p.calibrated_ms||0)/1000).toFixed(1)} 秒；中位数 ${p.median_tilt_deg??'—'}°，P95 ${p.p95_tilt_deg??'—'}°。`:'没有已校准的 IMU 数据。',
        `100 × 持续偏离事件时长 / 已校准 IMU 有效时长；本次进入阈值 ${threshold}°`,
        '数值越高，表示传感器相对该次基准的偏离时间越长；不等于坐姿错误。',
        rotationReview?'存在大幅设备旋转。先确认固定佩戴和基准是否有效，不能据此判断躯干表现。':postureReady?'关注影响舒适或交流的片段，保持自然坐姿，无需追求全程静止。':'固定佩戴、完成坐姿校准后再记录。',['posture-2025','openopaf-2024']),
      item('voice_prosody','语音语气',null,'not_recorded','未评价','本记录未保存可验证的本人回答音频及声学特征。',
        '有音频时分别报告语速、停顿、基频范围与相对响度，不将它们任意合成优劣分。',
        '文字转写不能恢复语调、发音或真实停顿；发声占比也不等于语气质量。',
        '下一轮需采集本人回答音频，区分提问、回答与静音后提取声学特征。',['openopaf-2024','prosody-2026'])
    ],references:AUXILIARY_REFERENCES};
  for(const item of result.items){item.advice=practiceAdvice(item,metrics);item.recommendation=`${item.advice.title}：${item.advice.detail} 下一轮：${item.advice.exercise}`;}
  return result;
}

export function auxiliaryMarkdown(scores){
  if(!scores)return '';
  const lines=['## 多模态辅助指数',scores.scope,'','| 项目 | 指数（0–100） | 数据状态 |','|---|---:|---|'];
  scores.items.forEach(i=>lines.push(`| ${i.label} | ${i.value===null?'未评价':i.value.toFixed(1)} | ${i.status_label} |`));
  for(const i of scores.items)lines.push('',`### ${i.label}`,i.detail,`计算：${i.formula}`,`解释：${i.interpretation}`,`建议：${i.recommendation}`,i.advice?`建议类型：${i.advice.type}。依据：${i.advice.basis}`:'');
  lines.push('',`规则版本：${scores.version}。具体公式与可用性门槛为项目操作定义，文献支持指标选择，没有验证这些指数是面试能力分。`);
  for(const r of scores.references)lines.push(`- ${r.label}. ${r.title}. ${r.url}`);
  return lines.join('\n');
}

export function summarizeAuxiliaryCaptures(captures=[]){
  return {version:AUXILIARY_VERSION,scope:'多模态辅助测量独立展示，不计入回答专业总分。',captures:captures.filter(c=>c.analysis?.auxiliary_scores).map(c=>({captureId:c.id,duration_ms:c.duration_ms,scores:c.analysis.auxiliary_scores}))};
}
