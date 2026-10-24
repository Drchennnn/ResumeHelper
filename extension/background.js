import {loadState} from './lib/storage.js';
import {flattenResume,localPlan,resolvePlan} from './lib/model.js';
import {matchFields,chooseSemanticCandidate,requestJSON,endpoint} from './lib/ai.js';
import {fillWithBrowserControl,stopBrowserControl} from './lib/browser-control.js';
import {getAttachmentForUpload,listAttachments} from './lib/attachments.js';
import {scanAttachmentTargets,applyStoredAttachment} from './lib/attachment-control.js';
import {scanAllFrames,applyFrameItems,cancelFrameOperations} from './lib/frame-router.js';
const pageScans=new Map(), candidateRequests=new Map();
async function pageTab(message,sender,trusted){
 if(!trusted){if(sender.frameId>0)throw new Error('整页操作仅支持主框架');return sender.tab.id;}
 return (await attachmentTab(message.tabId)).id;
}
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
  if(['PAGE_SCAN','PAGE_CANCEL'].includes(message.type)){
   const tabId=await pageTab(message,sender,trusted);
   if(message.type==='PAGE_CANCEL'){stopBrowserControl(tabId);return {ok:true,...await cancelFrameOperations(tabId)};}
   const scan=await scanAllFrames(tabId);
   pageScans.set(tabId,{fields:scan.fields,time:Date.now()});
   for(const key of candidateRequests.keys())if(key.startsWith(`${tabId}:`))candidateRequests.delete(key);
   return {ok:true,...scan};
  }
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
  if(message.type==='PAGE_APPLY'){
   const tabId=await pageTab(message,sender,trusted),scan=pageScans.get(tabId);
   if(!scan||Date.now()-scan.time>600000)throw new Error('页面预览已过期，请重新识别');
   if(!Array.isArray(message.items)||message.items.length>250)throw new Error('填写项数量超限');
   const items=resolvePlan({mappings:message.items.map(item=>({...item,optionValue:item.value}))},scan.fields,resume);
   const accepted=new Set(items.map(item=>item.fieldId));
   const rejected=message.items.filter(item=>!accepted.has(item.fieldId)).map(item=>({fieldId:item.fieldId,status:'skipped',reason:'unverified_resume_mapping'}));
   const control=await controlState();
   const result=await applyFrameItems(tabId,items,{resumeId:resume.id,overwrite:message.overwrite===true,browserControl:control.enabled&&message.options?.browserControl===true,visionFallback:control.enabled&&message.options?.visionFallback===true,semanticCandidates:message.options?.semanticCandidates===true});
   return {ok:true,...result,results:[...result.results,...rejected]};
  }
  if(message.type==='CANDIDATE_MATCH'){
   if(!page||typeof message.fieldId!=='string'||message.fieldId.length>160)throw new Error('缺少字段上下文');
   const fact=flattenResume(resume).find(item=>item.path===message.sourcePath);
   if(!fact||!Array.isArray(message.candidates)||!message.candidates.length||message.candidates.length>100)throw new Error('候选或资料无效');
   const key=`${sender.tab.id}:${sender.frameId||0}:${message.fieldId}`;
   const previous=candidateRequests.get(key),count=previous&&Date.now()-previous.time<60000?previous.count:0;
   if(count>=3)return {ok:true,candidateId:null,reason:'candidate_request_limit'};
   candidateRequests.set(key,{count:count+1,time:Date.now()});
   const candidates=message.candidates.map(item=>({id:String(item.id||'').slice(0,160),label:String(item.label||'').slice(0,500),group:String(item.group||'').slice(0,200),disabled:item.disabled===true}));
   const field={label:String(message.field?.label||'').slice(0,300),section:String(message.field?.section||'').slice(0,200),type:String(message.field?.type||'').slice(0,80)};
   const candidate=await chooseSemanticCandidate({field,value:fact.value,candidates,context:{sourcePath:fact.path,sourceLabel:fact.label}},state.settings);
   return {ok:true,...(candidate||{candidateId:null,reason:'manual_required'})};
  }
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
