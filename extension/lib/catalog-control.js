let catalogPromise;
export function loadFieldCatalogs(){
 return catalogPromise??=Promise.all(['regions','majors'].map(async name=>{
  const response=await fetch(new URL(`../data/${name}.json`,import.meta.url));
  if(!response.ok)throw new Error('无法载入本地选择目录，请重新加载扩展');
  return response.json();
 })).then(([regions,majors])=>({regions,majors})).catch(error=>{catalogPromise=null;throw error;});
}
export function majorLevel(degree=''){
 if(/博士/.test(degree))return 'doctor';
 if(/硕士/.test(degree))return 'masters';
 if(/本科|学士/.test(degree))return 'bachelors';
 if(/专科|高职/.test(degree))return 'college';
 return '';
}
export function filterMajors(catalog,{degree='',query='',domain=''}={}){
 const level=majorLevel(degree);if(degree.trim()&&!level)return [];
 const words=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
 return catalog.filter(item=>(!level||item.level===level)&&(!domain||item.domain===domain)&&words.every(word=>item.label.toLowerCase().includes(word)));
}
export function splitRegions(value){return String(value||'').split(/[;；\n]+/).map(v=>v.trim()).filter(Boolean);}
export function addRegion(value,path,max=1){
 const next=String(path||'').trim();if(!next)throw new Error('请先选择地区或输入地区名称');
 if(max===1)return next;
 const values=splitRegions(value).filter(v=>v!=='任意城市');
 if(!values.includes(next))values.push(next);
 if(values.length>max)throw new Error(`最多选择 ${max} 个城市；可先移除一项`);
 return values.join('；');
}
const option=(doc,value,label)=>{const node=doc.createElement('option');node.value=value;node.textContent=label;return node;};
export function createCatalogControl({document:doc=globalThis.document,kind,value='',id,label='',multiple=false,degree=()=>'',onChange=()=>{},catalogs=loadFieldCatalogs}){
 const container=doc.createElement('div');container.className='catalog-control';
 const input=doc.createElement('input');input.type='text';input.id=id;input.value=String(value??'');input.maxLength=20000;
 input.setAttribute('aria-label',label);input.placeholder=kind==='major'?'选择目录或输入专业类别':multiple?'选择最多 5 个城市，或用分号分隔填写':'选择地区，或直接填写';
 input.oninput=()=>onChange(input.value);
 const details=doc.createElement('details');details.className='catalog-picker';
 const summary=doc.createElement('summary');summary.textContent=kind==='major'?'选择专业目录':'选择省 / 市 / 区';
 const panel=doc.createElement('div');panel.className='catalog-panel';
 const status=doc.createElement('p');status.className='note';status.setAttribute('role','status');
 let ready=false,loading=false;
 function commit(next){input.value=next;onChange(next);}
 function selectBox(name){const select=doc.createElement('select');select.setAttribute('aria-label',`${label}${name}`);select.dataset.part=name;return select;}
 function fill(select,nodes,placeholder){select.replaceChildren(option(doc,'',placeholder),...nodes.map(node=>option(doc,node.code,node.name)));select.value='';select.disabled=!nodes.length;}
 async function open(){
  if(!details.open||loading)return;
  if(ready&&kind!=='major')return;
  loading=true;panel.replaceChildren(status);status.textContent='正在载入包内目录…';
  try{
   const data=await catalogs();panel.replaceChildren();
   if(kind==='major'){
    const search=doc.createElement('input');search.type='search';search.placeholder='搜索专业类别';search.setAttribute('aria-label',`${label}搜索`);
    const domain=selectBox('门类'),list=selectBox('候选');list.size=7;
    const available=filterMajors(data.majors,{degree:degree()});
    const domains=[...new Set(available.map(x=>x.domain))].sort();
    domain.append(option(doc,'','全部门类'),...domains.map(name=>option(doc,name,name)));
    const update=()=>{const choices=filterMajors(data.majors,{degree:degree(),query:search.value,domain:domain.value});list.replaceChildren(...choices.map(x=>option(doc,x.label,x.label)));list.selectedIndex=-1;const preserved=input.value&&!available.some(x=>x.label===input.value)?'原类别不在当前学历目录中，已保留原值；请核对。':'';status.textContent=preserved+(choices.length?`${choices.length} 项，选择后点击“使用所选”；原值保留至确认。`:'目录暂无匹配项，可关闭后直接输入类别。');};
    search.oninput=update;domain.onchange=update;
    const apply=doc.createElement('button');apply.type='button';apply.className='secondary';apply.textContent='使用所选';apply.onclick=()=>{if(!list.value){status.textContent='请先选择一个专业类别';return;}commit(list.value);details.open=false;};
    panel.append(search,domain,list,apply,status);update();
   }else{
    const province=selectBox('省份'),city=selectBox('城市'),district=selectBox('区县');
    district.hidden=multiple;
    fill(province,data.regions,'选择省 / 直辖市 / 港澳台');fill(city,[],'选择城市');fill(district,[],'选择区县（可选）');
    const chosen=()=>{const p=data.regions.find(x=>x.code===province.value),c=p?.children.find(x=>x.code===city.value),d=c?.children.find(x=>x.code===district.value);return {p,c,d};};
    province.onchange=()=>{const {p}=chosen();fill(city,p?.children||[],'选择城市');fill(district,[],'选择区县（可选）');};
    city.onchange=()=>{const {c}=chosen();fill(district,c?.children||[],'选择区县（可选）');};
    const apply=doc.createElement('button');apply.type='button';apply.className='secondary';apply.textContent=multiple?'添加城市':'使用所选地区';
    const chips=doc.createElement('div');chips.className='region-chips';
    const refresh=()=>{chips.replaceChildren();if(!multiple)return;for(const path of splitRegions(input.value)){const remove=doc.createElement('button');remove.type='button';remove.className='secondary';remove.textContent=`${path} ×`;remove.setAttribute('aria-label',`移除${path}`);remove.onclick=()=>{commit(splitRegions(input.value).filter(x=>x!==path).join('；'));refresh();};chips.append(remove);}};
    apply.onclick=()=>{const {p,c,d}=chosen();if(!p){status.textContent='请先选择省份';return;}if(multiple&&!c){status.textContent='请选择城市后再添加';return;}const path=(multiple?[p,c]:[p,c,d]).filter(Boolean).map(x=>x.name).filter(x=>!['市辖区','县'].includes(x)).join(' / ');try{commit(addRegion(input.value,path,multiple?5:1));refresh();status.textContent=multiple?'城市已添加，可继续选择或收起目录。':'地区已更新。';if(!multiple)details.open=false;}catch(e){status.textContent=e.message;}};
    const manual=doc.createElement('button');manual.type='button';manual.className='secondary';manual.textContent='海外 / 手动输入';manual.onclick=()=>{details.open=false;input.focus();};
    status.textContent='地区目录截至 2023 年；未收录或海外地区可直接输入，已有资料不会自动改写。';
    panel.append(province,city,district,apply,manual,chips,status);
    if(multiple){const unlimited=doc.createElement('button');unlimited.type='button';unlimited.className='secondary';unlimited.textContent='任意城市';unlimited.onclick=()=>{commit('任意城市');refresh();details.open=false;};panel.append(unlimited);}
    refresh();
   }
   ready=true;
  }catch(e){status.textContent=e.message;panel.replaceChildren(status);}
  finally{loading=false;}
 }
 container.refreshOptions=()=>{if(details.open)return open();};
 details.ontoggle=open;details.append(summary,panel);
 container.append(input,details);
 return container;
}
