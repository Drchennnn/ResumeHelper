// Standalone test page only. Production extension APIs are never replaced by this fixture.
globalThis.chrome={runtime:{id:'fictional-fixture',onMessage:{addListener(){}}}};
const records=document.querySelector('.records');
function picker(root,choices,multiple=false){
 const input=root.querySelector('input'),label=root.querySelector('.ud__select__selector__selectItem');
 const menu=document.createElement('div');menu.className='ud__select__list';menu.hidden=true;document.body.append(menu);
 for(const text of choices){const item=document.createElement('div');item.className='ud__select__list__item';item.textContent=text;item.onmousedown=e=>e.preventDefault();item.onclick=()=>{const old=label.textContent.split('；').filter(Boolean);label.textContent=multiple?[...new Set([...old,text])].join('；'):text;input.value='';menu.hidden=!multiple;input.dispatchEvent(new Event('change',{bubbles:true}));};menu.append(item);}
 input.addEventListener('click',()=>{for(const p of document.querySelectorAll('.ud__select__list,.ud__picker-panel'))p.hidden=true;menu.hidden=false;});
 input.addEventListener('keydown',e=>{if(e.key==='Escape')menu.hidden=true;});
 input.addEventListener('input',()=>{for(const item of menu.children)item.hidden=!item.textContent.includes(input.value);});
}
function month(input){
 let year=2026;const panel=document.createElement('div');panel.className='ud__picker-panel';panel.hidden=true;
 const header=document.createElement('div');header.className='ud__picker-panel-header';const inner=document.createElement('div');inner.className='ud__picker-panel-header-inner';const content=document.createElement('div');content.className='ud__picker-panel-header-content';inner.append(content);header.append(inner);
 const render=()=>{const title=document.createElement('span');title.className='ud__picker-panel-header-btn';title.textContent=`${year}年`;content.replaceChildren(title);};render();
 for(const [icon,delta]of [['LeftBoldOutlined',-1],['RightBoldOutlined',1]]){const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',delta<0?'上一年':'下一年');b.innerHTML=`<span data-icon="${icon}">${delta<0?'←':'→'}</span>`;b.onclick=()=>{year+=delta;render();};inner.append(b);}
 panel.append(header);const cells=document.createElement('div');cells.className='ud__picker-panel-body';
 for(let m=1;m<=12;m++){const cell=document.createElement('div');cell.className='ud__picker-month-panel-cell ud__picker__cell';const area=document.createElement('div');area.className='ud__picker__cell-interactive-area';area.textContent=`${String(m).padStart(2,'0')}月`;area.onclick=()=>{input.value=`${year}-${String(m).padStart(2,'0')}`;input.dataset.committed=input.value;panel.hidden=true;input.dispatchEvent(new Event('change',{bubbles:true}));};cell.append(area);cells.append(cell);}
 panel.append(cells);document.body.append(panel);input.addEventListener('click',()=>{for(const p of document.querySelectorAll('.ud__select__list,.ud__picker-panel'))p.hidden=true;panel.hidden=false;});input.addEventListener('blur',()=>{input.value=input.dataset.committed||'';});input.addEventListener('keydown',e=>{if(e.key==='Escape')panel.hidden=true;});
}
function addEducation(){const record=document.createElement('div');record.className='apply-form-array-card-content';record.innerHTML=`<div data-form-field-i18n-name="学校名称"><label>学校名称</label><input data-form-field-name="school" data-form-field-i18n-name="学校名称"></div><div data-form-field-i18n-name="学历"><label>学历</label><div class="ud__select"><div class="ud__select__selector"><div class="ud__select__selector__selectItem"></div><input role="combobox" type="search" readonly></div></div></div><div data-form-field-i18n-name="起止时间"><label>起止时间</label><div class="throne-biz-date-range-picker-wrapper"><input><input></div></div>`;records.append(record);picker(record.querySelector('.ud__select'),['博士','硕士','本科','大专']);for(const input of record.querySelectorAll('.throne-biz-date-range-picker-wrapper input'))month(input);}
document.querySelector('.add').onclick=()=>setTimeout(addEducation,30);addEducation();picker(document.querySelector('#formily-item-preferred_city_list .ud__select'),['北京','上海','深圳','杭州'],true);
document.querySelector('#submit').onclick=()=>document.body.dataset.submitted='true';
const generic=document.createElement('section');generic.dataset.section='personal';generic.innerHTML='<h2>通用 ARIA / Ant / Element 控件</h2><div role="combobox" tabindex="0" aria-label="性别" aria-controls="aria-gender"></div><div class="ant-select"><span class="ant-select-selection-item"></span><input role="combobox" readonly aria-label="婚姻状况" aria-controls="ant-marital"></div><div class="el-select"><input role="combobox" readonly aria-label="政治面貌" aria-controls="element-political"></div>';document.querySelector('#submit').before(generic);
for(const [id,label,choices]of [['aria-gender','性别',['男','女']],['ant-marital','婚姻状况',['未婚','已婚']],['element-political','政治面貌',['群众','共青团员']]]){
 const control=generic.querySelector(`[aria-label="${label}"]`);const menu=document.createElement('div');menu.id=id;menu.setAttribute('role','listbox');menu.hidden=true;
 for(const text of choices){const option=document.createElement('div');option.setAttribute('role','option');option.textContent=text;option.onclick=()=>{control.setAttribute('aria-valuetext',text);control.setAttribute('aria-expanded','false');if(control.tagName==='INPUT')control.value=text;const span=control.closest('.ant-select')?.querySelector('.ant-select-selection-item');if(span)span.textContent=text;menu.hidden=true;};menu.append(option);}
 control.onclick=()=>{for(const p of document.querySelectorAll('.ud__select__list,.ud__picker-panel,[role="listbox"]'))p.hidden=true;menu.hidden=false;control.setAttribute('aria-expanded','true');};document.body.append(menu);
}

// A separate portal with delayed child columns exercises a general ARIA cascader.
const region=document.createElement('div');region.className='ant-cascader';region.innerHTML='<input role="combobox" readonly aria-label="籍贯" aria-haspopup="tree" aria-controls="region-tree">';generic.append(region);
const regionInput=region.querySelector('input'),tree=document.createElement('div');tree.id='region-tree';tree.setAttribute('role','tree');tree.hidden=true;document.body.append(tree);
function regionLevel(level){tree.replaceChildren();const item=document.createElement('div');item.setAttribute('role','treeitem');item.textContent=['广东省','深圳市','南山区'][level];item.onclick=()=>{if(level<2)setTimeout(()=>regionLevel(level+1),30);else{regionInput.value='广东省 / 深圳市 / 南山区';regionInput.setAttribute('aria-valuetext',regionInput.value);tree.hidden=true;}};tree.append(item);}
regionInput.onclick=()=>{for(const p of document.querySelectorAll('.ud__select__list,.ud__picker-panel,[role="listbox"]'))p.hidden=true;regionLevel(0);tree.hidden=false;};
