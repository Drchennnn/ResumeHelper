import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../extension/workflow.js", import.meta.url), "utf8");
const popupSource = await readFile(new URL("../extension/popup.js", import.meta.url), "utf8");

class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this.textContent = text;
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.clicks = 0;
  }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector.includes("[hidden]") && node.hidden) return node;
      if (selector.includes("[aria-hidden='true']") && node.getAttribute("aria-hidden") === "true") return node;
    }
    return null;
  }
  contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
  getClientRects() { return [{}]; }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (selector === "button,[role='button']" && (child.tagName === "BUTTON" || child.getAttribute("role") === "button")) found.push(child);
        if (selector === "details" && child.tagName === "DETAILS") found.push(child);
        if (selector.includes("apply-form-array-card-content") && (String(child.className || "").includes("apply-form-array-card-content") || String(child.className || "").includes("formGroupItem"))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
}

function record() { const item = new FakeElement("div"); item.className = "apply-form-array-card-content"; return item; }
function button(text, type = "button", onclick = () => {}) {
  const item = new FakeElement("button", text);
  item.type = type;
  item.setAttribute("type", type);
  item.click = () => { item.clicks += 1; onclick(); };
  return item;
}

function roleButton(tagName, text, attributes = {}, onclick = () => {}) {
  const item = new FakeElement(tagName, text);
  for (const [name, value] of Object.entries(attributes)) item.setAttribute(name, value);
  item.click = () => { item.clicks += 1; onclick(); };
  return item;
}

function harness(sectionEntries = [], explicitEntries = [], hostname = "") {
  const roots = new Map(sectionEntries);
  const explicit = new Map(explicitEntries);
  const document = {
    getElementById(id) { return roots.get(id) || null; },
    querySelector(selector) { return explicit.get(selector) || null; },
    querySelectorAll() { return []; },
  };
  const context = vm.createContext({ document, location: {hostname}, setTimeout, clearTimeout, Date, getComputedStyle: () => ({ display: "block", visibility: "visible" }) });
  vm.runInContext(source, context);
  return { api: context.__personalResumeWorkflow, roots, document };
}

function section(id, existing = 0, addText = "添加") {
  const details = new FakeElement("details");
  const root = new FakeElement("section");
  details.append(root);
  for (let index = 0; index < existing; index += 1) root.append(record());
  const add = button(addText, "button", () => root.append(record()));
  root.append(add);
  return { root, details, add };
}

test("prepare clicks only the exact safe add button inside a confirmed Formily section", async () => {
  const education = section("formily-item-education_list", 1);
  const submit = button("新增", "submit", () => { throw new Error("submit must never run"); });
  const complete = button("完成", "button", () => { throw new Error("complete must never run"); });
  const remove = button("删除", "button", () => { throw new Error("delete must never run"); });
  const noInternship = button("没有实习经历", "button", () => { throw new Error("declaration must never run"); });
  education.root.append(submit, complete, remove, noInternship);
  const { api } = harness([["formily-item-education_list", education.root]]);

  const result = await api.prepare({ education: 3, career: 0, projects: 0, certificates: 0, languages: 0 });

  assert.equal(result.added, 2);
  assert.equal(education.root.querySelectorAll("[class*='apply-form-array-card-content']").length, 3);
  assert.equal(education.add.clicks, 2);
  assert.equal(submit.clicks + complete.clicks + remove.clicks + noInternship.clicks, 0);
  assert.equal(education.details.open, true, "existing native details should be expanded safely");
});

test("prepare ignores lookalike sections and reports missing safe controls without clicking arbitrary buttons", async () => {
  const confirmed = section("formily-item-project_list", 0, "创建项目");
  const lookalike = section("unconfirmed", 0, "新增");
  const { api } = harness([
    ["formily-item-project_list", confirmed.root],
    ["some-other-array", lookalike.root],
  ]);

  const result = await api.prepare({ projects: 1 });
  const project = result.sections.find((item) => item.key === "projects");
  assert.equal(project.status, "no_safe_add_button");
  assert.equal(project.remaining, 1);
  assert.equal(lookalike.add.clicks, 0);
});

test("prepare supports an explicit generic section marker without guessing unrelated page structure", async () => {
  const education = section("generic", 0);
  const selector = "[data-resume-helper-section='education']";
  const { api } = harness([], [[selector, education.root]]);

  const result = await api.prepare({ education: 2 });
  assert.equal(result.added, 2);
  assert.equal(education.add.clicks, 2);
});

test("prepare enforces a global 30-addition limit and reads back every created record", async () => {
  const education = section("formily-item-education_list");
  const projects = section("formily-item-project_list");
  const { api } = harness([
    ["formily-item-education_list", education.root],
    ["formily-item-project_list", projects.root],
  ]);

  const result = await api.prepare({ education: 30, projects: 30 });
  assert.equal(result.added, 30);
  assert.equal(education.add.clicks, 30);
  assert.equal(projects.add.clicks, 0);
  assert.equal(result.remaining, 30);
  assert.equal(result.sections.find((item) => item.key === "projects").status, "limit_reached");
});

test("prepare can be cancelled while waiting for a page that did not create a record", async () => {
  const root = new FakeElement("section");
  const stuck = button("添加");
  root.append(stuck);
  const { api } = harness([["formily-item-career_list", root]]);

  const pending = api.prepare({ work_experience: 1 }, { timeoutMs: 1000 });
  setTimeout(() => api.cancel(), 10);
  await assert.rejects(pending, /已停止补齐经历条目/);
  assert.equal(stuck.clicks, 1);
});

test("popup injects content, workflow, then floating scripts in dependency order", () => {
  assert.match(popupSource, /files:\['site-adapters\.js','content\.js','workflow\.js','session\.js','floating\.js'\]/);
});


test("JD repeatable sections require both the site and confirmed title before adding", async () => {
  const root = new FakeElement("section");
  root.className = "gridContainer___test";
  const heading = new FakeElement("h2", "教育经历（必填）");
  root.querySelector = selector => selector.includes("titleContainer") ? heading : null;
  const makeRow = () => { const row = new FakeElement("div"); row.className = "formGroupItem___test"; return row; };
  root.append(makeRow());
  const add = button("+ 添加", "button", () => root.append(makeRow()));
  root.append(add);
  const {api} = harness([["edu", root]], [], "campus.jd.com");
  const result = await api.prepare({education: 2});
  assert.equal(result.added, 1);
  assert.equal(add.clicks, 1);
  const other = harness([["edu", root]], [], "other.example");
  assert.equal((await other.api.prepare({education: 3})).added, 0);
  heading.textContent = "提交申请";
  assert.equal((await api.prepare({education: 3})).added, 0);
  assert.equal(add.clicks, 1);
});

test("JD confirmed section supports a non-navigation anchor role button", async () => {
  const root = new FakeElement("section");
  root.className = "gridContainer___test";
  const heading = new FakeElement("h2", "教育经历（必填）");
  root.querySelector = selector => selector.includes("titleContainer") ? heading : null;
  const makeRow = () => { const row = new FakeElement("div"); row.className = "formGroupItem___test"; return row; };
  root.append(makeRow());
  const add = roleButton("a", "+ 添加", {role: "button", class: "am-button addBtn___3r3aQ", "aria-disabled": "false"}, () => root.append(makeRow()));
  const label = new FakeElement("span", "+ 添加");
  add.append(label);
  root.append(add);

  const {api} = harness([["edu", root]], [], "campus.jd.com");
  const result = await api.prepare({education: 2});

  assert.equal(result.added, 1);
  assert.equal(add.clicks, 1);
  assert.equal(result.sections.find(item => item.key === "education").after, 2);
});

test("role add controls reject aria-disabled and navigation anchors", async () => {
  const root = new FakeElement("section");
  const disabled = roleButton("a", "+ 添加", {role: "button", "aria-disabled": "true"}, () => { throw new Error("disabled control must never run"); });
  const navigation = roleButton("a", "+ 添加", {role: "button", href: "/resume/new"}, () => { throw new Error("navigation anchor must never run"); });
  root.append(disabled, navigation);
  const {api} = harness([["formily-item-education_list", root]]);

  const result = await api.prepare({education: 1});
  const education = result.sections.find(item => item.key === "education");
  assert.equal(education.status, "no_safe_add_button");
  assert.equal(disabled.clicks + navigation.clicks, 0);
});

test("a titled add button is allowed only inside its already-confirmed section", async () => {
  const projects = section("formily-item-project_list", 0, "添加项目经历");
  const {api} = harness([["formily-item-project_list", projects.root]]);
  const result = await api.prepare({projects: 1});
  assert.equal(result.added, 1);
  assert.equal(projects.add.clicks, 1);
});

test("prepare stops at a visible dialog instead of guessing through it", async () => {
  const projects = section("formily-item-project_list", 0);
  const dialog = new FakeElement("div", "请选择项目类型");
  dialog.setAttribute("role", "dialog");
  dialog.hidden = true;
  projects.add.click = () => { projects.add.clicks += 1; dialog.hidden = false; };
  const {api, document} = harness([["formily-item-project_list", projects.root]]);
  document.querySelectorAll = selector => selector.includes("role='dialog'") ? [dialog] : [];

  const result = await api.prepare({projects: 1});
  const item = result.sections.find(section => section.key === "projects");
  assert.equal(item.status, "requires_dialog");
  assert.equal(item.added, 0);
  assert.equal(projects.add.clicks, 1);
});

test("observer detects nested fields, stale removal, and ignores helper UI mutations", async () => {
  const fields = [];
  const records = [];
  let observerInstance;
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; observerInstance = this; }
    observe() {}
    disconnect() { this.disconnected = true; }
    trigger(mutations) { this.callback(mutations); }
  }
  const helper = {
    nodeType: 1,
    matches: selector => selector.includes("personal-resume-floating-host"),
    closest: selector => selector.includes("personal-resume-floating-host") ? helper : null,
    querySelector: () => null,
  };
  const makeField = () => ({
    nodeType: 1,
    matches: selector => selector.includes("input"),
    closest: () => null,
    querySelector: () => null,
  });
  const nestedRow = {
    nodeType: 1,
    matches: selector => selector.includes("apply-form-array-card-content"),
    closest: () => null,
    querySelector: selector => selector.includes("input") ? fields.at(-1) : null,
  };
  const document = {
    documentElement: {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector.startsWith("input")) return fields;
      if (selector.includes("apply-form-array-card-content")) return records;
      return [];
    },
  };
  const context = vm.createContext({document, location: {hostname: "", href: "https://jobs.example/resume"}, MutationObserver: FakeMutationObserver, setTimeout, clearTimeout, Date, getComputedStyle: () => ({display: "block", visibility: "visible"})});
  vm.runInContext(source, context);
  const watch = context.__personalResumeWorkflow.observe();
  const initialRevision = watch.snapshot().revision;
  observerInstance.trigger([{type: "childList", addedNodes: [helper], removedNodes: []}]);
  assert.equal(watch.snapshot().revision, initialRevision, "helper UI must not wake the observer");

  const added = makeField(); fields.push(added); records.push(nestedRow);
  const changed = watch.waitForChanges({since: initialRevision, timeoutMs: 200});
  observerInstance.trigger([{type: "childList", addedNodes: [nestedRow], removedNodes: []}]);
  const first = await changed;
  assert.equal(first.after.fields, 1);
  assert.equal(first.after.records, 1);

  const revision = watch.snapshot().revision;
  fields.pop(); records.pop();
  const removed = watch.waitForChanges({since: revision, timeoutMs: 200});
  observerInstance.trigger([{type: "childList", addedNodes: [], removedNodes: [nestedRow]}]);
  const second = await removed;
  assert.equal(second.after.fields, 0);
  assert.equal(second.after.records, 0);
  watch.disconnect();
  assert.equal(observerInstance.disconnected, true);
});

test("next-step inspection allows one exact safe control and blocks submission or validation errors", () => {
  const next = button("下一步");
  const submit = button("提交申请");
  const error = new FakeElement("div", "请填写必填项");
  const form = {
    querySelectorAll(selector) {
      if (selector === "button,[role='button']") return [next, submit];
      if (selector.includes("aria-invalid")) return this.hasError ? [error] : [];
      return [];
    },
    hasError: false,
    disabled: false,
    hidden: false,
    getAttribute: () => null,
    closest: () => null,
    getClientRects: () => [{}],
  };
  const document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: selector => selector.startsWith("form") ? [form] : [],
  };
  const context = vm.createContext({document, location: {hostname: ""}, setTimeout, clearTimeout, Date, getComputedStyle: () => ({display: "block", visibility: "visible"})});
  vm.runInContext(source, context);
  assert.equal(context.__personalResumeWorkflow.inspectNextStep().status, "ready");
  assert.equal(context.__personalResumeWorkflow.advanceStep().reason, "explicit_confirmation_required");
  assert.equal(next.clicks, 0);
  form.hasError = true;
  assert.equal(context.__personalResumeWorkflow.advanceStep({explicit: true}).reason, "validation_errors");
  assert.equal(next.clicks, 0);
  form.hasError = false;
  assert.equal(context.__personalResumeWorkflow.advanceStep({explicit: true}).status, "clicked");
  assert.equal(next.clicks, 1);
  assert.equal(submit.clicks, 0);
});

 test("an already visible dialog prevents add and next-step controls", async()=>{
  const project=section("formily-item-project_list",0);
  const {api,document}=harness([["formily-item-project_list",project.root]]);
  const dialog=new FakeElement("div","确认");
  document.querySelectorAll=selector=>selector.includes("role='dialog'")?[dialog]:[];
  assert.equal((await api.prepare({projects:1})).status,"requires_dialog");
  assert.equal(project.add.clicks,0);
  assert.equal(api.advanceStep({explicit:true}).reason,"site_confirmation_required");
 });
