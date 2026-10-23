import {localPlan,createResume} from '../extension/lib/model.js';
const result=document.querySelector('#result');
document.querySelector('#run').onclick=async()=>{
 const checks=[];const check=(ok,label)=>{checks.push(`${ok?'PASS':'FAIL'} ${label}`);result.textContent=checks.join('\n');if(!ok)throw new Error(label);};
 try{
  const resume=createResume('虚构交互验收');resume.personal.name='虚构姓名';resume.personal.gender='女';resume.personal.marital_status='未婚';resume.personal.political_status='群众';resume.job_intention.preferred_city='深圳；北京';resume.education=[{school:'虚构本科大学',degree:'本科',start_date:'2020-09',end_date:'2024-06'},{school:'虚构研究生大学',degree:'硕士',start_date:'2024-09',end_date:'2027-06'}];
  resume.personal.native_place='广东省 / 深圳市 / 南山区';
  await globalThis.__personalResumeWorkflow.prepare({education:2});check(document.querySelectorAll('.apply-form-array-card-content').length===2,'按资料数量新增教育记录');
  const scan=await globalThis.__personalResumeBridge.scan();const plan=localPlan(scan.fields,resume);const outcomes=await globalThis.__personalResumeBridge.apply(plan.map(({fieldId,value})=>({fieldId,value})),false);
  document.querySelector('#debug')?.remove();const debug=document.createElement('details');debug.id='debug';const heading=document.createElement('summary');heading.textContent='查看字段、匹配与结果';const pre=document.createElement('pre');pre.textContent=JSON.stringify({fields:scan.fields,plan,outcomes},null,2);debug.append(heading,pre);document.body.append(debug);
  check(document.querySelector('#formily-item-name input').value==='已有姓名请保留','保护已有姓名');
  const rows=[...document.querySelectorAll('.apply-form-array-card-content')];
  for(const [i,row]of rows.entries()){
   check(row.querySelector('[data-form-field-name="school"]').value===resume.education[i].school,`第${i+1}段学校映射正确`);
   check(row.querySelector('.ud__select__selector__selectItem').textContent===resume.education[i].degree,`第${i+1}段学历真实候选点击`);
   const dates=[...row.querySelectorAll('.throne-biz-date-range-picker-wrapper input')];check(dates[0].dataset.committed===resume.education[i].start_date&&dates[1].dataset.committed===resume.education[i].end_date,`第${i+1}段年月面板选择并提交组件状态`);
  }
  const cities=document.querySelector('#formily-item-preferred_city_list .ud__select__selector__selectItem').textContent;check(cities.includes('深圳')&&cities.includes('北京'),'城市多选');
  for(const [label,value]of [['性别','女'],['婚姻状况','未婚'],['政治面貌','群众']])check(document.querySelector(`[aria-label="${label}"]`).getAttribute('aria-valuetext')===value,`${label}通用候选点击与状态读回`);
  check(document.querySelector('[aria-label="籍贯"]').value===resume.personal.native_place,'分级地区逐层等待并点击');
  check(outcomes.every(item=>item.status==='applied'||item.reason==='non_empty'),'所有匹配项成功或保护已有内容');
  check(document.body.dataset.submitted!=='true','从未点击完成/提交');check(outcomes.some(x=>x.status==='applied'),'生产引擎返回填写结果');result.textContent+=`\n${checks.length}项通过 · ${scan.fields.length}个字段 · ${plan.length}项匹配\n`;
 }catch(e){result.textContent+=`\n错误：${e.message}`;}
};
