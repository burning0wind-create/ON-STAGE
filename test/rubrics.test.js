import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHOOL_CATALOG,resolveCatalogTarget} from '../src/catalog.js';
import {buildTrainingRubric,TRAINING_RUBRIC_VERSION} from '../public/rubrics.js';

const targets=SCHOOL_CATALOG.flatMap(s=>s.colleges.flatMap(c=>c.programs.map(p=>({s,c,p}))));
function target({s,c,p},direction) {
  return resolveCatalogTarget({schoolId:s.id,collegeId:c.id,programId:p.id,directionId:direction?.id??(p.requireDirection?p.directions[0]?.id:''),year:2027,admissionType:direction?.admissionTypes?.[0]??p.admissionTypes?.[0]??p.catalog.admissionTypes[0]});
}
function verify(r,label) {
  assert.equal(r.version,TRAINING_RUBRIC_VERSION,label);assert.match(r.id,/^onstage-/);
  assert.equal(r.provisional,true);assert.match(r.rationale,/ON STAGE/);assert.match(r.rationale,/不是院校/);
  assert.equal(r.dimensions.length,6);assert.equal(new Set(r.dimensions.map(d=>d.id)).size,6);
  assert.equal(r.dimensions.reduce((sum,d)=>sum+d.weight,0),100,label);
  for(const d of [...r.dimensions,...r.languageDimensions]) {
    assert.ok(d.criterion.length>10,label);assert.equal(d.anchors.length,3,label);
    assert.equal(new Set(d.anchors).size,3,label);assert.ok(d.anchors.every(a=>a.length>8),label);
    assert.ok(d.evidenceExpected.length>8,label);assert.ok(d.nextProbe.length>8,label);assert.ok(d.stages.length);
  }
  assert.equal(r.languageDimensions.length,3);assert.ok(r.languageDimensions.every(d=>d.weight===0&&d.group==='language'&&!d.critical));
  assert.deepEqual(r.criticalDimensions,r.dimensions.filter(d=>d.critical).map(d=>d.id));
  assert.equal(r.scoringRules.qualitySeparateFromCoverage,true);assert.equal(r.scoringRules.missingEvidenceIsNotLowScore,true);
  assert.equal(r.scoringRules.nonverbalExcluded,true);assert.equal(r.scoringRules.languageSeparateFromProfessional,true);
}

test('全部19个院校学院专业组合均有完整且诚实标注的训练量表',()=>{
  assert.equal(targets.length,19);
  for(const entry of targets)verify(buildTrainingRubric(target(entry)),entry.p.id);
});
test('目录全部研究方向均可构建量表，专业和表达分始终分离',()=>{
  for(const entry of targets)for(const direction of entry.p.directions) {
    const t=target(entry,direction),r=buildTrainingRubric(t);
    verify(r,`${entry.p.id}/${direction.id}`);assert.ok(r.targetLabel.includes(direction.name));
  }
});
test('交互、视觉、数据设计与史论会改变判断标准，不只替换专业名称',()=>{
  const cases=[['tongji-270-135700','01','onstage-interaction'],['tongji-270-135700','03','onstage-visual'],['tongji-270-087200','01','onstage-data_design'],['tongji-270-140300','01','onstage-history']];
  const rubrics=cases.map(([programId,directionId,id])=>{
    const entry=targets.find(t=>t.p.id===programId);const r=buildTrainingRubric(target(entry,entry.p.directions.find(d=>d.id===directionId)));
    assert.equal(r.id,id);return r;
  });
  assert.equal(new Set(rubrics.map(r=>r.dimensions.find(d=>d.id==='evidence').criterion)).size,cases.length);
  assert.equal(new Set(rubrics.map(r=>r.dimensions.find(d=>d.id==='knowledge').anchors[2])).size,cases.length);
});
test('同一学院的专业代码与方向共同决定量表，未知方向不依学院名猜测',()=>{
  const research=buildTrainingRubric({school:'任意学校',college:'交互设计学院',majorCode:'140300',major:'设计学'});
  assert.equal(research.id,'onstage-research');
  assert.equal(buildTrainingRubric({majorCode:'085400',major:'电子信息'}).id,'onstage-technology');
  assert.equal(buildTrainingRubric({majorCode:'085507',major:'工业设计工程'}).id,'onstage-technology');
  assert.equal(buildTrainingRubric({majorCode:'087200',major:'设计学'}).id,'onstage-data_design');
  assert.equal(buildTrainingRubric({schoolId:'custom',major:'设计',direction:'设计战略与服务系统'}).id,'onstage-service');
});
test('量表是独立快照，后续修改不会污染其他专业或重建结果',()=>{
  const t=target(targets[0]);const a=buildTrainingRubric(t),b=buildTrainingRubric(t);
  a.dimensions[0].weight=999;a.dimensions[0].anchors[0]='污染';a.languageDimensions[0].stages.push('fake');a.source.url='fake';
  assert.deepEqual(buildTrainingRubric(t),b);
});
