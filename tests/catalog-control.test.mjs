import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCatalogControl,filterMajors,addRegion,majorLevel} from '../extension/lib/catalog-control.js';
const regions=JSON.parse(await readFile(new URL('../extension/data/regions.json',import.meta.url)));
const majors=JSON.parse(await readFile(new URL('../extension/data/majors.json',import.meta.url)));
class Node{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.value='';this.dataset={};this.attributes={};this.open=false;this.disabled=false;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(key,value){this.attributes[key]=value;}
 focus(){this.focused=true;}
}
const document={createElement:tag=>new Node(tag)};
const nodes=(node,tag)=>node.children.flatMap(n=>[...(n.tagName===tag.toUpperCase()?[n]:[]),...nodes(n,tag)]);
const open=async control=>{const details=nodes(control,'details')[0];details.open=true;await details.ontoggle();return details;};
const catalog=async()=>({regions,majors});
test('local region tree covers provinces and cascading district paths with stable unique identifiers',()=>{
 assert.equal(regions.length,34);const ids=new Set();let count=0;
 const visit=rows=>rows.forEach(row=>{assert.ok(row.name);assert.ok(!ids.has(row.code));ids.add(row.code);count++;visit(row.children);});visit(regions);assert.equal(count,3840);
 const guangdong=regions.find(r=>r.name==='广东省');const shenzhen=guangdong.children.find(r=>r.name==='深圳市');assert.ok(shenzhen.children.some(r=>r.name==='南山区'));
 assert.ok(regions.find(r=>r.name==='香港特别行政区'));
});
test('professional catalogue filters by education, domain and search without inventing missing levels',()=>{
 assert.equal(majorLevel('硕士研究生'),'masters');assert.equal(majorLevel('本科'),'bachelors');
 const options=filterMajors(majors,{degree:'本科',query:'计算机'});assert.ok(options.length);assert.ok(options.every(o=>o.level==='bachelors'&&o.label.includes('计算机')));
 const masters=filterMajors(majors,{degree:'硕士',domain:'工学',query:'电子 信息'});assert.ok(masters.some(o=>o.label.includes('电子信息')));
 assert.ok(filterMajors(majors,{degree:'博士'}).length>100);assert.ok(filterMajors(majors,{degree:'专科'}).some(x=>x.label.includes('计算机')));assert.equal(filterMajors(majors,{degree:'高中'}).length,0);
});
test('region multi-select deduplicates and rejects a sixth city while single choice preserves exact text',()=>{
 let value='';for(let i=0;i<5;i++)value=addRegion(value,`城市${i}`,5);
 assert.equal(addRegion(value,'城市0',5),value);assert.throws(()=>addRegion(value,'城市5',5),/最多选择 5/);
 assert.equal(addRegion('旧值','海外 / 自定义',1),'海外 / 自定义');
});
test('region picker cascades, commits only explicitly and preserves legacy values before confirmation',async()=>{
 const changed=[];const control=createCatalogControl({document,kind:'region',value:'旧地址未收录',label:'现居住地址',id:'address',onChange:v=>changed.push(v),catalogs:catalog});
 await open(control);assert.deepEqual(changed,[]);const [input]=nodes(control,'input');assert.equal(input.value,'旧地址未收录');
 const [province,city,district]=nodes(control,'select');province.value='44';province.onchange();
 const gd=regions.find(r=>r.code==='44');city.value=gd.children.find(r=>r.name==='深圳市').code;city.onchange();district.value=gd.children.find(r=>r.name==='深圳市').children.find(r=>r.name==='南山区').code;
 nodes(control,'button').find(b=>b.textContent==='使用所选地区').onclick();assert.deepEqual(changed,['广东省 / 深圳市 / 南山区']);
});
test('major picker refreshes when education changes but never clears a saved custom category',async()=>{
 let degree='本科';const changes=[];const control=createCatalogControl({document,kind:'major',id:'major',label:'专业类别',value:'海外原专业分类',degree:()=>degree,onChange:v=>changes.push(v),catalogs:catalog});
 const details=await open(control);assert.deepEqual(changes,[]);
 assert.ok(nodes(control,'select')[1].children.every(o=>o.value.startsWith('本科')));
 degree='硕士';details.open=false;await open(control);const list=nodes(control,'select')[1];assert.ok(list.children.every(o=>!o.value.startsWith('本科')));
 list.value=list.children.find(o=>o.value.includes('计算机')).value;nodes(control,'button').find(b=>b.textContent==='使用所选').onclick();assert.equal(changes.length,1);assert.match(changes[0],/硕士/);
});
test('catalog failure leaves original input editable and exposes a retryable error',async()=>{
 let fail=true;const control=createCatalogControl({document,kind:'major',value:'原值',label:'专业类别',catalogs:async()=>{if(fail)throw new Error('本地目录失败');return {regions,majors};}});
 const details=await open(control);assert.ok(nodes(control,'p').some(n=>n.textContent==='本地目录失败'));assert.equal(nodes(control,'input')[0].value,'原值');fail=false;details.open=false;await open(control);assert.equal(nodes(control,'select').length,2);
});

test('preferred-city selection stores a city once and does not offer district-level duplicates',async()=>{
 const changed=[];const control=createCatalogControl({document,kind:'region',multiple:true,value:'',label:'期望城市',onChange:v=>changed.push(v),catalogs:catalog});
 await open(control);const [province,city,district]=nodes(control,'select');assert.equal(district.hidden,true);
 province.value='44';province.onchange();city.value='4403';city.onchange();
 const add=nodes(control,'button').find(b=>b.textContent==='添加城市');add.onclick();add.onclick();
 assert.equal(changed.at(-1),'广东省 / 深圳市');
});
