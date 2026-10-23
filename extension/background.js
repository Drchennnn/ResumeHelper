import {loadState} from './lib/storage.js';
import {flattenResume,localPlan} from './lib/model.js';
import {matchFields,requestJSON,endpoint} from './lib/ai.js';
chrome.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||!message||typeof message!=='object')return false;
 const trusted=sender.url?.startsWith(chrome.runtime.getURL(''));
 const page=sender.tab&&/^https?:/.test(sender.url||'');
 if(!trusted&&!page)return false;
 (async()=>{
  if(message.type==='OPEN_WORKBENCH'){await chrome.runtime.openOptionsPage();return {ok:true};}
  if(message.type==='TEST_API'&&!trusted)throw new Error('此请求仅限扩展设置页面');
  const state=await loadState();
  if(message.type==='PANEL_STATE')return {ok:true,resumes:state.resumes.map(({id,name})=>({id,name})),activeId:state.activeId};
  if(message.type==='TEST_API'){const settings=message.settings||state.settings;endpoint(settings);await requestJSON(settings,'Return only JSON {"ok":true}.',{});return {ok:true};}
  const resume=state.resumes.find(r=>r.id===message.resumeId);
  if(!resume)throw new Error('简历不存在，请重新打开助手');
  if(message.type==='RESUME_FACTS')return {ok:true,facts:flattenResume(resume)};
  if(message.type==='MATCH'||message.type==='LOCAL_MATCH'){
   if(!Array.isArray(message.fields)||message.fields.length>250)throw new Error('字段数量应在 250 以内');
   return {ok:true,items:message.type==='MATCH'?await matchFields(message.fields,resume,state.settings):localPlan(message.fields,resume)};
  }
  throw new Error('不支持的请求');
 })().then(respond,e=>respond({ok:false,error:e.message}));return true;
});
