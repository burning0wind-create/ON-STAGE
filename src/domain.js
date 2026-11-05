import { createHash, randomUUID } from 'node:crypto';
import { SCHOOL_CATALOG } from './catalog.js';

export const id = () => randomUUID();
export const hash = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const STAGES = [
  { id: 'english', name: '英语问答', minutes: 5, language: 'en-US', question: 'Please introduce one design project and explain a key decision you made.' },
  { id: 'portfolio', name: '作品集答辩', minutes: 8, language: 'zh-CN', question: '请选择作品集中的一个项目，说明设计问题、你的个人贡献和最关键的设计决策。' },
  { id: 'design', name: '设计专业问答', minutes: 5, language: 'zh-CN', question: '你如何把用户研究发现转化为设计判断？请结合自己的项目说明。' },
  { id: 'ethics', name: '综合素质与设计伦理', minutes: 3, language: 'zh-CN', question: '如果作品集中使用了生成式 AI 或团队成员的成果，你会如何标注来源、说明个人贡献并处理研究伦理？' },
];
export const DIMENSIONS = [
  { id: 'logic', name: '逻辑结构', weight: 25, anchors: ['观点零散，因果断裂', '有基本结构，部分推理有缺口', '问题、依据、决策与反思构成清晰论证'] },
  { id: 'knowledge', name: '专业理解', weight: 20, anchors: ['核心概念混淆', '主要概念正确，运用较浅', '准确运用设计知识，解释条件与局限'] },
  { id: 'evidence', name: '作品与研究证据', weight: 20, anchors: ['缺少相关证据', '有实例，验证不足', '个人贡献清晰，以研究或验证支持判断'] },
  { id: 'expression', name: '专业表达', weight: 15, anchors: ['用词模糊，难以理解', '基本清晰，有重复', '术语准确，表达简洁且便于理解'] },
  { id: 'reflection', name: '创新与批判反思', weight: 10, anchors: ['只有结论，未说明取舍', '能说明局限或替代方案', '比较替代方案，反思局限与后续验证'] },
  { id: 'relevance', name: '切题与完整性', weight: 10, anchors: ['未回应核心问题', '回应主要要求，有遗漏', '直接回应问题，覆盖要求且详略合适'] },
];
export const TEMPLATE_SEEDS = [{id:'custom',school:'自定义院校',colleges:[]},...SCHOOL_CATALOG].map(t=>({...t,status:t.id==='custom'?'custom':'catalog_verified',note:'专业目录来源可查。请另上传对应年份、招生类型的面试考核细则及评分标准。',stages:STAGES}));
export function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
export function required(value, label, limit = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(`${label}需要填写，且不超过 ${limit} 字`);
  return value.trim();
}
export function validateStages(stages) {
  if (!Array.isArray(stages) || !stages.length || stages.length > 8) fail('请选择 1–8 个面试环节');
  const ids = new Set();
  return stages.map(s => {
    if (!STAGES.some(t => t.id === s.id) || ids.has(s.id)) fail('环节无效或重复');
    ids.add(s.id);
    const minutes = Number(s.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 30) fail('每个环节时长应为 1–30 分钟');
    return { ...STAGES.find(t => t.id === s.id), minutes };
  });
}
export function sessionIdentity(input) {
  return { nickname: required(input.nickname, '昵称', 60), school: required(input.school, '院校'), major: required(input.major, '专业'), interviewTime: required(input.interviewTime, '面试时间', 60), attempt: Number(input.attempt),...(input.college?{college:input.college}:{}),...(input.programId?{programId:input.programId}:{}),...(input.directionId?{directionId:input.directionId}:{}) };
}
export function cacheKey(input) {
  const identity = sessionIdentity(input);
  if (!Number.isInteger(identity.attempt) || identity.attempt < 1 || identity.attempt > 9999) fail('模拟次数应为正整数');
  if (!Number.isFinite(Date.parse(identity.interviewTime))) fail('面试时间无效');
  return hash(identity);
}
export function validateOfficialRubric(raw) {
  if (!raw) return null;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) fail('院校评分项应为 1–20 项');
  const ids = new Set();
  const items = raw.map(x => {
    const key = required(x.id, '评分项 ID', 60);
    if (ids.has(key)) fail('院校评分项 ID 不可重复');
    ids.add(key);
    if (!Number.isFinite(x.weight) || x.weight <= 0 || x.weight > 100) fail('评分权重无效');
    return { id: key, name: required(x.name, '评分项名称', 120), weight: x.weight, criterion: required(x.criterion, '评分依据', 4000) };
  });
  if (Math.abs(items.reduce((n, x) => n + x.weight, 0) - 100) > 0.01) fail('院校评分权重合计必须为 100%');
  return items;
}
export function makePlan(profile, materials) {
  return {
    source: 'configured', generatedAt: new Date().toISOString(),
    layers: {
      target: { school: profile.school, college:profile.college, major: profile.major, majorCode:profile.majorCode,direction:profile.direction,catalog:profile.catalog,admissionType: profile.admissionType, year: profile.year, rules: profile.rulesText },
      candidate: { resume: materials.find(m => m.kind === 'resume')?.id ?? null, portfolio: materials.find(m => m.kind === 'portfolio')?.id ?? null },
      examiners: profile.stages.map(s => ({ stageId: s.id, role: `${s.name}虚拟练习考官` })),
      strategy: profile.stages.map(s => ({ ...s, opening: s.question, followupFocus: '依据回答追问设计依据、个人贡献、替代方案与验证' })),
      gaps: materials.filter(m => !['parsed','user_described'].includes(m.status)).map(m => `${m.name}需要补充可读取文字或页面说明`),
      evaluation: { trainingRubric: profile.trainingRubric??DIMENSIONS, officialRubric: profile.officialRubric, rubricText: profile.rubricText, status: profile.officialRubric ? 'user_confirmed' : 'training_only',evidencePolicy:'先冻结标准；专业与语言分开；覆盖与质量分开；引用、边界、追问可追溯；重复引文不计新增证据。' },
      rhythm: { totalMinutes: profile.stages.reduce((n,s) => n+s.minutes, 0), pauseAllowed: true, sensingAffectsContentScore: false },
    },
  };
}
export function sourceRecord(input) {
  let url; try {url = new URL(required(input.url, '来源 URL', 3000));} catch {fail('来源 URL 无效');}
  if (!['https:', 'http:'].includes(url.protocol)) fail('来源需为网页链接');
  const type = ['official', 'experience', 'portfolio_reference'].includes(input.type) ? input.type : 'experience';
  return { id: id(), title: required(input.title, '来源标题', 400), url: url.href, type, summary: String(input.summary ?? '').slice(0,6000), publishedAt: input.publishedAt || null, retrievedAt: new Date().toISOString(), confidence: type === 'official' ? 'pending_verification' : 'anecdotal', verified: false };
}
