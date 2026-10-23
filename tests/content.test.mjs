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
    return this.children.filter((element) => {
      const tag = element.tagName.toLowerCase();
      return ["input", "textarea", "select"].includes(tag) || element.isContentEditable;
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
  });
  vm.runInContext(contentSource, context);

  function send(message, sender = { id: chrome.runtime.id }) {
    let response;
    for (const listener of listeners) {
      listener(message, sender, (value) => { response = value; });
    }
    return response;
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

test("APPLY uses native setters, emits events, protects non-empty values, and validates choices", () => {
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

  const response = send({
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
  assert.deepEqual(response.results.map((result) => [result.status, result.reason]), [
    ["skipped", "too_long"],
    ["skipped", "non_empty"],
    ["applied", undefined],
    ["skipped", "checkbox_requires_boolean"],
    ["skipped", "radio_value_mismatch"],
  ]);
});

test("APPLY supports explicit boolean controls and overwrite", () => {
  const { document, send } = createHarness();
  const existing = new FakeElement("textarea", { value: "旧内容", labels: [label("项目")] });
  const consent = new FakeElement("input", { type: "checkbox", labels: [label("接收提醒")] });
  const radio = new FakeElement("input", { type: "radio", value: "tech", labels: [label("技术岗")] });
  document.children.push(existing, consent, radio);
  const fields = send({ type: "SCAN" }).fields;

  const response = send({
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

test("dynamic fields can be scanned while detached and forged messages are rejected", () => {
  const { context, document, listeners, send } = createHarness();
  vm.runInContext(contentSource, context);
  assert.equal(listeners.length, 1, "second injection must not register another listener");

  const first = new FakeElement("input", { name: "first" });
  document.children.push(first);
  const firstId = send({ type: "SCAN" }).fields[0].id;
  first.isConnected = false;
  document.children.splice(0, 1);
  const detached = send({ type: "APPLY", items: [{ fieldId: firstId, value: "x" }] });
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

test("APPLY rejects disabled options and protects an already selected radio group", () => {
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

  const response = send({
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

test("APPLY verifies readback and isolates one field exception from later fields", () => {
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

  const response = send({
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

test('same-URL document reload cannot apply an old document field ID',()=>{
 const old=createHarness(),fresh=createHarness();
 const a=new FakeElement('input',{labels:[label('姓名')]}),b=new FakeElement('input',{labels:[label('姓名')]});
 old.document.children.push(a);fresh.document.children.push(b);
 const before=old.send({type:'SCAN'}).fields[0].id;const after=fresh.send({type:'SCAN'}).fields[0].id;
 assert.notEqual(before,after);
 assert.equal(fresh.send({type:'APPLY',items:[{fieldId:before,value:'wrong'}]}).results[0].reason,'unknown_field');
 assert.equal(b.value,'');
});

test('isolated bridge scans selected container and a single target without including assistant shadow UI',()=>{
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
 assert.equal(bridge.apply([{fieldId:id,value:'局部填写'}],false)[0].status,'applied');
 assert.equal(outside.value,'');assert.equal(inside.value,'局部填写');
});
