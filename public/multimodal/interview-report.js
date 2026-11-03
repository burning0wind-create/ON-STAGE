import {normalizeTranscript} from './transcript.js';
import {buildAuxiliaryScores,auxiliaryMarkdown,AUXILIARY_REFERENCES} from './auxiliary-scores.js';
export const REPORT_VERSION='interview-behavior/1.1';
export const REFERENCES=[
  {id:'posture-context',label:'Dael等，2012',title:'Emotion expression in body action and posture',url:'https://doi.org/10.1037/a0025737',finding:'身体动作组合携带情绪表达信息，但演员研究中的模式不能成为单个IMU的情绪判定表。'},
  {id:'posture-meta',label:'Monéger等，2025',title:'The Effects of Exposure to Pleasant and Unpleasant Stimuli on Body Posture: A Systematic Review and Meta-Analysis',url:'https://doi.org/10.1111/psyp.70126',finding:'姿态与情绪效价研究的效应较小且异质；其力板测量也不同于本项目的佩戴式IMU。'},
  {id:'gesture-meaning',label:'Cook等，2012',title:'Gestures, but not meaningless movements, lighten working memory load when explaining math',url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC3658147/',finding:'与语言意义配合的手势可能帮助组织思考；移动数量不能代替语义分析。'},
  {id:'gesture-understanding',label:'Hostetter，2011',title:'When do gestures communicate? A meta-analysis',url:'https://doi.org/10.1037/a0022128',finding:'手势可帮助听众理解，效果取决于内容；本系统通过对应回答与回放呈现动作语境。'},
  {id:'interview-impression',label:'Feiler与Powell，2016',title:'Behavioral Expression of Job Interview Anxiety',url:'https://doi.org/10.1007/s10869-015-9403-z',finding:'面试表现与整体沟通印象有关，微观小动作不能直接等同于实际焦虑。'},
  {id:'attention-context',label:'Seli等，2014',title:'Restless mind, restless body',url:'https://doi.org/10.1037/a0035260',finding:'实验任务中走神与额外身体动作有关；不能将面试中的思考、手势直接判为注意力低。'},
  {id:'reflective-practice',label:'Hoque等，2013 MACH',title:'MACH: My Automated Conversation coacH',url:'https://www.media.mit.edu/publications/mach-my-automated-conversation-coach/',finding:'可视反馈可服务面试练习与反思；本项目的反馈效果仍需单独验证。'}
];
const number=n=>typeof n==='number'&&Number.isFinite(n);
const round=(n,d=1)=>number(n)?Math.round(n*10**d)/10**d:null;
const ratio=(n,d)=>d>0?Math.max(0,Math.min(1,n/d)):null;
const sum=a=>a.reduce((n,x)=>n+x[1]-x[0],0);
export function formatTime(ms) {const s=Math.max(0,ms||0)/1000;return `${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(1).padStart(4,'0')}`;}
export function mergeIntervals(items,start=0,end=Infinity) {
  const sorted=items.filter(a=>number(a[0])&&number(a[1])).map(([a,b])=>[Math.max(start,a),Math.min(end,b)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
  const merged=[];for(const item of sorted){const prev=merged.at(-1);if(prev&&item[0]<=prev[1])prev[1]=Math.max(prev[1],item[1]);else merged.push([...item]);}return merged;
}
function intersect(a,b) {const result=[];let i=0,j=0;while(i<a.length&&j<b.length){const s=Math.max(a[i][0],b[j][0]),e=Math.min(a[i][1],b[j][1]);if(e>s)result.push([s,e]);if(a[i][1]<b[j][1])i++;else j++;}return result;}
function quantile(values,q) {if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),p=(s.length-1)*q,l=Math.floor(p);return s[l]+(s[Math.ceil(p)]-s[l])*(p-l);}
function series(items) {const sorted=items.filter(x=>number(x.t_ms)).sort((a,b)=>a.t_ms-b.t_ms),result=[];for(const item of sorted){if(result.at(-1)?.t_ms===item.t_ms)result[result.length-1]=item;else result.push(item);}return result;}
function windows(samples,gap,start,end,predicate=()=>true) {
  const result=[];for(let i=0;i<samples.length;i++){const s=samples[i],a=Math.max(start,s.t_ms),b=Math.min(end,samples[i+1]?.t_ms??end,s.t_ms+gap);if(b>a&&predicate(s))result.push([a,b]);}return mergeIntervals(result,start,end);
}
function cleanEvents(events,duration) {
  return (events||[]).filter(e=>number(e.start_ms)&&number(e.end_ms)&&e.end_ms>=e.start_ms).map(e=>({...e,start_ms:Math.max(0,e.start_ms),end_ms:Math.min(duration,e.end_ms)})).filter(e=>e.end_ms>=e.start_ms);
}
function prepare(session) {
  const duration=Math.max(0,number(session.duration_ms)?session.duration_ms:0);
  const frames=series((session.frames||[]).map(f=>({...f,hands:Array.isArray(f.hands)?f.hands:[]})));
  const samples=series(session.imu?.samples||[]);
  return {duration,frames,samples,events:cleanEvents(session.events,duration),cameraRequested:['camera','video'].includes(session.source?.type)||frames.length>0,imuRequested:!!session.imu,baseline:!!session.imu?.baseline,handGap:Math.max(300,3000/(session.settings?.target_fps||15)),imuGap:session.imu?.settings?.staleMs||800};
}
function stats(data,start,end) {
  const duration=Math.max(0,end-start),captured=windows(data.frames,data.handGap,start,end),visible=windows(data.frames,data.handGap,start,end,f=>f.hands.length>0);
  const signal=windows(data.samples,data.imuGap,start,end),calibrated=windows(data.samples,data.imuGap,start,end,s=>data.baseline&&number(s.tilt_deg));
  const events=data.events.filter(e=>e.end_ms>start&&e.start_ms<end),handEvents=events.filter(e=>e.type==='hand_movement'),tiltEvents=events.filter(e=>e.type==='imu_tilt');
  const handIntervals=intersect(mergeIntervals(handEvents.map(e=>[e.start_ms,e.end_ms]),start,end),visible);
  const tiltIntervals=intersect(mergeIntervals(tiltEvents.map(e=>[e.start_ms,e.end_ms]),start,end),calibrated);
  const inWindow=data.frames.filter(f=>f.t_ms>=start&&f.t_ms<end),seen=inWindow.filter(f=>f.hands.length),speeds=seen.flatMap(f=>f.hands.map(h=>h.speed).filter(number));
  const tilts=data.baseline?data.samples.filter(s=>s.t_ms>=start&&s.t_ms<end&&number(s.tilt_deg)).map(s=>s.tilt_deg):[];
  return {
    duration_ms:round(duration),
    hands:{requested:data.cameraRequested,frame_count:inWindow.length,observed_frame_count:seen.length,sampled_ms:round(sum(captured)),visible_ms:round(sum(visible)),coverage:ratio(sum(visible),duration),movement_ms:round(sum(handIntervals)),movement_share_visible:ratio(sum(handIntervals),sum(visible)),movement_episodes:handIntervals.length,track_events:handEvents.length,median_speed:round(quantile(speeds,.5),2),p95_speed:round(quantile(speeds,.95),2),edge_frame_share:ratio(seen.filter(f=>f.hands.some(h=>h.nearEdge)).length,seen.length)},
    posture:{requested:data.imuRequested,calibrated:data.baseline,sample_count:data.samples.filter(s=>s.t_ms>=start&&s.t_ms<end).length,signal_ms:round(sum(signal)),coverage:ratio(sum(signal),duration),calibrated_ms:round(sum(calibrated)),calibrated_coverage:ratio(sum(calibrated),duration),median_tilt_deg:round(quantile(tilts,.5)),p95_tilt_deg:round(quantile(tilts,.95)),peak_tilt_deg:tilts.length?round(tilts.reduce((max,n)=>Math.max(max,n),-Infinity)):null,deviation_ms:round(sum(tiltIntervals)),deviation_share:ratio(sum(tiltIntervals),sum(calibrated)),deviation_episodes:tiltIntervals.length},
    cooccurrence_ms:round(sum(intersect(handIntervals,tiltIntervals)))
  };
}
export function sanitizeReflection(input={}) {
  const score=(key,max,min=0)=>number(input[key])&&input[key]>=min&&input[key]<=max?input[key]:null;
  const allowed=['unrated','helpful','neutral','distracting','not_visible'];
  const contexts=['unconfirmed','explaining','recalling','adjusting','felt_nervous','uncertain'];
  return {stress:score('stress',10),attention:score('attention',10),effort:score('effort',10),structure:score('structure',5,1),gesture_help:allowed.includes(input.gesture_help)?input.gesture_help:'unrated',context:contexts.includes(input.context)?input.context:'unconfirmed',notes:typeof input.notes==='string'?input.notes.slice(0,2000):''};
}
function questionWindows(session,data) {
  let changes;
  if(Array.isArray(session.question_markers)&&session.question_markers.length){changes=series(session.question_markers.map(m=>({t_ms:m.t_ms,question_id:String(m.question_id||'未标注题目')})));}
  else {
    const observations=series([...data.frames,...data.samples].map(s=>({t_ms:s.t_ms,question_id:String(s.question_id||'未标注题目')})));changes=[];
    for(const s of observations){if(changes.at(-1)?.question_id!==s.question_id)changes.push(s);}
    if(changes.length)changes[0]={...changes[0],t_ms:0};
  }
  return (changes||[]).filter(c=>c.t_ms>=0&&c.t_ms<data.duration).map((c,i)=>({question_id:c.question_id,start_ms:c.t_ms,end_ms:Math.min(data.duration,changes[i+1]?.t_ms??data.duration)})).filter(q=>q.end_ms>q.start_ms);
}
function makeInsights(report,data) {
  const output=[],h=report.metrics.hands,p=report.metrics.posture;
  const add=(id,title,observation,meaning,practice,refs)=>output.push({id,title,observation,meaning,practice,references:refs});
  if(report.duration_ms<10000)add('short','本轮适合检查数据，暂不足以概括整段面试',`本轮只记录了${(report.duration_ms/1000).toFixed(1)}秒。`,'短记录容易受开始、结束时的动作影响。','下一轮完整回答一道题，再比较动作与表达。',['reflective-practice']);
  if(p.requested){
    if(!p.calibrated)add('no-baseline','先补齐个人坐姿基准',`收到${p.sample_count}条IMU样本，但没有有效坐姿基准。`,'原始角度不能直接解释为身体表现。','固定佩戴后保持自然坐姿，完成3秒校准再记录。',['posture-context','posture-meta']);
    else if(p.calibrated_ms<3000||(p.calibrated_coverage??0)<.5)add('imu-quality','姿态证据覆盖不足',`有效基准角度覆盖本轮约${Math.round((p.calibrated_coverage??0)*100)}%。`,'数据间断不能解释为身体静止。','先检查蓝牙连接和设备固定情况，再录制。',['posture-meta']);
    else if(p.deviation_episodes)add('posture-changes','有姿态变化值得结合回答回看',`检测到${p.deviation_episodes}段持续偏离候选，累计${(p.deviation_ms/1000).toFixed(1)}秒，偏离峰值${p.peak_tilt_deg}°。`,'这是相对个人基准的变化；可能发生在强调、检索知识或调整舒适姿势时，不能直接判为紧张。','选择下方姿态片段，确认当时发生什么；只有它影响表达或舒适感时，再制定调整目标。',['posture-context','posture-meta','interview-impression']);
    else add('posture-no-event','本轮未形成持续姿态偏离片段',`有效数据中的相对偏离中位数为${p.median_tilt_deg}°。`,'变化少只是本轮观察结果，不代表更专注或面试表现更好。','保留自然、舒适的坐姿，把练习重点放在回答是否清楚。',['interview-impression','posture-meta']);
  } else add('imu-absent','本轮未评价躯干姿态','本轮没有参与记录的IMU数据。','不根据手部画面补猜躯干角度。','需要姿态复盘时，先连接并校准IMU，再开始记录。',['posture-context']);
  if(h.requested){
    if(h.visible_ms<3000||(h.coverage??0)<.5)add('hands-quality','先改善双手取景，再评价动作',`本轮手部可见时间约${(h.visible_ms/1000).toFixed(1)}秒，占记录约${Math.round((h.coverage??0)*100)}%。`,'未检出可能来自出画或遮挡，不能解释为手势少，也不据此给表现结论。','调整机位，拍到前臂及桌面附近的双手，下一轮检查关键点能否持续跟随。',['gesture-understanding']);
    else if(h.movement_episodes)add('hand-movement','把手部移动与表达内容一起看',`检测到${h.movement_episodes}个可见移动时段，占可见时间约${Math.round((h.movement_share_visible??0)*100)}%。`,'这些是移动片段，不是语义手势计数；解释步骤、强调重点的动作可能有帮助。','结合对应回答，回看动作是否配合步骤、对比或重点。',['gesture-meaning','gesture-understanding']);
    else add('hands-no-event','本轮未检测到持续超过阈值的手部移动','有效画面中未形成移动事件。','这不表示缺少表达能力，也不要求刻意增加动作。','讲述流程时可保留自然的步骤手势，结合下一轮回答比较。',['gesture-meaning','gesture-understanding']);
  } else add('camera-absent','本轮未评价手部表达','本轮没有摄像头手部记录。','仅IMU不能判断手势是否帮助交流。','需要手部复盘时，先开启摄像头，再开始下一轮。',['gesture-understanding']);
  if(report.metrics.cooccurrence_ms>=1000)add('cooccurrence','两路动作在同一时段发生',`姿态变化与手部移动重叠约${(report.metrics.cooccurrence_ms/1000).toFixed(1)}秒。`,'时间重叠只说明共同发生，不说明它们由同一种情绪引起。','把这段对应到题目、停顿或强调内容，记录本人的解释。',['posture-context','attention-context']);
  return output;
}
function nextSteps(report) {
  const steps=[];
  if(report.insights.some(i=>['hands-quality','imu-quality','no-baseline','imu-rotation-review'].includes(i.id)))steps.push({title:'先补齐可用的采集证据',detail:'按数据质量提示调整取景、固定佩戴并重新校准，再完整回答一道题。',basis:'本轮数据质量'});
  steps.push({title:'结合对应回答回看动作',detail:'定位步骤说明、观点对比或重点强调的片段，保留帮助表达的自然动作。',basis:'动作与回答时间位置'});
  steps.push({title:'下一轮优先改善回答证据',detail:'先给结论，再用具体项目过程或结果支撑。保持同题型练习，比较回答质量与辅助指数。',basis:'回答评价与多模态分别呈现'});
  return steps.slice(0,3);
}
export function buildInterviewReport(session) {
  const data=prepare(session),metrics=stats(data,0,data.duration),h=metrics.hands,p=metrics.posture;
  const usableHands=h.requested&&h.visible_ms>=3000&&(h.coverage??0)>=.5,usablePosture=p.requested&&p.calibrated&&p.calibrated_ms>=3000&&(p.calibrated_coverage??0)>=.5;
  const report={version:REPORT_VERSION,method:'literature-informed local rules; no LLM request',session_id:session.id,generated_at:new Date().toISOString(),duration_ms:data.duration,origin:session.record_origin==='imported_json'?'导入的历史记录':'本页采集记录',status:data.duration<10000?'短记录 仅描述动作':usableHands&&usablePosture?'双模态证据可用':usableHands?'手部证据可用':usablePosture?'姿态证据可用':'证据不足 先检查采集',scope:'描述姿态与手部行为，辅助沟通练习；未评价回答内容、学术能力、情绪或注意力',metrics,reflection:sanitizeReflection(session.reflection),references:REFERENCES};
  report.auxiliary_scores=buildAuxiliaryScores(metrics,session);
  if(report.auxiliary_scores.items[1].status==='review_signal')report.status='姿态数据需核查';
  report.references=[...REFERENCES,...AUXILIARY_REFERENCES];
  report.insights=makeInsights(report,data);
  if(report.auxiliary_scores.items[1].status==='review_signal')report.insights.unshift({id:'imu-rotation-review',title:'先检查设备佩戴与坐姿基准',observation:`相对偏离P95为${p.p95_tilt_deg}°，存在大幅设备旋转。`,meaning:'数据不能自动区分躯干变化、设备移位或手持转动。',practice:'固定在躯干后重做3秒坐姿校准，再完整回答一道题。',references:['posture-2025']});
  report.questions=questionWindows(session,data).slice(0,100).map(q=>({...q,metrics:stats(data,q.start_ms,q.end_ms)}));
  const candidates=data.events.filter(e=>['imu_tilt','hand_movement','hands_unobserved','imu_unobserved','manual_marker'].includes(e.type));
  const picks=[];for(const type of ['imu_tilt','hand_movement','manual_marker','hands_unobserved','imu_unobserved']){const items=candidates.filter(e=>e.type===type);const e=type==='manual_marker'?items.at(-1):items.sort((a,b)=>((b.type==='imu_tilt'?b.peak_tilt_deg:b.end_ms-b.start_ms)||0)-((a.type==='imu_tilt'?a.peak_tilt_deg:a.end_ms-a.start_ms)||0))[0];if(e)picks.push(e);}
  report.moments=picks.slice(0,4).map(e=>({type:e.type,start_ms:e.start_ms,end_ms:e.end_ms,review_end_ms:Math.min(e.end_ms||e.start_ms+10000,e.start_ms+20000),title:e.type==='imu_tilt'?'姿态变化':e.type==='hand_movement'?'手部移动':e.type==='manual_marker'?'你标记的时刻':'数据质量 未知区间',prompt:e.type==='imu_tilt'?'结合对应回答查看姿态变化。':e.type==='hand_movement'?'结合步骤说明、对比或重点回看动作。':e.type==='manual_marker'?(e.note||'查看这一刻的记录。'):'先检查遮挡、出画或连接，不能据此评价表现。',event:e}));
  report.next_steps=nextSteps(report);
  report.summary=`本轮记录${(data.duration/1000).toFixed(1)}秒。${p.requested?(p.calibrated?`姿态记录形成${p.deviation_episodes}段持续偏离候选。`:'IMU尚无可解读的个人坐姿基准。'):'本轮未采集IMU。'}${h.requested?`手部可见时间约占${Math.round((h.coverage??0)*100)}%。`:'本轮未采集手部画面。'}辅助指数独立呈现，不计入回答专业总分。`;
  report.limits=['手部关键点只识别移动，尚未自动识别语义手势、摸脸、抱臂或动作意图。','IMU角度相对个人基准，不是人体关节角；设备移位、佩戴变化会影响结果。','12°等阈值与10秒、50%等报告可用性门槛是工程初值，未由论文验证为面试表现标准。','本报告为本地文献规则反馈，不是大模型对视频的语义判断，也不生成紧张、注意力、能力或录取评分。'];
  return report;
}

export function validateImportedSession(value) {
  if(!value||typeof value!=='object'||!['camera','video','imu'].includes(value.source?.type)||!number(value.duration_ms)||value.duration_ms<0)throw new Error('不是有效的会话JSON：需要来源与记录时长。');
  if(!Array.isArray(value.frames)||!Array.isArray(value.events)||value.frames.length>18000||value.events.length>30000)throw new Error('帧或事件格式不正确，或超过本地记录上限。');
  if(value.imu&&(!Array.isArray(value.imu.samples)||value.imu.samples.length>90000))throw new Error('IMU样本格式不正确，或超过90,000条。');
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(number);
  for(const f of value.frames){if(!number(f.t_ms)||!Array.isArray(f.hands)||f.hands.length>2)throw new Error('摄像头帧缺少时间或手部列表。');for(const h of f.hands){if(!Array.isArray(h.landmarks)||h.landmarks.length!==21||h.landmarks.some(p=>!number(p.x)||!number(p.y))||!number(h.center?.x)||!number(h.center?.y))throw new Error('手部关键点或掌部中心格式不正确。');}if(f.imu&&!vector(f.imu.euler_deg))throw new Error('帧中的IMU匹配数据格式不正确。');}
  for(const s of value.imu?.samples||[]){if(!number(s.t_ms)||!vector(s.acc_g)||!vector(s.gyro_dps)||!vector(s.euler_deg))throw new Error('IMU样本缺少时间或三轴数值。');}
  for(const e of value.events){if(!['imu_tilt','hand_movement','hands_unobserved','imu_unobserved','manual_marker'].includes(e.type)||!number(e.start_ms)||!number(e.end_ms)||e.end_ms<e.start_ms)throw new Error('事件时间或类型不正确。');if(e.type==='imu_tilt'&&!number(e.peak_tilt_deg))throw new Error('倾斜事件缺少有效峰值。');}
  if(value.imu?.baseline&&!vector(value.imu.baseline.gravity_sensor))throw new Error('IMU基准方向格式不正确。');
  if(value.transcript)value.transcript=normalizeTranscript(value.transcript);
  value.reflection=sanitizeReflection(value.reflection);return value;
}

export function reportToMarkdown(report) {
  const refs=report.references??REFERENCES;
  const p=report.metrics.posture,h=report.metrics.hands,r=report.reflection,percentage=n=>n===null?'未评价':`${Math.round(n*100)}%`;
  const lines=['# 面试行为复盘',`记录ID：${report.session_id}`,`生成时间：${report.generated_at}`,`来源：${report.origin}`,`状态：${report.status}`,'',report.summary,'',`覆盖范围：${report.scope}`,'','## 可观察指标',`- 姿态基准：${p.calibrated?'已校准':'未校准/未采集'}`,`- IMU接收覆盖：${p.requested?percentage(p.coverage):'未采集'}`,`- 相对偏离中位数 / P95 / 峰值：${p.median_tilt_deg??'—'} / ${p.p95_tilt_deg??'—'} / ${p.peak_tilt_deg??'—'} °`,`- 持续姿态偏离：${p.deviation_episodes}段，${(p.deviation_ms/1000).toFixed(1)}秒`,`- 手部可见时间占记录：${h.requested?percentage(h.coverage):'未采集'}`,`- 可见移动时段：${h.movement_episodes}段（合并双手同时移动），${(h.movement_ms/1000).toFixed(1)}秒`,`- 移动时长占可见时间：${percentage(h.movement_share_visible)}`,`- 速度中位数：${h.median_speed??'—'} 图像估计掌宽/秒`,'','## 观察、解释与练习'];
  for(const i of report.insights)lines.push(`### ${i.title}`,`观察：${i.observation}`,`解释边界：${i.meaning}`,`练习：${i.practice}`,`依据：${i.references.map(id=>refs.find(s=>s.id===id)?.label).join('；')}`,'');
  lines.push('## 题目与片段');for(const q of report.questions)lines.push(`- ${q.question_id}：${formatTime(q.start_ms)}–${formatTime(q.end_ms)}；姿态候选${q.metrics.posture.deviation_episodes}段；手部可见${percentage(q.metrics.hands.coverage)}`);
  for(const m of report.moments)lines.push(`- ${formatTime(m.start_ms)}–${formatTime(m.end_ms)} ${m.title}：${m.prompt}`);
  lines.push('',auxiliaryMarkdown(report.auxiliary_scores),'','## 下一轮练习');
  report.next_steps.forEach((s,i)=>lines.push(`${i+1}. ${s.title}：${s.detail}（依据：${s.basis}）`));
  lines.push('','## 文献');REFERENCES.forEach(s=>lines.push(`- ${s.label}. ${s.title}. ${s.url}`));lines.push('','## 方法边界',...report.limits.map(s=>'- '+s),`报告方法版本：${report.version}；${report.method}`);return lines.join('\n');
}
