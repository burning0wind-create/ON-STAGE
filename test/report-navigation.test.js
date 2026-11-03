import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewGroups,stageReviewId,revealReviewTarget,captureReportReading,restoreReportReading} from '../public/report-navigation.js';
import {reportDashboard} from '../public/report-visuals.js';
import {renderAnswerReview} from '../public/answer-review.js';

const session=()=>({profile:{stages:[{id:'english'},{id:'portfolio'},{id:'design'}]},turns:[
 {id:'q1',role:'interviewer',stageId:'english',content:'Introduce yourself.'},
 {id:'a1',questionId:'q1',role:'candidate',stageId:'english',content:'My answer',scoring:{status:'pending'}},
 {id:'a2',role:'candidate',stageId:'portfolio',content:'作品回答'},
 {id:'a3',role:'candidate',stageId:'english',skipped:true}
],report:{dimensions:[],performance:{stages:[{id:'english',score:null,weight:20},{id:'portfolio',score:44.2,weight:40},{id:'design',score:null,weight:30}]}}});

test('环节整行与对应回看组关联，多题和已跳过题均可定位，空环节不创建无效入口',()=>{
 const s=session(),dashboard=reportDashboard(s),review=renderAnswerReview(s);
 assert.deepEqual(reviewGroups(s).map(g=>[g.id,g.answers.map(a=>a.id)]),[['english',['a1','a3']],['portfolio',['a2']]]);
 assert.match(dashboard,/data-jump-stage="english" aria-controls="review-stage-english"/);
 assert.match(dashboard,/回看 2 题/);assert.match(dashboard,/data-jump-stage="design" disabled/);
 assert.match(review,/id="review-stage-english"/);assert.match(review,/aria-controls="answer-a3"/);
 assert.match(review,/id="back-review-stage-english" data-jump-overview/);assert.match(review,/id="answer-a1"/);assert.match(review,/id="review-link-a1"/);
 assert.match(review,/Introduce yourself\./);assert.match(review,/回答已保存/);
 assert.doesNotMatch(dashboard+review,/href="#review-stage|aria-valuenow="0"/);
 assert.equal((review.match(/class="answer-record"/g)||[]).length,3);
});

test('自定义环节、题目特殊字符保持转义，稳定ID不需要CSS选择器',()=>{
 const s={turns:[{id:'a"<1>',role:'candidate',stageId:'custom "<>/a',content:'<img onerror=alert(1)>'}]};
 const html=renderAnswerReview(s);assert.match(html,/custom%20%22%3C%3E%2Fa/);assert.doesNotMatch(html,/<img|onerror=alert\(1\)>/);
 assert.match(html,/id="answer-a&quot;&lt;1&gt;"/);assert.equal(reviewGroups(s).length,1);
 assert.equal(stageReviewId('自定义/环节'),'review-stage-'+encodeURIComponent('自定义/环节'));
});

test('跳转展开所有祖先、移动键盘焦点并从题目顶部滚动，减少动态偏好即时定位',()=>{
 const outer={tagName:'DETAILS',open:false,parentElement:null},inner={tagName:'DETAILS',open:false,parentElement:outer};
 const classes=new Set(),calls=[],target={parentElement:inner,hasAttribute:()=>false,setAttribute:(...x)=>calls.push(['attr',...x]),focus:x=>calls.push(['focus',x]),scrollIntoView:x=>calls.push(['scroll',x]),classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}};
 let cleanup;
 assert.equal(revealReviewTarget(target,{reducedMotion:true,schedule:fn=>cleanup=fn}),true);
 assert.equal(inner.open,true);assert.equal(outer.open,true);assert.deepEqual(calls,[['attr','tabindex','-1'],['focus',{preventScroll:true}],['scroll',{block:'start',behavior:'instant'}]]);
 assert.ok(classes.has('answer-highlight'));cleanup();assert.ok(!classes.has('answer-highlight'));assert.equal(revealReviewTarget(null),false);
});

test('后台刷新保留逐题展开状态、摘要焦点和当前阅读位置',()=>{
 const answer={id:'answer-a1',getBoundingClientRect:()=>({top:-120,bottom:600})};
 const summary={tagName:'SUMMARY',focus:x=>summary.focused=x};
 const details={open:true,dataset:{reviewDetail:'feedback-full'},closest:()=>answer,querySelector:()=>summary};summary.parentElement=details;
 const scrolls=[],doc={activeElement:summary,getElementById:id=>id==='answer-a1'?answer:null,defaultView:{scrollBy:x=>scrolls.push(x)}};
 const root={ownerDocument:doc,contains:()=>true,querySelectorAll:selector=>selector==='details'?[details]:[answer]};
 const state=captureReportReading(root);details.open=false;answer.getBoundingClientRect=()=>({top:-80,bottom:640});
 restoreReportReading(root,state);assert.equal(details.open,true);assert.deepEqual(summary.focused,{preventScroll:true});assert.deepEqual(scrolls,[{top:40,behavior:'instant'}]);
 const button={id:'review-link-a1',focus:x=>button.focused=x};doc.activeElement=button;doc.getElementById=id=>id==='review-link-a1'?button:answer;
 const focusedButton=captureReportReading(root);restoreReportReading(root,focusedButton);assert.deepEqual(button.focused,{preventScroll:true});
});
