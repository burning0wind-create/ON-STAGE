import { catalogSelection } from '../public/catalog-state.js';
import extraData from './catalog-extra.json' with {type:'json'};

const checkedAt='2026-10-30';
export const catalogSource=(url,label,admissionTypes=['推免面试'],year=2027)=>({url,label,admissionTypes,year,checkedAt});
export function program(id,code,name,degree,catalog,names=[],extra={}) {
  return {id,code,name,degree,catalog,directions:names.map((name,i)=>({id:String(i+1).padStart(2,'0'),code:String(i+1).padStart(2,'0'),name})),...extra};
}
const hnu=catalogSource('https://design.hnu.edu.cn/info/1031/9308.htm','2027 年接收推荐免试研究生综合考核细则');
const jnDesign=catalogSource('https://sodcn.jiangnan.edu.cn/info/1074/7674.htm','2027 年设计学院推免细则（专业与方向）');
const jnDigital=catalogSource('https://dtid.jiangnan.edu.cn/info/1038/1893.htm','2027 年数字科技与创意设计学院推免细则（专业与方向）');
export const SCHOOL_CATALOG = [
  {id:'hunan',school:'湖南大学',colleges:[{id:'hunan-design',name:'设计艺术学院',programs:[
    program('hunan-design-140300','140300','设计学','学术学位',hnu),
    program('hunan-design-135700','135700','设计','专业学位',hnu),
  ]}]},
  ...extraData.schools.map(s=>({...s,colleges:s.colleges.map(c=>({...c,id:`${s.id}-${c.code}`,programs:c.programs.map(p=>({...p,id:`${s.id}-${c.code}-${p.code}`,catalog:{...p.catalog,year:Number(p.catalog.year)},admissionTypes:p.catalog.admissionTypes,scopeNote:p.note??'',requireDirection:p.code==='085400',directions:p.directions.map(d=>({...d,id:d.code}))}))}))})),
  {id:'jiangnan',school:'江南大学',colleges:[
    {id:'jiangnan-003',code:'003',name:'设计学院',programs:[
      program('jiangnan-003-140300','140300','设计学','学术学位',jnDesign,['工业设计与产品战略研究','交互与体验设计研究','视觉设计与形象传播研究','环境设计与城市更新研究','公共艺术与数字创新研究','服饰文化与时尚创意研究','紫砂艺术与文脉传承研究','设计历史与理论']),
      program('jiangnan-003-135700','135700','设计','专业学位',jnDesign,['工业设计与产品战略','交互与体验设计','视觉设计与形象传播','环境设计与城市更新','公共艺术与数字创新','服饰文化与时尚创意','紫砂艺术与设计创新']),
      program('jiangnan-003-130100','130100','艺术学','学术学位',jnDesign,['美术创作及理论'],{scopeNote:'相关艺术专业；本轮仅收录学院已公布的美术创作及理论方向。'}),
    ]},
    {id:'jiangnan-037',code:'037',name:'数字科技与创意设计学院',programs:[
      program('jiangnan-037-140300','140300','设计学','学术学位',jnDigital,['工业设计与智能交互研究','数字媒体艺术设计研究']),
      program('jiangnan-037-135700','135700','设计','专业学位',jnDigital,['工业设计与智能交互','数字媒体艺术设计']),
      program('jiangnan-037-085507','085507','工业设计工程','专业学位',jnDigital,['工业设计与数智交叉']),
    ]},
  ]},
];

export function resolveCatalogTarget(input) {
  input={...input,school:typeof input.school==='string'?input.school.trim():input.school};
  const named=SCHOOL_CATALOG.find(s=>s.school===input.school);
  const chosen=SCHOOL_CATALOG.find(s=>s.id===input.schoolId);
  if(input.schoolId&&input.schoolId!=='custom'&&!chosen)throw new Error('所选学校不存在');
  if(chosen&&input.school&&input.school!==chosen.school)throw new Error('学校名称与所选学校不一致');
  const school=chosen??named;
  if(!school) {
    if(input.schoolId&&input.schoolId!=='custom')throw new Error('所选学校不存在');
    if(typeof input.college!=='string'||!input.college.trim()||input.college.length>200)throw new Error('请填写学院名称，且不超过 200 字');
    return {schoolId:'custom',school:input.school,college:input.college.trim(),collegeId:'',programId:'',major:input.major,majorCode:'',directionId:'',direction:'',catalog:null};
  }
  const s=catalogSelection(SCHOOL_CATALOG,{...input,school:school.school});
  if(!s.college)throw new Error('请为所选学校选择学院');
  if(!s.program)throw new Error('请为所选学院选择报考专业');
  if(input.directionId&&!s.direction)throw new Error('研究方向不属于所选专业');
  if(s.program.requireDirection&&!s.direction)throw new Error('请选择该专业下的设计相关研究方向');
  return {schoolId:school.id,school:school.school,collegeId:s.college.id,college:s.college.name,programId:s.program.id,major:s.program.name,majorCode:s.program.code,degree:s.program.degree,directionId:s.direction?.id??'',direction:s.direction?.name??'',studyMode:s.direction?.studyMode??'',catalog:structuredClone(s.program.catalog)};
}
