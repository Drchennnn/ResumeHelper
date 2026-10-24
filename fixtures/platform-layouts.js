import '../extension/site-adapters.js';
import {localPlan,normalizeResume} from '../extension/lib/model.js';
globalThis.chrome={runtime:{id:'local-layout-fixture',onMessage:{addListener(){}}}};
await import('../extension/content.js');
const result=document.querySelector('#result'),root=document.querySelector('#fixture');
const resume=normalizeResume({education:[{school:'虚构甲大学',major:'人工智能'},{school:'虚构乙大学',major:'计算机科学'}],projects:[{name:'虚构检索系统',description:'虚构检索项目描述'},{name:'虚构预测系统',description:'虚构预测项目描述'}]});
const layouts=[
 {id:'atsx',title:'教育背景',section:'createFormSection',heading:'createFormSection-title',record:'resumeEditForm-item',container:'atsx-form-item',label:'atsx-form-item-label',labels:['学校名称','专业名称']},
 {id:'mokahr',title:'教育背景',section:'apply-block-education',heading:'blockTitle-demo',record:'apply-fields-record',container:'field-line',label:'title-field',labels:['学校名称','专业名称']},
 {id:'feishu',title:'项目经历',section:'applyFormModuleWrapper',heading:'applyFormModuleWrapper-text',record:'apply-form-array-card__record',container:'ud-formily-item',label:'field-label',labels:['项目名称','项目描述']},
];
document.querySelector('#run').onclick=async()=>{
 result.textContent='';
 try{for(const layout of layouts){
  const heading=layout.id==='mokahr'?`<h2 class="${layout.heading}"><span class="text-title">${layout.title}</span></h2>`:`<h2 class="${layout.heading}">${layout.title}</h2>`;
  root.innerHTML=`<section class="${layout.section}">${heading}<div class="records">${[0,1].map(()=>`<div class="${layout.record}">${layout.labels.map(label=>`<div class="${layout.container}"><span class="${layout.label}">${label}</span><input ${layout.id==='feishu'?`data-form-field-i18n-name="${label}"`:''}></div>`).join('')}</div>`).join('')}</div></section>`;
  const scan=globalThis.__personalResumeBridge.scan();
  if(scan.fields.length!==4||scan.fields.some(field=>field.section!==layout.title))throw new Error(`${layout.id} 分区识别失败`);
  if(scan.fields.some((field,index)=>field.groupIndex!==Math.floor(index/2)))throw new Error(`${layout.id} 重复记录边界失败`);
  const items=localPlan(scan.fields,resume);
  if(items.length!==4)throw new Error(`${layout.id} 预期4项，实际${items.length}`);
  const outcomes=await globalThis.__personalResumeBridge.apply(items,false);
  if(outcomes.some(item=>item.status!=='applied'))throw new Error(`${layout.id} 填写失败`);
  result.textContent+=`PASS ${layout.id}：分区、标签、两条记录、4项填写及回读\n`;
 }
 result.textContent+='全部通过；未调用模型或提交表单。';
 }catch(error){result.textContent+=`FAIL ${error.message}`;}
};
