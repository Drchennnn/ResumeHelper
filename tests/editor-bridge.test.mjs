import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../extension/editor-bridge.js", import.meta.url), "utf8");

class FakeCustomEvent {
  constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.attributes = new Map();
    this.listeners = new Map();
    this.isConnected = true;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatchEvent(event) {
    event.target ||= this;
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return true;
  }
  getAttribute(name) { return this.attributes.get(name) || null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  matches(selector) { return selector === ".ql-editor" && this.ql === true; }
  closest() { return null; }
  querySelector() { return null; }
}

function htmlElement() {
  let html = "";
  let text = "";
  return {
    set textContent(value) { text = String(value); html = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); },
    get textContent() { return text; },
    set innerHTML(value) {
      html = String(value);
      text = html.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, "")
        .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
    },
    get innerHTML() { return html; },
  };
}

function harness(globals = {}) {
  const documentListeners = new Map();
  const document = {
    createElement: htmlElement,
    addEventListener(type, listener) { documentListeners.set(type, listener); },
  };
  const context = vm.createContext({
    document,
    location: { origin: "https://jobs.example.test" },
    Element: FakeElement,
    CustomEvent: FakeCustomEvent,
    setTimeout,
    ...globals,
  });
  vm.runInContext(source, context);
  return {
    request(target, detail) {
      documentListeners.get("personal-resume-editor-request")?.({ target, detail });
    },
  };
}

test("CKEditor 4 bridge escapes resume text and confirms plain-text readback", async () => {
  let stored = "";
  const editor = {
    setData(value, options) { stored = value; options.callback(); },
    getData() { return stored; },
  };
  const { request } = harness({ CKEDITOR: { instances: { profile: editor } } });
  const target = new FakeElement("profile");
  target.setAttribute("data-personal-resume-editor-token", "secret");
  const response = new Promise((resolve) => target.addEventListener("personal-resume-editor-response", (event) => resolve(event.detail)));
  request(target, {
    token: "secret", requestId: "one", origin: "https://jobs.example.test",
    action: "setPlainText", text: "项目 <script>alert(1)</script>",
  });
  const detail = await response;
  assert.equal(detail.ok, true);
  assert.equal(detail.editor, "ckeditor4");
  assert.equal(stored.includes("<script>"), false);
  assert.equal(detail.actual, "项目 <script>alert(1)</script>");
});

test("Quill bridge uses its public text API and rejects a bad origin/token", async () => {
  let stored = "";
  const quill = {
    setText(value) { stored = value; },
    getText() { return `${stored}\n`; },
  };
  const { request } = harness({ Quill: { find: () => quill } });
  const target = new FakeElement("quill");
  target.ql = true;
  target.setAttribute("data-personal-resume-editor-token", "valid");
  const responses = [];
  target.addEventListener("personal-resume-editor-response", (event) => responses.push(event.detail));
  request(target, {
    token: "stolen", requestId: "bad", origin: "https://jobs.example.test",
    action: "setPlainText", text: "不能写入",
  });
  request(target, {
    token: "valid", requestId: "bad-origin", origin: "https://evil.example",
    action: "setPlainText", text: "不能写入",
  });
  request(target, {
    token: "valid", requestId: "good", origin: "https://jobs.example.test",
    action: "setPlainText", text: "RAG 项目",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stored, "RAG 项目");
  assert.deepEqual(responses.map((item) => item.requestId), ["good"]);
  assert.equal(responses[0].ok, true);
});
