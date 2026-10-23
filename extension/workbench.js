import {SECTIONS,createResume,normalizeResume,flattenResume,completionStats} from './lib/model.js';
import {loadState,saveResumes,saveSettings} from './lib/storage.js';
import {prepareResumeFiles} from './lib/documents.js';
import {parseResumeText,parseResumeImages,requestJSON,endpoint} from './lib/ai.js';
const $=id=>document.getElementById(id);let state,current,dirty=false,missingOnly=false,pendingImport=null,importBusy=false;
const status=text=>$('status').textContent=text;
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
async function action(fn){try{await fn();}catch(e){status(`操作失败：${e.message}`);}}
function view(id){for(const v of document.querySelectorAll('.view'))v.hidden=v.id!==id;for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('active',b.dataset.view===id);}
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>view(b.dataset.view);
function mark(){dirty=true;status('有未保存的修改');progress();}
function progress(){
 const stats=completionStats(current);
 $('completion').textContent=`${stats.filled} / ${stats.total} 项 · ${stats.percent}%`;
 $('completionText').textContent=`已填写 ${stats.filled} / ${stats.total} 个字段`;
 $('completionPercent').textContent=`完成度 ${stats.percent}%`;
 $('missingCount').textContent=`未补齐 ${stats.missing} 项`;
 $('completionBar').value=stats.percent;
 for(const item of stats.sections){
  const link=document.querySelector(`[data-nav-section="${item.key}"]`);
  if(!link)continue;
  link.querySelector('.nav-count').textContent=`${item.filled}/${item.total}`;
  link.querySelector('.nav-missing').textContent=item.total?item.missing?`未补齐 ${item.missing} 项`:'资料已补齐':'暂无记录';
  link.querySelector('progress').value=item.percent;
  link.classList.toggle('complete',item.total>0&&item.missing===0);
 }
}
$('missingOnly').onclick=()=>{missingOnly=!missingOnly;$('missingOnly').textContent=missingOnly?'显示全部字段':'查看未补齐项';$('missingOnly').setAttribute('aria-pressed',String(missingOnly));sections();};
function list(){const node=$('resumeList');node.replaceChildren();for(const r of state.resumes){const b=el('button',r.name||'未命名简历',r.id===state.activeId?'active':'');b.onclick=()=>action(async()=>{await save();state.activeId=r.id;await saveResumes(state.resumes,state.activeId);select();});node.append(b);}}
function select(){current=state.resumes.find(r=>r.id===state.activeId)||state.resumes[0];state.activeId=current.id;$('name').value=current.name;dirty=false;list();sections();status('资料已载入 · 本地保存');progress();}
function fields(section,row,index){
 const grid=el('div',undefined,'grid');
 for(const f of section.fields){
  const label=el('label',undefined,f.type==='textarea'?'wide':'');
  const title=el('span',f.label);const hint=el('small','未填写','field-missing');title.append(hint);label.append(title);
  const input=el(f.type==='textarea'?'textarea':f.type==='select'?'select':'input');
  const value=String(row[f.key]??'');
  if(input.tagName==='SELECT'){
   const options=[{value:'',label:'请选择'},...(f.options||[]).map(o=>typeof o==='object'?{value:String(o.value??o.label),label:String(o.label??o.value)}:{value:String(o),label:String(o)})];
   if(value&&!options.some(o=>o.value===value))options.push({value,label:value});
   for(const o of options){const option=el('option',o.label);option.value=o.value;input.append(option);}
  }else if(input.tagName==='INPUT')input.type=['email','tel','url','number'].includes(f.type)?f.type:'text';
  if(input.type==='number')input.step='any';input.value=value;input.maxLength=20000;input.id=`field-${section.key}-${index??'single'}-${f.key}`;
  label.htmlFor=input.id;hint.hidden=Boolean(value.trim());label.classList.toggle('missing-field',!value.trim());
  label.hidden=missingOnly&&Boolean(value.trim());
  input.oninput=()=>{row[f.key]=input.value;hint.hidden=Boolean(input.value.trim());label.classList.toggle('missing-field',!input.value.trim());mark();};
  label.append(input);
  if(f.suggestions?.length){const choices=el('datalist');choices.id=input.id+'-choices';input.setAttribute('list',choices.id);input.placeholder='输入搜索或选择行业';for(const value of f.suggestions)choices.append(el('option',value));label.append(choices);}
  grid.append(label);
 }
 return grid;
}
function sections(){
 $('sections').replaceChildren();$('sectionNav').replaceChildren();
 for(const s of SECTIONS){
  const card=el('section',undefined,'card');card.id=`section-${s.key}`;
  const head=el('div',undefined,'section-head');head.append(el('h2',s.title));
  if(s.repeatable){const add=el('button','＋ 添加','secondary');add.type='button';add.onclick=()=>{if(current[s.key].length>=30){status('每个分区最多 30 条记录');return;}current[s.key].push(Object.fromEntries(s.fields.map(f=>[f.key,''])));mark();sections();};head.append(add);}
  card.append(head);
  if(s.repeatable){
   if(!current[s.key].length)card.append(el('div',`暂无${s.title}，有相关经历时添加记录。`,'empty'));
   current[s.key].forEach((row,i)=>{
    const entry=el('div',undefined,'entry');const top=el('div',undefined,'entry-head');top.append(el('strong',`${s.title} ${i+1}`));
    const remove=el('button','移除','secondary danger');remove.type='button';remove.onclick=()=>{current[s.key].splice(i,1);mark();sections();};top.append(remove);entry.append(top,fields(s,row,i));card.append(entry);
   });
  }else card.append(fields(s,current[s.key]));
  $('sections').append(card);
  const a=el('a');a.href=`#${card.id}`;a.dataset.navSection=s.key;
  const title=el('span',undefined,'nav-title');title.append(el('strong',s.title),el('span','','nav-count'));
  const detail=el('span',undefined,'nav-detail');const bar=el('progress');bar.max=100;bar.value=0;bar.setAttribute('aria-label',`${s.title}完成度`);detail.append(el('span','','nav-missing'),bar);a.append(title,detail);$('sectionNav').append(a);
 }
 const extra=el('section',undefined,'card');extra.append(el('h2','补充资料'));const label=el('label','其他希望保留的信息');const area=el('textarea');area.value=current.extras||'';area.oninput=()=>{current.extras=area.value;mark();};label.append(area);extra.append(label);$('sections').append(extra);progress();
}
async function save(){current.name=$('name').value.trim()||'未命名简历';await saveResumes(state.resumes,state.activeId);dirty=false;list();status('已保存到本地');}
async function add(r){await save();r.id=crypto.randomUUID();state.resumes.push(normalizeResume(r));state.activeId=r.id;await saveResumes(state.resumes,state.activeId);select();}
$('name').oninput=()=>{current.name=$('name').value;mark();};$('save').onclick=()=>action(save);$('form').onsubmit=e=>e.preventDefault();
$('new').onclick=()=>action(()=>add(createResume(`简历 ${state.resumes.length+1}`)));$('duplicate').onclick=()=>action(()=>add({...structuredClone(current),name:current.name+' · 副本'}));
$('delete').onclick=()=>$('deleteDialog').showModal();$('cancelDelete').onclick=()=>$('deleteDialog').close();$('confirmDelete').onclick=()=>action(async()=>{state.resumes=state.resumes.filter(r=>r.id!==current.id);if(!state.resumes.length)state.resumes=[createResume()];state.activeId=state.resumes[0].id;await saveResumes(state.resumes,state.activeId);$('deleteDialog').close();select();});
$('export').onclick=()=>action(async()=>{await save();const url=URL.createObjectURL(new Blob([JSON.stringify(normalizeResume(current),null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download=(current.name.replace(/[\\/:*?"<>|]/g,'-')||'resume')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
function importProgress(event){
 const names={'pdf-text':'提取 PDF 文字','pdf-render':'渲染 PDF 页面',image:'处理图片'};
 $('importStatus').textContent=`${names[event.stage]||'准备资料'} ${event.current}/${event.total}`;
}
function importControls(busy){
 importBusy=busy;
 for(const id of ['parse','cancelImport','visualMode'])$(id).disabled=busy;
 $('import').disabled=busy;
}
function clearImport(){pendingImport=null;$('documentPreview').replaceChildren();$('textPreview').value='';$('file').value='';}
function imagePreviews(images){
 $('documentPreview').replaceChildren();
 images.forEach((src,index)=>{const figure=el('figure');const img=el('img');img.src=src;img.alt=`待识别页面 ${index+1}`;figure.append(img,el('figcaption',`第 ${index+1} 张`));$('documentPreview').append(figure);});
}
function importSummary(){
 if(!pendingImport)return;
 const images=$('visualMode').checked?pendingImport.images:[];
 imagePreviews(images);
 $('importFile').textContent=`${pendingImport.name}${pendingImport.pageCount?` · ${pendingImport.pageCount} 页/张`:''}`;
 $('importMode').textContent=images.length?`将发送 ${images.length} 张页面图片及下方文本。需要所配置的模型支持图片识别。`:'将发送下方文本。PDF 文字在本地提取，不发送原始 PDF 文件。';
 let destination='尚未配置 API';try{destination=new URL(endpoint(state.settings)).origin;}catch{}
 $('importDestination').textContent=`接收方：${destination} · 模型：${state.settings.model||'未设置'}`;
 $('parse').textContent=images.length?'发送图片与文本并 AI 识别':'发送文本并 AI 解析';
}
$('import').onclick=()=>$('file').click();
$('file').onchange=async()=>{
 const files=Array.from($('file').files);$('file').value='';if(!files.length)return;
 clearImport();$('importStatus').textContent='正在本地读取，尚未发送到 API…';$('importFile').textContent=files.map(f=>f.name).join('、');
 $('importMode').textContent='先在本地处理文件，再检查待发送内容。';$('importDestination').textContent='';$('visualModeRow').hidden=true;$('textPreview').disabled=true;
 $('importDialog').showModal();importControls(true);
 try{
  const prepared=await prepareResumeFiles(files,importProgress);
  if(prepared.kind==='json'){
   const data=JSON.parse(prepared.text);const raw=data.resume||data;const imported=normalizeResume(raw);const count=flattenResume(imported).length;
   if(!count)throw new Error('没有识别到资料字段。请导入工作台 JSON，或改用文本/PDF/图片解析');
   await add(imported);$('importDialog').close();clearImport();status(`JSON 已导入 ${count} 项资料，请检查。`);return;
  }
  pendingImport=prepared;$('textPreview').value=prepared.text;$('visualMode').checked=prepared.needsVision;
  $('visualModeRow').hidden=!prepared.renderImages&&!prepared.images.length;
  $('visualMode').disabled=prepared.needsVision;
  importSummary();$('importStatus').textContent=prepared.needsVision?'已在本地准备图片；检查后点击识别才会发送。':'已在本地提取文字；可修改文字后再发送。';
 }catch(e){clearImport();$('importStatus').textContent=e.message;}
 finally{importControls(false);$('textPreview').disabled=false;$('parse').disabled=!pendingImport;if(pendingImport?.needsVision)$('visualMode').disabled=true;}
};
$('visualMode').onchange=async()=>{
 if(!pendingImport)return;importControls(true);
 try{if($('visualMode').checked&&!pendingImport.images.length)pendingImport.images=await pendingImport.renderImages();importSummary();$('importStatus').textContent='预览已更新，尚未发送。';}
 catch(e){$('visualMode').checked=false;$('importStatus').textContent=e.message;}
 finally{importControls(false);}
};
$('importDialog').addEventListener('cancel',e=>{if(importBusy)e.preventDefault();else clearImport();});
$('cancelImport').onclick=()=>{if(importBusy)return;$('importDialog').close();clearImport();};
$('parse').onclick=async()=>{
 if(importBusy||!pendingImport)return;importControls(true);$('importStatus').textContent='正在识别…';
 try{
  const images=$('visualMode').checked?pendingImport.images:[];const text=$('textPreview').value;
  const resume=images.length?await parseResumeImages(images,state.settings,text):await parseResumeText(text,state.settings);
  await add(resume);$('importDialog').close();clearImport();status('识别完成并已保存为新简历，请逐项校对；原简历保留。');
 }catch(e){$('importStatus').textContent=`识别失败：${e.message}${$('visualMode').checked?'。请确认模型支持图片输入。':''}`;}
 finally{importControls(false);if(pendingImport?.needsVision)$('visualMode').disabled=true;}
};
$('example').onclick=()=>action(()=>add(normalizeResume({name:'虚构示例 · AI 应用开发',personal:{name:'林测试',email:'demo@example.com',phone:'13800000000',city:'深圳',summary:'虚构测试资料，仅供功能验证。'},intent:{role:'AI 应用开发工程师',city:'深圳'},education:[{school:'示例大学',major:'计算机科学',degree:'硕士',start:'2024-09',end:'2026-06'}],projects:[{name:'演示知识库',role:'开发者',details:'虚构项目：实现资料检索与问答。'}],skills:{technical:'Python、JavaScript、SQL'},extras:'此简历完全虚构，请勿用于真实投递。'})));
function settings(){return {baseUrl:$('baseUrl').value.trim(),model:$('model').value.trim(),apiKey:$('apiKey').value.trim(),temperature:0};}
async function permission(s){const url=new URL(endpoint(s));if(!s.model)throw new Error('请填写模型名称');if(globalThis.chrome?.permissions?.request){const granted=await chrome.permissions.request({origins:[url.origin+'/*']});if(!granted)throw new Error('尚未授权 API 域名访问');}}
$('settingsForm').onsubmit=e=>{e.preventDefault();action(async()=>{const s=settings();await permission(s);await saveSettings(s);state.settings=s;$('apiStatus').textContent='设置已保存';});};
$('test').onclick=async()=>{const b=$('test');b.disabled=true;$('apiStatus').textContent='正在测试…';try{const s=settings();await permission(s);if(globalThis.chrome?.runtime?.sendMessage){const r=await chrome.runtime.sendMessage({type:'TEST_API',settings:s});if(!r.ok)throw new Error(r.error);}else await requestJSON(s,'Return only JSON {"ok":true}.',{});$('apiStatus').textContent='连接成功，模型已返回 JSON';}catch(e){$('apiStatus').textContent=e.message;}finally{b.disabled=false;}};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
action(async()=>{state=await loadState();select();for(const key of ['baseUrl','model','apiKey'])$(key).value=state.settings[key]||'';});
