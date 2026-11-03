import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {scoreRing,radarChart,reportDashboard} from '../public/report-visuals.js';
import {scoringPanel} from '../public/scoring-ui.js';
test('总分圆环保留真实小数、无分数状态和有效SVG范围',()=>{
 assert.match(scoreRing(71.3),/stroke-dasharray="71.3 100"/);assert.match(scoreRing(71.3),/>71.3<\/strong>/);
 assert.match(scoreRing(null),/暂无评分/);assert.doesNotMatch(scoreRing(null),/>0<\/strong>/);assert.doesNotMatch(scoreRing(NaN),/NaN/);
});
test('雷达图缺项不会用零分补成面积，完整数据才连接画像',()=>{
 const dims=Array.from({length:6},(_,i)=>({name:'能力'+i,score:3}));assert.match(radarChart(dims),/class="radar-area"/);
 dims[2].score=null;const partial=radarChart(dims);assert.doesNotMatch(partial,/class="radar-area"/);assert.match(partial,/空缺项不按0分绘制/);assert.match(partial,/能力2：未评分/);
 assert.doesNotMatch(radarChart([]),/NaN|undefined/);
});
test('成绩总览不捏造环节分或历史进步，未评分环节保持待评分',()=>{
 const s={turns:[{role:'candidate'}],report:{trainingTotal:71.3,dimensions:[{name:'逻辑',score:3}],performance:{completed:0,pending:1,scoredStageWeight:0,totalStageWeight:100,stages:[{id:'english',name:'英语',weight:20,score:null}]}}};
 const html=reportDashboard(s);assert.match(html,/71.3/);assert.match(html,/部分评分/);assert.match(html,/未取得评分，不记零分/);assert.doesNotMatch(html,/aria-valuenow="0"|进步|击败|排名/);
 assert.match(reportDashboard({report:{dimensions:[]}}),/历史报告没有独立的环节分/);
});
test('进度按完成题数表达，部分完成和运行中不被计入已完成',()=>{
 const turns=['complete','complete','partial','running'].map((status,i)=>({id:String(i),role:'candidate',stageId:'design',scoring:{status}}));const html=scoringPanel({turns});
 assert.match(html,/stroke-dasharray="50 100"/);assert.match(html,/aria-valuenow="2"/);assert.match(html,/answer-progress-segment running/);assert.match(html,/专业问答/);assert.match(html,/查看逐题状态与诊断/);
 turns.push({role:'candidate',skipped:true});assert.match(scoringPanel({turns}),/aria-valuemax="4"/);
 assert.match(scoringPanel({turns:[]}),/等待作答/);assert.doesNotMatch(scoringPanel({turns:[]}),/✓ 专业评分已完成|NaN/);
});
test('面试中仅展示评分进度，分数和诊断表留在复盘界面',()=>{
 const s={turns:[{id:'a',role:'candidate',stageId:'english',scoring:{status:'complete'}}],report:{performance:{questions:[{responseId:'a',score:73.6,status:'complete'}]}}};
 assert.doesNotMatch(scoringPanel(s,true),/73.6|<table/);assert.match(scoringPanel(s),/73.6/);
});
test('图表文本保持转义，准备导航包含可访问的折叠关联且保留原路由',()=>{
 assert.doesNotMatch(radarChart([{name:'<script>alert(1)</script>',score:3}]),/<script>/);
 const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');assert.match(index,/aria-controls="prep-links"/);assert.match(index,/id="prep-links" class="prep-links" hidden/);assert.match(index,/面试准备/);for(const route of ['setup','devices','exam-library','sources','interview','reports'])assert.match(index,new RegExp('href="#'+route+'"'));
});
