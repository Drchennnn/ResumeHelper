import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const contentSource = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    Object.assign(this, options);
  }
}

class FakeElement {
  #value = "";
  #checked = false;

  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.id = attributes.id || "";
    this.name = attributes.name || "";
    this.type = attributes.type || (tagName === "input" ? "text" : "");
    this.hidden = Boolean(attributes.hidden);
    this.disabled = Boolean(attributes.disabled);
    this.readOnly = Boolean(attributes.readOnly);
    this.isConnected = true;
    this.isContentEditable = attributes.contenteditable === "true";
    this.textContent = attributes.textContent || "";
    this.maxLength = attributes.maxLength ?? -1;
    this.multiple = Boolean(attributes.multiple);
    this.options = attributes.options || [];
    this.labels = attributes.labels || [];
    this.events = [];
    this.style = attributes.style || {};
    this.parent = attributes.parent || null;
    this.parentElement = attributes.parent || null;
    this.className = attributes.className || "";
    this.section = attributes.section || null;
    this.setterCalls = [];
    this.#value = attributes.value || "";
    this.#checked = Boolean(attributes.checked);
  }

  get value() {
    return this.#value;
  }

  set value(value) {
    this.setterCalls.push(["value", value]);
    this.#value = String(value);
  }

  get checked() {
    return this.#checked;
  }

  set checked(value) {
    this.setterCalls.push(["checked", value]);
    this.#checked = Boolean(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  getClientRects() {
    return this.style.display === "none" ? [] : [{}];
  }

  closest(selector) {
    if (selector === "[hidden],[aria-hidden='true']") {
      return this.hidden || this.attributes["aria-hidden"] === "true" ? this : null;
    }
    if (selector === "label") return this.parent?.tagName === "LABEL" ? this.parent : null;
    if (selector === "[data-section],[aria-label],fieldset,section") return this.section;
    return null;
  }

  querySelector(selector) {
    if (!this.sectionHeading) return null;
    return selector.includes("legend") ? this.sectionHeading : null;
  }

  querySelectorAll() {
    return [];
  }

  focus() {}

  scrollIntoView() {}

  click() {
    this.onclick?.();
    this.dispatchEvent(new FakeEvent("click", { bubbles: true }));
  }

  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }
}

class FakeContainer extends FakeElement {
  constructor(tagName, attributes = {}) {
    super(tagName, attributes);
    this.children = [];
  }

  querySelectorAll(selector) {
    if (selector === "*") return this.children;
    if (selector.includes("[role='listbox']") || selector.includes("[role='tree']")) {
      return this.children.filter((element) => (
        (selector.includes("[role='listbox']") && element.getAttribute("role") === "listbox") ||
        (selector.includes("[role='tree']") && element.getAttribute("role") === "tree")
      ));
    }
    if (selector.includes("[role='option']")) {
      return this.children.filter((element) => element.getAttribute("role") === "option");
    }
    return this.children.filter((element) => {
      const tag = element.tagName.toLowerCase();
      return ["input", "textarea", "select", "button"].includes(tag) || element.isContentEditable ||
        element.getAttribute("role") === "combobox" || element.getAttribute("aria-haspopup");
    });
  }
}

class RejectingCheckbox extends FakeElement {
  get checked() {
    return false;
  }

  set checked(value) {
    this.setterCalls.push(["checked-rejected", value]);
  }
}

function label(text) {
  return { textContent: text };
}

function labelWithNestedControl(text, nestedText) {
  return {
    textContent: `${text}${nestedText}`,
    cloneNode() {
      const clone = {
        textContent: `${text}${nestedText}`,
        querySelectorAll() {
          return [{ remove() { clone.textContent = text; } }];
        },
      };
      return clone;
    },
  };
}

function createHarness() {
  const document = new FakeContainer("document");
  document.title = "测试网申";
  document.byId = new Map();
  document.getElementById = (id) => document.byId.get(id) || null;
  const listeners = [];
  const chrome = {
    runtime: {
      id: "personal-resume-test",
      onMessage: { addListener(listener) { listeners.push(listener); } },
    },
  };
  const context = vm.createContext({
    chrome,
    document,
    location: { href: "https://jobs.example.test/apply" },
    Event: FakeEvent,
    getComputedStyle: (element) => ({
      display: element.style.display || "block",
      visibility: element.style.visibility || "visible",
    }),
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(contentSource, context);

  function send(message, sender = { id: chrome.runtime.id }) {
    let response;
    let resolveAsync;
    const responsePromise = new Promise((resolve) => { resolveAsync = resolve; });
    let asynchronous = false;
    for (const listener of listeners) {
      const keepChannel = listener(message, sender, (value) => {
        response = value;
        resolveAsync(value);
      });
      if (keepChannel === true) asynchronous = true;
    }
    return asynchronous ? responsePromise : response;
  }

  return { context, document, listeners, send };
}

test("SCAN returns labelled visible fields, options, sections, and stable IDs", () => {
  const { document, send } = createHarness();
  const section = new FakeContainer("fieldset", { "data-section": "教育经历" });
  const name = new FakeElement("input", { labels: [label("姓名")], section });
  const school = new FakeElement("input", { "aria-label": "学校", section });
  const degree = new FakeElement("select", {
    labels: [labelWithNestedControl("学历", "请选择本科硕士博士")],
    section,
    value: "master",
    options: [
      { value: "", textContent: "请选择" },
      { value: "master", textContent: "硕士" },
    ],
  });
  const password = new FakeElement("input", { type: "password", name: "secret" });
  const hidden = new FakeElement("input", { name: "hidden-field", style: { display: "none" } });
  const readonly = new FakeElement("input", { name: "readonly-field", readOnly: true });
  const consent = new FakeElement("input", { type: "checkbox", labels: [label("同意隐私声明")] });
  document.children.push(name, school, degree, password, hidden, readonly, consent);

  const first = send({ type: "SCAN" });
  const second = send({ type: "SCAN" });

  assert.equal(first.url, "https://jobs.example.test/apply");
  assert.equal(first.title, "测试网申");
  assert.deepEqual(plain(first.fields.map((field) => field.label)), ["姓名", "学校", "学历"]);
  assert.equal(first.fields[1].section, "教育经历");
  assert.equal(first.fields[2].value, "master");
  assert.deepEqual(plain(first.fields[2].options.map((option) => option.label)), ["请选择", "硕士"]);
  assert.deepEqual(
    plain(second.fields.map((field) => field.id)),
    plain(first.fields.map((field) => field.id)),
  );
});

test("APPLY uses native setters, emits events, protects non-empty values, and validates choices", async () => {
  const { document, send } = createHarness();
  const name = new FakeElement("input", { labels: [label("姓名")], maxLength: 4 });
  const email = new FakeElement("input", { name: "email", value: "keep@example.test" });
  const degree = new FakeElement("select", {
    labels: [label("学历")],
    options: [{ value: "master", textContent: "硕士" }],
  });
  const consent = new FakeElement("input", { type: "checkbox", labels: [label("接收职位提醒") ] });
  const track = new FakeElement("input", { type: "radio", value: "tech", labels: [label("技术") ] });
  document.children.push(name, email, degree, consent, track);
  const fields = send({ type: "SCAN" }).fields;
  const id = (labelText) => fields.find((field) => field.label === labelText).id;

  const response = await send({
    type: "APPLY",
    items: [
      { fieldId: id("姓名"), value: "ABCDE" },
      { fieldId: id("email"), value: "replace@example.test" },
      { fieldId: id("学历"), value: "硕士" },
      { fieldId: id("接收职位提醒"), value: "随便" },
      { fieldId: id("技术"), value: "other" },
    ],
  });

  assert.equal(name.value, "");
  assert.deepEqual(name.setterCalls, []);
  assert.deepEqual(name.events, []);
  assert.equal(email.value, "keep@example.test");
  assert.equal(degree.value, "master");
  assert.deepEqual(plain(response.results.map((result) => [result.status, result.reason])), [
    ["skipped", "too_long"],
    ["skipped", "non_empty"],
    ["applied", null],
    ["skipped", "checkbox_requires_boolean"],
    ["skipped", "radio_value_mismatch"],
  ]);
});

test("APPLY supports explicit boolean controls and overwrite", async () => {
  const { document, send } = createHarness();
  const existing = new FakeElement("textarea", { value: "旧内容", labels: [label("项目")] });
  const consent = new FakeElement("input", { type: "checkbox", labels: [label("接收提醒")] });
  const radio = new FakeElement("input", { type: "radio", value: "tech", labels: [label("技术岗")] });
  document.children.push(existing, consent, radio);
  const fields = send({ type: "SCAN" }).fields;

  const response = await send({
    type: "APPLY",
    overwrite: true,
    items: [
      { fieldId: fields[0].id, value: "新内容" },
      { fieldId: fields[1].id, value: true },
      { fieldId: fields[2].id, value: "tech" },
    ],
  });

  assert.equal(existing.value, "新内容");
  assert.equal(consent.checked, true);
  assert.equal(radio.checked, true);
  assert.ok(response.results.every((result) => result.status === "applied"));
});

test("dynamic fields can be scanned while detached and forged messages are rejected", async () => {
  const { context, document, listeners, send } = createHarness();
  vm.runInContext(contentSource, context);
  assert.equal(listeners.length, 1, "second injection must not register another listener");

  const first = new FakeElement("input", { name: "first" });
  document.children.push(first);
  const firstId = send({ type: "SCAN" }).fields[0].id;
  first.isConnected = false;
  document.children.splice(0, 1);
  const detached = await send({ type: "APPLY", items: [{ fieldId: firstId, value: "x" }] });
  assert.equal(detached.results[0].reason, "detached_field");

  const dynamic = new FakeElement("input", { placeholder: "动态字段" });
  document.children.push(dynamic);
  assert.equal(send({ type: "SCAN" }).fields[0].label, "动态字段");
  assert.equal(send({ type: "SCAN" }, { id: "another-extension" }), undefined);
});

test("SCAN includes fields in open shadow roots", () => {
  const { document, send } = createHarness();
  const host = new FakeElement("div");
  const shadow = new FakeContainer("shadow-root");
  shadow.mode = "open";
  shadow.children.push(new FakeElement("input", { "aria-label": "影子字段" }));
  host.shadowRoot = shadow;
  document.children.push(host);

  const fields = send({ type: "SCAN" }).fields;
  assert.equal(fields.length, 1);
  assert.equal(fields[0].label, "影子字段");
});

test("APPLY rejects disabled options and protects an already selected radio group", async () => {
  const { document, send } = createHarness();
  const select = new FakeElement("select", {
    labels: [label("意向城市")],
    options: [{ value: "hk", textContent: "香港", disabled: true }],
  });
  const selected = new FakeElement("input", {
    type: "radio",
    name: "track",
    value: "product",
    checked: true,
    labels: [label("产品岗")],
  });
  const target = new FakeElement("input", {
    type: "radio",
    name: "track",
    value: "tech",
    labels: [label("技术岗")],
  });
  document.children.push(select, selected, target);
  const fields = send({ type: "SCAN" }).fields;

  const response = await send({
    type: "APPLY",
    items: [
      { fieldId: fields[0].id, value: "hk" },
      { fieldId: fields[2].id, value: "tech" },
    ],
  });

  assert.deepEqual(plain(response.results.map(({ status, reason }) => [status, reason])), [
    ["skipped", "option_disabled"],
    ["skipped", "non_empty"],
  ]);
  assert.equal(selected.checked, true);
  assert.equal(target.checked, false);
});

test("APPLY verifies readback and isolates one field exception from later fields", async () => {
  const { document, send } = createHarness();
  const reverted = new FakeElement("input", { labels: [label("被页面回滚")] });
  reverted.dispatchEvent = function dispatchAndRevert(event) {
    this.events.push(event.type);
    this.value = "页面值";
    return true;
  };
  const broken = new FakeElement("input", { labels: [label("异常字段")] });
  broken.dispatchEvent = () => { throw new Error("page handler failed"); };
  const rejectedCheck = new RejectingCheckbox("input", {
    type: "checkbox",
    labels: [label("接收职位提醒")],
  });
  const healthy = new FakeElement("input", { labels: [label("正常字段")] });
  document.children.push(reverted, broken, rejectedCheck, healthy);
  const fields = send({ type: "SCAN" }).fields;

  const response = await send({
    type: "APPLY",
    items: fields.map((field) => ({
      fieldId: field.id,
      value: field.type === "checkbox" ? true : "目标值",
    })),
  });

  assert.deepEqual(plain(response.results.map(({ status, reason }) => [status, reason])), [
    ["failed", "value_mismatch"],
    ["failed", "exception"],
    ["failed", "value_mismatch"],
    ["applied", null],
  ]);
  assert.equal(healthy.value, "目标值");
  assert.deepEqual(healthy.events, ["input", "change"]);
});

test('same-URL document reload cannot apply an old document field ID',async()=>{
 const old=createHarness(),fresh=createHarness();
 const a=new FakeElement('input',{labels:[label('姓名')]}),b=new FakeElement('input',{labels:[label('姓名')]});
 old.document.children.push(a);fresh.document.children.push(b);
 const before=old.send({type:'SCAN'}).fields[0].id;const after=fresh.send({type:'SCAN'}).fields[0].id;
 assert.notEqual(before,after);
 assert.equal((await fresh.send({type:'APPLY',items:[{fieldId:before,value:'wrong'}]})).results[0].reason,'unknown_field');
 assert.equal(b.value,'');
});

test('isolated bridge scans selected container and a single target without including assistant shadow UI',async()=>{
 const {context,document}=createHarness();
 const outside=new FakeElement('input',{'aria-label':'外部字段'});
 const scope=new FakeContainer('section');
 const inside=new FakeElement('input',{'aria-label':'选区字段'});
 scope.children.push(inside);document.children.push(outside,scope);
 const bridge=context.__personalResumeBridge;
 assert.deepEqual(plain(bridge.scan(scope).fields.map(f=>f.label)),['选区字段']);
 inside.matches=()=>true;
 assert.deepEqual(plain(bridge.scan(inside).fields.map(f=>f.label)),['选区字段']);
 const host=new FakeElement('div');host.hasAttribute=k=>k==='data-personal-resume-ui';
 host.shadowRoot=new FakeContainer('shadow-root');host.shadowRoot.mode='open';
 host.shadowRoot.children.push(new FakeElement('input',{'aria-label':'助手开关'}));
 document.children.push(host);
 assert.ok(!bridge.scan().fields.some(f=>f.label==='助手开关'));
 const id=bridge.scan(inside).fields[0].id;
 assert.equal((await bridge.apply([{fieldId:id,value:'局部填写'}],false))[0].status,'applied');
 assert.equal(outside.value,'');assert.equal(inside.value,'局部填写');
});

test('ARIA readonly combobox is scanned and APPLY clicks only an exact visible option',async()=>{
 const {document,send}=createHarness();
 const menu=new FakeContainer('div',{id:'degree-options'});menu.id='degree-options';
 const bachelor=new FakeElement('div',{role:'option',textContent:'本科'});
 const master=new FakeElement('div',{role:'option',textContent:'硕士'});
 menu.children.push(bachelor,master);document.byId.set(menu.id,menu);
 const combo=new FakeElement('input',{
  role:'combobox',readonly:'',readOnly:true,'aria-controls':menu.id,
  'data-form-field-i18n-name':'学历',placeholder:'请选择学历',
 });
 master.onclick=()=>{combo.value='硕士';master.attributes['aria-selected']='true';};
 document.children.push(combo,menu);
 const fields=send({type:'SCAN'}).fields;
 assert.equal(fields.length,1);
 assert.equal(fields[0].label,'学历');
 assert.equal(fields[0].type,'combobox');
 assert.deepEqual(plain(fields[0].options),[
  {value:'本科',label:'本科'},
  {value:'硕士',label:'硕士'},
 ]);
 const result=await send({type:'APPLY',items:[{fieldId:fields[0].id,value:'硕士'}]});
 assert.equal(result.results[0].status,'applied',JSON.stringify(result));
 assert.equal(combo.value,'硕士');
 assert.ok(master.events.includes('pointerdown'));
 assert.ok(!bachelor.events.includes('click'));
});

test('custom combobox waits for an asynchronously rendered exact option',async()=>{
 const {document,send}=createHarness();
 const menu=new FakeContainer('div',{id:'city-options'});menu.id='city-options';document.byId.set(menu.id,menu);
 const combo=new FakeElement('input',{
  role:'combobox',readonly:'',readOnly:true,'aria-controls':menu.id,'aria-label':'期望城市',
 });
 combo.onclick=()=>setTimeout(()=>{
  if(menu.children.length)return;
  const option=new FakeElement('div',{role:'option',textContent:'深圳'});
  option.onclick=()=>{combo.value='深圳';option.attributes['aria-selected']='true';};
  menu.children.push(option);
 },20);
 document.children.push(combo,menu);
 const field=send({type:'SCAN'}).fields[0];
 const result=await send({type:'APPLY',items:[{fieldId:field.id,value:'深圳'}]});
 assert.equal(result.results[0].status,'applied',JSON.stringify(result));
 assert.equal(combo.value,'深圳');
});

test('bridge cancel stops an in-flight custom control wait',async()=>{
 const {context,document,send}=createHarness();
 const emptyMenu=new FakeContainer('div',{id:'empty-options'});emptyMenu.id='empty-options';document.byId.set(emptyMenu.id,emptyMenu);
 const combo=new FakeElement('input',{role:'combobox',readonly:'',readOnly:true,'aria-controls':emptyMenu.id,'aria-label':'学历'});
 document.children.push(combo,emptyMenu);
 const field=send({type:'SCAN'}).fields[0];
 const pending=context.__personalResumeBridge.apply([{fieldId:field.id,value:'硕士'}],false);
 setTimeout(()=>context.__personalResumeBridge.cancel(),20);
 const results=await pending;
 assert.equal(results[0].reason,'cancelled');
});

test('multi-select combobox applies semicolon-delimited choices one by one',async()=>{
 const {document,send}=createHarness();
 const menu=new FakeContainer('div',{id:'multi-city-options'});menu.id='multi-city-options';
 const wrapper=new FakeContainer('div');const multipleMarker={};const selected=[];
 const combinedSelection={get textContent(){return selected.join('；');}};
 wrapper.querySelector=selector=>selector.includes('selector-multiple')?multipleMarker:null;
 wrapper.querySelectorAll=selector=>selector.includes('selectItem')?[combinedSelection]:[];
 const combo=new FakeElement('input',{role:'combobox',readonly:'',readOnly:true,'aria-controls':menu.id,'aria-label':'期望地点'});
 const baseClosest=combo.closest.bind(combo);
 combo.closest=selector=>selector.includes('.ud__select')?wrapper:baseClosest(selector);
 for(const city of ['深圳','北京']){
  const option=new FakeElement('div',{role:'option',textContent:city});
  option.onclick=()=>{option.attributes['aria-selected']='true';selected.push(city);};
  menu.children.push(option);
 }
 document.byId.set(menu.id,menu);document.children.push(combo,menu);
 const field=send({type:'SCAN'}).fields[0];
 const result=await send({type:'APPLY',items:[{fieldId:field.id,value:'深圳；北京'}]});
 assert.equal(result.results[0].status,'applied',JSON.stringify(result));
 assert.deepEqual(selected,['深圳','北京']);
});

test('SCAN does not copy one detached portal menu onto unrelated closed comboboxes',()=>{
 const {document,send}=createHarness();
 const closed=new FakeElement('input',{role:'combobox',readonly:'',readOnly:true,'aria-label':'学历'});
 const open=new FakeElement('input',{
  role:'combobox',readonly:'',readOnly:true,'aria-label':'政治面貌','aria-expanded':'true',
 });
 const popup=new FakeContainer('div',{role:'listbox'});
 popup.children.push(new FakeElement('div',{role:'option',textContent:'群众'}));
 document.children.push(closed,open,popup);
 const fields=send({type:'SCAN'}).fields;
 assert.equal(fields.find(field=>field.label==='学历').options,undefined);
 assert.deepEqual(plain(fields.find(field=>field.label==='政治面貌').options),[
  {value:'群众',label:'群众'},
 ]);
});

test('inline custom control can use its single visible portal when no aria ownership exists',async()=>{
 const {document,send}=createHarness();
 const inline=new FakeContainer('div');
 const popup=new FakeContainer('div',{role:'listbox'});
 const option=new FakeElement('div',{role:'option',textContent:'硕士'});
 const combo=new FakeElement('input',{role:'combobox',readonly:'',readOnly:true,'aria-label':'学历'});
 const baseClosest=combo.closest.bind(combo);
 combo.closest=selector=>selector.includes('.ud__select')?inline:baseClosest(selector);
 option.onclick=()=>{combo.value='硕士';option.attributes['aria-selected']='true';};
 popup.children.push(option);document.children.push(combo,popup);
 const field=send({type:'SCAN'}).fields[0];
 const result=await send({type:'APPLY',items:[{fieldId:field.id,value:'硕士'}]});
 assert.equal(result.results[0].status,'applied',JSON.stringify(result));
 assert.equal(combo.value,'硕士');
});

test('tree cascader selects an exact province city district path with explicit suffix aliases',async()=>{
 const {document,send}=createHarness();
 const popup=new FakeContainer('div',{role:'tree'});
 const combo=new FakeElement('input',{role:'combobox','aria-haspopup':'tree',readonly:'',readOnly:true,'aria-label':'居住地址'});
 const option=text=>new FakeElement('div',{role:'option',textContent:text});
 const province=option('广东'),city=option('深圳'),district=option('南山');
 province.onclick=()=>{popup.children=[city];};
 city.onclick=()=>{popup.children=[district];};
 district.onclick=()=>{combo.value='广东 / 深圳 / 南山';district.attributes['aria-selected']='true';};
 popup.children=[province];document.children.push(combo,popup);
 const field=send({type:'SCAN'}).fields[0];
 const result=await send({type:'APPLY',items:[{fieldId:field.id,value:'广东省 / 深圳市 / 南山区'}]});
 assert.equal(result.results[0].status,'applied',JSON.stringify(result));
 assert.equal(combo.value,'广东 / 深圳 / 南山');
 assert.ok(province.events.includes('click')&&city.events.includes('click')&&district.events.includes('click'));
});

test('repeated records get their index from the enclosing collection instead of their immediate parent',()=>{
 const {document,send}=createHarness();
 const collection=new FakeContainer('section');
 const recordsParent={closest:()=>collection};
 const firstRecord=new FakeContainer('div'),secondRecord=new FakeContainer('div');
 collection.querySelectorAll=selector=>selector.includes('apply-form-array-card-content')?[firstRecord,secondRecord]:[];
 firstRecord.parentElement=recordsParent;secondRecord.parentElement=recordsParent;
 const school=new FakeElement('input',{'aria-label':'学校名称','data-form-field-name':'school'});
 const baseClosest=school.closest.bind(school);
 school.closest=selector=>selector.includes('apply-form-array-card-content')?secondRecord:baseClosest(selector);
 document.children.push(school);
 const field=send({type:'SCAN'}).fields[0];
 assert.equal(field.fieldKey,'school');assert.equal(field.groupIndex,1);assert.equal(field.groupCount,2);
});

test('UD month range picker navigates by year, clicks the requested month, and reads back',async()=>{
 const {document,send}=createHarness();
 const start=new FakeElement('input',{'aria-label':'入学时间'});
 const end=new FakeElement('input',{'aria-label':'毕业时间'});
 const range={querySelectorAll:selector=>selector==='input'?[start,end]:[]};
 const baseStartClosest=start.closest.bind(start),baseEndClosest=end.closest.bind(end);
 start.closest=selector=>selector.includes('date-range-picker')||selector.includes('DateRangePicker')||selector.includes('throne-biz-date-range')?range:baseStartClosest(selector);
 end.closest=selector=>selector.includes('date-range-picker')||selector.includes('DateRangePicker')||selector.includes('throne-biz-date-range')?range:baseEndClosest(selector);
 const controls=new FakeContainer('div');
 const headerContent=new FakeContainer('div');headerContent.parentElement=controls;
 let displayedYear=2026;
 let header;
 const renderHeader=()=>{
  header=new FakeElement('button',{textContent:`${displayedYear}年`});
  header.parentElement=headerContent;
  header.closest=selector=>selector==='.ud__picker-panel-header-inner'?controls:null;
  headerContent.children=[header];
 };
 renderHeader();
 const left=new FakeElement('button'),right=new FakeElement('button');
 left.querySelector=selector=>selector.includes('LeftBoldOutlined')?{}:null;
 right.querySelector=selector=>selector.includes('RightBoldOutlined')?{}:null;
 left.onclick=()=>{displayedYear-=1;renderHeader();};
 right.onclick=()=>{displayedYear+=1;renderHeader();};
 controls.children.push(left,headerContent,right);
 const months=Array.from({length:12},(_,index)=>new FakeElement('div',{textContent:`${String(index+1).padStart(2,'0')}月`}));
 months[8].onclick=()=>{start.value='2024-09';};
 const originalQuery=document.querySelectorAll.bind(document);
 document.querySelectorAll=selector=>{
  if(selector==='.ud__picker-panel-header-btn')return[header];
  if(selector.includes('.ud__picker-month-panel-cell'))return months;
  return originalQuery(selector);
 };
 document.children.push(start,end);
 const fields=send({type:'SCAN'}).fields;
 assert.deepEqual(plain(fields.map(field=>[field.label,field.type])),[
  ['入学时间（开始）','date-picker'],['毕业时间（结束）','date-picker'],
 ]);
 const result=await send({type:'APPLY',items:[{fieldId:fields[0].id,value:'2024-09'}]});
 assert.equal(result.results[0].status,'applied',JSON.stringify(result));
 assert.equal(start.value,'2024-09');
 assert.equal(left.events.filter(type=>type==='click').length,2);
 assert.ok(months[8].events.includes('click'));
});
