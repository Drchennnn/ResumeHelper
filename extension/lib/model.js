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
 const facts=new Map(flattenResume(resume).map(fact=>[fact.path,fact])),ids=new Map(fields.map(field=>[field.id,field])),seen=new Set(),items=[];
 for(const mapping of Array.isArray(raw?.mappings)?raw.mappings:[]){
  if(!mapping||seen.has(mapping.fieldId)||!ids.has(mapping.fieldId)||!facts.has(mapping.sourcePath))continue;
  const fact=facts.get(mapping.sourcePath),field=ids.get(mapping.fieldId);let value=fact.value;
  if(field.options?.length){const option=field.options.find(item=>item.value===mapping.optionValue);if(!option)continue;value=option.value;}
  seen.add(mapping.fieldId);
  items.push({fieldId:mapping.fieldId,sourcePath:mapping.sourcePath,label:field.label,sourceLabel:fact.label,value,displayValue:field.options?.find(option=>option.value===value)?.label||displayValue(value)});
 }
 return items;
}

const manualAliases={
 'personal.name':['姓名','name','fullname'],'personal.email':['邮箱','电子邮件','email'],
 'personal.phone':['手机','联系电话','电话','phone','mobile'],'education.school':['学校','school','university'],
 'education.major':['专业','major'],'education.degree':['学历','degree'],'skills.technical':['技术技能','技能','skills'],
 'personal.self_introduction':['个人介绍','自我介绍','自我评价','summary'],
 'job_intention.target_position':['目标岗位','意向岗位','role'],'job_intention.preferred_city':['期望城市','意向城市'],
 'personal.personal_workspace_url':['个人网站','个人主页','作品链接','website']
};
const schemaAliases={};
for(const section of SECTIONS)for(const field of section.fields)schemaAliases[`${section.key}.${field.key}`]=[field.label.toLowerCase()];
const aliases={...schemaAliases,...Object.fromEntries(Object.entries(manualAliases).map(([key,values])=>[key,[...(schemaAliases[key]||[]),...values.map(value=>value.toLowerCase())]]))};
const normalizedLabel=value=>String(value||'').toLowerCase().replace(/[\s*：:（）()]/g,'');
export function localPlan(fields,resume){
 const facts=flattenResume(resume),mappings=[];
 for(const field of fields){
  const label=normalizedLabel(field.label),candidates=facts.filter(fact=>{const parts=fact.path.split('.'),sourceKey=`${parts[0]}.${parts.at(-1)}`;return (aliases[sourceKey]||[]).some(alias=>label===normalizedLabel(alias));});
  if(candidates.length!==1)continue;
  const fact=candidates[0];let optionValue;
  if(field.options?.length){const option=field.options.find(item=>String(item.label)===fact.value||String(item.value)===fact.value);if(!option)continue;optionValue=option.value;}
  mappings.push({fieldId:field.id,sourcePath:fact.path,optionValue});
 }
 return resolvePlan({mappings},fields,resume);
}
