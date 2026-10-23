import {loadState} from './lib/storage.js';
import {flattenResume,localPlan} from './lib/model.js';
import {matchFields,requestJSON,endpoint} from './lib/ai.js';
import {fillWithBrowserControl,stopBrowserControl} from './lib/browser-control.js';
import {getAttachmentForUpload,listAttachments} from './lib/attachments.js';
import {scanAttachmentTargets,applyStoredAttachment} from './lib/attachment-control.js';
const CONTROL_PREFS='personalResumeControlV1';
const attachmentScans=new Map();
async function attachmentTab(tabId){
 const [active]=await chrome.tabs.query({active:true,currentWindow:true});
 if(!Number.isInteger(tabId)||active?.id!==tabId||!/^https?:/.test(active.url||''))throw new Error('请在目标招聘网页打开扩展后重新扫描附件栏');
 return active;
}
async function controlState(){
 const stored=(await chrome.storage.local.get(CONTROL_PREFS))[CONTROL_PREFS]||{};
 const permitted=Boolean(await chrome.permissions?.contains?.({permissions:['debugger']}));
 return {permitted,enabled:permitted&&stored.enabled===true};
}
chrome.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||!message||typeof message!=='object')return false;
 const trusted=sender.url?.startsWith(chrome.runtime.getURL(''));
 const page=sender.tab&&/^https?:/.test(sender.url||'');
 if(!trusted&&!page)return false;
 (async()=>{
  if(message.type==='OPEN_WORKBENCH'){await chrome.runtime.openOptionsPage();return {ok:true};}
  if(message.type==='OPEN_ATTACHMENTS'){
   const url=new URL(chrome.runtime.getURL('attachments.html'));
   if(typeof message.resumeId==='string')url.searchParams.set('resumeId',message.resumeId.slice(0,200));
   await chrome.tabs.create({url:url.href});return {ok:true};
  }
  if(['ATTACHMENTS_LIST','ATTACHMENT_TARGETS','ATTACHMENT_APPLY'].includes(message.type)&&!trusted)throw new Error('附件操作仅限扩展弹窗或附件库');
  if(message.type==='ATTACHMENT_TARGETS'){
   const tab=await attachmentTab(message.tabId);
   const result=await scanAttachmentTargets(tab.id);
   if(result.ok)attachmentScans.set(tab.id,{url:tab.url,time:Date.now(),ids:new Set(result.targets.map(target=>target.id))});
   return {...result,url:tab.url};
  }
  if(message.type==='ATTACHMENT_APPLY'){
   const tab=await attachmentTab(message.tabId);
   const scan=attachmentScans.get(tab.id);
   if(!scan||scan.url!==tab.url||Date.now()-scan.time>600000||!scan.ids.has(message.targetId))throw new Error('附件栏已变化或预览已过期，请重新扫描');
   const attachment=await getAttachmentForUpload(message.attachmentId);
   if(attachment.source==='path'&&!(await controlState()).enabled)throw new Error('本地路径需要浏览器文件控制，请先启用“浏览器输入控制”；或使用预先保存的文件');
   return applyStoredAttachment({tabId:tab.id,targetId:message.targetId,attachmentId:message.attachmentId});
  }
  if(message.type==='TEST_API'&&!trusted)throw new Error('此请求仅限扩展设置页面');
  const state=await loadState();
  if(message.type==='PANEL_STATE')return {ok:true,resumes:state.resumes.map(({id,name})=>({id,name})),activeId:state.activeId,aiConfigured:Boolean(state.settings.baseUrl&&state.settings.model),apiHost:(()=>{try{return new URL(state.settings.baseUrl).host;}catch{return '';}})(),control:await controlState()};
  if(message.type==='CONTROL_STATUS')return {ok:true,control:await controlState()};
  if(message.type==='SET_CONTROL_SETTINGS'){
   if(!trusted)throw new Error('请在扩展弹窗设置浏览器控制');
   const control=await controlState();
   if(message.enabled&&!control.permitted)throw new Error('当前安装缺少调试权限，请重新加载扩展');
   if(message.enabled!==true)stopBrowserControl();
   await chrome.storage.local.set({[CONTROL_PREFS]:{enabled:message.enabled===true}});
   return {ok:true,control:await controlState()};
  }
  if(message.type==='CONTROL_CANCEL'){
   if(!page)throw new Error('缺少当前网页');
   stopBrowserControl(sender.tab.id);
   return {ok:true,cancelled:true};
  }
  if(message.type==='TEST_API'){const settings=message.settings||state.settings;endpoint(settings);await requestJSON(settings,'Return only JSON {"ok":true}.',{});return {ok:true};}
  const resume=state.resumes.find(r=>r.id===message.resumeId);
  if(!resume)throw new Error('简历不存在，请重新打开助手');
  if(message.type==='ATTACHMENTS_LIST')return {ok:true,items:await listAttachments({resumeId:resume.id})};
  if(message.type==='RESUME_FACTS')return {ok:true,facts:flattenResume(resume)};
  if(message.type==='CONTROL_FILL'){
   if(!page||sender.frameId>0)throw new Error('浏览器控制仅支持当前页面主框架');
   if(!(await controlState()).enabled)return {ok:true,status:'skipped',reason:'browser_control_disabled'};
   const fact=flattenResume(resume).find(item=>item.path===message.sourcePath);
   if(!fact||typeof message.fieldId!=='string'||message.fieldId.length>160)throw new Error('缺少经过确认的字段或简历资料');
   try{
    const result=await fillWithBrowserControl({tabId:sender.tab.id,fieldId:message.fieldId,value:fact.value,overwrite:message.overwrite===true,vision:message.vision===true,settings:state.settings});
    return {ok:true,...result};
   }finally{
    await chrome.tabs.sendMessage(sender.tab.id,{type:'CONTROL_END'}).catch(()=>{});
   }
  }
  if(message.type==='MATCH'||message.type==='LOCAL_MATCH'){
   if(!Array.isArray(message.fields)||message.fields.length>250)throw new Error('字段数量应在 250 以内');
   return {ok:true,items:message.type==='MATCH'?await matchFields(message.fields,resume,state.settings):localPlan(message.fields,resume)};
  }
  throw new Error('不支持的请求');
 })().then(respond,e=>respond({ok:false,error:e.message}));return true;
});
