import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAuxiliaryScores,auxiliaryMarkdown,summarizeAuxiliaryCaptures} from '../public/multimodal/auxiliary-scores.js';
import {buildInterviewReport} from '../public/multimodal/interview-report.js';
const metrics=()=>({duration_ms:200000,hands:{visible_ms:100000,movement_ms:25000,coverage:.5},posture:{calibrated:true,calibrated_ms:200000,deviation_ms:50000,calibrated_coverage:1,median_tilt_deg:5,p95_tilt_deg:20}});

test('活动与偏离指数只描述时间比例，不生成专业或情绪分',()=>{
  const result=buildAuxiliaryScores(metrics());assert.equal(result.items[0].value,25);assert.equal(result.items[1].value,25);
  assert.equal(result.items[0].status,'measured');assert.ok(result.items.every(i=>i.performance_score===null));
  const changed=metrics();changed.hands.movement_ms=75000;
  assert.equal(buildAuxiliaryScores(changed).items[0].value,75);
  assert.equal(buildAuxiliaryScores(changed).items[1].value,25);
});
test('低覆盖仍可显示局部测量，但不能概括整场；高角度提示核查而非扣分',()=>{
  const input=metrics();input.hands={visible_ms:9545.8,movement_ms:4950.8,coverage:.0471045584};
  input.posture={calibrated:true,calibrated_ms:202638.4,deviation_ms:194820.4,calibrated_coverage:.9999,median_tilt_deg:90.9,p95_tilt_deg:120.3};
  const scores=buildAuxiliaryScores(input).items;
  assert.equal(scores[0].value,51.9);assert.equal(scores[0].status,'limited_sample');
  assert.equal(scores[1].value,96.1);assert.equal(scores[1].status,'review_signal');
  assert.equal(scores[1].performance_score,null);assert.equal(scores[2].value,null);
});
test('零活动和无数据分开，未校准、非有限值和非法比例不能产生分数',()=>{
  const input=metrics();input.hands.movement_ms=0;input.posture.deviation_ms=0;
  const result=buildAuxiliaryScores(input);assert.equal(result.items[0].value,0);assert.equal(result.items[1].value,0);
  for(const hands of [{visible_ms:0,movement_ms:0},{visible_ms:100,movement_ms:200},{visible_ms:NaN,movement_ms:10},{visible_ms:100,movement_ms:-1}])assert.equal(buildAuxiliaryScores({...input,hands}).items[0].value,null);
  assert.equal(buildAuxiliaryScores({...input,posture:{...input.posture,calibrated:false}}).items[1].value,null);
});
test('历史回看、保存摘要和导出使用同一套规则，不要求同伴确认',()=>{
  const report=buildInterviewReport({id:'test',source:{type:'camera'},duration_ms:20000,frames:[],events:[]});
  const text=auxiliaryMarkdown(report.auxiliary_scores);assert.match(text,/语音语气/);assert.match(text,/未评价/);
  assert.ok(!report.next_steps.some(i=>i.detail.includes('同伴')));
  assert.equal(summarizeAuxiliaryCaptures([{id:'capture',duration_ms:20000,analysis:report}]).captures[0].scores.version,report.auxiliary_scores.version);
  assert.ok(report.references.some(r=>r.id==='prosody-2026'));
});

test('活动充分可见时才提示减少无关动作，低覆盖先改善取景',()=>{
  const input=metrics();input.hands.movement_ms=60000;
  let hand=buildAuxiliaryScores(input).items[0];
  assert.match(hand.advice.title,/减少.*重复手部动作/);assert.match(hand.advice.detail,/先回看是否/);
  input.hands.coverage=.1;hand=buildAuxiliaryScores(input).items[0];
  assert.equal(hand.advice.type,'采集优先');assert.doesNotMatch(hand.advice.title,/减少/);
  input.hands.coverage=.8;input.hands.movement_ms=0;
  assert.match(buildAuxiliaryScores(input).items[0].advice.title,/配合步骤/);
});

test('疑似设备旋转优先校准，可靠偏离再提示减少无关晃动；语音缺失只给通用练习',()=>{
  const input=metrics();input.posture.deviation_ms=180000;
  let scores=buildAuxiliaryScores(input).items;
  assert.match(scores[1].advice.title,/减少.*身体晃动/);
  input.posture.p95_tilt_deg=150;scores=buildAuxiliaryScores(input).items;
  assert.equal(scores[1].advice.type,'校准优先');assert.match(scores[1].advice.detail,/佩戴确认后/);
  assert.equal(scores[2].value,null);assert.equal(scores[2].advice.type,'通用练习');
  assert.match(scores[2].advice.detail,/不代表本场语气存在问题/);
  assert.match(auxiliaryMarkdown(buildAuxiliaryScores(input)),/下一轮/);
});
