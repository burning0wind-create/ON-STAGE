// Fictional fixture for UI timing tests. No speech recognition is performed.
const turns=[
  [0,5,'老师','请介绍一下你的研究经历，以及你希望继续研究的方向。'],
  [5,16,'考生','老师好。我本科主要学习交互设计，最近做了一个帮助同学复盘模拟面试的项目。我负责摄像头手部识别和IMU姿态数据接入。'],
  [16,21,'老师','你们为什么选择结合这两种传感方式？'],
  [21,39,'考生','摄像头记录手部移动，IMU记录躯干相对个人基准的倾斜。我们先统一时间轴，再把变化定位到回答片段，最后请本人和同伴解释当时的情境。比如讲研究流程时，手势可能是在帮助说明步骤。'],
  [39,44,'老师','如果没有检测到手，系统会怎样处理？'],
  [44,61,'考生','我们把它标记为未知，不当作手没有活动。刚才我把手放到了桌沿下面，摄像头可能被遮挡。系统会提示调整取景，而不是给出表现差的结论。'],
  [61,68,'老师','你会如何证明这个反馈对练习有帮助？'],
  [68,87,'考生','我会让同学回答难度相近的题目，比较只有录像回看和带定位反馈的两种情况。记录复盘耗时，再请同伴评价回答结构是否更清楚，同时收集本人对建议可用性的反馈。']
];
export function demoTranscript(duration) {
  return {kind:'synthetic',title:'升学面试测试对话',segments:turns.filter(t=>t[0]*1000<duration).map(([a,b,speaker,text])=>({start_ms:a*1000,end_ms:Math.min(b*1000,duration),speaker,text}))};
}
export function normalizeTranscript(value) {
  if(!value||!Array.isArray(value.segments)||value.segments.length>1000)throw new Error('对话记录格式不正确。');
  const segments=value.segments.map(s=>{
    if(!Number.isFinite(s.start_ms)||!Number.isFinite(s.end_ms)||s.start_ms<0||s.end_ms<=s.start_ms||typeof s.text!=='string')throw new Error('对话时间或文本格式不正确。');
    return {start_ms:s.start_ms,end_ms:s.end_ms,speaker:String(s.speaker||'发言者').slice(0,40),text:s.text.slice(0,2000)};
  }).sort((a,b)=>a.start_ms-b.start_ms);
  return {kind:value.kind==='synthetic'?'synthetic':'imported',title:String(value.title||'对话记录').slice(0,100),segments};
}
export function activeTurn(segments,time,duration) {
  return (segments||[]).findIndex(s=>s.start_ms<=time&&(time<s.end_ms||(time===duration&&s.end_ms===duration)));
}
