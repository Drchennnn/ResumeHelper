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
  assert.deepEqual(panel,{ok:true,resumes:[{id:'demo',name:'虚构简历'}],activeId:'demo'});
  const facts=await send({type:'RESUME_FACTS',resumeId:'demo'});assert.ok(facts.facts.some(f=>f.value==='林测试'));
  const denied=await send({type:'TEST_API'});assert.equal(denied.ok,false);
  assert.equal(await send({type:'PANEL_STATE'},{...page,id:'forged'}),undefined);
  assert.equal(await send({type:'PANEL_STATE'},{id:'test-extension',url:page.url}),undefined);
  await send({type:'OPEN_WORKBENCH'});assert.equal(opened,1);
  assert.ok(!JSON.stringify([panel,facts,denied]).includes('DO-NOT-EXPOSE'));
 }finally{delete globalThis.chrome;}
});
