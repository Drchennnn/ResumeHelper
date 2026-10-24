import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeResume} from '../extension/lib/model.js';

test('content messages receive allowed profile facts but never API settings or privileged API test access',async()=>{
 const resume=normalizeResume({id:'demo',name:'虚构简历',personal:{name:'林测试',email:'demo@example.com'}});
 const store={personalResumeProfilesV1:{resumes:[resume],activeId:'demo'},personalResumeSettingsV1:{baseUrl:'https://api.example.test/v1',model:'test',apiKey:'DO-NOT-EXPOSE'}};
 let handler,opened=0;
 globalThis.chrome={storage:{local:{get:async key=>({[key]:store[key]}),set:async values=>Object.assign(store,values),setAccessLevel(){}}},runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path,onMessage:{addListener:fn=>handler=fn},openOptionsPage:async()=>opened++}};
 try{
  await import('../extension/background.js?background-test');
  const page={id:'test-extension',tab:{id:7},url:'https://jobs.example.test/apply'};
  const send=(message,sender=page)=>new Promise(resolve=>{if(!handler(message,sender,resolve))resolve(undefined);});
  const panel=await send({type:'PANEL_STATE'});
  assert.deepEqual(panel.resumes,[{id:'demo',name:'虚构简历'}]);assert.equal(panel.activeId,'demo');assert.equal(panel.aiConfigured,true);assert.deepEqual(panel.control,{permitted:false,enabled:false});
  const facts=await send({type:'RESUME_FACTS',resumeId:'demo'});assert.ok(facts.facts.some(f=>f.value==='林测试'));
  const denied=await send({type:'TEST_API'});assert.equal(denied.ok,false);
  assert.equal((await send({type:'SET_CONTROL_SETTINGS',enabled:true})).ok,false,'网页内容脚本不能提升调试权限');
  for(const type of ['ATTACHMENTS_LIST','ATTACHMENT_TARGETS','ATTACHMENT_APPLY'])assert.equal((await send({type,tabId:7,resumeId:'demo'})).ok,false,'网页不能读取附件库或指挥附件上传');
  let activeUrl='https://jobs.example.test/apply';
  chrome.tabs={query:async()=>[{id:7,url:activeUrl}]};
  chrome.scripting={executeScript:async()=>[{result:[{id:'rh-upload-test-12345678',label:'简历'}]}]};
  const extension={id:'test-extension',url:'chrome-extension://test-extension/popup.html'};
  assert.equal((await send({type:'ATTACHMENT_TARGETS',tabId:8},extension)).ok,false,'不能操作非当前标签页');
  assert.equal((await send({type:'ATTACHMENT_APPLY',tabId:7,targetId:'rh-upload-test-12345678',attachmentId:'x'},extension)).ok,false,'未经扫描的文件控件不能填写');
  assert.equal((await send({type:'ATTACHMENT_TARGETS',tabId:7},extension)).targets.length,1);
  activeUrl='https://jobs.example.test/different';
  assert.equal((await send({type:'ATTACHMENT_APPLY',tabId:7,targetId:'rh-upload-test-12345678',attachmentId:'x'},extension)).ok,false,'页面导航后旧预览必须失效');
  assert.equal((await send({type:'CONTROL_FILL',resumeId:'demo',fieldId:'x',sourcePath:'personal.name'})).reason,'browser_control_disabled');
  const actualWrites=[];
  chrome.scripting={executeScript:async details=>details.func?[{frameId:0,documentId:'document-seven',result:{url:page.url,fields:[{id:'local-name',label:'姓名',type:'text',value:''}]}}]:[]};
  chrome.tabs.sendMessage=async(_tab,message)=>{
   if(message.type==='SCAN')return {url:page.url,fields:[]};
   if(message.type==='APPLY'){actualWrites.push(...message.items);return {results:message.items.map(item=>({fieldId:item.fieldId,status:'applied'}))};}
   if(message.type==='CANCEL')return {cancelled:true};
  };
  assert.equal((await send({type:'PAGE_SCAN'},{...page,frameId:2})).ok,false);
  const scanned=await send({type:'PAGE_SCAN'});
  assert.equal(scanned.fields[0].id,'f0:local-name');
  const applied=await send({type:'PAGE_APPLY',resumeId:'demo',items:[{fieldId:'f0:local-name',sourcePath:'personal.name',value:'forged page value'}]});
  assert.equal(applied.results[0].status,'applied');
  assert.equal(actualWrites[0].value,'林测试','后台必须重新取简历事实而非相信页面传入的value');
  const invalid=await send({type:'PAGE_APPLY',resumeId:'demo',items:[{fieldId:'f0:local-name',sourcePath:'personal.nonexistent',value:'fake'}]});
  assert.equal(invalid.results[0].reason,'unverified_resume_mapping');
  assert.equal(actualWrites.length,1);
  assert.equal((await send({type:'PAGE_CANCEL'})).cancelled,true);
  assert.equal(await send({type:'PANEL_STATE'},{...page,id:'forged'}),undefined);
  assert.equal(await send({type:'PANEL_STATE'},{id:'test-extension',url:page.url}),undefined);
  await send({type:'OPEN_WORKBENCH'});assert.equal(opened,1);
  assert.ok(!JSON.stringify([panel,facts,denied]).includes('DO-NOT-EXPOSE'));
 }finally{delete globalThis.chrome;}
});
