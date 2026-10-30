import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogSelection, changeCatalogTarget, clearTargetRules, reconcileCatalogDraft, targetLabel } from '../public/catalog-state.js';

// Synthetic records exercise relationships without asserting any real admissions facts.
const templates = [
  { id: 'custom', school: '自定义院校' },
  {
    id: 'school-a', school: '测试甲校', colleges: [
      { id: 'a-art', name: '甲校艺术学院', programs: [
        { id: 'design', name: '设计学', code: '140300', directions: [{ id: 'a-visual', name: '视觉设计研究' }, { id: 'a-space', name: '空间设计研究' }] },
        { id: 'a-professional', name: '设计', code: '135700', directions: [{ id: 'a-practice', name: '设计实践' }] },
      ] },
      { id: 'a-innovation', name: '甲校创新学院', programs: [
        { id: 'design', name: '设计学', code: '140300', directions: [{ id: 'a-interaction', name: '交互设计研究' }] },
      ] },
    ],
  },
  {
    id: 'school-b', school: '测试乙校', colleges: [
      { id: 'b-design', name: '乙校设计学院', programs: [
        { id: 'b-design', name: '设计', code: '135700', directions: [{ id: 'b-service', name: '服务设计' }] },
      ] },
    ],
  },
];

function fixture() {
  return {
    target: {
      nickname: '测试同学', school: '测试甲校', collegeId: 'a-art', college: '甲校艺术学院',
      programId: 'design', major: '设计学', majorCode: '140300', directionId: 'a-visual', direction: '视觉设计研究',
      year: '2027', admissionType: '推免面试', interviewTime: '2026-11-01T10:00', attempt: 2,
      rulesText: '甲校旧细则', rubricText: '甲校旧评分文本',
      official: [{ id: 'old', weight: 100 }], officialRubric: [{ id: 'old', weight: 100 }],
      portfolioNotes: '个人项目说明', stages: ['portfolio', 'english'],
    },
    materials: { resume: 'resume-1', portfolio: 'portfolio-1', rules: 'rules-a', rubric: 'rubric-a' },
  };
}

function assertRulesCleared(result) {
  assert.equal(result.target.rulesText, '');
  assert.equal(result.target.rubricText, '');
  assert.deepEqual(result.target.official, []);
  assert.equal(result.target.officialRubric, null);
  assert.equal(Object.hasOwn(result.materials, 'rules'), false);
  assert.equal(Object.hasOwn(result.materials, 'rubric'), false);
  assert.equal(result.materials.resume, 'resume-1');
  assert.equal(result.materials.portfolio, 'portfolio-1');
}

function assertIdentityPreserved(target, original) {
  for (const field of ['nickname', 'year', 'admissionType', 'interviewTime', 'attempt', 'portfolioNotes', 'stages']) {
    assert.deepEqual(target[field], original[field], `${field} should survive target selection`);
  }
}

test('目录按学校、学院、专业逐层解析，不暴露其他学院或院校的选项', () => {
  const { target } = fixture();
  const selected = catalogSelection(templates, target);
  assert.equal(selected.school.id, 'school-a');
  assert.equal(selected.college.id, 'a-art');
  assert.equal(selected.program.code, '140300');
  assert.equal(selected.direction.name, '视觉设计研究');
  assert.deepEqual(selected.colleges.map(c => c.id), ['a-art', 'a-innovation']);
  assert.deepEqual(selected.programs.map(p => p.id), ['design', 'a-professional']);
  assert.deepEqual(selected.directions.map(d => d.id), ['a-visual', 'a-space']);
  assert.equal(selected.directions.some(d => d.id === 'b-service'), false);
});

test('切换院校清空学院、专业、方向与旧考核材料，保留学生身份及个人材料', () => {
  const { target, materials } = fixture();
  const result = changeCatalogTarget(templates, target, materials, 'school', '测试乙校');
  assert.equal(result.target.school, '测试乙校');
  for (const field of ['collegeId', 'college', 'programId', 'major', 'majorCode', 'directionId', 'direction']) {
    assert.equal(result.target[field], '', `${field} should reset after changing school`);
  }
  assertRulesCleared(result);
  assertIdentityPreserved(result.target, target);
  const selection = catalogSelection(templates, result.target);
  assert.deepEqual(selection.colleges.map(c => c.id), ['b-design']);
  assert.deepEqual(selection.programs, []);
  assert.deepEqual(selection.directions, []);
});

test('切换学院清空下级选择，同名同代码专业也不会沿用原学院的方向', () => {
  const { target, materials } = fixture();
  const result = changeCatalogTarget(templates, target, materials, 'collegeId', 'a-innovation');
  assert.equal(result.target.school, '测试甲校');
  assert.equal(result.target.college, '甲校创新学院');
  for (const field of ['programId', 'major', 'majorCode', 'directionId', 'direction']) assert.equal(result.target[field], '');
  assertRulesCleared(result);
  assertIdentityPreserved(result.target, target);
  const selected = changeCatalogTarget(templates, result.target, result.materials, 'programId', 'design');
  assert.deepEqual(catalogSelection(templates, selected.target).directions.map(d => d.id), ['a-interaction']);
  assert.equal(selected.target.directionId, '');
});

test('选择专业后同步官方名称和代码，切换专业清空方向并解绑旧规则', () => {
  const { target, materials } = fixture();
  const result = changeCatalogTarget(templates, target, materials, 'programId', 'a-professional');
  assert.equal(result.target.collegeId, 'a-art');
  assert.equal(result.target.major, '设计');
  assert.equal(result.target.majorCode, '135700');
  assert.equal(result.target.directionId, '');
  assert.equal(result.target.direction, '');
  assert.deepEqual(catalogSelection(templates, result.target).directions.map(d => d.id), ['a-practice']);
  assertRulesCleared(result);
  assertIdentityPreserved(result.target, target);
});

test('选择研究方向保留所属专业与身份，但清空上一方向的评分和院校材料', () => {
  const { target, materials } = fixture();
  const result = changeCatalogTarget(templates, target, materials, 'directionId', 'a-space');
  assert.equal(result.target.programId, 'design');
  assert.equal(result.target.majorCode, '140300');
  assert.equal(result.target.direction, '空间设计研究');
  assertRulesCleared(result);
  assertIdentityPreserved(result.target, target);
});

test('同名专业通过学院隔离，过期方向 ID 不会在另一学院中匹配', () => {
  const { target } = fixture();
  const art = catalogSelection(templates, target);
  const innovation = catalogSelection(templates, { ...target, collegeId: 'a-innovation' });
  assert.equal(art.program.name, innovation.program.name);
  assert.equal(art.program.code, innovation.program.code);
  assert.notDeepEqual(art.directions, innovation.directions);
  assert.equal(innovation.direction, undefined);
  const aLabel = targetLabel(target);
  const bLabel = targetLabel({ ...target, college: '甲校创新学院', direction: '交互设计研究' });
  assert.notEqual(aLabel, bLabel);
  assert.match(aLabel, /140300 设计学/);
});

test('未知院校和无效上级选择不回退到首个专业，支持自定义目标', () => {
  const { target, materials } = fixture();
  for (const school of ['尚未收录的院校', '自定义院校']) {
    const selection = catalogSelection(templates, { ...target, school });
    assert.equal(selection.school, undefined);
    assert.deepEqual(selection.colleges, []);
    assert.deepEqual(selection.programs, []);
    assert.deepEqual(selection.directions, []);
  }
  const wrongCollege = catalogSelection(templates, { ...target, collegeId: 'b-design' });
  assert.equal(wrongCollege.college, undefined);
  assert.deepEqual(wrongCollege.programs, []);
  const changed = changeCatalogTarget(templates, target, materials, 'school', '自定义院校');
  assert.equal(changed.target.major, '');
  assertRulesCleared(changed);
});

test('改招生年份或招生类型也需重新确认规则，同时保留选定专业方向', () => {
  const { target, materials } = fixture();
  for (const [field, value] of [['year', '2028'], ['admissionType', '研究生复试']]) {
    const result = changeCatalogTarget(templates, target, materials, field, value);
    assert.equal(result.target[field], value);
    assert.equal(result.target.programId, target.programId);
    assert.equal(result.target.directionId, target.directionId);
    assertRulesCleared(result);
  }
});

test('联动与规则清理返回新对象，不改写传入草稿、材料或目录', () => {
  const { target, materials } = fixture();
  const before = structuredClone({ target, materials, templates });
  const cleared = clearTargetRules(target, materials);
  const changed = changeCatalogTarget(templates, target, materials, 'school', '测试乙校');
  assert.notEqual(cleared.target, target);
  assert.notEqual(cleared.materials, materials);
  assert.notEqual(changed.target, target);
  assert.deepEqual({ target, materials, templates }, before);
  assert.equal(target.rulesText, '甲校旧细则');
  assert.equal(materials.rules, 'rules-a');
});

test('目录更新使已保存方向失效时，初始化清除方向名称和 ID 并解绑旧规则', () => {
  const { target, materials } = fixture();
  const stale = { ...target, directionId: 'removed-direction', direction: '目录已移除的旧方向' };
  const result = reconcileCatalogDraft(templates, stale, materials);
  assert.equal(result.changed, true);
  assert.equal(result.target.directionId, '');
  assert.equal(result.target.direction, '');
  assert.equal(result.target.collegeId, target.collegeId);
  assert.equal(result.target.programId, target.programId);
  assert.equal(result.target.major, '设计学');
  assertRulesCleared(result);
  assertIdentityPreserved(result.target, target);
  assert.equal(stale.directionId, 'removed-direction');
  assert.equal(materials.rules, 'rules-a');
});

test('V0.1 无目录 ID 的旧草稿保持原文与规则，不自动猜选同名专业或改写材料', () => {
  const { target, materials } = fixture();
  const legacy = { ...target };
  for (const field of ['schoolId', 'collegeId', 'college', 'programId', 'majorCode', 'directionId', 'direction']) delete legacy[field];
  const before = structuredClone({ target: legacy, materials });
  const result = reconcileCatalogDraft(templates, legacy, materials);
  assert.equal(result.changed, false);
  assert.deepEqual(result.target, before.target);
  assert.deepEqual(result.materials, before.materials);
  assert.equal(result.target.major, '设计学');
  assert.equal(result.target.rulesText, '甲校旧细则');
  assert.equal(result.materials.rules, 'rules-a');
  const selection = catalogSelection(templates, result.target);
  assert.equal(selection.college, undefined);
  assert.equal(selection.program, undefined);
});
