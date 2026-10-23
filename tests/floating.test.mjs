import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

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
    this.children = [...this.nodes.values()];
  }

  get innerHTML() { return this.markup; }
  querySelector(selector) { return this.nodes.get(selector) || null; }
}

function createHarness(runtimeHandler) {
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
  const chrome = {
    runtime: {
      async sendMessage(payload) {
        calls.push(payload);
        return runtimeHandler(payload);
      },
    },
  };
  const bridge = {
    async scan(rootNode) {
      return { fields: [{ id: "field-1", label: rootNode ? "选区姓名" : "姓名", type: "text", value: "" }] };
    },
    async apply(items, overwrite) {
      applyCalls.push({ items, overwrite });
      return items.map(({ fieldId }) => ({ fieldId, status: "applied" }));
    },
  };
  const context = vm.createContext({
    chrome,
    document,
    navigator: { clipboard: { async writeText(value) { clipboardWrites.push(value); } } },
    Element: FakeNode,
    __personalResumeBridge: bridge,
    setTimeout,
  });
  vm.runInContext(source, context);
  const host = root.children[0];
  return { context, document, host, shadow: host._closedShadow, calls, applyCalls, clipboardWrites };
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
  assert.equal(harness.calls.length, 1, "重复注入不应创建第二个面板或重复读取状态");
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
  assert.deepEqual(JSON.parse(JSON.stringify(harness.applyCalls)), [{ items: [{ fieldId: "field-1", value: "林测试" }], overwrite: false }]);
  assert.match(harness.shadow.querySelector(".status").textContent, /成功 1 项.*不会自动提交/);
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

  for (const selector of [".scan", ".selected", ".assist", ".ai", ".confirm", ".edit"]) {
    await harness.shadow.querySelector(selector).onclick({ isTrusted: false });
  }
  harness.shadow.querySelector(".resume").onchange({ isTrusted: false });

  assert.equal(harness.calls.length, initialMessages);
  assert.equal(harness.applyCalls.length, 0);

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
