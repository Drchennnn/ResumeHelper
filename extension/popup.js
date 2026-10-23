import {loadState} from './lib/storage.js';
import {localPlan} from './lib/model.js';
const $=id=>document.getElementById(id);
let state,tabId,fields=[],items=[],scanUrl='',control={enabled:false};
function status(text){$('status').textContent=text;}
function busy(value){for(const id of ['floating','scan','local','ai','apply','resume','control'])$(id).disabled=value;}
async function run(work){busy(true);try{await work();}catch(error){status(error.message||'操作失败');}finally{busy(false);}}
async function message(payload){const result=await chrome.runtime.sendMessage(payload);if(!result?.ok)throw new Error(result?.error||'扩展后台没有响应');return result;}
async function refreshControl(){control=(await message({type:'CONTROL_STATUS'})).control;$('control').textContent=control.enabled?'关闭浏览器输入控制':'启用浏览器输入控制';$('control-status').textContent=control.enabled?'已启用：DOM 失败后尝试可信输入与点击。':'未启用：使用 DOM 填写，失败项会说明原因。';$('vision').disabled=!control.enabled;if(!control.enabled)$('vision').checked=false;}
function render(){
 const rows=$('rows');rows.replaceChildren();$('count').textContent=`${items.length} / ${fields.length} 项`;
 for(const [index,item] of items.entries()){
  const row=document.createElement('div');row.className='row';
  const input=document.createElement('input');input.type='checkbox';input.checked=true;input.id=`item-${index}`;input.dataset.index=index;
  const label=document.createElement('label');label.htmlFor=input.id;
  const title=document.createElement('strong');title.textContent=item.label;
  const value=document.createElement('small');value.textContent=item.displayValue;
  label.append(title,value);row.append(input,label);rows.append(row);
 }
 if(!items.length){const p=document.createElement('p');p.textContent='暂无确定匹配，可使用 AI，或先补充简历资料。';rows.append(p);}
}
async function aiMatch(){const result=await message({type:'MATCH',fields,resumeId:$('resume').value});items=result.items;render();status(`AI 已匹配 ${items.length} / ${fields.length} 项。请检查经历对应和每项内容后填写。`);}
async function scan(useAI){
 fields=[];items=[];tabId=null;scanUrl='';$('preview').hidden=true;state=await loadState();
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 if(!tab?.id||!/^https?:/.test(tab.url||''))throw new Error('请在普通网页中使用，浏览器设置页不支持。');
 tabId=tab.id;scanUrl=tab.url;
 await chrome.scripting.executeScript({target:{tabId},files:['content.js']});
 const result=await chrome.tabs.sendMessage(tabId,{type:'SCAN'});if(result.error)throw new Error(result.error);
 fields=result.fields||[];if(fields.length>250)throw new Error('当前页面字段过多，请使用悬浮助手选区填写。');
 items=localPlan(fields,state.resumes.find(resume=>resume.id===$('resume').value));$('preview').hidden=false;render();
 status(`识别到 ${fields.length} 个字段，本地确定匹配 ${items.length} 项。`);
 if(useAI){try{await aiMatch();}catch(error){status(`AI 匹配未完成：${error.message}。已保留 ${items.length} 项本地匹配，可检查后填写或重试 AI。`);}}
}
$('floating').onclick=()=>run(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!/^https?:/.test(tab.url||''))throw new Error('请在普通网页中使用悬浮助手');await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js','workflow.js','floating.js']});status('页面右下角已显示悬浮助手。');});
$('manage').onclick=()=>chrome.runtime.openOptionsPage();
$('resume').onchange=()=>{fields=[];items=[];$('preview').hidden=true;status('简历已切换，请重新识别页面。');};
$('scan').onclick=()=>run(()=>scan(true));
$('local').onclick=()=>run(()=>scan(false));
$('ai').onclick=()=>run(aiMatch);
$('control').onclick=async()=>{
 try{
  if(control.enabled){await message({type:'SET_CONTROL_SETTINGS',enabled:false});}
  else{await message({type:'SET_CONTROL_SETTINGS',enabled:true});}
  await refreshControl();
 }catch(error){status(error.message||'浏览器控制设置失败');}
};
$('apply').onclick=()=>run(async()=>{
 const current=await chrome.tabs.get(tabId);if(current.url!==scanUrl)throw new Error('页面地址已改变，请重新识别。');
 const selected=[...$('rows').querySelectorAll('input:checked')].map(input=>items[Number(input.dataset.index)]);
 if(!selected.length)throw new Error('请先选择要填写的项目');
 const result=await chrome.tabs.sendMessage(tabId,{type:'APPLY',items:selected.map(({fieldId,value,sourcePath})=>({fieldId,value,sourcePath})),overwrite:$('overwrite').checked,options:{resumeId:$('resume').value,browserControl:control.enabled,visionFallback:control.enabled&&$('vision').checked}});
 if(result.error)throw new Error(result.error);
 const counts={};for(const entry of result.results||[])counts[entry.status]=(counts[entry.status]||0)+1;
 const protectedCount=(result.results||[]).filter(entry=>entry.reason==='non_empty').length;
 status(`填写结果：${Object.entries(counts).map(([key,value])=>`${({applied:'成功',skipped:'跳过',failed:'失败'})[key]||key} ${value} 项` ).join('，')}${protectedCount?`（保护已有内容 ${protectedCount} 项）`:''}。请在页面复核。`);
});
run(async()=>{state=await loadState();for(const resume of state.resumes){const option=document.createElement('option');option.value=resume.id;option.textContent=resume.name;$('resume').append(option);}$('resume').value=state.activeId;await refreshControl();});
