import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {getFieldHelp} from '../extension/lib/field-help.js';
import {splitRegions} from '../extension/lib/catalog-control.js';
const workbenchSource=(await readFile(new URL('../extension/workbench.js',import.meta.url),'utf8'))
 .replace(/^import .*;\n/gm,'');

class FakeClassList{
 constructor(node){this.node=node;}
 toggle(name,force){const values=new Set(String(this.node.className||'').split(/\s+/).filter(Boolean));const enabled=force===undefined?!values.has(name):force;enabled?values.add(name):values.delete(name);this.node.className=[...values].join(' ');return enabled;}
}

class FakeNode{
 constructor(tag='div',id=''){
  this.tagName=tag.toUpperCase();this.id=id;this.children=[];this.dataset={};this.attributes={};this.className='';this.classList=new FakeClassList(this);
  this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.checked=false;this.files=[];this.open=false;this.listeners=new Map();
 }
 append(...children){for(const child of children){if(child&&typeof child==='object')child.parentNode=this;this.children.push(child);}}
 replaceChildren(...children){this.children=[];this.append(...children);}
 setAttribute(name,value){this.attributes[name]=String(value);}
 addEventListener(type,handler){this.listeners.set(type,handler);}
 showModal(){this.open=true;}
 close(){this.open=false;}
 click(){this.clicked=true;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 querySelectorAll(selector){
  const output=[];
  const match=node=>{
   if(selector.startsWith('.'))return String(node.className).split(/\s+/).includes(selector.slice(1));
   const nav=/^\[data-nav-section="([^"]+)"\]$/.exec(selector);if(nav)return node.dataset.navSection===nav[1];
   if(/^[a-z]+$/.test(selector))return node.tagName===selector.toUpperCase();
   return false;
  };
  const walk=node=>{for(const child of node.children||[]){if(match(child))output.push(child);walk(child);}};walk(this);return output;
 }
}

const ids=['status','completion','completionText','completionPercent','missingCount','completionBar','missingOnly','resumeList','name','sections','sectionNav','save','form','new','duplicate','delete','cancelDelete','confirmDelete','deleteDialog','export','file','import','importDialog','importStatus','importFile','importMode','importDestination','visualModeRow','visualMode','textPreview','documentPreview','parse','cancelImport','example','baseUrl','model','apiKey','settingsForm','apiStatus','test'];

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

function normalized(input={}){
 return {id:input.id||crypto.randomUUID(),name:input.name||'导入简历',personal:{name:input.personal?.name||''},education:Array.isArray(input.education)?input.education:[],extras:input.extras||''};
}

function createHarness({prepared,parseText,parseImages}){
 const nodes=new Map(ids.map(id=>[id,new FakeNode(id.includes('Dialog')?'dialog':id==='file'?'input':id==='visualMode'?'input':'div',id)]));
 nodes.get('baseUrl').value='https://api.example.test/v1';nodes.get('model').value='vision-model';
 const body=new FakeNode('body');for(const node of nodes.values())body.append(node);
 const document={
  body,createElement:tag=>new FakeNode(tag),getElementById:id=>nodes.get(id)||null,
  querySelectorAll:selector=>selector==='.view'||selector==='[data-view]'?[]:body.querySelectorAll(selector),
  querySelector:selector=>body.querySelector(selector),
 };
 const original=normalized({id:'original',name:'原简历',personal:{name:'原用户'}});
 const state={resumes:[original],activeId:original.id,settings:{baseUrl:'https://api.example.test/v1',model:'vision-model',apiKey:'local-key'}};
 const saved=[],calls={prepare:0,text:[],images:[]};
 const SECTIONS=[{key:'personal',title:'个人信息',repeatable:false,fields:[{key:'name',label:'姓名',type:'text'}]},{key:'education',title:'教育背景',repeatable:true,fields:[{key:'school',label:'学校',type:'text'}]}];
 const flattenResume=resume=>resume.personal?.name?[{path:'personal.name',value:resume.personal.name}]:[];
 const completionStats=()=>({filled:1,total:1,missing:0,percent:100,sections:SECTIONS.map(s=>({key:s.key,filled:s.key==='personal'?1:0,total:s.key==='personal'?1:0,missing:0,percent:s.key==='personal'?100:0}))});
 const sandbox={
  document,window:{addEventListener(){}},SECTIONS,getFieldHelp,splitRegions,createResume:name=>normalized({name}),normalizeResume:normalized,flattenResume,completionStats,
  loadState:async()=>state,saveResumes:async(resumes,activeId)=>{saved.push({resumes:structuredClone(resumes),activeId});},saveSettings:async()=>{},
  prepareResumeFiles:async(files,onProgress)=>{calls.prepare++;onProgress?.({stage:'pdf-text',current:1,total:1});return typeof prepared==='function'?prepared():prepared;},
  parseResumeText:async(text,settings)=>{calls.text.push({text,settings});return parseText(text,settings);},
  parseResumeImages:async(images,settings,text)=>{calls.images.push({images,text,settings});return parseImages(images,settings,text);},
  requestJSON:async()=>({}),endpoint:()=>state.settings.baseUrl+'/chat/completions',
  crypto,structuredClone,URL,Blob,setTimeout,clearTimeout,console,
 };
 vm.runInContext(workbenchSource,vm.createContext(sandbox));
 return {nodes,state,saved,calls};
}

test('PDF preparation stays local until explicit parse, allows text edits, and preserves the original resume',async()=>{
 const h=createHarness({
  prepared:{kind:'document',name:'resume.pdf',text:'姓名：旧文本',images:[],pageCount:1,needsVision:false,renderImages:async()=>[]},
  parseText:async text=>normalized({name:'PDF 识别结果',personal:{name:text.includes('修正')?'修正姓名':''}}),parseImages:async()=>{throw new Error('unexpected image parse');},
 });
 await tick();h.nodes.get('file').files=[{name:'resume.pdf'}];await h.nodes.get('file').onchange();
 assert.equal(h.calls.text.length,0,'选择文件与生成预览不得调用 AI');
 assert.equal(h.calls.images.length,0);
 assert.equal(h.nodes.get('textPreview').value,'姓名：旧文本');
 assert.equal(h.nodes.get('importDialog').open,true);

 h.nodes.get('textPreview').value='姓名：修正姓名';await h.nodes.get('parse').onclick();
 assert.equal(h.calls.text.length,1);assert.equal(h.calls.text[0].text,'姓名：修正姓名');
 const final=h.saved.at(-1);assert.deepEqual(final.resumes.map(item=>item.name),['原简历','PDF 识别结果']);
 assert.equal(final.resumes[0].personal.name,'原用户');
 assert.match(h.nodes.get('status').textContent,/原简历保留/,h.nodes.get('importStatus').textContent);
});

test('scanned PDF forces visual preview and cancel clears staged data without an API request',async()=>{
 const h=createHarness({
  prepared:{kind:'document',name:'scan.pdf',text:'',images:['data:image/jpeg;base64,AA==','data:image/jpeg;base64,AQ=='],pageCount:2,needsVision:true,renderImages:async()=>[]},
  parseText:async()=>{throw new Error('unexpected text parse');},parseImages:async()=>{throw new Error('unexpected image parse');},
 });
 await tick();h.nodes.get('file').files=[{name:'scan.pdf'}];await h.nodes.get('file').onchange();
 assert.equal(h.nodes.get('visualMode').checked,true);assert.equal(h.nodes.get('visualMode').disabled,true);
 assert.equal(h.nodes.get('documentPreview').children.length,2);assert.match(h.nodes.get('importMode').textContent,/发送 2 张页面图片/);
 h.nodes.get('cancelImport').onclick();
 assert.equal(h.nodes.get('importDialog').open,false);assert.equal(h.nodes.get('documentPreview').children.length,0);assert.equal(h.nodes.get('textPreview').value,'');
 assert.equal(h.calls.text.length+h.calls.images.length,0);
});

test('AI parse failure does not save a new resume and the same preview can be retried',async()=>{
 let attempts=0;
 const h=createHarness({
  prepared:{kind:'document',name:'retry.pdf',text:'姓名：重试',images:[],pageCount:1,needsVision:false,renderImages:async()=>[]},
  parseText:async()=>{attempts++;if(attempts===1)throw new Error('模型暂时不可用');return normalized({name:'重试成功',personal:{name:'林测试'}});},
  parseImages:async()=>{throw new Error('unexpected image parse');},
 });
 await tick();h.nodes.get('file').files=[{name:'retry.pdf'}];await h.nodes.get('file').onchange();
 await h.nodes.get('parse').onclick();
 assert.equal(h.saved.length,0);assert.equal(h.state.resumes.length,1);assert.equal(h.nodes.get('importDialog').open,true);assert.match(h.nodes.get('importStatus').textContent,/识别失败：模型暂时不可用/);

 await h.nodes.get('parse').onclick();
 assert.equal(h.calls.text.length,2);assert.equal(h.saved.at(-1).resumes.length,2);assert.equal(h.saved.at(-1).resumes[1].name,'重试成功');assert.equal(h.nodes.get('importDialog').open,false,h.nodes.get('importStatus').textContent);
});

test('saving rejects six manually entered preferred cities without persisting and allows correction',async()=>{
 const h=createHarness({});await tick();
 h.state.resumes[0].job_intention={preferred_city:'城市一；城市二；城市三；城市四；城市五；城市六'};
 await h.nodes.get('save').onclick();
 assert.equal(h.saved.length,0);
 assert.match(h.nodes.get('status').textContent,/期望城市最多填写 5 个/);
 h.state.resumes[0].job_intention.preferred_city='广东省 / 深圳市；广东省 / 广州市';
 await h.nodes.get('save').onclick();
 assert.equal(h.saved.length,1);
 assert.equal(h.saved[0].resumes[0].job_intention.preferred_city,'广东省 / 深圳市；广东省 / 广州市');
 assert.equal(h.nodes.get('status').textContent,'已保存到本地');
});
