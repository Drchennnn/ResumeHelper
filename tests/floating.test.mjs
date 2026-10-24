import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sessionSource = await readFile(new URL("../extension/session.js", import.meta.url), "utf8");
const source = await readFile(new URL("../extension/floating.js", import.meta.url), "utf8");

class FakeNode {
  constructor(tagName = "div", className = "") {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.textContent = "";
    this.attributes = {};
  }

  append(...nodes) { this.children.push(...nodes); }
  remove() { this.removed = true; }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  attachShadow(options) {
    this._closedShadow = new FakeShadow();
    this.shadowRoot = options?.mode === "open" ? this._closedShadow : null;
    return this._closedShadow;
  }
  contains(node) { return node === this || this.children.some((child) => child?.contains?.(node)); }
  select() {}

  querySelectorAll(selector) {
    const all = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (selector === "input:checked" && child.tagName === "INPUT" && child.checked) all.push(child);
        visit(child);
      }
    };
    visit(this);
    return all;
  }
}

class FakeShadow extends FakeNode {
  set innerHTML(value) {
    this.markup = value;
    const selectors = [
      ".launcher", ".panel", ".resume", ".edit", ".scan", ".selected", ".assist", ".status",
      ".frame-note", ".prepare", ".continuous", ".continuous-all", ".next-step", ".attachments", ".stop", ".issues", ".local", ".browser-control", ".vision-fallback", ".control-state", ".api-detail",
      ".preview", ".summary", ".items", ".ai", ".overwrite", ".confirm", ".facts",
      ".facts-list", ".picker", ".minimize", ".close", ".facts-close",
    ];
    this.nodes = new Map(selectors.map((selector) => {
      const tag = selector === ".resume" ? "select" : selector === ".overwrite" ? "input" : "button";
      return [selector, new FakeNode(tag, selector.slice(1))];
    }));
    this.nodes.get(".panel").hidden = true;
    this.nodes.get(".preview").hidden = true;
    this.nodes.get(".facts").hidden = true;
    this.nodes.get(".picker").hidden = true;
    this.nodes.get(".stop").hidden = true;
    this.nodes.get(".issues").hidden = true;
    this.children = [...this.nodes.values()];
  }

  get innerHTML() { return this.markup; }
  querySelector(selector) { return this.nodes.get(selector) || null; }
}

function createHarness(runtimeHandler, bridgeHandler = {}) {
  const root = new FakeNode("html");
  const document = {
    documentElement: root,
    body: root,
    listeners: new Map(),
    getElementById() { return null; },
    createElement(tag) { return new FakeNode(tag); },
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    removeEventListener(type) { this.listeners.delete(type); },
    execCommand() { return true; },
  };
  const calls = [];
  const applyCalls = [];
  const clipboardWrites = [];
  const workflowCalls = [];
  let workflowCancels = 0;
  let bridgeCancels = 0;
  const chrome = {
    runtime: {
      async sendMessage(payload) {
        calls.push(payload);
        if(payload.type === "PAGE_SCAN") return {ok:true,...await bridge.scan()};
        if(payload.type === "PAGE_APPLY") return {ok:true,results:await bridge.apply(payload.items,payload.overwrite)};
        if(payload.type === "PAGE_CANCEL") return {ok:true,cancelled:true};
        return runtimeHandler(payload);
      },
    },
  };
  const bridge = {
    async scan(rootNode) {
      if (bridgeHandler.scan) return bridgeHandler.scan(rootNode);
      return { fields: [{ id: "field-1", label: rootNode ? "选区姓名" : "姓名", type: "text", value: "" }] };
    },
    async apply(items, overwrite) {
      applyCalls.push({ items, overwrite });
      if (bridgeHandler.apply) return bridgeHandler.apply(items, overwrite);
      return items.map(({ fieldId }) => ({ fieldId, status: "applied" }));
    },
    cancel() {
      bridgeCancels += 1;
      return bridgeHandler.cancel ? bridgeHandler.cancel() : true;
    },
  };
  const context = vm.createContext({
    chrome,
    document,
    navigator: { clipboard: { async writeText(value) { clipboardWrites.push(value); } } },
    Element: FakeNode,
    __personalResumeBridge: bridge,
    __personalResumeWorkflow: {
      async prepare(counts) {
        workflowCalls.push(counts);
        return { ok: true, added: 2, remaining: 0, sections: [] };
      },
      cancel() { workflowCancels += 1; return true; },
      observe() {return {waitForChanges:async()=>({}),disconnect(){}};},
      advanceStep(){return {status:"clicked"};},
    },
    setTimeout, clearTimeout, AbortController, location:{href:"https://jobs.example.test/apply"},
  });
  vm.runInContext(sessionSource, context);
  vm.runInContext(source, context);
  const host = root.children[0];
  return {
    context, document, host, shadow: host._closedShadow, calls, applyCalls, clipboardWrites, workflowCalls,
    get workflowCancels() { return workflowCancels; }, get bridgeCancels() { return bridgeCancels; },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("panel initializes once, marks its host, and loads only public resume metadata", async () => {
  const harness = createHarness(async (payload) => {
    assert.deepEqual(Object.keys(payload), ["type"]);
    return { ok: true, resumes: [{ id: "resume-1", name: "求职简历" }], activeId: "resume-1" };
  });
  await tick();

  assert.equal(harness.host.dataset.personalResumeUi, "true");
  assert.equal(harness.host.shadowRoot, null, "页面脚本不应读取助手 Shadow DOM");
  assert.equal(harness.calls[0].type, "PANEL_STATE");
  assert.equal(harness.shadow.querySelector(".resume").children[0].textContent, "求职简历");
  assert.match(harness.shadow.querySelector(".status").textContent, /已就绪/);

  vm.runInContext(source, harness.context);
  assert.equal(harness.shadow.querySelector(".panel").hidden, false, "重复注入应重新打开现有面板");
  assert.equal(harness.shadow.querySelector(".launcher").hidden, true);
  assert.equal(harness.calls.length, 2, "重新打开应刷新资料列表，但不创建第二个面板");
});

test("scan uses LOCAL_MATCH, renders checked preview, and applies selected values without submitting", async () => {
  const harness = createHarness(async (payload) => {
    if (payload.type === "PANEL_STATE") return { ok: true, resumes: [{ id: "resume-1", name: "默认简历" }], activeId: "resume-1" };
    if (payload.type === "LOCAL_MATCH") return { ok: true, items: [{ fieldId: "field-1", label: "姓名", value: "林测试", displayValue: "林测试" }] };
    throw new Error(`Unexpected ${payload.type}`);
  });
  await tick();
  await harness.shadow.querySelector(".scan").onclick({ isTrusted: true });

  const local = harness.calls.find((call) => call.type === "LOCAL_MATCH");
  assert.equal(local.resumeId, "resume-1");
  assert.equal(local.fields[0].label, "姓名");
  assert.equal(harness.shadow.querySelector(".preview").hidden, false);
  assert.equal(harness.shadow.querySelector(".items").querySelectorAll("input:checked").length, 1);

  await harness.shadow.querySelector(".confirm").onclick({ isTrusted: true });
  assert.deepEqual(JSON.parse(JSON.stringify(harness.applyCalls)), [{ items: [{ fieldId: "field-1", label: "姓名", value: "林测试", displayValue: "林测试" }], overwrite: false }]);
  assert.match(harness.shadow.querySelector(".status").textContent, /成功 1 项.*仍有 1 个空字段，其中 1 项已匹配/);
});

test("prepare is explicit, derives only collection counts from RESUME_FACTS, then rescans", async () => {
  const harness = createHarness(async (payload) => {
    if (payload.type === "PANEL_STATE") return { ok: true, resumes: [{ id: "resume-1", name: "默认简历" }], activeId: "resume-1" };
    if (payload.type === "RESUME_FACTS") return { ok: true, facts: [
      { path: "education.0.school", value: "虚构大学" },
      { path: "education.0.major", value: "计算机" },
      { path: "education.1.school", value: "虚构中学" },
      { path: "internships.0.company", value: "虚构公司" },
      { path: "work_experience.0.company", value: "虚构单位" },
      { path: "projects.0.name", value: "虚构项目" },
      { path: "certificate.0.certificate_name", value: "虚构证书" },
      { path: "language_skills.0.language_type", value: "英语" },
      { path: "education.2.school", value: "" },
      { path: "personal.name", value: "不应进入工作流" },
    ] };
    if (payload.type === "LOCAL_MATCH") return { ok: true, items: [] };
    throw new Error(`Unexpected ${payload.type}`);
  });
  await tick();

  assert.equal(harness.workflowCalls.length, 0, "初始化和普通扫描不得暗中新增条目");
  await harness.shadow.querySelector(".prepare").onclick({ isTrusted: true });

  assert.deepEqual(JSON.parse(JSON.stringify(harness.workflowCalls)), [{ education: 2, internships: 1, cadre_experiences: 0, work_experience: 1, projects: 1, certificate: 1, language_skills: 1 }]);
  assert.equal(harness.calls.at(-1).type, "LOCAL_MATCH", "新增后应重新识别并生成本地预览");
  assert.equal(harness.shadow.querySelector(".preview").hidden, false);
  assert.match(harness.shadow.querySelector(".status").textContent, /已新增 2 条经历并重新识别/);
  assert.equal(harness.shadow.querySelector(".stop").hidden, true);
});

test("apply lists at most ten actionable failures and rematches only empty fields", async () => {
  const fields = Array.from({ length: 12 }, (_, index) => ({
    id: `field-${index}`,
    label: `字段 ${index}`,
    type: "text",
    value: index === 11 ? "已有内容不应显示" : "",
  }));
  const localMatchSizes = [];
  const harness = createHarness(async (payload) => {
    if (payload.type === "PANEL_STATE") return { ok: true, resumes: [{ id: "resume-1", name: "默认简历" }], activeId: "resume-1" };
    if (payload.type === "LOCAL_MATCH") {
      localMatchSizes.push(payload.fields.length);
      return { ok: true, items: payload.fields.map((field) => ({ fieldId: field.id, label: field.label, value: `虚构值-${field.id}`, displayValue: "虚构资料" })) };
    }
    throw new Error(`Unexpected ${payload.type}`);
  }, {
    scan: async () => ({ fields }),
    apply: async (items) => items.map(({ fieldId }, index) => index === 11
      ? { fieldId, status: "skipped", reason: "non_empty" }
      : { fieldId, status: "failed", reason: ["option_not_found", "custom_menu_needs_manual_open", "unsupported_custom_date_panel"][index % 3], error: "原始异常不应展示" }),
  });
  await tick();
  await harness.shadow.querySelector(".scan").onclick({ isTrusted: true });
  await harness.shadow.querySelector(".confirm").onclick({ isTrusted: true });

  assert.deepEqual(localMatchSizes, [12, 11], "填写后只能把空值字段送入 LOCAL_MATCH");
  const issues = harness.shadow.querySelector(".issues");
  assert.equal(issues.hidden, false);
  const list = issues.children[1];
  assert.equal(list.children.length, 10, "未完成字段清单最多展示十条");
  const rendered = [issues, ...issues.children, ...list.children].map((node) => node.textContent).join(" ");
  assert.match(rendered, /字段 0：未找到匹配选项/);
  assert.match(rendered, /手动打开下拉或日期后重试；仍失败可辅助填写复制资料自行选择/);
  assert.doesNotMatch(rendered, /原始异常不应展示|已有内容不应显示|虚构值/);
  assert.match(harness.shadow.querySelector(".status").textContent, /仍有 11 个空字段，其中 11 项已匹配/);
});

test("stop button cancels an active bridge apply and hides after the operation settles", async () => {
  let releaseApply;
  const pendingApply = new Promise((resolve) => { releaseApply = resolve; });
  const harness = createHarness(async (payload) => {
    if (payload.type === "PANEL_STATE") return { ok: true, resumes: [{ id: "resume-1", name: "默认简历" }], activeId: "resume-1" };
    if (payload.type === "LOCAL_MATCH") return { ok: true, items: [{ fieldId: "field-1", label: "姓名", value: "虚构姓名", displayValue: "虚构姓名" }] };
    throw new Error(`Unexpected ${payload.type}`);
  }, {
    apply: async () => pendingApply,
  });
  await tick();
  await harness.shadow.querySelector(".scan").onclick({ isTrusted: true });
  const applying = harness.shadow.querySelector(".confirm").onclick({ isTrusted: true });
  await tick();

  assert.equal(harness.shadow.querySelector(".stop").hidden, false);
  harness.shadow.querySelector(".stop").onclick({ isTrusted: true });
  assert.equal(harness.bridgeCancels, 1);
  assert.equal(harness.workflowCancels, 1);
  assert.match(harness.shadow.querySelector(".status").textContent, /已经完成的填写会保留/);

  releaseApply([{ fieldId: "field-1", status: "skipped", reason: "cancelled" }]);
  await applying;
  assert.equal(harness.shadow.querySelector(".stop").hidden, true);
  assert.equal(harness.applyCalls.length, 1, "停止后不得发起第二次页面写入");
  assert.equal(harness.calls.filter((call) => call.type === "LOCAL_MATCH").length, 2, "停止后只复扫剩余空字段");
  assert.equal(harness.calls.some((call) => call.type === "MATCH"), false, "停止后的复扫不得自动调用 AI");
  assert.match(harness.shadow.querySelector(".status").textContent, /已停止当前操作.*仍有 1 个空字段，其中 1 项已匹配/);
  assert.equal(harness.shadow.querySelector(".issues").hidden, true, "取消项不应被误报为字段失败");
});

test("AI matching is an explicit action and surfaces background failures", async () => {
  let failAi = false;
  const harness = createHarness(async (payload) => {
    if (payload.type === "PANEL_STATE") return { ok: true, resumes: [{ id: "resume-1", name: "默认简历" }], activeId: "resume-1" };
    if (payload.type === "LOCAL_MATCH") return { ok: true, items: [] };
    if (payload.type === "MATCH") return failAi ? { ok: false, error: "自定义 API 无法连接" } : { ok: true, items: [] };
    throw new Error(`Unexpected ${payload.type}`);
  });
  await tick();
  await harness.shadow.querySelector(".scan").onclick({ isTrusted: true });
  assert.equal(harness.calls.some((call) => call.type === "MATCH"), false, "扫描不应自动向 AI API 发送资料");

  failAi = true;
  await harness.shadow.querySelector(".ai").onclick({ isTrusted: true });
  assert.equal(harness.calls.at(-1).type, "MATCH");
  assert.equal(harness.shadow.querySelector(".status").textContent, "自定义 API 无法连接");
  assert.equal(harness.shadow.querySelector(".status").dataset.tone, "error");
});

test("assistant mode reads flattened local facts and workbench opens through background", async () => {
  const harness = createHarness(async (payload) => {
    if (payload.type === "PANEL_STATE") return { ok: true, resumes: [{ id: "resume-1", name: "默认简历" }], activeId: "resume-1" };
    if (payload.type === "RESUME_FACTS") return { ok: true, facts: [{ path: "personal.name", label: "姓名", value: "林测试" }] };
    if (payload.type === "OPEN_WORKBENCH") return { ok: true };
    throw new Error(`Unexpected ${payload.type}`);
  });
  await tick();

  await harness.shadow.querySelector(".assist").onclick({ isTrusted: true });
  assert.equal(harness.calls.at(-1).type, "RESUME_FACTS");
  assert.equal(harness.calls.at(-1).resumeId, "resume-1");
  assert.equal(harness.shadow.querySelector(".facts").hidden, false);
  assert.match(harness.shadow.querySelector(".status").textContent, /1 项本地资料/);

  const factActions = harness.shadow.querySelector(".facts-list").children[0].children[2];
  await factActions.children[0].onclick({ isTrusted: false });
  factActions.children[1].onclick({ isTrusted: false });
  assert.deepEqual(harness.clipboardWrites, []);
  assert.equal(harness.document.listeners.size, 0, "合成点击不能进入单字段选择模式");

  await harness.shadow.querySelector(".edit").onclick({ isTrusted: true });
  assert.equal(harness.calls.at(-1).type, "OPEN_WORKBENCH");
});

test("untrusted synthetic controls cannot read facts, scan, match, apply, or open workbench", async () => {
  const harness = createHarness(async (payload) => {
    if (payload.type === "PANEL_STATE") return { ok: true, resumes: [{ id: "resume-1", name: "默认简历" }], activeId: "resume-1" };
    throw new Error(`Synthetic event escaped guard: ${payload.type}`);
  });
  await tick();
  const initialMessages = harness.calls.length;

  for (const selector of [".scan", ".selected", ".assist", ".prepare", ".stop", ".ai", ".confirm", ".edit"]) {
    await harness.shadow.querySelector(selector).onclick({ isTrusted: false });
  }
  harness.shadow.querySelector(".resume").onchange({ isTrusted: false });

  assert.equal(harness.calls.length, initialMessages);
  assert.equal(harness.applyCalls.length, 0);
  assert.equal(harness.workflowCalls.length, 0);
  assert.equal(harness.workflowCancels, 0);
  assert.equal(harness.bridgeCancels, 0);

  harness.shadow.querySelector(".selected").onclick({ isTrusted: true });
  harness.document.listeners.get("click")({
    isTrusted: false,
    target: new FakeNode("section"),
    preventDefault() { throw new Error("untrusted picker click must not be consumed"); },
    stopImmediatePropagation() { throw new Error("untrusted picker click must not be consumed"); },
  });
  assert.equal(harness.calls.length, initialMessages);
});

test("source declares every panel protocol and never requests an API key", () => {
  for (const type of ["PANEL_STATE", "LOCAL_MATCH", "MATCH", "RESUME_FACTS", "OPEN_WORKBENCH"]) {
    assert.match(source, new RegExp(`type: \\\"${type}\\\"`));
  }
  assert.doesNotMatch(source, /apiKey/);
  assert.match(source, /data-personal-resume-ui|personalResumeUi/);
  assert.match(source, /助手不会自动提交/);
});

test('AI scan understands fields by default and keeps its remaining plan after partial apply', async () => {
  const fields=[{id:'major',label:'所学方向',type:'text',value:''},{id:'description',label:'你做过什么',type:'textarea',value:''}];
  let scans=0;
  const harness=createHarness(async payload=>{
    if(payload.type==='PANEL_STATE')return {ok:true,resumes:[{id:'resume-1',name:'AI 简历'}],activeId:'resume-1',aiConfigured:true,apiHost:'api.example.test',control:{enabled:true}};
    if(payload.type==='LOCAL_MATCH')return {ok:true,items:[]};
    if(payload.type==='MATCH')return {ok:true,items:[{fieldId:'major',label:'所学方向',sourcePath:'education.0.major',value:'计算机',displayValue:'计算机'},{fieldId:'description',label:'你做过什么',sourcePath:'projects.0.description',value:'已有项目事实',displayValue:'已有项目事实'}]};
    throw new Error(`Unexpected ${payload.type}`);
  },{
    scan:async()=>({fields:++scans===1?fields:fields.map(field=>field.id==='major'?{...field,value:'计算机'}:field)}),
    apply:async()=>[{fieldId:'major',status:'applied'},{fieldId:'description',status:'skipped',reason:'too_long'}],
  });
  await tick();
  await harness.shadow.querySelector('.scan').onclick({isTrusted:true});
  assert.equal(harness.calls.filter(call=>call.type==='MATCH').length,1);
  assert.equal(harness.shadow.querySelector('.items').querySelectorAll('input:checked').length,2);
  await harness.shadow.querySelector('.confirm').onclick({isTrusted:true});
  assert.equal(harness.calls.filter(call=>call.type==='MATCH').length,1,'复扫不得暗中再次发送资料');
  assert.equal(harness.shadow.querySelector('.items').querySelectorAll('input:checked').length,1,'保留未完成的 AI 语义映射');
  assert.match(harness.shadow.querySelector('.status').textContent,/仍有 1 个空字段，其中 1 项已匹配/);
  assert.equal(harness.shadow.querySelector('.status').dataset.tone,'error','跳过不应显示全部成功');
  assert.match(harness.shadow.querySelector('.issues').children[1].children[0].textContent,/超过网页允许的字数/);
  assert.equal(harness.applyCalls[0].items[0].sourcePath,'education.0.major');
});

test('local-only scan never calls AI and reopen refreshes a deleted or renamed selected profile', async () => {
  let updated=false;
  const harness=createHarness(async payload=>{
    if(payload.type==='PANEL_STATE')return {ok:true,resumes:[updated?{id:'new',name:'更新的简历'}:{id:'old',name:'旧简历'}],activeId:updated?'new':'old',aiConfigured:true};
    if(payload.type==='LOCAL_MATCH')return {ok:true,items:[]};
    throw new Error(`Unexpected ${payload.type}`);
  });
  await tick();
  await harness.shadow.querySelector('.local').onclick({isTrusted:true});
  assert.equal(harness.calls.some(call=>call.type==='MATCH'),false);
  updated=true;
  await harness.context.__personalResumeFloatingPanel.reopen();
  assert.equal(harness.shadow.querySelector('.resume').value,'new');
  assert.equal(harness.shadow.querySelector('.resume').children[0].textContent,'更新的简历');
  assert.equal(harness.shadow.querySelector('.preview').hidden,true,'资料被删除替换后旧计划不能继续应用');
});

test("floating continuous mode rescans dynamic fields but uses only approved source paths",async()=>{
 let filled=false,scans=0;
 const harness=createHarness(async payload=>{
  if(payload.type==='PANEL_STATE')return {ok:true,resumes:[{id:'r',name:'虚构'}],activeId:'r'};
  if(payload.type==='LOCAL_MATCH')return {ok:true,items:payload.fields.map(field=>({fieldId:field.id,sourcePath:field.id==='name'?'personal.name':'personal.email',value:field.id==='name'?'虚构姓名':'demo@example.test',label:field.label}))};
  throw new Error(payload.type);
 },{scan:async()=>({fields:++scans===1?[{id:'name',label:'姓名',value:''}]:[{id:filled?'email':'name',label:filled?'邮箱':'姓名',value:''}]}),apply:async items=>{filled=true;return items.map(item=>({fieldId:item.fieldId,status:'applied'}));}});
 await tick();
 await harness.shadow.querySelector('.local').onclick({isTrusted:true});
 await harness.shadow.querySelector('.continuous').onclick({isTrusted:true});
 assert.equal(harness.applyCalls.length,1);
 assert.equal(harness.applyCalls[0].items[0].sourcePath,'personal.name');
 assert.ok(harness.calls.filter(call=>call.type==='PAGE_SCAN').length>=3);
 assert.equal(harness.calls.some(call=>call.type==='MATCH'),false,'本地模式连续处理不得调用AI');
 assert.match(harness.shadow.querySelector('.status').textContent,/连续填写已结束/);
 assert.equal(harness.shadow.querySelector('.stop').hidden,true);
});
