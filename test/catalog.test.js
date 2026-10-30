import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCHOOL_CATALOG,resolveCatalogTarget } from '../src/catalog.js';
import { catalogSelection,changeCatalogTarget } from '../public/catalog-state.js';
import { cacheKey,STAGES } from '../src/domain.js';
import { Store } from '../src/store.js';
import { OnStage } from '../src/app.js';

test('四所学校、七个学院的设计相关硕士目录保留官方来源与独立专业 ID',()=>{
  assert.equal(SCHOOL_CATALOG.length,4);
  assert.equal(SCHOOL_CATALOG.flatMap(s=>s.colleges).length,7);
  const ids=new Set();
  for(const s of SCHOOL_CATALOG)for(const c of s.colleges)for(const p of c.programs){
    assert.ok(c.name);assert.ok(!ids.has(p.id));ids.add(p.id);
    assert.match(p.code,/^[0-9A-Z]{6}$/);assert.equal(p.catalog.year,2027);
    assert.ok(new URL(p.catalog.url).hostname.endsWith('.edu.cn'));assert.equal(p.catalog.checkedAt,'2026-10-30');
  }
  assert.equal(ids.size,19);
});
test('后端拒绝跨校、跨学院专业或无效研究方向，名称与来源由服务端目录生成',()=>{
  const target={schoolId:'jiangnan',school:'江南大学',collegeId:'jiangnan-037',programId:'jiangnan-037-140300',directionId:'02',admissionType:'推免面试'};
  assert.throws(()=>resolveCatalogTarget({...target,collegeId:'hunan-design'}),/学院/);
  assert.throws(()=>resolveCatalogTarget({...target,programId:'jiangnan-003-140300'}),/专业/);
  assert.throws(()=>resolveCatalogTarget({...target,directionId:'99'}),/方向/);
  assert.throws(()=>resolveCatalogTarget({...target,school:'清华大学'}),/不一致/);
  assert.throws(()=>resolveCatalogTarget({...target,schoolId:'bad'}),/不存在/);
  assert.throws(()=>resolveCatalogTarget({schoolId:'custom',school:'清华大学 ',college:'任意学院',major:'任意专业'}),/学院/);
  const result=resolveCatalogTarget({...target,major:'伪造专业',catalog:{url:'https://bad.example'}});
  assert.equal(result.major,'设计学');assert.equal(result.college,'数字科技与创意设计学院');assert.equal(result.direction,'数字媒体艺术设计研究');assert.ok(result.catalog.url.includes('dtid.jiangnan.edu.cn'));
});
test('推免筛除仅统考专业及方向，跨类型切换不沿用不适用方向',()=>{
  const target={school:'清华大学',collegeId:'tsinghua-080',admissionType:'推免面试'};
  assert.ok(!catalogSelection(SCHOOL_CATALOG,target).programs.some(p=>p.code==='085500'));
  assert.ok(catalogSelection(SCHOOL_CATALOG,{...target,admissionType:'研究生复试'}).programs.some(p=>p.code==='085500'));
  const tongji={school:'同济大学',collegeId:'tongji-270',programId:'tongji-270-135700',directionId:'07',admissionType:'研究生复试'};
  assert.ok(catalogSelection(SCHOOL_CATALOG,tongji).direction);
  const changed=changeCatalogTarget(SCHOOL_CATALOG,tongji,{},'admissionType','推免面试');
  assert.equal(changed.target.directionId,'');assert.ok(catalogSelection(SCHOOL_CATALOG,changed.target).directions.every(d=>d.studyMode==='全日制'));
  assert.throws(()=>resolveCatalogTarget({...target,collegeId:'tsinghua-599',programId:'tsinghua-599-085400'}),/研究方向/);
});
test('同名设计学通过学院与方向隔离场次身份',()=>{
  const common={nickname:'同学',school:'江南大学',major:'设计学',interviewTime:'2026-11-01T12:00+08:00',attempt:1};
  const a={...common,college:'设计学院',programId:'jiangnan-003-140300',directionId:'01'};
  const b={...common,college:'数字科技与创意设计学院',programId:'jiangnan-037-140300',directionId:'01'};
  assert.notEqual(cacheKey(a),cacheKey(b));assert.notEqual(cacheKey(a),cacheKey({...a,directionId:'02'}));
});
test('新设置保存完整三级目标与来源快照；旧档案原文仍可读取',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onstage-catalog-'));
  t.after(()=>{const checked=path.resolve(root);if(!checked.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(checked).startsWith('onstage-catalog-'))throw Error('Unsafe test cleanup');fs.rmSync(checked,{recursive:true,force:true});});
  const store=new Store(root),app=new OnStage(store);
  for(const kind of ['resume','portfolio'])store.put('materials',kind,{id:kind,kind,hash:kind,text:'材料',status:'parsed'});
  const p=app.profile({schoolId:'hunan',school:'湖南大学',collegeId:'hunan-design',programId:'hunan-design-140300',nickname:'同学',year:'2027',admissionType:'推免面试',interviewTime:'2026-11-01T12:00+08:00',attempt:1,materialIds:['resume','portfolio'],rulesText:'细则',rubricText:'标准',stages:STAGES});
  assert.equal(p.college,'设计艺术学院');assert.equal(p.majorCode,'140300');assert.equal(p.catalog.year,2027);
  store.put('sessions','legacy',{id:'legacy',profile:{school:'湖南大学',major:'交互设计（旧自填）'}});
  assert.equal(app.get('legacy').profile.major,'交互设计（旧自填）');
});
