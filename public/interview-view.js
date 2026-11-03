const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const personas={
  english:{name:'英语表达考官',focus:'英文自我介绍、作品介绍、研究兴趣与追问。',image:'/assets/examiners/english.png'},
  portfolio:{name:'作品集答辩考官',focus:'项目背景、个人贡献、设计决策与验证结果。',image:'/assets/examiners/portfolio.png'},
  design:{name:'设计研究方法考官',focus:'研究问题、用户研究、证据分析与验证方法。',image:'/assets/examiners/research.png'},
  ethics:{name:'综合素质与学习规划考官',focus:'升学动机、研究计划、协作经历与反思。',image:'/assets/examiners/qualities.png'},
};
const materials={resume:'个人简历',portfolio:'作品集'};
const phaseLabels={speaking:'考官正在提问',connecting:'正在连接麦克风',listening:'正在倾听你的回答',confirm:'等待你确认回答状态',processing:'正在保存回答',paused:'面试已暂停',finishing:'正在保存回答',error:'语音暂时中断',unsupported:'请使用文字辅助',ready:'准备开始对话',idle:'准备开始对话',blocked:'点击开启语音面试'};
const phaseLabel=(phase,paused)=>paused?phaseLabels.paused:phaseLabels[phase]??'准备继续对话';
const hasText=x=>typeof x==='string'&&x.trim().length>0;

export function compactInterviewProgress(s){
  const answers=(s.turns??[]).filter(t=>t.role==='candidate'&&!t.skipped);
  const done=answers.filter(t=>t.scoring?.status==='complete'||(!t.scoring&&t.evaluation?.mode==='llm')).length;
  const pending=Math.max(0,answers.length-done);
  return `<div class="iv-save-progress" id="scoring-progress" aria-label="作答保存与评分进度"><span><i class="iv-save-dot ${pending?'is-working':''}" aria-hidden="true"></i><strong>${answers.length}</strong> 题已记录</span><span>${answers.length?pending?'内容评分在后台进行':'本场已作答题目评价完成':'回答后自动保存'}${answers.length?`<small>${done} / ${answers.length}</small>`:''}</span></div>`;
}

function stageRail(s){
  const stages=s.profile?.stages??[],index=Math.max(0,Math.min(s.stageIndex??0,stages.length-1));
  const current=stages[index]??{},count=(s.turns??[]).filter(t=>t.role==='interviewer'&&t.stageId===current.id).length;
  return `<section class="iv-journey" aria-label="本场面试环节进度"><div class="iv-journey-heading"><div><span class="iv-kicker">当前环节 <span>${String(index+1).padStart(2,'0')} / ${String(stages.length).padStart(2,'0')}</span></span><h2>${esc(current.name??'面试对话')}</h2></div><span class="iv-question-position">本环节 · 第 ${Math.max(1,count)} 题<span>建议 ${esc(current.minutes??'—')} 分钟</span></span></div><ol class="iv-stage-rail">${stages.map((stage,i)=>`<li class="iv-stage-step ${i<index?'is-done':i===index?'is-current':'is-upcoming'}" ${i===index?'aria-current="step"':''}><span class="iv-step-dot" aria-hidden="true">${i<index?'✓':String(i+1).padStart(2,'0')}</span><div><strong>${esc(stage.name)}</strong><span>${i<index?'已结束':i===index?s.status==='paused'?'已暂停':'正在进行':'待进行'}</span></div></li>`).join('')}</ol></section>`;
}

function referencePanel(s,stage){
  const name=(s.rubric??s.profile?.trainingRubric)?.name??'沿用本场已确认的评价标准';
  const warnings=s.warnings??[],gaps=s.plan?.layers?.gaps??[];
  return `<details class="iv-reference"><summary>本场材料与面试依据 <span>查看</span></summary><div class="iv-reference-body"><p>${esc(name)}</p><p class="iv-note">${esc(stage.name)} · ${esc(s.profile?.year)} ${esc(s.profile?.admissionType)}</p><div class="iv-material-links">${(s.materials??[]).filter(m=>Object.hasOwn(materials,m.kind)).map(m=>`<a class="button secondary" href="/api/materials/${encodeURIComponent(m.id)}/file" target="_blank" rel="noopener noreferrer">查看${materials[m.kind]} ↗</a>`).join('')}</div>${gaps.length?`<p class="iv-note">${esc(gaps.join('；'))}</p>`:''}${warnings.length?`<div class="iv-session-notes"><h3>本场说明</h3>${warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</div>`:''}<p class="iv-note">内容评价与语言反馈分开；面试结束后查看完整复盘。</p></div></details>`;
}

export function renderInterview(s,{config={},answerDraft='',speechConsent=false,camera=false,voiceState={phase:'ready'},imagePath}={}){
  const stages=s.profile?.stages??[],stage=stages[s.stageIndex??0]??{},persona=personas[stage.id]??personas.design;
  const turns=s.turns??[],last=turns.at(-1),question=[...turns].reverse().find(t=>t.role==='interviewer');
  const answered=last?.role==='candidate',paused=s.status==='paused',phase=paused?'paused':voiceState.phase??'ready';
  const supported=voiceState.recognitionSupported!==false,interim=voiceState.interimText??'',draft=String(answerDraft??''),overLimit=draft.length>20000;
  const finalText=hasText(interim)&&typeof voiceState.finalText==='string'?voiceState.finalText:draft;
  const safeImage=imagePath===undefined?persona.image:[...Object.values(personas).map(p=>p.image),'/assets/examiner.webp'].includes(imagePath)?imagePath:'/assets/examiner.webp';
  const canComplete=!paused&&!overLimit&&!['speaking','connecting','processing','finishing'].includes(phase)&&(hasText(draft)||hasText(interim));
  const isListening=phase==='listening',isBusy=['speaking','connecting','processing','finishing'].includes(phase),showStart=!['speaking','connecting','listening','confirm','processing','finishing'].includes(phase);
  const nextHint=s.stageIndex<stages.length-1?'确认后保存回答，进入下一环节。':'确认后保存回答，生成本场复盘。';
  return `<div class="iv-experience" id="interview-experience" data-voice-phase="${esc(phase)}">
    ${stageRail(s)}
    <div class="iv-stage-layout"><div class="iv-examiner-column">
      <section class="iv-scene iv-single-image iv-persona-${Object.hasOwn(personas,stage.id)?stage.id:'design'}" id="interview-scene" data-voice-phase="${esc(phase)}" aria-label="${esc(persona.name)}虚拟练习场景">
        <div class="iv-photo-frame"><img class="iv-portrait" src="${safeImage}" alt="虚构的${esc(persona.name)}形象" width="421" height="237" fetchpriority="high"><div class="iv-scene-top"><span class="iv-virtual-badge">虚拟考官 · ${esc(stage.name)}</span><span class="iv-presence"><i aria-hidden="true"></i><span id="voice-state-label">${phaseLabel(phase,paused)}</span></span></div></div>
        <div class="iv-scene-footer"><div class="iv-examiner-identity"><h3>${persona.name}</h3><p>${persona.focus}</p></div><div class="iv-sound-bars" aria-hidden="true">${Array.from({length:5},()=>'<i></i>').join('')}</div></div>
      </section>
      <div class="iv-scene-controls"><button type="button" class="secondary" data-action="voice-repeat" id="voice-repeat" ${paused||!question||phase==='finishing'?'disabled':''}><span aria-hidden="true">↻</span> 重复问题</button><button type="button" class="secondary" data-control="${paused?'resume':'pause'}">${paused?'继续面试':'暂停面试'}</button><button type="button" class="ghost iv-camera-control" data-action="camera">${camera?'关闭我的画面':'开启我的画面'}</button><button type="button" class="ghost iv-end-control" data-control="finish">结束面试</button></div>
      ${referencePanel(s,stage)}
    </div>
    <section class="iv-conversation" aria-label="当前面试对话"><div class="iv-question-card"><div class="iv-conversation-heading"><span class="iv-kicker">考官提问</span><span>${stage.language?.startsWith('en')?'ENGLISH':'中文'}</span></div><p class="iv-current-question" lang="${stage.language?.startsWith('en')?'en':'zh-CN'}">${esc(question?.content??'正在准备本题问题…')}</p></div>
      ${compactInterviewProgress(s)}
      ${answered?`<div class="iv-answer-saved"><span class="iv-save-check" aria-hidden="true">✓</span><h3>${last.skipped?'本题已跳过':'回答已保存'}</h3><p>${last.skipped?'你可以继续下一环节，或在本环节追加练习。':'本题内容已记录。继续对话，完整评价将在面试后呈现。'}</p><div class="iv-recovery-actions"><button type="button" class="primary" data-control="${s.stageIndex<stages.length-1?'next':'finish'}" ${paused?'disabled':''}>${s.stageIndex<stages.length-1?'进入下一环节 →':'结束并查看复盘'}</button><button type="button" class="secondary" data-control="followup" ${paused?'disabled':''}>本环节追加追问</button></div></div>`:`<form id="answer-form" class="iv-answer-form"><div class="iv-response-heading"><h3>你的回答</h3><span class="iv-listening-state" id="speech-status" role="status">${isListening?'实时转写中':isBusy?phaseLabel(phase,false):supported?'以语音自然回答，文字辅助可随时补充':'当前浏览器不支持语音转写，请使用文字辅助'}</span></div>
      <div class="iv-live-transcript ${hasText(draft)||hasText(interim)?'has-content':''}" id="voice-transcript" aria-label="语音回答实时转写"><span class="iv-transcript-placeholder" id="voice-placeholder" ${hasText(draft)||hasText(interim)?'hidden':''}>${isListening?'正在听，请开始你的回答…':'考官提问后，在这里看见你的回答。'}</span><span id="voice-final">${esc(finalText)}</span><span id="voice-interim" class="iv-interim">${esc(interim)}</span><span class="iv-transcript-caret" aria-hidden="true"></span></div>
      <div class="iv-voice-actions"><button type="button" class="primary" data-action="${hasText(draft)?'voice-toggle':'voice-start'}" id="voice-start" ${!showStart?'hidden':''} ${paused||!supported?'disabled':''}>${hasText(draft)?'继续语音回答':'开启语音面试'}</button><button type="button" class="secondary" data-action="voice-toggle" id="voice-toggle" ${showStart?'hidden':''} ${paused||['speaking','confirm','processing','finishing'].includes(phase)||!supported?'disabled':''}>${isListening?'暂停收音':phase==='connecting'?'取消连接':'继续语音回答'}</button><button type="button" class="primary iv-answer-complete" data-action="voice-complete" id="voice-complete" ${!canComplete?'disabled':''}>回答完毕 <span aria-hidden="true">→</span></button></div>
      <p class="iv-draft-limit" id="voice-draft-limit" role="alert" ${overLimit?'':'hidden'}>回答已超过 20,000 字，内容已完整保留。请在文字辅助中精简后提交。</p>
      <p class="iv-complete-hint">${nextHint}长时间停顿时，会先询问你是否结束。</p>
      <label class="iv-speech-consent"><input id="speech-consent" type="checkbox" ${speechConsent?'checked':''} ${paused?'disabled':''}><span>启用实时语音转写<span>音频可能由浏览器语音服务商处理。</span></span></label>
      <details class="iv-text-assist" id="text-assist" data-text-assist ${!supported||overLimit?'open':''}><summary>文字辅助 <span>查看或修正转写</span></summary><label class="field"><span>补充或修正你的回答</span><textarea class="answer-box" name="answer" id="answer-text" maxlength="20000" aria-describedby="voice-draft-limit" ${paused?'disabled':''} placeholder="可在这里修正转写，或在语音不可用时输入回答。">${esc(draft)}</textarea></label><div class="iv-text-actions"><button type="submit" class="secondary" data-voice-lock ${paused||overLimit||['processing','finishing'].includes(phase)?'disabled':''}>保存文字并继续 →</button><button type="button" class="ghost" data-control="skip" data-voice-lock ${paused||['processing','finishing'].includes(phase)?'disabled':''}>跳过本题</button></div></details>
      </form>`}
      <details class="iv-history"><summary>本场对话记录 <span>${turns.filter(t=>t.role==='candidate').length} 次回应</span></summary><div class="iv-history-turns">${turns.map(t=>`<article class="iv-history-turn ${t.role==='candidate'?'is-candidate':''}"><span>${t.role==='candidate'?'你':'考官'} · ${esc(stages.find(st=>st.id===t.stageId)?.name??config.stages?.find(st=>st.id===t.stageId)?.name??'面试对话')}</span><p>${esc(t.skipped?'本题已跳过。':t.content)}</p></article>`).join('')}</div></details>
    </section></div></div>`;
}

// Update the voice chrome without replacing the form or moving the text cursor.
export function updateInterviewVoice(root,state={}, {speechConsent=false,paused=false}={}){
  const phase=paused?'paused':state.phase??'ready',supported=state.recognitionSupported!==false;
  if(root.id==='interview-experience')root.dataset.voicePhase=phase;
  for(const node of root.querySelectorAll('#interview-experience,#interview-scene'))node.dataset.voicePhase=phase;
  const label=root.querySelector('#voice-state-label');if(label)label.textContent=phaseLabel(phase,paused);
  const status=root.querySelector('#speech-status');if(status)status.textContent=state.message|| (phase==='listening'?'实时转写中':phase==='speaking'?'请听考官提问':!supported?'当前浏览器不支持语音转写，请使用文字辅助':phaseLabel(phase,paused));
  const speaking=phase==='speaking',connecting=phase==='connecting',confirming=phase==='confirm',finishing=phase==='finishing'||phase==='processing',listening=phase==='listening';
  const draft=root.querySelector('#answer-form textarea')?.value??state.finalText??'',hasAnswer=hasText(draft)||hasText(state.interimText),overLimit=draft.length>20000,showStart=!['speaking','connecting','listening','confirm','processing','finishing'].includes(phase);
  const start=root.querySelector('#voice-start');if(start){start.hidden=!showStart;start.disabled=paused||!supported;start.textContent=hasText(draft)?'继续语音回答':'开启语音面试';if(start.dataset)start.dataset.action=hasText(draft)?'voice-toggle':'voice-start';}
  const toggle=root.querySelector('#voice-toggle');if(toggle){toggle.hidden=showStart;toggle.disabled=paused||speaking||confirming||finishing||!supported;toggle.textContent=listening?'暂停收音':connecting?'取消连接':'继续语音回答';}
  const complete=root.querySelector('#voice-complete');if(complete)complete.disabled=paused||speaking||connecting||finishing||overLimit||!hasAnswer;
  const repeat=root.querySelector('#voice-repeat');if(repeat)repeat.disabled=paused||finishing;
  const placeholder=root.querySelector('#voice-placeholder');if(placeholder){placeholder.hidden=hasAnswer;placeholder.textContent=listening?'正在听，请开始你的回答…':'考官提问后，在这里看见你的回答。';}
  const transcript=root.querySelector('#voice-transcript');if(transcript)transcript.classList.toggle('has-content',hasAnswer);
  const consent=root.querySelector('#speech-consent');if(consent){consent.checked=speechConsent;consent.disabled=paused;}
  const limit=root.querySelector('#voice-draft-limit');if(limit)limit.hidden=!overLimit;
  for(const button of root.querySelectorAll('[data-voice-lock]'))button.disabled=paused||finishing||(button.type==='submit'&&overLimit);
  if(!supported||overLimit){const assist=root.querySelector('#text-assist');if(assist)assist.open=true;}
}
