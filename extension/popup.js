import {loadState} from './lib/storage.js';
import {localPlan} from './lib/model.js';
const $=id=>document.getElementById(id);
let state,tabId,fields=[],items=[],scanUrl='',control={enabled:false};
let attachmentItems=[],attachmentTargets=[],attachmentTabId=null,attachmentTabUrl='',attachmentRefreshToken=0;
function status(text){$('status').textContent=text;}
function busy(value){for(const id of ['floating','scan','local','ai','apply','resume','control'])$(id).disabled=value;}
async function run(work){busy(true);try{await work();}catch(error){status(error.message||'操作失败');}finally{busy(false);}}
async function message(payload){const result=await chrome.runtime.sendMessage(payload);if(!result?.ok)throw new Error(result?.error||result?.message||result?.reason||result?.status||'扩展后台没有响应');return result;}
const attachmentKind={resume:'简历',transcript:'成绩单',certificate:'证书',other:'其他'};
function formatBytes(bytes){if(bytes===null||bytes===undefined||bytes===''||!Number.isFinite(Number(bytes)))return '大小未知';const value=Number(bytes);if(value<1024)return `${value} B`;if(value<1024*1024)return `${(value/1024).toFixed(1)} KB`;return `${(value/1024/1024).toFixed(1)} MB`;}
function attachmentStatus(text,error=false){$('attachment-status').textContent=text;$('attachment-status').classList.toggle('error',error);}
function managerUrl(){$('attachments-manage').href=chrome.runtime.getURL(`attachments.html?resumeId=${encodeURIComponent($('resume').value)}`);}
async function activeHttpTab(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!/^https?:\/\//i.test(tab.url||''))throw new Error('请在普通网页中选择附件，浏览器设置页不支持。');return tab;}
function renderAttachmentOptions(){
 const attachment=$('attachment'),target=$('attachment-target');attachment.replaceChildren();target.replaceChildren();
 for(const item of attachmentItems){const option=document.createElement('option');option.value=item.id;option.textContent=`${item.name} · ${attachmentKind[item.kind]||item.kind||'附件'} · ${formatBytes(item.size)}`;attachment.append(option);}
 for(const item of attachmentTargets){const option=document.createElement('option');option.value=item.id;option.textContent=`${item.label||'文件控件'}${item.accept?` · ${item.accept}`:''}${item.selectedCount?` · 已选 ${item.selectedCount} 个`:''}`;target.append(option);}
 $('attachment-apply').disabled=!attachmentItems.length||!attachmentTargets.length;
 if(!attachmentItems.length)attachmentStatus('当前简历没有本地附件，请先打开附件库添加。');
 else if(!attachmentTargets.length)attachmentStatus('当前页面没有可用的文件控件。');
}
async function refreshAttachments(){
 const token=++attachmentRefreshToken,button=$('attachment-refresh');button.disabled=true;$('attachment-apply').disabled=true;
 try{
  managerUrl();const tab=await activeHttpTab();attachmentTabId=tab.id;attachmentTabUrl=tab.url;
  const safeUrl=new URL(tab.url);$('attachment-page').textContent=`目标网址：${safeUrl.origin}${safeUrl.pathname}`;
  const [library,page]=await Promise.all([
   message({type:'ATTACHMENTS_LIST',resumeId:$('resume').value}),
   message({type:'ATTACHMENT_TARGETS',tabId:tab.id})
  ]);
  if(token!==attachmentRefreshToken)return;
  attachmentItems=Array.isArray(library.items)?library.items:[];
  attachmentTargets=(Array.isArray(page.targets)?page.targets:[]).filter(item=>!item.disabled);
  renderAttachmentOptions();
  if(attachmentItems.length&&attachmentTargets.length)attachmentStatus(`已找到 ${attachmentItems.length} 个附件和 ${attachmentTargets.length} 个页面文件控件。选择操作可能触发网站立即上传。`);
 }catch(error){if(token===attachmentRefreshToken){attachmentItems=[];attachmentTargets=[];renderAttachmentOptions();attachmentStatus(error.message||'附件信息读取失败',true);}}
 finally{if(token===attachmentRefreshToken)button.disabled=false;}
}
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
$('resume').onchange=()=>{fields=[];items=[];$('preview').hidden=true;managerUrl();status('简历已切换，请重新识别页面。');if($('attachments-panel').open)refreshAttachments();};
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
$('attachments-panel').ontoggle=()=>{if($('attachments-panel').open)refreshAttachments();};
$('attachment-refresh').onclick=refreshAttachments;
$('attachment-apply').onclick=async()=>{
 const button=$('attachment-apply');button.disabled=true;
 try{
  const tab=await activeHttpTab();if(tab.id!==attachmentTabId||tab.url!==attachmentTabUrl)throw new Error('当前页面已变化，请重新识别文件控件。');
  const attachment=attachmentItems.find(item=>item.id===$('attachment').value);const target=attachmentTargets.find(item=>item.id===$('attachment-target').value);
  if(!attachment||!target)throw new Error('请选择附件和页面文件控件。');
  attachmentStatus(`正在为当前页面选择“${attachment.name}”…`);
  const result=await message({type:'ATTACHMENT_APPLY',tabId:tab.id,targetId:target.id,attachmentId:attachment.id});
  if(result.status!=='selected_for_review')throw new Error(result.error||result.message||'附件未能选择到页面。');
  attachmentStatus(`已选择附件“${attachment.name}”；请在页面复核。网站是否接收成功仍以页面显示为准。`);
 }catch(error){attachmentStatus(error.message||'附件选择失败',true);}
 finally{button.disabled=!attachmentItems.length||!attachmentTargets.length;}
};
run(async()=>{state=await loadState();for(const resume of state.resumes){const option=document.createElement('option');option.value=resume.id;option.textContent=resume.name;$('resume').append(option);}$('resume').value=state.activeId;managerUrl();await refreshControl();});
