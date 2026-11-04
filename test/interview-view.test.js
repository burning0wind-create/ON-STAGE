import test from 'node:test';
import assert from 'node:assert/strict';
import {renderInterview,compactInterviewProgress,updateInterviewVoice,renderSelfCamera,updateSelfCamera,answerControlState} from '../public/interview-view.js';

const stages=[{id:'english',name:'英语问答',language:'en',minutes:5},{id:'portfolio',name:'作品集答辩',language:'zh-CN',minutes:8},{id:'design',name:'设计专业问答',language:'zh-CN',minutes:5},{id:'ethics',name:'综合素质与设计伦理',language:'zh-CN',minutes:3}];
const session=()=>({id:'s1',status:'active',stageIndex:1,profile:{stages,year:2027,admissionType:'推免面试'},turns:[{id:'q1',role:'interviewer',stageId:'english',content:'Tell us about your project.'},{id:'a1',role:'candidate',stageId:'english',content:'My project.',scoring:{status:'complete'}},{id:'q2',role:'interviewer',stageId:'portfolio',content:'说明作品的研究依据。'}],materials:[],warnings:[]});

test('开始与继续回答使用不同文案和动作，停听与识别错误都保留明确的继续入口',()=>{
  const first=answerControlState();assert.equal(first.startLabel,'开始语音回答');assert.equal(first.startAction,'voice-start');
  for(const context of [{speechConsent:true},{draft:'已有内容'},{hasSpeech:true},{phase:'error'},{interimText:'补充片段'}]){
    const control=answerControlState(context);assert.equal(control.startLabel,'继续回答');assert.equal(control.startAction,'voice-toggle');assert.equal(control.showStart,true);assert.equal(control.showToggle,false);
    const html=renderInterview(session(),{speechConsent:!!context.speechConsent,answerDraft:context.draft??'',voiceState:{phase:context.phase??'ready',...context}});
    assert.match(html,/data-action="voice-toggle" id="voice-start"  >继续回答/);assert.match(html,/已有内容保留/);assert.doesNotMatch(html,/开启语音面试|继续语音回答/);
  }
  const listening=answerControlState({phase:'listening',speechConsent:true});assert.equal(listening.showStart,false);assert.equal(listening.showToggle,true);assert.equal(listening.toggleLabel,'暂停回答');assert.equal(listening.status,'正在聆听，可以直接继续说');
  const paused=renderInterview({...session(),status:'paused'},{speechConsent:true});assert.match(paused,/id="voice-start"  disabled>继续回答/);
  const unsupported=answerControlState({recognitionSupported:false});assert.match(unsupported.hint,/文字辅助/);
});

test('环节进度突出当前步骤，按实际问题计数且不以评分代替面试进度',()=>{
  const html=renderInterview(session());
  assert.match(html,/当前环节 <span>02 \/ 04/);
  assert.equal((html.match(/aria-current="step"/g)||[]).length,1);
  assert.match(html,/iv-stage-step is-done/);assert.match(html,/iv-stage-step is-current/);assert.match(html,/iv-stage-step is-upcoming/);
  assert.match(html,/本环节 · 第 1 题/);assert.doesNotMatch(html,/progress-donut|专业评分完成度|stroke-dasharray/);
  const s=session();s.turns.push({role:'interviewer',stageId:'portfolio',content:'再解释一条依据。'});assert.match(renderInterview(s),/本环节 · 第 2 题/);
  s.profile.stages=[stages[1]];s.stageIndex=0;const one=renderInterview(s);assert.doesNotMatch(one,/\sstyle=/);assert.equal((one.match(/class="iv-stage-step /g)||[]).length,1);assert.match(one,/01 \/ 01/);
});

test('语音是主要入口，文字辅助保留合法表单、转写节点和明确提交动作',()=>{
  const html=renderInterview(session(),{answerDraft:'我的回答',speechConsent:true,voiceState:{phase:'listening',interimText:'补充中'}});
  for(const id of ['voice-final','voice-interim','voice-placeholder','voice-state-label','speech-status','voice-start','voice-repeat','voice-toggle','voice-complete'])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/id="answer-form"/);assert.match(html,/textarea[^>]*name="answer"[^>]*maxlength="20000"/);
  assert.match(html,/id="text-assist" data-text-assist >/);assert.match(html,/id="voice-final">我的回答/);assert.match(html,/iv-interim">补充中/);
  assert.match(html,/type="button" class="primary iv-answer-complete" data-action="voice-complete"/);
  assert.match(html,/回答完毕后，确认提交才进入下一环节/);assert.match(html,/音频可能由浏览器语音服务商处理/);
  assert.doesNotMatch(html,/<textarea[^>]*required/);
});

test('不同环节使用Figma原考官图片；不支持语音时自动展开文字辅助',()=>{
  const s=session();
  const files=['english','portfolio','research','qualities'];
  for(let i=0;i<stages.length;i++){s.stageIndex=i;const html=renderInterview(s);assert.match(html,new RegExp('iv-persona-'+stages[i].id));assert.match(html,new RegExp('src="/assets/examiners/'+files[i]+'\\.png"'));assert.match(html,/虚拟考官/);assert.doesNotMatch(html,/\sstyle=|figma\.com|examiner-personas/);}
  const fallback=renderInterview(s,{voiceState:{phase:'unsupported',recognitionSupported:false}});
  assert.match(fallback,/id="text-assist" data-text-assist open/);assert.match(fallback,/当前浏览器不支持语音转写/);
  assert.match(renderInterview(s,{imagePath:'https://bad.example/a.png'}),/iv-single-image/);
  assert.match(renderInterview(s,{imagePath:'https://bad.example/a.png'}),/src="\/assets\/examiner.webp"/);
  assert.doesNotMatch(renderInterview(s,{imagePath:'https://bad.example/a.png'}),/bad\.example/);
});

test('考官身份信息在照片下方，当前问题仅在对话区展示而不遮挡人物',()=>{
  const html=renderInterview(session()),scene=html.match(/<section class="iv-scene[\s\S]*?<\/section>/)?.[0];
  assert.ok(scene);assert.match(scene,/<img class="iv-portrait"[^>]+width="421" height="237"/);
  assert.match(scene,/<\/div>\s*<div class="iv-scene-footer"><div class="iv-examiner-identity">/);
  assert.match(scene,/项目背景、个人贡献、设计决策与验证结果。/);
  assert.doesNotMatch(scene,/说明作品的研究依据|PORTFOLIO REVIEW|iv-subtitles|iv-scene-shade/);
  assert.match(html,/class="iv-current-question"[^>]*>说明作品的研究依据。/);
});

test('过渡态阻止重复提交，收音连接可取消；部分结果不在实时面板重复显示',()=>{
  const s=session();
  const html=renderInterview(s,{answerDraft:'最终句子 临时句子',voiceState:{phase:'listening',finalText:'最终句子',interimText:'临时句子'}});
  assert.match(html,/id="voice-final">最终句子<\/span><span id="voice-interim" class="iv-interim">临时句子/);
  assert.doesNotMatch(html,/id="voice-final">最终句子 临时句子/);
  const processing=renderInterview(s,{answerDraft:'已回答',voiceState:{phase:'processing'}});
  assert.match(processing,/data-voice-lock disabled>完成本题，确认提交/);assert.match(processing,/data-control="skip" data-voice-lock disabled/);
  const connecting=renderInterview(s,{voiceState:{phase:'connecting'}});assert.match(connecting,/id="voice-toggle"  >取消连接/);
  for(const phase of ['ready','error']){const ready=renderInterview(s,{answerDraft:'继续内容',voiceState:{phase}});assert.match(ready,/id="voice-start"  >继续回答/);assert.match(ready,/id="voice-toggle" hidden/);}
  const full='长'.repeat(20001)+'完整末尾';const long=renderInterview(s,{answerDraft:full});assert.ok(long.includes(full+'</textarea>'));assert.match(long,/内容已完整保留/);assert.match(long,/id="voice-complete" disabled/);assert.match(long,/id="text-assist" data-text-assist open/);
});

test('紧凑记录条仅展示真实保存题数和后台状态，不泄露分数或构造进度',()=>{
  const s=session();s.turns.push({role:'candidate',stageId:'portfolio',scoring:{status:'partial'},evaluation:{feedback:'not shown',score:91.5}},{role:'candidate',skipped:true});
  const html=compactInterviewProgress(s);assert.match(html,/<strong>2<\/strong> 题已记录/);assert.match(html,/<small>1 \/ 2<\/small>/);assert.match(html,/内容评分在后台进行/);
  assert.doesNotMatch(html,/91\.5|not shown|svg|圆环|%/);assert.match(compactInterviewProgress({turns:[]}),/回答后自动保存/);
});

test('暂停和已回答恢复入口不创建新答案；最后一个环节明确生成复盘',()=>{
  const s=session();s.status='paused';const paused=renderInterview(s,{answerDraft:'已转写内容'});
  assert.match(paused,/data-voice-phase="paused"/);assert.match(paused,/data-control="resume"/);assert.match(paused,/id="voice-complete" disabled/);
  s.status='active';s.turns.push({id:'a2',role:'candidate',stageId:'portfolio',content:'已保存'});
  const answered=renderInterview(s);assert.match(answered,/回答已保存/);assert.match(answered,/data-control="next"/);assert.match(answered,/data-control="followup"/);assert.doesNotMatch(answered,/id="answer-form"/);
  s.turns.pop();s.stageIndex=3;assert.match(renderInterview(s),/回答完毕后，确认提交才生成本场复盘/);
});

test('动态标签、回答、材料与提示全部转义；音频状态更新不替换输入节点',()=>{
  const s=session();s.turns.at(-1).content='<script>alert(1)</script>';s.warnings=['<img src=x onerror=alert(1)>'];
  const html=renderInterview(s,{answerDraft:'</textarea><script>bad()</script>'});assert.doesNotMatch(html,/<script>|<img src=x/);assert.match(html,/&lt;script&gt;/);
  const nodes=Object.fromEntries(['#voice-state-label','#speech-status','#voice-start','#voice-toggle','#voice-complete','#voice-repeat','#voice-placeholder','#speech-consent','#text-assist'].map(id=>[id,{}]));
  const textarea={value:'保留光标与内容'};nodes['#answer-form textarea']=textarea;
  const classes=new Set();nodes['#voice-transcript']={classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}};
  const scene={dataset:{}};const root={querySelector:id=>nodes[id]??null,querySelectorAll:()=>[scene]};
  updateInterviewVoice(root,{phase:'processing',finalText:'不覆盖输入框'},{speechConsent:true});
  assert.equal(textarea.value,'保留光标与内容');assert.equal(scene.dataset.voicePhase,'processing');assert.equal(nodes['#voice-complete'].disabled,true);assert.equal(nodes['#voice-repeat'].disabled,true);
  updateInterviewVoice(root,{phase:'listening'},{speechConsent:true});assert.equal(nodes['#voice-toggle'].textContent,'暂停回答');assert.equal(nodes['#voice-complete'].disabled,false);assert.equal(nodes['#speech-consent'].checked,true);
  updateInterviewVoice(root,{phase:'ready'},{speechConsent:true});assert.equal(nodes['#voice-toggle'].hidden,true);assert.equal(nodes['#voice-start'].hidden,false);
});

test('自拍小窗默认关闭且不伪造画面，授权连接后才展示静音实时视频与三个操作',()=>{
  const off=renderSelfCamera();assert.match(off,/data-camera-status="off"[^>]*hidden/);assert.doesNotMatch(off,/<video|<img/);
  for(const status of ['requesting','error'])assert.doesNotMatch(renderSelfCamera({status}),/<video/);
  const active=renderInterview(session(),{selfCamera:{status:'active',view:'normal'}});
  assert.match(active,/<video id="self-camera-video" autoplay muted playsinline/);
  assert.match(active,/data-self-camera="minimize"/);assert.match(active,/data-self-camera="expand"/);assert.match(active,/data-self-camera="close" aria-label="关闭摄像头"/);
  assert.equal((active.match(/id="self-camera-video"/g)||[]).length,1);assert.match(active,/aria-pressed="true"[^>]*>关闭我的画面/);
  assert.doesNotMatch(active,/\sstyle=|getUserMedia|srcObject|麦克风已连接/);
});

test('收起和放大具有明确含义，权限状态与错误在画面外说明且保持转义',()=>{
  const collapsed=renderSelfCamera({status:'active',view:'collapsed'});assert.match(collapsed,/is-collapsed/);assert.match(collapsed,/摄像头仍开启，展开预览/);assert.match(collapsed,/data-self-camera="close"/);
  const expanded=renderSelfCamera({status:'active',view:'expanded'});assert.match(expanded,/is-expanded/);assert.match(expanded,/data-self-camera="restore" aria-label="恢复小窗大小"/);
  const requesting=renderInterview(session(),{selfCamera:{status:'requesting'}});assert.match(requesting,/aria-pressed="false" disabled>正在开启画面/);assert.match(requesting,/正在请求摄像头权限/);
  const error=renderInterview(session(),{selfCamera:{status:'error',error:'<script>权限错误</script>'}});assert.match(error,/id="self-camera-status" role="status" aria-live="polite"/);assert.match(error,/&lt;script&gt;权限错误/);assert.doesNotMatch(error,/<script>/);
});

test('切换小窗尺寸保留视频节点与表单，并在收起恢复时保留可用键盘焦点',()=>{
  const video={},minimize={},label={},chip={focus(options){this.focused=options;}},expand={dataset:{selfCamera:'expand'},setAttribute(name,value){this[name]=value;},focus(options){this.focused=options;}};
  const preview={dataset:{cameraStatus:'active',cameraView:'normal'},contains:node=>[minimize,chip,expand].includes(node),querySelector:selector=>({
    '[data-self-camera="minimize"]':minimize,'[data-self-camera="expand"],.iv-self-camera-toolbar [data-self-camera="restore"]':expand,'.iv-self-camera-label':label,'.iv-self-camera-collapsed':chip,'.iv-self-camera-toolbar [data-self-camera="expand"]':expand,'#self-camera-video':video
  })[selector]??null};
  const status={classList:{toggle(){}}},button={setAttribute(name,value){this[name]=value;}};
  const root={ownerDocument:{activeElement:minimize},querySelector:selector=>({'#self-camera':preview,'.iv-camera-control':button,'#self-camera-status':status})[selector]??null};
  assert.equal(updateSelfCamera(root,{status:'active',view:'collapsed'}),video);assert.equal(preview.dataset.cameraView,'collapsed');assert.equal(chip.hidden,false);assert.deepEqual(chip.focused,{preventScroll:true});assert.match(status.textContent,/摄像头仍开启/);
  root.ownerDocument.activeElement=chip;assert.equal(updateSelfCamera(root,{status:'active',view:'normal'}),video);assert.deepEqual(expand.focused,{preventScroll:true});assert.equal(chip.hidden,true);
  updateSelfCamera(root,{status:'active',view:'expanded'});assert.equal(expand.dataset.selfCamera,'restore');assert.equal(expand['aria-label'],'恢复小窗大小');
});
