import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAnswerFeedback} from '../public/answer-feedback.js';

const dimension=(id,score=3,patch={})=>({id,name:'维度'+id,status:'observed',score,quote:'我访谈了三位用户。',reason:'说明了方法，但没有交代样本选择。',limitation:'仅依据本题转写判断，尚未核对研究记录。',nextProbe:'你如何选择访谈对象？',...patch});
const turn=(patch={})=>({evaluation:{mode:'llm',dimensions:[dimension('research')],languageDimensions:[dimension('clarity',4)],feedback:'专业方面：说明了研究对象。主要缺口是样本选择理由尚未展开。语言方面：表达清楚，术语基本准确。',...patch}});

test('layered feedback separates professional and language summaries and surfaces the saved gap',()=>{
  const html=renderAnswerFeedback(turn());
  assert.match(html,/af-summary-professional/);assert.match(html,/af-summary-language/);
  assert.match(html,/<aside class="af-issue">/);assert.match(html,/主要缺口是样本选择理由尚未展开/);
  assert.match(html,/为什么这样判断/);assert.match(html,/核对回答依据/);assert.match(html,/下一步要说清楚/);assert.match(html,/评价边界/);
});

test('priority order comes from saved numeric scores and never treats an unscored item as a weakness',()=>{
  const html=renderAnswerFeedback(turn({dimensions:[dimension('high',5),dimension('low',2,{improvement:'交代抽样条件。'}),dimension('missing',null,{status:'not_assessed'})],languageDimensions:[]}));
  const first=html.indexOf('af-dimension-priority'),remaining=html.indexOf('af-dimension-details');
  assert.ok(html.indexOf('维度low',first)<html.indexOf('维度high',first));
  assert.ok(html.indexOf('维度missing')>remaining);assert.match(html,/下一步怎么补/);
  assert.match(html,/没有可用分数/);assert.doesNotMatch(html,/0<small> \/ 5/);
});

test('pending and demo records show status without presenting saved text as completed judgment',()=>{
  for(const mode of ['unavailable','demo']){
    const html=renderAnswerFeedback(turn({mode,dimensions:[],languageDimensions:[]}));
    assert.match(html,/af-state/);assert.doesNotMatch(html,/class="af-issue"|af-dimension-priority|af-summary-professional/);
    assert.match(html,/查看原始评价全文/);
  }
});

test('partial results retain valid judgments while marking pending dimension distinctly',()=>{
  const input=turn({dimensions:[dimension('done',3),dimension('pending',null,{status:'not_assessed',gradingStatus:'pending'})],languageDimensions:[]});input.scoring={status:'partial'};
  const html=renderAnswerFeedback(input);assert.match(html,/仍有评分项待补评/);assert.match(html,/待补评/);assert.match(html,/维度done/);assert.match(html,/1 项没有可用分数/);
});

test('semicolon gap clause is shown once outside the professional summary',()=>{
  const html=renderAnswerFeedback(turn({feedback:'专业方面：研究方法交代清楚，能够说明决策；主要缺口是样本选择理由尚未展开。语言方面：表达清楚。'}));
  const issue=html.match(/<aside class="af-issue">(.*?)<\/aside>/s)?.[1];assert.match(issue,/主要缺口/);assert.doesNotMatch(issue,/研究方法交代清楚/);
  const summary=html.match(/af-summary-professional">(.*?)<\/section>/s)?.[1];assert.match(summary,/研究方法交代清楚/);assert.doesNotMatch(summary,/主要缺口/);
});

test('aggregate pending flag is also rendered as pending rather than a low score',()=>{
  const html=renderAnswerFeedback(turn({dimensions:[dimension('waiting',3,{scoringPending:true})],languageDimensions:[]}));
  assert.match(html,/仍有评分项待补评/);assert.match(html,/af-dimension-score">待补评/);assert.doesNotMatch(html,/af-dimension-priority/);
});

test('high scores keep visible limits without relabeling them as low ability',()=>{
  const html=renderAnswerFeedback(turn({dimensions:[dimension('strong',5)],languageDimensions:[],feedback:'内容有依据，能够说明决策。'}));
  assert.match(html,/af-dimension-priority/);assert.match(html,/<h6>评价边界<\/h6><p>仅依据本题转写判断/);
  assert.doesNotMatch(html,/class="af-issue"|严重|能力不足/);
});

test('feedback, object content and attributes are escaped',()=>{
  const html=renderAnswerFeedback(turn({dimensions:[dimension('unsafe',3,{name:'<img src=x>',reason:{text:'<script>alert(1)</script>'},quote:'<svg onload="x">',improvement:{suggestion:'<b>修复</b>'}})],languageDimensions:[],feedback:{content:'<script>bad</script>'}}));
  assert.doesNotMatch(html,/<(?:script|img|svg|b)\b/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;b&gt;修复&lt;\/b&gt;/);assert.doesNotMatch(html,/\[object Object\]/);
});

test('detail restore keys are stable and unique within one answer',()=>{
  const input=turn({dimensions:[dimension('a'),dimension('b'),dimension('c')],languageDimensions:[dimension('a')],improvedAnswer:'用“证据—判断—验证”组织已有经历。',exercise:'补充一条抽样依据。'});
  const html=renderAnswerFeedback(input),keys=[...html.matchAll(/data-review-detail="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(keys.length,new Set(keys).size);assert.equal([...html.matchAll(/<details\b/g)].length,keys.length);
  assert.match(html,/data-review-detail="feedback-coaching"/);assert.match(html,/不是新增的个人经历或评分证据/);
  assert.deepEqual(keys,[...renderAnswerFeedback(input).matchAll(/data-review-detail="([^"]+)"/g)].map(m=>m[1]));
});

test('skipped and empty answers do not generate judgments',()=>{
  assert.match(renderAnswerFeedback({skipped:true}),/本题已跳过/);assert.doesNotMatch(renderAnswerFeedback({skipped:true}),/af-issue|af-priorities/);
  assert.match(renderAnswerFeedback(),/暂无已保存的评价内容/);
});
