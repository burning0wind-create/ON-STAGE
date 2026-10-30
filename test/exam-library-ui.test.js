import test from 'node:test';
import assert from 'node:assert/strict';
import {examMatches,renderLibraryLink,renderExamLibrary} from '../public/exam-library-ui.js';
import {getExamLibrary} from '../src/exam-library.js';
import {SCHOOL_CATALOG} from '../src/catalog.js';

const library=getExamLibrary();
const hunan=library.records.find(r=>r.id==='hunan-design-2027-recommended');
const target={schoolId:'hunan',school:'湖南大学',collegeId:'hunan-design',college:'设计艺术学院',majorCode:'140300',major:'设计学',year:2027,admissionType:'推免面试'};
const rendered=(filter={},current=target)=>renderExamLibrary({library,templates:SCHOOL_CATALOG,target:current,filter});

test('只有精确匹配且可载入的官网条目启用加载按钮',()=>{
  assert.equal(examMatches(hunan,target),true);
  for(const patch of [{schoolId:'tongji'},{collegeId:'tongji-270'},{majorCode:'085400'},{year:2026},{admissionType:'研究生复试'}])assert.equal(examMatches(hunan,{...target,...patch}),false);
  assert.equal(examMatches({...hunan,verification:'source_pending'},target),false);
  assert.equal(examMatches({...hunan,loadable:false},target),false);
  assert.equal(examMatches(hunan,{...target,year:'2027'}),true);
  const html=rendered();assert.match(html,new RegExp(`data-load-exam="${hunan.id}" >载入本场细则`));
  assert.match(html,/data-load-exam="jiangnan-design-2027-recommended" disabled/);
});
test('电子信息两个方向不会相互载入，待核验线索不会成为评分资料',()=>{
  const imdt=library.records.find(r=>r.id==='tsinghua-sigs-imdt-2027-recommended');
  const t={schoolId:'tsinghua',collegeId:'tsinghua-599',majorCode:'085400',year:2027,admissionType:'推免面试',directionId:'05'};
  assert.equal(examMatches(imdt,t),true);assert.equal(examMatches(imdt,{...t,directionId:'10'}),false);assert.equal(examMatches(imdt,{...t,directionId:''}),false);
  const pending=library.records.find(r=>r.verification==='source_pending');
  assert.equal(examMatches(pending,{...target,schoolId:pending.schoolId,collegeId:pending.collegeId,majorCode:pending.programCodes[0]}),false);
  assert.match(rendered(),new RegExp(`data-load-exam="${pending.id}" disabled>待核验`));
});
test('全部条目按七个学院呈现，筛选独立保留年份和类型边界',()=>{
  const html=rendered();assert.equal((html.match(/class="exam-college-group"/g)??[]).length,7);
  assert.equal((html.match(/data-load-exam=/g)??[]).length,library.records.length);
  for(const name of ['schoolId','collegeId','year','admissionType'])assert.match(html,new RegExp(`data-library-filter="${name}"`));
  const old=rendered({schoolId:'tongji',collegeId:'tongji-200',year:'2026',admissionType:'研究生复试'});
  assert.equal((old.match(/data-load-exam=/g)??[]).length,1);assert.match(old,/2026 年/);assert.doesNotMatch(old,/id="exam-tongji-media-2027-recommended"/);
  assert.match(rendered({schoolId:'hunan',year:'2026'}),/此筛选下暂无考核资料/);
});
test('面试权重与笔试材料分数分开，缺失权重不被补齐',()=>{
  const html=rendered();assert.match(html,/评分观察要求经 ON STAGE 转译/);assert.match(html,/面试内部权重未公布/);
  assert.match(html,/材料审查/);assert.match(html,/笔试/);assert.match(html,/110 分/);assert.match(html,/240 <small>分/);
  const jn=rendered({schoolId:'jiangnan',collegeId:'jiangnan-003'});
  assert.match(jn,/未公布/);assert.doesNotMatch(jn,/33\.3%|平均分配/);assert.match(jn,/官网原文/);
  assert.match(renderLibraryLink(library,target),/找到 1 条匹配/);assert.match(renderLibraryLink(library,{...target,year:2030}),/查阅目标院校/);
});
test('官网链接和目标文本按数据处理，不能注入标签或执行脚本',()=>{
  const unsafe={...hunan,id:'x" onclick="bad',title:'<img src=x onerror=bad()>',url:'javascript:bad()',documentUrl:'data:text/html,<script>bad()</script>'};
  const html=renderExamLibrary({library:{records:[unsafe]},target:{...target,school:'<script>bad()</script>'}});
  assert.doesNotMatch(html,/<script>|<img|href="javascript:|href="data:/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);
  assert.match(html,/href="#" target="_blank" rel="noopener noreferrer"/);
});
test('已载入且仍匹配的条目显示来源、核验日期和编辑边界',()=>{
  const html=renderLibraryLink(library,{...target,examLibraryId:hunan.id});
  assert.match(html,/已载入官网考核依据/);assert.ok(html.includes(hunan.title));assert.ok(html.includes(hunan.checkedAt));assert.match(html,/编辑后按本人确认内容使用/);
  assert.doesNotMatch(renderLibraryLink(library,{...target,examLibraryId:hunan.id,year:2026}),/已载入官网考核依据/);
  assert.doesNotMatch(renderLibraryLink(library,{...target,examLibraryId:'jiangnan-design-2027-recommended'}),/已载入官网考核依据/);
});
