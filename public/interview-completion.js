// Save first, then advance. A transition failure must never submit an answer twice.
export async function completeInterviewAnswer({session,answer,inputMode='text',durationMs=0,finish=false},{post,onSaved=()=>{}}){
  const question=session?.turns?.at(-1),text=String(answer??'').trim();
  if(session?.status!=='active'||question?.role!=='interviewer')throw new Error('当前没有可提交的问题，请先恢复面试。');
  if(!text)throw new Error('还没有识别到回答。请继续说话，或使用文字辅助补充。');
  if(text.length>20000)throw new Error('本题回答超过 20000 字，请在文字辅助中精简后提交。');
  const saved=await post(`/api/sessions/${session.id}/answer`,{answer:text,questionId:question.id,inputMode,durationMs});
  onSaved(saved);
  const action=finish||saved.stageIndex>=saved.profile.stages.length-1?'finish':'next';
  try{return await post(`/api/sessions/${saved.id}/action`,{action});}
  catch(error){throw new Error('本题回答已保存，'+(action==='finish'?'生成复盘':'切换环节')+'暂未完成。请点击继续操作，无需重新回答。',{cause:error});}
}
