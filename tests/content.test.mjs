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
    this.listeners = new Map();
    this.style = attributes.style || {};
    this.rect = attributes.rect || { x: 10, y: 20, width: 120, height: 32 };
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

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener));
  }

  getClientRects() {
    return this.style.display === "none" ? [] : [{}];
  }

  getBoundingClientRect() {
    return this.rect;
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
    event.target ||= this;
    for (const listener of this.listeners.get(event.type) || []) listener(event);
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
    if (selector.includes("[role='option']") || selector.includes("[role='menuitem']")) {
      return this.children.filter((element) => (
        (selector.includes("[role='option']") && element.getAttribute("role") === "option") ||
        (selector.includes("[role='menuitem']") && element.getAttribute("role") === "menuitem")
      ));
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

function createHarness({ runtimeSend } = {}) {
  const document = new FakeContainer("document");
  document.title = "测试网申";
  document.byId = new Map();
  document.getElementById = (id) => document.byId.get(id) || null;
  const listeners = [];
  const chrome = {
    runtime: {
      id: "personal-resume-test",
      onMessage: { addListener(listener) { listeners.push(listener); } },
      sendMessage: runtimeSend || (async () => null),
    },
  };
  const context = vm.createContext({
    chrome,
    document,
    location: { href: "https://jobs.example.test/apply", origin: "https://jobs.example.test" },
    Event: FakeEvent,
    CustomEvent: FakeEvent,
    getComputedStyle: (element) => ({
      display: element.style.display || "block",
      visibility: element.style.visibility || "visible",
    }),
    setTimeout,
    clearTimeout,
    innerWidth: 1200,
    innerHeight: 800,
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

test('custom picker can request one bounded semantic candidate and verifies the chosen label',async()=>{
 let candidateRequest;
 const {document,send}=createHarness({runtimeSend:async message=>{
  if(message.type!=='CANDIDATE_MATCH')return null;
  candidateRequest=message;
  const match=message.candidates.find(candidate=>candidate.label==='计算机相关类');
  return {candidateId:match.id,confidence:0.96};
 }});
 const menu=new FakeContainer('div',{id:'major-category-options'});menu.id='major-category-options';
 const mathematics=new FakeElement('div',{role:'option',textContent:'数学相关类'});
 const computing=new FakeElement('div',{role:'option',textContent:'计算机相关类'});
 const combo=new FakeElement('input',{
  role:'combobox',readonly:'',readOnly:true,'aria-controls':menu.id,'aria-label':'专业类别',
 });
 computing.onclick=()=>{combo.value='计算机相关类';computing.attributes['aria-selected']='true';};
 menu.children.push(mathematics,computing);document.byId.set(menu.id,menu);document.children.push(combo,menu);
 const field=send({type:'SCAN'}).fields[0];
 const result=await send({
  type:'APPLY',
  items:[{fieldId:field.id,value:'电子信息类',sourcePath:'education[0].major_category'}],
  options:{semanticCandidates:true,resumeId:'resume-1'},
 });
 assert.equal(result.results[0].status,'applied',JSON.stringify(result));
 assert.equal(result.results[0].via,'semantic_candidate');
 assert.equal(combo.value,'计算机相关类');
 assert.equal(candidateRequest.sourcePath,'education[0].major_category');
 assert.equal(candidateRequest.candidates.length,2);
 const verified=send({type:'CONTROL_VERIFY',fieldId:field.id,value:'电子信息类'});
 assert.equal(verified.verified,true,'verified semantic selection may differ literally from the resume value');
});

test('rich text targets use the bounded editor event bridge instead of assigning HTML',async()=>{
 const {document,send}=createHarness();
 const editor=new FakeElement('div',{'aria-label':'项目描述',contenteditable:'true',className:'ql-editor'});
 editor.isContentEditable=true;
 editor.matches=selector=>selector.includes('.ql-editor');
 let request;
 editor.addEventListener('personal-resume-editor-request',event=>{
  request=event.detail;
  editor.dispatchEvent(new FakeEvent('personal-resume-editor-response',{detail:{
   token:event.detail.token,requestId:event.detail.requestId,ok:true,actual:event.detail.text,editor:'quill',
  }}));
 });
 document.children.push(editor);
 const field=send({type:'SCAN'}).fields[0];
 assert.equal(field.type,'richtext');
 const result=await send({type:'APPLY',items:[{fieldId:field.id,value:'项目 <b>纯文本</b>'}]});
 assert.equal(result.results[0].status,'applied',JSON.stringify(result));
 assert.equal(result.results[0].via,'quill');
 assert.equal(request.action,'setPlainText');
 assert.equal(request.text,'项目 <b>纯文本</b>');
 assert.equal(editor.getAttribute('data-personal-resume-editor-token'),null,'temporary token is removed');
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

test('JD-style CSS modules expose semantic label, section, record context and help text',()=>{
 const {document,send}=createHarness();
 const title={textContent:'教育经历'};
 const grid=new FakeContainer('section',{className:'gridContainer___hash'});
 grid.closest=selector=>selector.includes('gridContainer')?grid:null;
 grid.querySelector=selector=>selector.includes('title')?title:null;
 const collection=new FakeContainer('div');
 const recordsParent={closest:()=>collection};
 const firstRecord=new FakeContainer('div',{className:'formGroupItem___a'});
 const secondRecord=new FakeContainer('div',{className:'formGroupItem___b'});
 firstRecord.parentElement=recordsParent;secondRecord.parentElement=recordsParent;
 collection.querySelectorAll=selector=>selector.includes('formGroupItem')?[firstRecord,secondRecord]:[];
 const school=new FakeElement('input',{value:'香港城市大学','aria-label':'学校名称'});
 const major=new FakeElement('input',{placeholder:'请输入',rect:{x:30,y:80,width:260,height:40}});
 const fieldItem=new FakeContainer('div',{className:'fieldItem___hash'});
 fieldItem.parentElement=grid;
 fieldItem.querySelector=selector=>{
  if(selector.includes('filedName'))return{textContent:'专业名称'};
  if(selector.includes('help')||selector.includes('tip'))return{textContent:'请填写毕业证上的专业全称'};
  return null;
 };
 secondRecord.querySelector=()=>null;
 secondRecord.querySelectorAll=selector=>selector.includes('input')?[school,major]:[];
 const baseClosest=major.closest.bind(major);
 major.closest=selector=>{
  if(selector.includes('fieldItem'))return fieldItem;
  if(selector.includes('formGroupItem'))return secondRecord;
  return baseClosest(selector);
 };
 document.children.push(major);
 const field=send({type:'SCAN'}).fields[0];
 assert.equal(field.label,'专业名称');
 assert.equal(field.section,'教育经历');
 assert.equal(field.recordLabel,'香港城市大学');
 assert.equal(field.groupIndex,1);assert.equal(field.groupCount,2);
 assert.equal(field.helpText,'请填写毕业证上的专业全称');
 assert.match(field.context,/教育经历 \/ 香港城市大学 \/ 专业名称/);
 assert.deepEqual(plain(field.rect),{x:30,y:80,width:260,height:40});
 assert.equal(field.value,'','placeholder must not be treated as an existing value');
});

test('Ant 3 school selections ignore prompt text and expose the selected record anchor',()=>{
 const {document,send}=createHarness();
 const collection=new FakeContainer('div');
 const recordsParent={closest:()=>collection};
 const record=new FakeContainer('div',{className:'formGroupItem___education'});record.parentElement=recordsParent;
 collection.querySelectorAll=selector=>selector.includes('formGroupItem')?[record]:[];
 const selectRoot=new FakeContainer('div',{className:'ant-select'});
 const selected={textContent:''};
 selectRoot.querySelectorAll=selector=>selector.includes('ant-select-selection-selected-value')
  ?(selected.textContent?[selected]:[]):[];
 const school=new FakeContainer('div',{
  role:'combobox',className:'ant-select-selection--single','aria-label':'学校名称',textContent:'请填写学校名称',
 });
 const major=new FakeElement('input',{'aria-label':'专业名称'});
 const baseSchool=school.closest.bind(school),baseMajor=major.closest.bind(major);
 school.closest=selector=>selector.includes('.ant-select')?selectRoot:selector.includes('formGroupItem')?record:baseSchool(selector);
 major.closest=selector=>selector.includes('formGroupItem')?record:baseMajor(selector);
 record.querySelector=()=>null;
 record.querySelectorAll=selector=>selector.includes('input')||selector.includes("[role='combobox']")?[school,major]:[];
 document.children.push(major);
 let field=send({type:'SCAN'}).fields[0];
 assert.equal(field.recordLabel,undefined,'prompt text must not identify an empty education record');
 selected.textContent='北京邮电大学';school.textContent='请填写学校名称北京邮电大学';
 field=send({type:'SCAN'}).fields[0];
 assert.equal(field.recordLabel,'北京邮电大学');
 const realInput=new FakeElement('input',{
  role:'combobox',value:'香港城市大学','aria-label':'另一学校',textContent:'请填写学校名称',
 });
 document.children=[realInput];
 assert.equal(send({type:'SCAN'}).fields[0].value,'香港城市大学','real input values take precedence over prompt text');
});

test('occupied records without an identity anchor are not treated as blank records',()=>{
 const {document,send}=createHarness();
 const collection=new FakeContainer('div');
 const recordsParent={closest:()=>collection};
 const occupied=new FakeContainer('div',{className:'formGroupItem___campus'});
 const blank=new FakeContainer('div',{className:'formGroupItem___campus'});
 occupied.parentElement=recordsParent;blank.parentElement=recordsParent;
 collection.querySelectorAll=selector=>selector.includes('formGroupItem')?[occupied,blank]:[];

 const oldDescription=new FakeElement('textarea',{value:'已有但缺少活动名称的旧内容','aria-label':'活动描述'});
 const occupiedName=new FakeElement('input',{'aria-label':'活动名称'});
 const blankName=new FakeElement('input',{'aria-label':'活动名称'});
 const blankRadio=new FakeElement('input',{type:'radio',value:'1','aria-label':'是'});
 const blankSelect=new FakeElement('select',{'aria-label':'类型',options:[{value:'',textContent:'请选择'}]});
 occupied.querySelector=blank.querySelector=()=>null;
 occupied.querySelectorAll=selector=>selector.includes('input')||selector.includes('textarea')||selector.includes('select')
  ?[occupiedName,oldDescription]:[];
 blank.querySelectorAll=selector=>selector.includes('input')||selector.includes('textarea')||selector.includes('select')
  ?[blankName,blankRadio,blankSelect]:[];
 const baseOccupied=occupiedName.closest.bind(occupiedName),baseBlank=blankName.closest.bind(blankName);
 occupiedName.closest=selector=>selector.includes('formGroupItem')?occupied:baseOccupied(selector);
 blankName.closest=selector=>selector.includes('formGroupItem')?blank:baseBlank(selector);
 document.children.push(occupiedName,blankName);

 const fields=send({type:'SCAN'}).fields;
 assert.equal(fields[0].recordLabel,'未识别的已有记录');
 assert.equal(fields[1].recordLabel,undefined,'a genuinely empty record remains assignable');
});

test('JD program and campus containers keep their own sections',()=>{
 const {document,send}=createHarness();
 const makeSection=(id,title,labelText)=>{
  const section=new FakeContainer('section',{id,className:'gridContainer___fixture'});section.id=id;
  section.closest=selector=>selector.includes('gridContainer')?section:null;
  section.querySelector=selector=>selector.includes('title')?{textContent:title}:null;
  const item=new FakeContainer('div',{className:'fieldItem___fixture'});item.parentElement=section;
  item.querySelector=selector=>selector.includes('filedName')?{textContent:labelText}:null;
  const field=new FakeElement('textarea');
  const baseClosest=field.closest.bind(field);
  field.closest=selector=>selector.includes('fieldItem')?item:baseClosest(selector);
  return field;
 };
 document.children.push(
  makeSection('program','项目经历','项目经历描述'),
  makeSection('campus','校园经历','校园经历描述'),
 );
 const fields=send({type:'SCAN'}).fields;
 assert.deepEqual(plain(fields.map(field=>[field.label,field.section])),[
  ['项目经历描述','项目经历'],['校园经历描述','校园经历'],
 ]);
 assert.notEqual(fields[0].section,fields[1].section);
});

test('radio controls use their group title instead of exposing only the choice label',()=>{
 const {document,send}=createHarness();
 const container=new FakeContainer('div',{className:'fieldItem___gender'});
 container.querySelector=selector=>selector.includes('filedName')?{textContent:'性别'}:null;
 const male=new FakeElement('input',{type:'radio',value:'male',labels:[label('男')]});
 const baseClosest=male.closest.bind(male);
 male.closest=selector=>selector.includes('fieldItem')?container:baseClosest(selector);
 document.children.push(male);
 const field=send({type:'SCAN'}).fields[0];
 assert.equal(field.label,'性别：男');
 assert.deepEqual(plain(field.options),[{value:'male',label:'男'}]);
});

test('highest-degree radios keep their group title and select the matching boolean choice',async()=>{
 const {document,send}=createHarness();
 const container=new FakeContainer('div',{className:'fieldItem___highest'});
 container.querySelector=selector=>selector.includes('filedName')?{textContent:'是否最高学历'}:null;
 const group=new FakeContainer('div',{className:'ant-radio-group'});
 const yes=new FakeElement('input',{type:'radio',value:'1','aria-label':'是'});
 const no=new FakeElement('input',{type:'radio',value:'0','aria-label':'否',checked:true});
 group.children.push(yes,no);
 const baseYes=yes.closest.bind(yes),baseNo=no.closest.bind(no);
 yes.closest=selector=>selector.includes('fieldItem')?container:selector.includes('radio-group')?group:baseYes(selector);
 no.closest=selector=>selector.includes('fieldItem')?container:selector.includes('radio-group')?group:baseNo(selector);
 document.children.push(yes,no);
 const fields=send({type:'SCAN'}).fields;
 assert.deepEqual(plain(fields.map(field=>field.label)),['是否最高学历：是','是否最高学历：否']);
 assert.deepEqual(plain(fields.map(field=>field.options[0])),[
  {value:'1',label:'是'},{value:'0',label:'否'},
 ]);
 const result=await send({type:'APPLY',items:[{fieldId:fields[0].id,value:true}],overwrite:true});
 assert.equal(result.results[0].status,'applied',JSON.stringify(result));
 assert.equal(yes.checked,true);assert.equal(no.checked,false,'no-name Ant radios must remain mutually exclusive');
 assert.ok(yes.events.includes('click'),'controlled radio should receive a click');
 assert.deepEqual(no.events,[],'cleared peer must not receive a second synthetic change');
 assert.equal(yes.events.filter(type=>type==='input').length,1,'fallback emits one input event');
 assert.equal(yes.events.filter(type=>type==='change').length,1,'fallback emits one change event');
 const verified=send({type:'CONTROL_VERIFY',fieldId:fields[0].id,value:true});
 assert.equal(verified.verified,true);
 const reverse=await send({type:'APPLY',items:[{fieldId:fields[1].id,value:false}],overwrite:true});
 assert.equal(reverse.results[0].status,'applied',JSON.stringify(reverse));
 assert.equal(no.checked,true);assert.equal(yes.checked,false,'reverse overwrite must not leave both choices checked');
});

test('highest-degree switch confirms only the exact JD modal once and continues the batch',async()=>{
 const {document,send}=createHarness();
 const container=new FakeContainer('div',{className:'fieldItem___highest'});
 container.querySelector=selector=>selector.includes('filedName')?{textContent:'是否最高学历'}:null;
 const group=new FakeContainer('div',{className:'ant-radio-group'});
 const yes=new FakeElement('input',{type:'radio',value:'1','aria-label':'是'});
 const no=new FakeElement('input',{type:'radio',value:'0','aria-label':'否',checked:true});
 const following=new FakeElement('input',{'aria-label':'专业名称'});
 group.children.push(yes,no);
 const baseYes=yes.closest.bind(yes),baseNo=no.closest.bind(no);
 yes.closest=selector=>selector.includes('fieldItem')?container:selector.includes('radio-group')?group:baseYes(selector);
 no.closest=selector=>selector.includes('fieldItem')?container:selector.includes('radio-group')?group:baseNo(selector);
 const modal=new FakeContainer('div',{className:'ant-modal-confirm'});
 const prompt={textContent:'已选择另一学历为最高学历，请确认是否修改？'};
 const confirm=new FakeElement('button',{textContent:'确认'});
 modal.querySelector=selector=>selector.includes('ant-modal-confirm-content')?prompt:null;
 modal.querySelectorAll=selector=>selector==='button'?[confirm]:[];
 const originalQuery=document.querySelectorAll.bind(document);
 document.querySelectorAll=selector=>selector.includes('.ant-modal-confirm')&&modal.style.display!=='none'
  ?[modal]:originalQuery(selector);
 yes.click=()=>{
  yes.checked=true;no.checked=false;
  yes.dispatchEvent(new FakeEvent('click',{bubbles:true}));
 };
 confirm.onclick=()=>{modal.style.display='none';};
 document.children.push(yes,no,following);
 const fields=send({type:'SCAN'}).fields;
 const yesField=fields.find(field=>field.label==='是否最高学历：是');
 const followingField=fields.find(field=>field.label==='专业名称');
 const result=await send({
  type:'APPLY',overwrite:true,
  items:[{fieldId:yesField.id,value:true},{fieldId:followingField.id,value:'人工智能'}],
 });
 assert.deepEqual(plain(result.results.map(({status,reason})=>[status,reason])),[
  ['applied',null],['applied',null],
 ]);
 assert.equal(yes.events.filter(type=>type==='click').length,1,'radio receives one native click');
 assert.equal(confirm.events.filter(type=>type==='click').length,1,'recognized confirmation is accepted once');
 assert.equal(following.value,'人工智能');
});

test('unknown highest-degree confirmation stops the remaining batch without clicking generic buttons',async()=>{
 const {document,send}=createHarness();
 const container=new FakeContainer('div',{className:'fieldItem___highest'});
 container.querySelector=selector=>selector.includes('filedName')?{textContent:'是否最高学历'}:null;
 const group=new FakeContainer('div',{className:'ant-radio-group'});
 const yes=new FakeElement('input',{type:'radio',value:'1','aria-label':'是'});
 const no=new FakeElement('input',{type:'radio',value:'0','aria-label':'否',checked:true});
 const following=new FakeElement('input',{'aria-label':'专业名称'});
 group.children.push(yes,no);
 const baseYes=yes.closest.bind(yes),baseNo=no.closest.bind(no);
 yes.closest=selector=>selector.includes('fieldItem')?container:selector.includes('radio-group')?group:baseYes(selector);
 no.closest=selector=>selector.includes('fieldItem')?container:selector.includes('radio-group')?group:baseNo(selector);
 const modal=new FakeContainer('div',{className:'ant-modal-confirm'});
 const prompt={textContent:'已选择另一学历为最高学历，请确认是否修改？'};
 const generic=new FakeElement('button',{textContent:'继续'});
 modal.querySelector=selector=>selector.includes('ant-modal-confirm-content')?prompt:null;
 modal.querySelectorAll=selector=>selector==='button'?[generic]:[];
 const originalQuery=document.querySelectorAll.bind(document);
 document.querySelectorAll=selector=>selector.includes('.ant-modal-confirm')?[modal]:originalQuery(selector);
 yes.click=()=>{yes.checked=true;no.checked=false;yes.dispatchEvent(new FakeEvent('click',{bubbles:true}));};
 document.children.push(yes,no,following);
 const fields=send({type:'SCAN'}).fields;
 const result=await send({
  type:'APPLY',overwrite:true,
  items:[
   {fieldId:fields.find(field=>field.label==='是否最高学历：是').id,value:true},
   {fieldId:fields.find(field=>field.label==='专业名称').id,value:'人工智能'},
  ],
 });
 assert.deepEqual(plain(result.results.map(({status,reason})=>[status,reason])),[
  ['skipped','site_confirmation_required'],['skipped','site_confirmation_required'],
 ]);
 assert.equal(generic.events.includes('click'),false);
 assert.equal(following.value,'');
});

test('JD camelCase date range scans and verifies both readonly endpoints independently',()=>{
 const {document,send}=createHarness();
 const range=new FakeContainer('div',{className:'dateRangePicker___hash'});
 const start=new FakeElement('input',{readonly:'',readOnly:true,placeholder:'开始日期',value:'2024-09-01'});
 const end=new FakeElement('input',{readonly:'',readOnly:true,placeholder:'结束日期',value:'2027-10-01'});
 range.querySelectorAll=selector=>selector==='input'?[start,end]:[];
 const fieldItem=new FakeContainer('div',{className:'fieldItem___dates'});
 fieldItem.querySelector=selector=>selector.includes('filedName')?{textContent:'起止时间'}:null;
 const baseStart=start.closest.bind(start),baseEnd=end.closest.bind(end);
 start.closest=selector=>selector.includes('dateRangePicker')?range:selector.includes('fieldItem')?fieldItem:baseStart(selector);
 end.closest=selector=>selector.includes('dateRangePicker')?range:selector.includes('fieldItem')?fieldItem:baseEnd(selector);
 document.children.push(start,end);
 const fields=send({type:'SCAN'}).fields;
 assert.deepEqual(plain(fields.map(field=>[field.label,field.type,field.value])),[
  ['起止时间（开始）','date-picker','2024-09-01'],
  ['起止时间（结束）','date-picker','2027-10-01'],
 ]);
 assert.equal(send({type:'CONTROL_VERIFY',fieldId:fields[0].id,value:'2024-09-01'}).verified,true);
 assert.equal(send({type:'CONTROL_VERIFY',fieldId:fields[0].id,value:'2027-10-01'}).verified,false);
 assert.equal(send({type:'CONTROL_VERIFY',fieldId:fields[1].id,value:'2027-10-01'}).verified,true);
});

test('Ant professional cascader drops professional-degree prefixes and accepts related-category aliases',async()=>{
 const {document,send}=createHarness();
 const popup=new FakeContainer('div',{id:'major-menus'});popup.id='major-menus';
 const wrapper=new FakeContainer('span',{className:'ant-cascader-picker'});
 const selected={textContent:''};
 wrapper.querySelectorAll=selector=>selector.includes('ant-cascader-picker-label')?[selected]:[];
 const combo=new FakeElement('input',{
  className:'ant-cascader-input',readonly:'',readOnly:true,'aria-controls':popup.id,'aria-label':'专业类别',
 });
 const science=new FakeElement('li',{role:'menuitem',title:'理学',textContent:'理学'});
 const math=new FakeElement('li',{role:'menuitem',title:'数学相关类',textContent:'数学相关类'});
 science.onclick=()=>{popup.children=[math];};
 math.onclick=()=>{selected.textContent='理学 / 数学相关类';math.attributes['aria-selected']='true';};
 popup.children=[science];document.byId.set(popup.id,popup);
 const baseClosest=combo.closest.bind(combo);
 combo.closest=selector=>selector.includes('cascader')?wrapper:baseClosest(selector);
 document.children.push(combo,popup);
 const field=send({type:'SCAN'}).fields[0];
 const result=await send({type:'APPLY',items:[{
  fieldId:field.id,value:'专业学位硕士 / 理学 / 数学类',
 }]});
 assert.equal(result.results[0].status,'applied',JSON.stringify(result));
 assert.equal(combo.value,'','Ant cascader keeps the hidden input empty');
 assert.equal(selected.textContent,'理学 / 数学相关类');
 assert.ok(science.events.includes('click')&&math.events.includes('click'));
});

test('Ant day picker applies an exact date but blocks month-only and unavailable present values',async()=>{
 const {document,send}=createHarness();
 const originalQuery=document.querySelectorAll.bind(document);
 document.querySelectorAll=selector=>selector==='.ud__picker-panel-header-btn'?[]:originalQuery(selector);
 const makeDate=(label,panelId)=>{
  const panel=new FakeContainer('div',{id:panelId,className:'ant-calendar-picker-container'});panel.id=panelId;
  panel.matches=selector=>selector.includes('ant-calendar-picker-container');
  const input=new FakeElement('input',{
   role:'combobox',readonly:'',readOnly:true,'aria-controls':panelId,'aria-label':label,
  });
  const unit=new FakeContainer('td',{title:'2024-09-01'});
  const cell=new FakeElement('div',{className:'ant-calendar-date',textContent:'1日',parent:unit});
  unit.children.push(cell);
  unit.querySelector=selector=>selector.includes('ant-calendar-date')?cell:null;
  unit.closest=selector=>selector.includes('td[title]')?unit:null;
  cell.matches=selector=>selector.includes('ant-calendar-date');
  cell.closest=selector=>selector.includes('td[title]')?unit:null;
  cell.onclick=()=>{input.value='2024-09-01';};
  panel.children.push(unit);
  panel.querySelector=selector=>selector.includes('ant-calendar-date')?cell:null;
  panel.querySelectorAll=selector=>selector.includes('ant-calendar-date')||selector.includes('td[title]')?[unit,cell]:[];
  document.byId.set(panelId,panel);
  return {input,panel,unit,cell};
 };
 const start=makeDate('开始日期','start-panel');
 const end=makeDate('结束日期','end-panel');
 const current=makeDate('结束日期（至今）','present-panel');
 document.children.push(start.input,start.panel,end.input,end.panel,current.input,current.panel);
 const fields=send({type:'SCAN'}).fields;
 const result=await send({type:'APPLY',items:[
  {fieldId:fields.find(field=>field.label==='开始日期').id,value:'2024-09-01'},
  {fieldId:fields.find(field=>field.label==='结束日期').id,value:'2027-10'},
  {fieldId:fields.find(field=>field.label==='结束日期（至今）').id,value:'至今'},
 ]});
 assert.deepEqual(plain(result.results.map(item=>[item.status,item.reason])),[
  ['applied',null],['skipped','date_precision_required'],['skipped','date_present_unavailable'],
 ]);
 assert.equal(start.input.value,'2024-09-01');
 assert.equal(end.input.value,'');assert.equal(current.input.value,'');
 assert.ok(start.cell.events.includes('click'));
 assert.ok(!start.unit.events.includes('click'),'nested Ant cell should prefer its clickable inner date node');
});

test('Ant day picker refuses duplicate dates from different calendar units',async()=>{
 const {document,send}=createHarness();
 const originalQuery=document.querySelectorAll.bind(document);
 document.querySelectorAll=selector=>selector==='.ud__picker-panel-header-btn'?[]:originalQuery(selector);
 const panel=new FakeContainer('div',{id:'duplicate-panel',className:'ant-calendar-picker-container'});panel.id='duplicate-panel';
 panel.matches=selector=>selector.includes('ant-calendar-picker-container');
 const input=new FakeElement('input',{
  role:'combobox',readonly:'',readOnly:true,'aria-controls':panel.id,'aria-label':'开始日期',
 });
 const units=[0,1].map(()=>{
  const unit=new FakeContainer('td',{title:'2024-09-01'});
  const cell=new FakeElement('div',{className:'ant-calendar-date',textContent:'1日',parent:unit});
  unit.children.push(cell);unit.querySelector=selector=>selector.includes('ant-calendar-date')?cell:null;
  unit.closest=selector=>selector.includes('td[title]')?unit:null;
  cell.matches=selector=>selector.includes('ant-calendar-date');
  cell.closest=selector=>selector.includes('td[title]')?unit:null;
  cell.onclick=()=>{input.value='2024-09-01';};
  return {unit,cell};
 });
 panel.children=units.map(item=>item.unit);
 panel.querySelector=selector=>selector.includes('ant-calendar-date')?units[0].cell:null;
 panel.querySelectorAll=selector=>selector.includes('ant-calendar-date')||selector.includes('td[title]')
  ?units.flatMap(item=>[item.unit,item.cell]):[];
 document.byId.set(panel.id,panel);document.children.push(input,panel);
 const field=send({type:'SCAN'}).fields[0];
 const result=await send({type:'APPLY',items:[{fieldId:field.id,value:'2024-09-01'}]});
 assert.notEqual(result.results[0].status,'applied',JSON.stringify(result));
 assert.equal(input.value,'');
 assert.ok(units.every(item=>!item.cell.events.includes('click')),'ambiguous calendar units must not be clicked');
});

test('detached Ant calendar parent and child count as one popup root',async()=>{
 const {document,send}=createHarness();
 const originalQuery=document.querySelectorAll.bind(document);
 const container=new FakeContainer('div',{className:'ant-calendar-picker-container'});
 const calendar=new FakeContainer('div',{className:'ant-calendar',parent:container});
 container.children.push(calendar);container.contains=node=>node===calendar;
 calendar.contains=()=>false;
 const unit=new FakeContainer('td',{title:'2024-09-01',parent:calendar});
 const cell=new FakeElement('div',{className:'ant-calendar-date',textContent:'1日',parent:unit});
 unit.children.push(cell);unit.querySelector=selector=>selector.includes('ant-calendar-date')?cell:null;
 unit.closest=selector=>selector.includes('td[title]')?unit:null;
 cell.matches=selector=>selector.includes('ant-calendar-date');
 cell.closest=selector=>selector.includes('td[title]')?unit:null;
 calendar.children.push(unit);
 container.querySelector=selector=>selector.includes('ant-calendar-date')?cell:null;
 container.querySelectorAll=selector=>selector.includes('ant-calendar-date')||selector.includes('td[title]')?[unit,cell]:[];
 calendar.querySelector=selector=>selector.includes('ant-calendar-date')?cell:null;
 calendar.querySelectorAll=container.querySelectorAll;
 document.querySelectorAll=selector=>{
  if(selector==='.ud__picker-panel-header-btn')return[];
  if(selector.includes('.ant-calendar-picker-container')&&selector.includes('.ant-calendar'))return[container,calendar];
  return originalQuery(selector);
 };
 const input=new FakeElement('input',{
  role:'combobox',readonly:'',readOnly:true,'aria-label':'开始日期',
 });
 cell.onclick=()=>{input.value='2024-09-01';};document.children.push(input,container);
 const field=send({type:'SCAN'}).fields[0];
 const result=await send({type:'APPLY',items:[{fieldId:field.id,value:'2024-09-01'}]});
 assert.equal(result.results[0].status,'applied',JSON.stringify(result));
 assert.ok(cell.events.includes('click'));
 const monthOnly=await send({type:'APPLY',items:[{fieldId:field.id,value:'2024-09'}],overwrite:true});
 assert.deepEqual(plain([monthOnly.results[0].status,monthOnly.results[0].reason]),[
  'skipped','date_precision_required',
 ]);
});

test('failed cascader paths close their popup before another control is processed',async()=>{
 const {document,send}=createHarness();
 const popup=new FakeContainer('div',{id:'ambiguous-cascader'});popup.id='ambiguous-cascader';
 popup.children.push(
  new FakeElement('li',{role:'menuitem',textContent:'理学'}),
  new FakeElement('li',{role:'menuitem',textContent:'理学'}),
 );
 const wrapper=new FakeContainer('span',{className:'ant-cascader-picker'});
 const combo=new FakeElement('input',{
  role:'combobox',readonly:'',readOnly:true,'aria-controls':popup.id,'aria-label':'专业类别',
 });
 const baseClosest=combo.closest.bind(combo);
 combo.closest=selector=>selector.includes('cascader')?wrapper:baseClosest(selector);
 document.byId.set(popup.id,popup);document.children.push(combo,popup);
 const field=send({type:'SCAN'}).fields[0];
 const result=await send({type:'APPLY',items:[{fieldId:field.id,value:'理学 / 数学类'}]});
 assert.equal(result.results[0].reason,'cascader_option_ambiguous:0',JSON.stringify(result));
 assert.ok(combo.events.includes('keydown'),'failed cascader should receive Escape');
});

test('APPLY strictly relocates a rerendered field by label, section and group anchors',async()=>{
 const {document,send}=createHarness();
 const oldField=new FakeElement('input',{'aria-label':'学院名称'});
 document.children.push(oldField);
 const fieldId=send({type:'SCAN'}).fields[0].id;
 oldField.isConnected=false;
 const replacement=new FakeElement('input',{'aria-label':'学院名称'});
 document.children=[replacement];
 const response=await send({type:'APPLY',items:[{fieldId,value:'计算机学院'}]});
 assert.equal(response.results[0].status,'applied',JSON.stringify(response));
 assert.equal(replacement.value,'计算机学院');
 assert.equal(oldField.value,'');
});

test('CONTROL bridge returns bounded targets and candidates, guards coordinates and verifies readback',()=>{
 const {document,send}=createHarness();
 const menu=new FakeContainer('div',{id:'degree-menu',rect:{x:10,y:60,width:180,height:120}});menu.id='degree-menu';
 const option=new FakeElement('div',{role:'option',textContent:'硕士',rect:{x:20,y:70,width:140,height:30}});
 menu.children.push(option);document.byId.set(menu.id,menu);
 const combo=new FakeElement('input',{
  role:'combobox',readonly:'',readOnly:true,'aria-controls':menu.id,'aria-label':'学历',
  rect:{x:10,y:20,width:180,height:32},
 });
 document.children.push(combo,menu);
 const field=send({type:'SCAN'}).fields[0];
 const target=send({type:'CONTROL_TARGET',fieldId:field.id});
 assert.equal(target.ok,true);assert.equal(target.nonempty,false);
 assert.deepEqual(plain(target.rect),{x:10,y:20,width:180,height:32});
 const candidates=send({type:'CONTROL_OPTIONS',fieldId:field.id});
 assert.equal(candidates.options.length,1);
 const candidate=candidates.options[0];
 assert.equal(send({type:'CONTROL_GUARD',fieldId:field.id,candidateId:candidate.id,x:30,y:80}).allowed,true);
 assert.equal(send({type:'CONTROL_GUARD',fieldId:field.id,x:900,y:900}).allowed,false);
 assert.equal(send({type:'CONTROL_VERIFY',fieldId:field.id,value:'硕士'}).verified,false);
 combo.value='硕士';
 assert.equal(send({type:'CONTROL_VERIFY',fieldId:field.id,value:'硕士'}).verified,true);
});

test('CONTROL date candidates stay inside their bound picker and dangerous actions remain blocked',()=>{
 const {document,send}=createHarness();
 const panel=new FakeContainer('div',{id:'month-panel',role:'grid',rect:{x:20,y:60,width:260,height:220}});panel.id='month-panel';
 const previous=new FakeElement('button',{'aria-label':'上一年',rect:{x:30,y:70,width:30,height:30}});
 const september=new FakeElement('button',{textContent:'9月',rect:{x:80,y:120,width:42,height:32}});
 const save=new FakeElement('button',{textContent:'保存',rect:{x:160,y:240,width:60,height:32}});
 panel.children.push(previous,september,save);document.byId.set(panel.id,panel);
 const date=new FakeElement('input',{
  role:'combobox','aria-haspopup':'dialog','aria-controls':panel.id,'aria-label':'毕业时间',
  readonly:'',readOnly:true,rect:{x:20,y:20,width:220,height:32},
 });
 document.children.push(date,panel);
 const field=send({type:'SCAN'}).fields[0];
 assert.equal(field.type,'date-picker');
 const state=send({type:'CONTROL_OPTIONS',fieldId:field.id});
 assert.deepEqual(plain(state.options.map(option=>option.label)),['上一年','9月']);
 const month=state.options.find(option=>option.label==='9月');
 assert.equal(send({type:'CONTROL_GUARD',fieldId:field.id,candidateId:month.id,x:90,y:130}).allowed,true);
 assert.equal(send({type:'CONTROL_GUARD',fieldId:field.id,x:180,y:250}).allowed,false);

 const dangerous=new FakeElement('input',{'aria-label':'保存',rect:{x:400,y:20,width:120,height:32}});
 document.children=[dangerous];
 const dangerousField=send({type:'SCAN'}).fields[0];
 const target=send({type:'CONTROL_TARGET',fieldId:dangerousField.id});
 assert.equal(target.blocked,true);assert.equal(target.reason,'unsafe_control');
});

test('control target suspends the panel and cancellation restores it',()=>{
 const {context,document,send}=createHarness();
 let suspended=0,resumed=0;
 context.__personalResumeFloatingPanel={suspend(){suspended+=1;},resume(){resumed+=1;}};
 const field=new FakeElement('input',{'aria-label':'专业名称'});document.children.push(field);
 const id=send({type:'SCAN'}).fields[0].id;
 assert.equal(send({type:'CONTROL_TARGET',fieldId:id}).ok,true);
 assert.equal(suspended,1);
 send({type:'CANCEL'});
 assert.equal(resumed,1);
});

test('browser-control fallback sends only field identity and trusted source path',async()=>{
 const {context,document,send}=createHarness();
 const field=new FakeElement('input',{'aria-label':'学院名称'});
 field.dispatchEvent=function(event){this.events.push(event.type);this.value='';return true;};
 document.children.push(field);
 const descriptor=send({type:'SCAN'}).fields[0];
 let payload;
 context.chrome.runtime.sendMessage=async message=>{
  payload=plain(message);field.value='计算机学院';return{status:'applied',method:'vision'};
 };
 const response=await send({
  type:'APPLY',overwrite:false,
  options:{browserControl:true,visionFallback:true,resumeId:'resume-1'},
  items:[{fieldId:descriptor.id,value:'计算机学院',sourcePath:'education.0.department'}],
 });
 assert.equal(response.results[0].status,'applied');
 assert.equal(response.results[0].method,'vision');
 assert.equal(payload.type,'CONTROL_FILL');
 assert.equal(payload.sourcePath,'education.0.department');
 assert.equal(payload.resumeId,'resume-1');
 assert.equal(payload.vision,true);
 assert.equal(Object.hasOwn(payload,'value'),false);
});

test('CONTROL guard rejects a candidate coordinate obscured by another element',()=>{
 const {document,send}=createHarness();
 const menu=new FakeContainer('div',{id:'menu'});menu.id='menu';
 const option=new FakeElement('div',{role:'option',textContent:'硕士',rect:{x:20,y:70,width:140,height:30}});
 menu.children.push(option);document.byId.set(menu.id,menu);
 const combo=new FakeElement('input',{role:'combobox','aria-controls':menu.id,'aria-label':'学历'});
 document.children.push(combo,menu);
 const field=send({type:'SCAN'}).fields[0];
 const candidate=send({type:'CONTROL_OPTIONS',fieldId:field.id}).options[0];
 document.elementFromPoint=()=>new FakeElement('div',{textContent:'遮挡层'});
 assert.equal(send({type:'CONTROL_GUARD',fieldId:field.id,candidateId:candidate.id,x:30,y:80}).allowed,false);
 document.elementFromPoint=()=>option;
 assert.equal(send({type:'CONTROL_GUARD',fieldId:field.id,candidateId:candidate.id,x:30,y:80}).allowed,true);
});

test('browser-control fallback requires an explicit applied status and never bypasses validation',async()=>{
 const {context,document,send}=createHarness();
 const tooLong=new FakeElement('input',{'aria-label':'姓名',maxLength:2});
 const disabled=new FakeElement('select',{
  labels:[label('学历')],options:[{value:'master',textContent:'硕士',disabled:true}],
 });
 const mismatch=new FakeElement('input',{'aria-label':'普通字段'});
 mismatch.dispatchEvent=function(event){this.events.push(event.type);this.value='';return true;};
 document.children.push(tooLong,disabled,mismatch);
 const fields=send({type:'SCAN'}).fields;
 const calls=[];
 context.chrome.runtime.sendMessage=async message=>{calls.push(plain(message));return{ok:true};};
 const response=await send({
  type:'APPLY',options:{browserControl:true,resumeId:'resume-1'},
  items:[
   {fieldId:fields[0].id,value:'过长姓名',sourcePath:'personal.name'},
   {fieldId:fields[1].id,value:'master',sourcePath:'education.0.degree'},
   {fieldId:fields[2].id,value:'目标',sourcePath:'personal.name'},
  ],
 });
 assert.deepEqual(plain(response.results.map(result=>[result.status,result.reason])),[
  ['skipped','too_long'],['skipped','option_disabled'],['failed','value_mismatch'],
 ]);
 assert.equal(calls.length,1,'only a retryable DOM mismatch may request fallback');
});
