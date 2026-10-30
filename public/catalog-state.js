// Shared, side-effect-free selectors for school → college → program → direction.
export function catalogSelection(templates, target) {
  const school=templates.find(s=>s.id!=='custom'&&s.school===target.school);
  const colleges=school?.colleges??[];
  const college=colleges.find(c=>c.id===target.collegeId);
  const specificType=['推免面试','研究生复试'].includes(target.admissionType);
  const programs=(college?.programs??[]).filter(p=>!specificType||!p.admissionTypes||p.admissionTypes.includes(target.admissionType));
  const program=programs.find(p=>p.id===target.programId);
  const directions=(program?.directions??[]).filter(d=>!specificType||!d.admissionTypes||d.admissionTypes.includes(target.admissionType));
  const direction=directions.find(d=>d.id===target.directionId);
  return {school,colleges,college,programs,program,directions,direction};
}
export function clearTargetRules(target, materials) {
  const next={...target,rulesText:'',rubricText:'',official:[],officialRubric:null};
  const selected={...materials};delete selected.rules;delete selected.rubric;
  return {target:next,materials:selected};
}
export function changeCatalogTarget(templates,target,materials,field,value) {
  let next={...target};
  if(field==='school')next={...next,school:value,collegeId:'',college:'',programId:'',major:'',directionId:'',direction:'',majorCode:''};
  else if(field==='collegeId')next={...next,collegeId:value,programId:'',major:'',directionId:'',direction:'',majorCode:''};
  else if(field==='programId')next={...next,programId:value,directionId:'',direction:''};
  else next[field]=value;
  const selection=catalogSelection(templates,next);
  if(selection.school){
    next.collegeId=selection.college?.id??'';
    next.programId=selection.program?.id??'';
    next.directionId=selection.direction?.id??'';
    next.college=selection.college?.name??'';
    next.major=selection.program?.name??'';
    next.majorCode=selection.program?.code??'';
    next.direction=selection.direction?.name??'';
  }
  return clearTargetRules(next,materials);
}
export function targetLabel(target) {
  return [target.school,target.college,target.majorCode?`${target.majorCode} ${target.major}`:target.major,target.direction].filter(Boolean).join(' / ');
}
export function reconcileCatalogDraft(templates,target,materials) {
  const s=catalogSelection(templates,target);
  const invalid=s.school&&((target.collegeId&&!s.college)||(target.programId&&!s.program)||(target.directionId&&!s.direction));
  return invalid?{changed:true,...changeCatalogTarget(templates,target,materials,'year',target.year)}:{changed:false,target,materials};
}
