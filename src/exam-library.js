import data from './exam-library-data.json' with {type:'json'};

/** Versioned excerpts of official rules, never inferred interview weights. */
export function getExamLibrary() {return structuredClone(data);}

/** A programme code is meaningful only inside its school and college. */
export function matchExamRecord(record,target) {
  if(!record||!target)return false;
  const code=String(target.majorCode??target.programCode??'');
  return record.schoolId===target.schoolId
    &&record.collegeId===target.collegeId
    &&record.programCodes.includes(code)
    &&String(record.year)===String(target.year)
    &&record.admissionType===target.admissionType
    &&(!record.directionIds?.length||record.directionIds.includes(String(target.directionId??'')));
}

/** Return a detached snapshot only after exact target and source verification. */
export function getExamRecord(id,target) {
  const record=data.records.find(r=>r.id===id);
  if(!record)throw new Error('考核库条目不存在');
  if(!matchExamRecord(record,target))throw new Error('考核库条目与本次学校、学院、专业、方向、年份或招生类型不匹配');
  if(record.verification!=='official'||!record.loadable)throw new Error('该考核原文尚待核验，不能作为本场评分依据');
  return structuredClone(record);
}
