import test from 'node:test';
import assert from 'node:assert/strict';
import { getExamLibrary,getExamRecord,matchExamRecord } from '../src/exam-library.js';
import { SCHOOL_CATALOG,resolveCatalogTarget } from '../src/catalog.js';

const hnu={schoolId:'hunan',collegeId:'hunan-design',majorCode:'140300',year:'2027',admissionType:'推免面试'};

test('官网考核库保留四所学校七个学院、独立版本和可读取状态',()=>{
  const library=getExamLibrary();
  assert.equal(library.checkedAt,'2026-10-30');
  assert.equal(library.records.length,9);
  assert.equal(new Set(library.records.map(r=>r.schoolId)).size,4);
  assert.equal(new Set(library.records.map(r=>r.collegeId)).size,7);
  assert.equal(library.records.filter(r=>r.verification==='official').length,8);
  assert.equal(library.records.filter(r=>r.loadable).length,8);
  const ids=new Set();
  for(const r of library.records){
    assert.ok(!ids.has(r.id));ids.add(r.id);
    assert.ok(new URL(r.url).hostname.endsWith('.edu.cn'));
    const college=SCHOOL_CATALOG.find(s=>s.id===r.schoolId)?.colleges.find(c=>c.id===r.collegeId);
    assert.ok(college);
    for(const code of r.programCodes)assert.ok(college.programs.some(p=>p.code===code));
    if(r.verification==='official'){
      assert.ok(r.publishedAt);assert.ok(r.rulesText);assert.ok(r.rubricText);
    }
  }
});

test('只能加载本校本院本专业同年份同招生类型的已核验规则',()=>{
  const r=getExamRecord('hunan-design-2027-recommended',hnu);
  assert.equal(r.totalScore,100);
  for(const bad of [{schoolId:'tongji'},{collegeId:'jiangnan-003'},{majorCode:'085400'},{year:2026},{admissionType:'研究生复试'}]){
    assert.equal(matchExamRecord(r,{...hnu,...bad}),false);
    assert.throws(()=>getExamRecord(r.id,{...hnu,...bad}),/不匹配/);
  }
  assert.throws(()=>getExamRecord('missing',hnu),/不存在/);
  const pending={schoolId:'tongji',collegeId:'tongji-270',majorCode:'135700',year:2027,admissionType:'推免面试'};
  assert.throws(()=>getExamRecord('tongji-design-2027-pending',pending),/尚待核验/);
});

test('清华深圳085400两个方向隔离，不把同代码当作同规则',()=>{
  const base={schoolId:'tsinghua',collegeId:'tsinghua-599',majorCode:'085400',year:2027,admissionType:'推免面试'};
  const a=getExamRecord('tsinghua-sigs-imdt-2027-recommended',{...base,directionId:'05'});
  assert.equal(a.directionNames[0],'互动媒体设计与技术');
  assert.throws(()=>getExamRecord(a.id,{...base,directionId:'10'}),/不匹配/);
  assert.throws(()=>getExamRecord(a.id,base),/不匹配/);
  assert.equal(getExamRecord('tsinghua-sigs-iid-2027-recommended',{...base,directionId:'10'}).passThreshold,null);
});

test('只有公开完整面试分项允许写入官方量表；笔试、材料和及格条件不变成权重',()=>{
  const records=getExamLibrary().records;
  const complete=records.filter(r=>r.officialRubric.length);
  assert.deepEqual(complete.map(r=>r.id),['hunan-design-2027-recommended']);
  assert.deepEqual(complete[0].officialRubric.map(d=>d.weight),[20,40,40]);
  for(const r of records.filter(r=>r.id!==complete[0].id))assert.deepEqual(r.officialRubric,[]);
  const tongji=records.find(r=>r.id==='tongji-media-2026-exam');
  assert.equal(tongji.totalScore,240);assert.equal(tongji.passThreshold,null);
  assert.equal(tongji.assessmentItems.find(d=>d.scope==='written').maxScore,110);
  assert.match(tongji.formula,/350/);assert.match(tongji.formula,/60%/);
  assert.equal(records.find(r=>r.id==='tongji-media-2027-recommended').passThreshold,null);
  assert.equal(records.find(r=>r.id==='tsinghua-art-2027-recommended').passThreshold,60);
});

test('库与单条读取均返回独立副本，调用方不能修改公共权重',()=>{
  const library=getExamLibrary();library.records[0].officialRubric[0].weight=999;
  const record=getExamRecord('hunan-design-2027-recommended',hnu);record.officialRubric[0].weight=888;
  assert.equal(getExamRecord('hunan-design-2027-recommended',hnu).officialRubric[0].weight,20);
});

test('已解析目标可精确匹配，清华仅统考专业不能加载推免规则',()=>{
  const target=resolveCatalogTarget({schoolId:'tsinghua',collegeId:'tsinghua-080',programId:'tsinghua-080-1403J1',admissionType:'推免面试'});
  assert.equal(getExamRecord('tsinghua-art-2027-recommended',{...target,year:2027,admissionType:'推免面试'}).collegeId,'tsinghua-080');
  assert.throws(()=>getExamRecord('tsinghua-art-2027-recommended',{...target,majorCode:'085500',year:2027,admissionType:'推免面试'}),/不匹配/);
});
