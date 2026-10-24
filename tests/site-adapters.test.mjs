import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../extension/site-adapters.js',import.meta.url),'utf8');
function fixture({host='jobs.example.test',layout='atsx',ambiguous=false}={}){
 const title={textContent:'教育背景'},other={textContent:'项目经历'},label={textContent:'学校名称',contains:()=>false};
 const recordA={},recordB={};
 const titleSelector=layout==='atsx'?'.createFormSection-title':'.dl_menutit', groupSelector=layout==='atsx'?'.resumeEditForm-item':'form';
 const section={querySelectorAll:selector=>selector===titleSelector?(ambiguous?[title,other]:[title]):selector===groupSelector?[recordA,recordB]:[],contains:()=>true};
 const parent={parentElement:section,querySelectorAll:()=>[]};recordA.parentElement=parent;recordB.parentElement=parent;
 const container={parentElement:parent,matches:()=>false,querySelector:()=>label,querySelectorAll:()=>[]};
 const element={parentElement:container,getAttribute:()=>null,closest:selector=>{
  if(layout==='atsx'&&selector==='.atsx-form-item')return container;
  if(layout==='atsx'&&selector==='.resumeEditForm-item')return recordB;
  if(layout==='beisen_old'&&selector==='.form_part_container li')return container;
  if(layout==='beisen_old'&&selector==='form')return recordB;
  return null;
 }};
 const context=vm.createContext({location:{hostname:host}});vm.runInContext(source,context);
 return {api:context.__personalResumeSiteAdapters,element,recordB};
}
test('platform labels and repeated record scopes require one section title',()=>{
 const {api,element,recordB}=fixture(),info=api.describe(element);
 assert.equal(info.platform,'atsx');assert.equal(info.section,'教育背景');assert.equal(info.label,'学校名称');assert.equal(info.record,recordB);assert.equal(info.records.indexOf(recordB),1);
 const ambiguous=fixture({ambiguous:true});assert.equal(ambiguous.api.describe(ambiguous.element),null);
});
test('host restricted adapters require a hostname boundary',()=>{
 for(const host of ['evilzhiye.com','zhiye.com.evil.test']){const f=fixture({host,layout:'beisen_old'});assert.equal(f.api.describe(f.element),null);}
 const f=fixture({host:'company.zhiye.com',layout:'beisen_old'});assert.equal(f.api.describe(f.element).platform,'beisen_old');
});
