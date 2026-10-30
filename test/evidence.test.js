import test from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE_STATUSES,validateEvidenceEvaluation,aggregateEvidence } from '../src/evidence.js';

const professional=['logic','knowledge','evidence','decision','reflection','ethics'];
const language=['clarity','structure','terminology'];
function rubric() {
  return {id:'interaction',version:'onstage-evidence-v1',criticalDimensions:['logic','evidence','decision'],dimensions:professional.map((id,i)=>({id,name:id,weight:[20,15,25,20,10,10][i],critical:['logic','evidence','decision'].includes(id),criterion:'用实际回答解释设计依据',stages:['portfolio','design','ethics'],nextProbe:'请补充研究依据。'})),languageDimensions:language.map(id=>({id,name:id,criterion:'根据文字评价表达',stages:['portfolio','design','ethics','english'],nextProbe:'请用更准确的术语重述。'}))};
}
const answer='我对 6 位首次到访者进行了访谈，再用可用性测试验证信息层级。';
const question={id:'q-1',responseId:'a-1',stageId:'portfolio',content:'你依据什么调整导航层级？'};
function item(id,options={}) {
  return {id,status:'observed',score:3,quote:'我对 6 位首次到访者进行了访谈',reason:'明确了研究对象与方法。',limitation:'这是自述，尚未提供原始访谈记录。',nextProbe:'哪些访谈发现改变了层级？',improvement:'补充具体发现与设计决策的联系。',...options};
}
function data(options={}) {return {dimensions:professional.map(id=>item(id)),languageDimensions:language.map(id=>item(id)),feedback:'研究过程有基本依据，请补充验证细节。',followup:'哪些访谈发现改变了层级？',improvedAnswer:'可按“问题—证据—决策—验证”重组已有内容，不增加经历。',exercise:'用 90 秒讲清一条证据如何改变设计。',...options};}
function validated(overrides={},text=answer,q=question,r=rubric()) {return validateEvidenceEvaluation(data(overrides),text,q,r);}
function session(evaluations=[validated()]) {
  return {profile:{},turns:evaluations.flatMap((evaluation,i)=>[{id:`q-${i+1}`,role:'interviewer',stageId:'portfolio',content:'说明研究依据。'},{id:`a-${i+1}`,questionId:`q-${i+1}`,role:'candidate',stageId:'portfolio',content:answer,evaluation}]),sensors:[]};
}

test('评分与证据定位绑定，专业和表达保持独立分组',()=>{
  const evaluation=validated();
  assert.equal(evaluation.dimensions.length,6);assert.equal(evaluation.languageDimensions.length,3);
  const record=evaluation.dimensions[0];assert.equal(record.responseId,'a-1');assert.equal(record.questionId,'q-1');assert.equal(record.group,'professional');assert.equal(record.quality,record.reason);assert.ok(record.limitation);assert.ok(record.nextProbe);
  assert.equal(evaluation.languageDimensions[0].group,'language');
});
test('评分输入必须关联实际回答与面试环节',()=>{
  assert.throws(()=>validated({},answer,{...question,responseId:undefined}),/关联/);
  assert.throws(()=>validated({},answer,{...question,stageId:''}),/关联/);
});
test('伪造引文、缺失证据边界或追问、无效分数和重复维度被拒绝',()=>{
  for(const patch of [{quote:'不存在于学生回答的内容'},{quote:''},{reason:''},{limitation:''},{nextProbe:''},{score:NaN},{score:6},{status:'confident'}]){
    const input=data();input.dimensions[0]=item('logic',patch);assert.throws(()=>validateEvidenceEvaluation(input,answer,question,rubric()));
  }
  const duplicate=data();duplicate.dimensions[1]=item('logic');assert.throws(()=>validateEvidenceEvaluation(duplicate,answer,question,rubric()),/重复/);
});
test('错误回答属于已观察的质量判断，不冒充缺少证据',()=>{
  const input=data();input.dimensions[1]=item('knowledge',{score:1,finding:'incorrect',reason:'回答把研究方法的作用混淆了。'});
  const result=validateEvidenceEvaluation(input,answer,question,rubric());assert.equal(result.dimensions[1].status,'observed');assert.equal(result.dimensions[1].finding,'incorrect');assert.equal(result.dimensions[1].score,1);
});
test('证据状态显式区分：未考察、跳过与不足均不允许记分',()=>{
  assert.equal(EVIDENCE_STATUSES.length,5);
  for(const status of ['not_assessed','skipped','insufficient_evidence']){
    const input=data();input.dimensions[0]=item('logic',{status,score:null,quote:''});
    assert.equal(validateEvidenceEvaluation(input,answer,question,rubric()).dimensions[0].score,null);
    input.dimensions[0].score=1;assert.throws(()=>validateEvidenceEvaluation(input,answer,question,rubric()),/不能评分/);
  }
});
test('已观察和部分观察不能携带空分，避免覆盖率与质量不一致',()=>{
  for(const status of ['observed','partly_observed']){
    const input=data();input.dimensions[0]=item('logic',{status,score:null});
    assert.throws(()=>validateEvidenceEvaluation(input,answer,question,rubric()),/质量分/);
  }
});
test('英语自述不强评未适用的专业能力，文字也不被当成发音证据',()=>{
  const input=data({dimensions:professional.map(id=>item(id,{status:'not_assessed',score:null,quote:'',reason:'英语自述未考察该专业能力。'}))});
  const result=validateEvidenceEvaluation(input,answer,{...question,stageId:'english'},rubric());assert.ok(result.dimensions.every(d=>d.score===null));assert.ok(result.languageDimensions.every(d=>d.score===3));
  input.dimensions[5]=item('ethics');assert.throws(()=>validateEvidenceEvaluation(input,answer,{...question,stageId:'english'},rubric()),/不适用/);
});
test('关键维度只有部分观察时只显示分项，不生成完整总分',()=>{
  const input=data();input.dimensions[2]=item('evidence',{status:'partly_observed'});
  const report=aggregateEvidence(session([validateEvidenceEvaluation(input,answer,question,rubric())]),rubric());
  assert.equal(report.trainingTotal,null);assert.equal(report.assessmentStatus,'partial');assert.equal(report.coverage.assessed,5);assert.equal(report.coverage.partial,1);assert.deepEqual(report.coverage.criticalMissing.map(d=>d.id),['evidence']);assert.ok(report.nextProbes.some(p=>p.dimensionId==='evidence'));assert.equal(report.dimensions.find(d=>d.id==='evidence').score,3);
});
test('同一原文重复作答不增加独立证据，也不通过重复高分提高结果',()=>{
  const first=validated();const second=data({dimensions:professional.map(id=>item(id,{score:5})),languageDimensions:language.map(id=>item(id,{score:5}))});
  const record=validateEvidenceEvaluation(second,answer,{...question,id:'q-2',responseId:'a-2'},rubric());
  const report=aggregateEvidence(session([first,record]),rubric());
  assert.equal(report.trainingTotal,60);assert.equal(report.dimensions[0].independentEvidenceCount,1);assert.equal(report.dimensions[0].duplicateEvidenceCount,1);assert.equal(report.evidenceLedger.find(e=>e.responseId==='a-2'&&e.dimensionId==='logic').duplicateOf,'evidence-a-1-professional-logic');
  assert.equal(report.coverage.answered,2);assert.equal(report.evidenceLedger.find(e=>e.responseId==='a-2').questionId,'q-2');
});
test('已充分观察后出现独立的部分观察低分，不会被聚合静默排除',()=>{
  const s=session();const weakAnswer='我目前还没有验证这个设计判断。';
  const weak=data({dimensions:professional.map(id=>item(id,{status:'partly_observed',score:1,quote:weakAnswer,reason:'补充回答承认验证依据不足。'})),languageDimensions:language.map(id=>item(id,{status:'partly_observed',score:1,quote:weakAnswer}))});
  s.turns.push({id:'q-2',role:'interviewer',stageId:'portfolio',content:'你已经完成验证了吗？'},{id:'a-2',questionId:'q-2',role:'candidate',stageId:'portfolio',content:weakAnswer,evaluation:validateEvidenceEvaluation(weak,weakAnswer,{...question,id:'q-2',responseId:'a-2'},rubric())});
  const report=aggregateEvidence(s,rubric());assert.equal(report.dimensions[0].status,'observed');assert.equal(report.dimensions[0].score,2);assert.equal(report.dimensions[0].independentEvidenceCount,2);assert.equal(report.trainingTotal,40);assert.equal(report.evidenceLedger.find(e=>e.responseId==='a-2').status,'partly_observed');
});
test('规范化空白的相同引文仍视作同一证据',()=>{
  const s=session();const extraAnswer='我 对 6 位 首次到访者 进行了 访谈，再用可用性测试验证信息层级。';
  const input=data({dimensions:professional.map(id=>item(id,{score:5,quote:'我 对 6 位 首次到访者 进行了 访谈'})),languageDimensions:language.map(id=>item(id,{score:5,quote:'我 对 6 位 首次到访者 进行了 访谈'}))});
  s.turns.push({id:'q-2',role:'interviewer',stageId:'portfolio',content:'重述依据。'},{id:'a-2',questionId:'q-2',role:'candidate',stageId:'portfolio',content:extraAnswer,evaluation:validateEvidenceEvaluation(input,extraAnswer,{...question,id:'q-2',responseId:'a-2'},rubric())});
  assert.equal(aggregateEvidence(s,rubric()).trainingTotal,60);
});
test('反证引文和修正理由保留可见，虚构反证被拒绝',()=>{
  const counter={dimensionId:'evidence',quote:'再用可用性测试验证信息层级',reason:'后半句补充了计划验证方式。',correction:'不能把原先的“没有验证思路”作为最终结论，但尚未说明验证结果。'};
  const evaluation=validated({counterevidence:[counter]});assert.equal(evaluation.dimensions[2].counterevidence.length,1);
  const report=aggregateEvidence(session([evaluation]),rubric());assert.equal(report.evidenceLedger.find(e=>e.dimensionId==='evidence').counterevidence[0].correction,counter.correction);
  assert.throws(()=>validated({counterevidence:[{...counter,quote:'用户没有说过的验证数据'}]}),/逐字/);
  assert.throws(()=>validated({counterevidence:[{...counter,correction:''}]}),/修正说明/);
});
test('语言分和摄像头眼动事件不会改变专业分，辅助练习不生成独立评价总分',()=>{
  const baseline=session();const baseReport=aggregateEvidence(baseline,rubric());assert.equal(baseReport.trainingTotal,60);
  const alternative=session([validated({languageDimensions:language.map(id=>item(id,{score:5}))})]);alternative.sensors=[{channel:'gaze',value:'not_tracking'},{channel:'camera',value:'preview_on'}];
  assert.equal(aggregateEvidence(alternative,rubric()).trainingTotal,60);assert.equal(aggregateEvidence(alternative,rubric()).languageDimensions[0].score,5);
  alternative.assisted=true;const assisted=aggregateEvidence(alternative,rubric());assert.equal(assisted.trainingTotal,null);assert.equal(assisted.assessmentStatus,'assisted_practice');
});
test('跳过状态保留记录但不算回答覆盖或独立证据',()=>{
  const skipData=data({dimensions:professional.map(id=>item(id,{status:'skipped',score:null,quote:''})),languageDimensions:language.map(id=>item(id,{status:'skipped',score:null,quote:''}))});
  const evaluation=validateEvidenceEvaluation(skipData,'',question,rubric());const s=session([evaluation]);s.turns[1].content='';s.turns[1].skipped=true;
  const report=aggregateEvidence(s,rubric());assert.equal(report.coverage.answered,0);assert.equal(report.coverage.skipped,1);assert.deepEqual(report.coverage.stageIds,[]);assert.equal(report.dimensions[0].independentEvidenceCount,0);assert.equal(report.trainingTotal,null);
});
test('旧分数不被伪造升级成证据；没有真实候选人引文的分数被排除',()=>{
  const old=session([{dimensions:professional.map(id=>({id,score:5,quote:'旧引文',reason:'旧评价'}))}]);const legacy=aggregateEvidence(old,rubric());assert.equal(legacy.assessmentStatus,'legacy');assert.equal(legacy.trainingTotal,null);assert.equal(legacy.evidenceLedger.length,0);
  const tampered=session();tampered.turns[1].evaluation.dimensions[0].quote='不存在的回答片段';const report=aggregateEvidence(tampered,rubric());assert.equal(report.trainingTotal,null);assert.equal(report.coverage.assessed,5);assert.equal(report.warnings.length,1);assert.equal(report.dimensions[0].status,'insufficient_evidence');assert.equal(report.evidenceLedger[0].status,'insufficient_evidence');
});
test('跳过回答即使携带旧分数也不能增加覆盖或证据',()=>{
  const s=session();s.turns[1].skipped=true;
  const report=aggregateEvidence(s,rubric());
  assert.equal(report.trainingTotal,null);assert.equal(report.coverage.assessed,0);assert.equal(report.coverage.answered,0);
  assert.ok(report.evidenceLedger.every(r=>r.score===null&&!r.independent&&r.status==='skipped'));
});
