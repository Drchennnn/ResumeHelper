import {SECTIONS} from './schema.js';
export {SECTIONS};

const sectionAliases={job_intention:'intent',work_experience:'experience',certificate:'certificates',language_skills:'languages',social_practices:'social_practice'};
const fieldAliases={
 personal:{address:['city'],personal_workspace_url:['website'],self_introduction:['summary']},
 job_intention:{target_position:['role'],preferred_city:['city'],availability_date:['availability'],expected_salary:['salary']},
 education:{start_date:['start'],end_date:['end'],description:['details']},
 work_experience:{position:['role'],start_date:['start'],end_date:['end'],description:['details']},
 projects:{start_date:['start'],end_date:['end'],description:['details'],project_link:['url']},
 skills:{soft:['other']},certificate:{certificate_name:['name'],certificate_date:['date']},
 language_skills:{language_type:['name'],proficiency_level:['level']}
};
const clean=value=>typeof value==='string'?value.slice(0,20000):typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='boolean'?value:'';
const hasValue=value=>value===true||value===false||(typeof value==='number'&&Number.isFinite(value))||(typeof value==='string'&&value.trim()!=='');

function inputSection(input,section){return input[section.key]!==undefined?input[section.key]:input[sectionAliases[section.key]];}
function normalizeRow(section,value){
 const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{},aliases=fieldAliases[section.key]||{};
 return Object.fromEntries(section.fields.map(field=>{
  let raw=source[field.key];
  if(raw===undefined)for(const alias of aliases[field.key]||[]){if(source[alias]!==undefined){raw=source[alias];break;}}
  if(field.options?.some(option=>option.value==='true')&&field.options?.some(option=>option.value==='false')){
   if(raw==='true')raw=true;
   if(raw==='false')raw=false;
  }
  return [field.key,clean(raw)];
 }));
}

export function createResume(name='我的简历'){return normalizeResume({name});}
export function normalizeResume(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('简历必须是 JSON 对象');
 const out={id:typeof input.id==='string'&&input.id.length<100?input.id:crypto.randomUUID(),name:clean(input.name)||clean(input.resumeName)||'我的简历'};
 for(const section of SECTIONS){
  const value=inputSection(input,section);
  out[section.key]=section.repeatable?(Array.isArray(value)?value.slice(0,30).map(row=>normalizeRow(section,row)):[]):normalizeRow(section,value);
 }
 let extras=clean(input.extras);
 // The old schema had an issuer without a current-site equivalent. Keep that
 // information as free text instead of assigning it to the wrong field.
 if(input.certificate===undefined&&Array.isArray(input.certificates)){
  const issuers=input.certificates.map(item=>clean(item?.issuer)).filter(hasValue);
  if(issuers.length)extras=[extras,...issuers.map(value=>`证书颁发机构：${value}`)].filter(Boolean).join('\n');
 }
 out.extras=extras;
 return out;
}

const displayValue=value=>typeof value==='boolean'?(value?'是':'否'):String(value);
export function flattenResume(resume){
 const out=[];
 for(const section of SECTIONS){
  const rows=section.repeatable?(Array.isArray(resume?.[section.key])?resume[section.key]:[]):[resume?.[section.key]||{}];
  rows.forEach((row,index)=>section.fields.forEach(field=>{
   if(!hasValue(row?.[field.key]))return;
   out.push({path:`${section.key}.${section.repeatable?`${index}.`:''}${field.key}`,label:`${section.title}${section.repeatable?` ${index+1}`:''} / ${field.label}`,value:displayValue(row[field.key])});
  }));
 }
 if(hasValue(resume?.extras))out.push({path:'extras',label:'补充资料',value:String(resume.extras)});
 return out;
}

export function completionStats(resume){
 const sections=SECTIONS.map(section=>{
  const rows=section.repeatable?(Array.isArray(resume?.[section.key])?resume[section.key]:[]):[resume?.[section.key]||{}];
  const total=rows.length*section.fields.length;let filled=0;
  for(const row of rows)for(const field of section.fields)if(hasValue(row?.[field.key]))filled+=1;
  return {key:section.key,title:section.title,filled,total,missing:total-filled,percent:total?Math.round(filled/total*100):0};
 });
 const filled=sections.reduce((sum,item)=>sum+item.filled,0),total=sections.reduce((sum,item)=>sum+item.total,0);
 return {filled,total,missing:total-filled,percent:total?Math.round(filled/total*100):0,sections,bySection:Object.fromEntries(sections.map(item=>[item.key,item]))};
}

export function resolvePlan(raw,fields,resume){
 const factList=flattenResume(resume),facts=new Map(factList.map(fact=>[fact.path,fact])),ids=new Map(fields.map(field=>[field.id,field])),seen=new Set(),items=[];
 for(const mapping of Array.isArray(raw?.mappings)?raw.mappings:[]){
  if(!mapping||seen.has(mapping.fieldId)||!ids.has(mapping.fieldId)||!facts.has(mapping.sourcePath))continue;
  const fact=facts.get(mapping.sourcePath),field=ids.get(mapping.fieldId);let value=fact.value;
  const metadata=metadataCandidates(field,factList);
  if(metadata!==null&&!metadata.some(candidate=>candidate.path===fact.path))continue;
  if(fact.path==='extras'&&normalizedLabel(field.label)!=='补充说明')continue;
  const options=Array.isArray(field.options)?field.options:[],nativeSelect=['select-one','select-multiple'].includes(field.type);
  if(nativeSelect&&!options.length)continue;
  if(options.length){
   const option=options.find(item=>String(item.value)===String(mapping.optionValue));
   if(!option||!optionMatchesFact(option,fact))continue;
   value=option.value;
  }
  seen.add(mapping.fieldId);
  items.push({fieldId:mapping.fieldId,sourcePath:mapping.sourcePath,label:field.label,sourceLabel:fact.label,value,displayValue:field.options?.find(option=>option.value===value)?.label||displayValue(value)});
 }
 return items;
}

const manualAliases={
 'personal.name':['姓名','name','fullname'],'personal.email':['邮箱','电子邮件','email'],
 'personal.phone':['手机','联系电话','电话','phone','mobile'],
 'education.school':['学校','学校名称','院校','院校名称','毕业学校','school','university'],
 'education.major':['专业','专业名称','major'],'education.degree':['学历','学历层次','教育程度','degree'],
 'education.department':['学院','院系','院系名称','department'],'education.advisor_name':['导师','导师姓名','advisor'],
 'education.research_focus':['研究方向','领域方向','研究领域','research focus'],
 'education.start_date':['入学时间','入学日期','开始时间','开始日期','起始时间'],
 'education.end_date':['毕业时间','毕业日期','结束时间','结束日期'],
 'education.date_range':['起止时间','起止日期','学习时间','就读时间'],
 'skills.technical':['技术技能','技能','skills'],
 'personal.self_introduction':['个人介绍','自我介绍','自我评价','summary'],
 'job_intention.target_position':['目标岗位','意向岗位','role'],
 'job_intention.preferred_city':['期望城市','意向城市','期望工作地点','意向工作地点'],
 'personal.personal_workspace_url':['个人网站','个人主页','作品链接','website']
};
for(const sectionKey of ['internships','projects','cadre_experiences','work_experience','social_practices','training']){
 manualAliases[`${sectionKey}.start_date`]=['开始时间','开始日期','起始时间','起始日期'];
 manualAliases[`${sectionKey}.end_date`]=['结束时间','结束日期','截止时间','截止日期'];
 manualAliases[`${sectionKey}.date_range`]=['起止时间','起止日期','时间范围'];
}
const schemaAliases={};
for(const section of SECTIONS)for(const field of section.fields)schemaAliases[`${section.key}.${field.key}`]=[field.label.toLowerCase()];
const aliases={...schemaAliases,...Object.fromEntries(Object.entries(manualAliases).map(([key,values])=>[key,[...(schemaAliases[key]||[]),...values.map(value=>value.toLowerCase())]]))};
const normalizedLabel=value=>String(value||'').toLowerCase().replace(/[\s*：:（）()]/g,'');
const sectionNames={
 personal:['个人信息','基本信息'],job_intention:['求职意向','求职偏好'],education:['教育背景','教育经历'],
 internships:['实习经历','实习经验'],projects:['项目经历','项目经验'],cadre_experiences:['校园经历','学生工作'],
 work_experience:['工作经历','工作经验'],social_practices:['社会实践'],skills:['技能专长','技能'],
 certificate:['证书','证书信息'],language_skills:['外语能力','语言能力'],family_relations:['家庭情况','家庭成员'],
 awards:['获奖经历','荣誉奖励'],patents:['专利信息','专利'],publications:['论文发表','论文'],training:['培训经历','培训']
};
const sectionByName=new Map(SECTIONS.flatMap(section=>[
 [normalizedLabel(section.key),section.key],[normalizedLabel(section.title),section.key],
 ...(sectionNames[section.key]||[]).map(name=>[normalizedLabel(name),section.key])
]));

function sectionKeyOf(value){
 const normalized=normalizedLabel(value);
 if(!normalized)return undefined;
 if(sectionByName.has(normalized))return sectionByName.get(normalized);
 const matches=[...sectionByName].filter(([name])=>name.length>=3&&normalized.includes(name)).map(([,key])=>key);
 return matches.length&&matches.every(key=>key===matches[0])?matches[0]:undefined;
}
function optionComparable(value,sourcePath){
 const normalized=normalizedLabel(value).replace(/[、,，/\\-]/g,'');
 if(!/(^|\.)(degree|highest_degree)$/.test(sourcePath))return normalized;
 if(/博士/.test(normalized))return 'doctor';
 if(/硕士/.test(normalized))return 'master';
 if(/本科|学士/.test(normalized))return 'bachelor';
 if(/专科|大专|高职/.test(normalized))return 'college';
 return normalized;
}
function optionMatchesFact(option,fact){
 const target=optionComparable(fact.value,fact.path);
 return [option.value,option.label].some(value=>optionComparable(value,fact.path)===target);
}
const metadataFieldAliases={projects:{project_name:'name'}};
const personalIntentCityLabels=new Set(['期望城市','意向城市','期望工作地点','意向工作地点'].map(normalizedLabel));
function metadataCandidates(field,facts){
 const rawKey=String(field.fieldKey||'');
 const keyParts=rawKey.split('.').filter(Boolean);
 const keySection=keyParts.length>1?sectionKeyOf(keyParts[0]):undefined;
 const declaredSection=sectionKeyOf(field.section);
 if(keySection&&declaredSection&&keySection!==declaredSection)return [];
 const sectionKey=keySection||declaredSection;
 const rawFieldKey=keyParts.at(-1)||undefined;
 const fieldKey=sectionKey&&rawFieldKey?(metadataFieldAliases[sectionKey]?.[rawFieldKey]||rawFieldKey):rawFieldKey;
 if(declaredSection==='personal'&&!keySection&&!rawFieldKey&&personalIntentCityLabels.has(normalizedLabel(field.label))){
  return facts.filter(fact=>fact.path==='job_intention.preferred_city');
 }
 if(!sectionKey&&!fieldKey)return null;
 const schemaSection=sectionKey&&SECTIONS.find(section=>section.key===sectionKey);
 if(sectionKey&&fieldKey&&!schemaSection?.fields.some(item=>item.key===fieldKey))return [];
 let candidates=facts.filter(fact=>{
  const parts=fact.path.split('.');
  return (!sectionKey||parts[0]===sectionKey)&&(!fieldKey||parts.at(-1)===fieldKey);
 });
 const groupIndex=Number(field.groupIndex);
 if(field.groupIndex!==undefined&&field.groupIndex!==null&&schemaSection?.repeatable&&Number.isInteger(groupIndex)&&groupIndex>=0){
  candidates=candidates.filter(fact=>Number(fact.path.split('.')[1])===groupIndex);
 }
 return candidates;
}
export function localPlan(fields,resume){
 const facts=flattenResume(resume),mappings=[];
 for(const field of fields){
  const label=normalizedLabel(field.label),metadata=metadataCandidates(field,facts);
  const labelCandidates=facts.filter(fact=>{const parts=fact.path.split('.'),sourceKey=`${parts[0]}.${parts.at(-1)}`;return (aliases[sourceKey]||[]).some(alias=>label===normalizedLabel(alias));});
  let candidates=metadata===null?labelCandidates:metadata.filter(fact=>{
   if(field.fieldKey)return true;
   return labelCandidates.some(candidate=>candidate.path===fact.path);
  });
  if(candidates.length!==1)continue;
  const fact=candidates[0];let optionValue;
  const options=Array.isArray(field.options)?field.options:[],nativeSelect=['select-one','select-multiple'].includes(field.type);
  if(nativeSelect&&!options.length)continue;
  if(options.length){const option=options.find(item=>optionMatchesFact(item,fact));if(!option)continue;optionValue=option.value;}
  mappings.push({fieldId:field.id,sourcePath:fact.path,optionValue});
 }
 return resolvePlan({mappings},fields,resume);
}
