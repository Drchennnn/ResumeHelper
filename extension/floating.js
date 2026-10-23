(function installPersonalResumeFloatingPanel() {
  "use strict";

  const INSTALL_KEY = "__personalResumeFloatingPanelInstalled__";
  const API_KEY = "__personalResumeFloatingPanel";
  if (globalThis[INSTALL_KEY]) {
    globalThis[API_KEY]?.reopen?.();
    return;
  }
  globalThis[INSTALL_KEY] = true;

  const HOST_ID = "personal-resume-floating-host";
  const existing = document.getElementById(HOST_ID);
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.dataset.personalResumeUi = "true";
  host.setAttribute("aria-label", "简历闪填助手");
  const shadow = host.attachShadow({ mode: "closed" });
  (document.documentElement || document.body).append(host);

  shadow.innerHTML = `
    <style>
      :host{all:initial;color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
      *{box-sizing:border-box;letter-spacing:0}
      button,select,input{font:inherit}
      button{cursor:pointer}
      .launcher{position:fixed;right:24px;bottom:24px;width:62px;height:62px;border:2px solid #76adff;border-radius:50%;background:linear-gradient(145deg,#2688ff,#545ee8);color:#fff;box-shadow:0 14px 34px rgba(24,73,150,.34);z-index:2147483647;display:grid;place-items:center;transition:transform .18s ease,box-shadow .18s ease}
      .launcher:hover{transform:translateY(-2px);box-shadow:0 17px 38px rgba(24,73,150,.4)}
      .launcher svg{width:31px;height:31px}
      .panel{position:fixed;right:24px;bottom:98px;width:min(380px,calc(100vw - 24px));max-height:min(680px,calc(100vh - 122px));border:1px solid #d4e2f6;border-radius:14px;background:#fff;color:#13233b;box-shadow:0 22px 58px rgba(30,49,83,.24);overflow:hidden;z-index:2147483646;display:flex;flex-direction:column}
      .panel[hidden],.launcher[hidden],[hidden]{display:none!important}
      .head{min-height:68px;padding:14px 16px;background:linear-gradient(135deg,#4f9bea,#3977da);color:#fff;display:flex;align-items:center;gap:11px}
      .brand{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.2);display:grid;place-items:center;flex:none}
      .brand svg{width:24px;height:24px}.title{min-width:0;flex:1}.title strong{display:block;font-size:17px;line-height:1.25}.title span{display:block;margin-top:3px;font-size:12px;opacity:.86}
      .icon{width:34px;height:34px;border:0;border-radius:7px;background:transparent;color:inherit;display:grid;place-items:center}.icon:hover{background:rgba(255,255,255,.15)}.icon svg{width:20px;height:20px}
      .body{overflow:auto;padding:16px}.resume-row{display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:12px}.resume-row select{min-width:0;height:38px;border:1px solid #cbd9ec;border-radius:7px;padding:0 10px;background:#fff;color:#18314f}.secondary{border:1px solid #bfd0e8;border-radius:7px;background:#fff;color:#315275;padding:0 12px;height:38px}.secondary:hover{background:#f4f8fd}
      .actions{display:grid;gap:8px}.action{min-height:50px;border:0;border-radius:8px;background:#1767e8;color:#fff;font-weight:700;font-size:16px;display:flex;align-items:center;justify-content:center;gap:9px}.action:hover{background:#0d5cda}.action.secondary-action{background:#edf5ff;color:#285c92;border:1px solid #bdd8fa}.action.secondary-action:hover{background:#e3f0ff}.action:disabled,.secondary:disabled,.confirm:disabled{cursor:not-allowed;opacity:.55}
      .action svg{width:21px;height:21px}.status{margin:12px 0 0;padding:9px 11px;border-radius:7px;background:#f4f7fb;color:#52647a;font-size:12px;line-height:1.55}.status[data-tone="error"]{background:#fff1f0;color:#a93632}.status[data-tone="success"]{background:#edf9f2;color:#24724a}
      .preview{margin-top:14px;border-top:1px solid #e3eaf3;padding-top:14px}.preview-head{display:flex;align-items:start;gap:8px}.preview-head>div{flex:1}.preview-head strong{display:block;font-size:15px}.preview-head small{display:block;color:#6b7d91;margin-top:3px}.ai{border:0;border-radius:7px;background:#eaf2ff;color:#135dcf;font-weight:700;padding:8px 10px}.ai:hover{background:#dae9ff}
      .privacy{font-size:11px;line-height:1.45;color:#7a6a48;background:#fff9e9;border:1px solid #f4dd9c;border-radius:6px;padding:7px 8px;margin:9px 0}.items{display:grid;gap:6px;max-height:210px;overflow:auto}.item{display:grid;grid-template-columns:auto 1fr;gap:8px;padding:8px;border:1px solid #dce5f0;border-radius:7px;background:#fff}.item:hover{border-color:#afc9e9}.item input{margin-top:3px}.item strong{display:block;font-size:13px;color:#253d59}.item span{display:block;margin-top:2px;color:#627388;font-size:12px;overflow-wrap:anywhere}.empty{padding:16px 8px;text-align:center;color:#77879a;font-size:13px}
      .options{margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:10px}.toggle{display:flex;align-items:center;gap:6px;font-size:12px;color:#52647a}.confirm{height:38px;border:0;border-radius:7px;background:#1767e8;color:#fff;font-weight:700;padding:0 15px}.confirm:hover{background:#0d5cda}
      .facts{margin-top:14px;border-top:1px solid #e3eaf3;padding-top:14px}.facts-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.facts-head strong{font-size:15px}.facts-list{display:grid;gap:6px;max-height:250px;overflow:auto}.fact{padding:8px;border:1px solid #dce5f0;border-radius:7px}.fact-label{font-size:12px;color:#52647a}.fact-value{margin:3px 0 7px;font-size:13px;color:#1a304a;overflow-wrap:anywhere}.fact-actions{display:flex;gap:6px}.fact-actions button{height:28px;border:1px solid #c9d7e8;border-radius:6px;background:#fff;color:#315275;font-size:12px;padding:0 9px}.fact-actions button:last-child{color:#135dcf;border-color:#b9d3f6;background:#f2f7ff}
      .control-help{margin:9px 2px 0;color:#6b7d91;font-size:11px;line-height:1.45}
      .issues{margin:9px 0 0;padding:9px 11px;border-radius:7px;background:#fff7ed;color:#8a4518;font-size:12px;line-height:1.5}.issues ul{margin:5px 0 0;padding-left:18px}.issues li+li{margin-top:4px}
      .picker{position:fixed;inset:auto 18px 18px;z-index:2147483647;margin:auto;max-width:520px;padding:11px 14px;border-radius:8px;background:#172a44;color:#fff;box-shadow:0 10px 28px rgba(0,0,0,.28);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;text-align:center;pointer-events:none}
      @media(max-width:520px){.panel{right:12px;bottom:86px;width:calc(100vw - 24px);max-height:calc(100vh - 106px)}.launcher{right:16px;bottom:16px;width:56px;height:56px}}
      @media(prefers-reduced-motion:reduce){.launcher{transition:none}}
    </style>
    <button class="launcher" type="button" aria-label="打开简历闪填助手" title="打开简历闪填助手">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/></svg>
    </button>
    <section class="panel" role="dialog" aria-label="简历闪填助手" hidden>
      <header class="head">
        <div class="brand"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/></svg></div>
        <div class="title"><strong>简历闪填助手</strong><span>本地资料 · 预览后填写</span></div>
        <button class="icon minimize" type="button" aria-label="收起" title="收起"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg></button>
        <button class="icon close" type="button" aria-label="关闭" title="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </header>
      <div class="body">
        <div class="resume-row"><select class="resume" aria-label="当前简历"></select><button class="secondary edit" type="button">编辑简历</button></div>
        <div class="actions">
          <button class="action scan" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/></svg>一键填写</button>
          <button class="action selected" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/></svg>选区填写</button>
          <button class="action secondary-action assist" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>辅助填写</button>
          <button class="action secondary-action prepare" type="button">补齐经历条目并重新识别</button>
          <button class="secondary stop" type="button" hidden>停止当前操作</button>
        </div>
        <p class="control-help">复杂下拉无法打开或找不到选项时，请先手动打开控件，再使用辅助填写或重新识别。</p>
        <p class="status" role="status" aria-live="polite">正在载入本地简历…</p>
        <section class="issues" aria-label="未完成字段" hidden></section>
        <section class="preview" hidden>
          <div class="preview-head"><div><strong>填写预览</strong><small class="summary"></small></div><button class="ai" type="button">AI 重新匹配</button></div>
          <p class="privacy">点击 AI 后，会把当前表单的字段标签和所选简历资料发送到你配置的自定义 API。</p>
          <div class="items"></div>
          <div class="options"><label class="toggle"><input class="overwrite" type="checkbox">覆盖已有内容</label><button class="confirm" type="button">确认填写</button></div>
        </section>
        <section class="facts" hidden><div class="facts-head"><strong>简历资料</strong><button class="secondary facts-close" type="button">返回</button></div><div class="facts-list"></div></section>
      </div>
    </section>
    <div class="picker" hidden>移动鼠标选择表单区域，单击确认；按 Esc 取消</div>
  `;

  const $ = (selector) => shadow.querySelector(selector);
  const ui = {
    launcher: $(".launcher"), panel: $(".panel"), resume: $(".resume"), edit: $(".edit"),
    scan: $(".scan"), selected: $(".selected"), assist: $(".assist"), prepare: $(".prepare"), stop: $(".stop"), status: $(".status"), issues: $(".issues"),
    preview: $(".preview"), summary: $(".summary"), items: $(".items"), ai: $(".ai"),
    overwrite: $(".overwrite"), confirm: $(".confirm"), facts: $(".facts"),
    factsList: $(".facts-list"), picker: $(".picker"),
  };
  const state = { fields: [], items: [], busy: false, pickCleanup: null, cancelRequested: false };

  function setStatus(message, tone = "") {
    ui.status.textContent = message;
    ui.status.dataset.tone = tone;
  }

  function setBusy(value) {
    state.busy = value;
    for (const control of [ui.resume, ui.edit, ui.scan, ui.selected, ui.assist, ui.prepare, ui.ai, ui.confirm]) {
      control.disabled = value;
    }
  }

  async function message(payload) {
    if (!globalThis.chrome?.runtime?.sendMessage) throw new Error("扩展通信不可用，请重新加载页面");
    const result = await chrome.runtime.sendMessage(payload);
    if (!result || result.ok === false) throw new Error(result?.error || "扩展后台没有响应");
    return result;
  }

  function bridge() {
    const api = globalThis.__personalResumeBridge;
    if (!api || typeof api.scan !== "function" || typeof api.apply !== "function") {
      throw new Error("页面填写组件尚未就绪，请刷新页面后重试");
    }
    return api;
  }

  function workflow() {
    const api = globalThis.__personalResumeWorkflow;
    if (!api || typeof api.prepare !== "function") throw new Error("经历条目组件尚未就绪，请刷新页面后重试");
    return api;
  }

  function resumeCollectionCounts(facts) {
    const records = { education: new Set(), work_experience: new Set(), projects: new Set(), certificate: new Set(), language_skills: new Set() };
    const targets = {
      education: "education", work_experience: "work_experience",
      projects: "projects", certificate: "certificate", language_skills: "language_skills",
    };
    for (const fact of Array.isArray(facts) ? facts : []) {
      const value = fact?.value;
      if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) continue;
      const match = String(fact?.path || "").match(/^([a-z_]+)\.(\d+)\./);
      const target = match && targets[match[1]];
      if (target) records[target].add(`${match[1]}.${match[2]}`);
    }
    return Object.fromEntries(Object.entries(records).map(([key, values]) => [key, values.size]));
  }

  async function task(work) {
    if (state.busy) return;
    setBusy(true);
    try { await work(); } catch (error) { setStatus(error?.message || "操作失败", "error"); }
    finally { setBusy(false); }
  }

  function normalizedItems(items) {
    if (!Array.isArray(items)) return [];
    return items.filter((item) => item && typeof item.fieldId === "string" && item.fieldId && item.value !== undefined);
  }

  function fieldIsEmpty(field) {
    const value = field?.value;
    return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  }

  function renderIssues(results) {
    ui.issues.replaceChildren();
    const reasonLabels = {
      option_not_found: "未找到匹配选项",
      custom_menu_needs_manual_open: "自定义下拉需要手动打开",
      unsupported_custom_date_panel: "日期面板暂不支持自动操作",
      option_disabled: "匹配选项不可用",
      value_mismatch: "页面没有接受填写结果",
      unknown_field: "页面字段已经变化",
    };
    const manualReasons = new Set(["option_not_found", "custom_menu_needs_manual_open", "unsupported_custom_date_panel"]);
    const fields = new Map(state.fields.map((field) => [field.id, field]));
    const unresolved = (Array.isArray(results) ? results : []).filter((entry) =>
      entry && entry.status !== "applied" && entry.reason !== "non_empty" && entry.reason !== "cancelled"
    );
    if (!unresolved.length) { ui.issues.hidden = true; return 0; }
    const heading = document.createElement("strong");
    heading.textContent = `有 ${unresolved.length} 个字段需要手动处理`;
    const list = document.createElement("ul");
    const pending = unresolved.slice(0, 10);
    for (const entry of pending) {
      const item = document.createElement("li");
      const label = fields.get(entry.fieldId)?.label || "未命名字段";
      const reason = reasonLabels[entry.reason] || "页面未完成自动填写";
      const next = manualReasons.has(entry.reason)
        ? "手动打开下拉或日期后重试；仍失败可辅助填写复制资料自行选择"
        : "请重新识别后重试；仍失败可用辅助填写复制资料手动完成";
      item.textContent = `${label}：${reason}。${next}`;
      list.append(item);
    }
    ui.issues.append(heading, list);
    if (unresolved.length > pending.length) {
      const more = document.createElement("div");
      more.textContent = `另有 ${unresolved.length - pending.length} 项未显示`;
      ui.issues.append(more);
    }
    ui.issues.hidden = false;
    return unresolved.length;
  }

  function renderItems() {
    ui.items.replaceChildren();
    ui.summary.textContent = `${state.items.length} / ${state.fields.length} 项可填写`;
    state.items.forEach((item, index) => {
      const row = document.createElement("label");
      row.className = "item";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = true;
      input.dataset.index = String(index);
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = item.label || state.fields.find((field) => field.id === item.fieldId)?.label || "未命名字段";
      const value = document.createElement("span");
      value.textContent = item.displayValue ?? String(item.value ?? "");
      copy.append(title, value);
      row.append(input, copy);
      ui.items.append(row);
    });
    if (!state.items.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "暂无确定匹配。可补充简历资料，或明确点击 AI 重新匹配。";
      ui.items.append(empty);
    }
    ui.preview.hidden = false;
    ui.facts.hidden = true;
  }

  async function scan(root, options = {}) {
    const result = await bridge().scan(root);
    const scannedFields = Array.isArray(result?.fields) ? result.fields : [];
    if (scannedFields.length > 250) throw new Error("识别到的字段超过 250 个，请使用选区填写缩小范围");
    if (!scannedFields.length) throw new Error("所选区域没有发现可填写字段");
    const fields = options.remainingOnly ? scannedFields.filter(fieldIsEmpty) : scannedFields;
    state.fields = fields;
    const matched = await message({ type: "LOCAL_MATCH", fields, resumeId: ui.resume.value });
    state.items = normalizedItems(matched.items);
    if (!options.preserveIssues) renderIssues([]);
    renderItems();
    setStatus(`识别到 ${fields.length} 个字段，本地匹配 ${state.items.length} 项。请检查后确认填写。`);
    return { fields: state.fields, items: state.items };
  }

  async function copyText(value) {
    const text = String(value ?? "");
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    shadow.append(area);
    area.select();
    const copied = document.execCommand?.("copy");
    area.remove();
    if (!copied) throw new Error("复制失败，请手动选择资料");
  }

  async function apply(items) {
    if (!items.length) throw new Error("请至少选择一项再填写");
    state.cancelRequested = false;
    ui.stop.hidden = false;
    let result;
    try {
      result = await bridge().apply(items.map(({ fieldId, value }) => ({ fieldId, value })), ui.overwrite.checked);
    } finally {
      ui.stop.hidden = true;
    }
    const results = Array.isArray(result) ? result : result?.results;
    const cancelled = state.cancelRequested || (results || []).some((entry) => entry?.reason === "cancelled");
    renderIssues(results || []);
    const counts = {};
    for (const entry of results || []) {
      const key = entry.reason === "non_empty" ? "protected" : entry.status;
      counts[key] = (counts[key] || 0) + 1;
    }
    const labels = { applied: "成功", skipped: "跳过", failed: "失败", protected: "保护已有值" };
    const detail = Object.entries(counts).map(([key, count]) => `${labels[key] || key} ${count} 项`).join("，");
    if (cancelled) {
      setStatus("已停止当前操作。已经完成的填写会保留，其余项目未继续写入。", "error");
    } else {
      setStatus(`填写结果：${detail || "没有返回结果"}。请在页面复核，助手不会自动提交。`, counts.failed ? "error" : "success");
    }
    return { results: results || [], cancelled };
  }

  function stopPicking() {
    if (state.pickCleanup) state.pickCleanup();
    state.pickCleanup = null;
    ui.picker.hidden = true;
  }

  function pickRegion() {
    stopPicking();
    ui.panel.hidden = true;
    ui.launcher.hidden = true;
    ui.picker.hidden = false;
    let highlighted = null;
    let previousOutline = "";
    let previousOffset = "";
    const clear = () => {
      if (!highlighted) return;
      highlighted.style.outline = previousOutline;
      highlighted.style.outlineOffset = previousOffset;
      highlighted = null;
    };
    const move = (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target === host || host.contains(target)) return;
      if (target === highlighted) return;
      clear();
      highlighted = target;
      previousOutline = target.style.outline;
      previousOffset = target.style.outlineOffset;
      target.style.outline = "3px solid #2688ff";
      target.style.outlineOffset = "2px";
    };
    const finish = () => {
      clear();
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("click", choose, true);
      document.removeEventListener("keydown", key, true);
      ui.picker.hidden = true;
      ui.panel.hidden = false;
      ui.launcher.hidden = true;
    };
    const choose = (event) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const root = event.target;
      finish();
      state.pickCleanup = null;
      task(() => scan(root));
    };
    const key = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish();
      state.pickCleanup = null;
      setStatus("已取消选区填写");
    };
    state.pickCleanup = finish;
    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", choose, true);
    document.addEventListener("keydown", key, true);
  }

  async function showFacts() {
    const result = await message({ type: "RESUME_FACTS", resumeId: ui.resume.value });
    const facts = Array.isArray(result.facts) ? result.facts : [];
    ui.factsList.replaceChildren();
    for (const fact of facts) {
      const card = document.createElement("div");
      card.className = "fact";
      const label = document.createElement("div");
      label.className = "fact-label";
      label.textContent = fact.label || fact.path || "简历资料";
      const value = document.createElement("div");
      value.className = "fact-value";
      value.textContent = String(fact.value ?? "");
      const actions = document.createElement("div");
      actions.className = "fact-actions";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "复制";
      copy.onclick = (event) => {
        if (!event.isTrusted) return;
        task(async () => { await copyText(fact.value); setStatus(`已复制：${label.textContent}`, "success"); });
      };
      const fill = document.createElement("button");
      fill.type = "button";
      fill.textContent = "填入当前字段";
      fill.onclick = (event) => { if (event.isTrusted) pickSingleField(fact); };
      actions.append(copy, fill);
      card.append(label, value, actions);
      ui.factsList.append(card);
    }
    if (!facts.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "当前简历还没有可用资料，请先前往工作台补充。";
      ui.factsList.append(empty);
    }
    ui.preview.hidden = true;
    ui.facts.hidden = false;
    setStatus(`已载入 ${facts.length} 项本地资料。复制不会调用 API。`);
  }

  function pickSingleField(fact) {
    stopPicking();
    ui.panel.hidden = true;
    ui.launcher.hidden = true;
    ui.picker.hidden = false;
    ui.picker.textContent = `请选择要填入“${fact.label || "这项资料"}”的字段；按 Esc 取消`;
    let highlighted = null;
    let previousOutline = "";
    const clear = () => {
      if (!highlighted) return;
      highlighted.style.outline = previousOutline;
      highlighted = null;
    };
    const move = (event) => {
      if (!(event.target instanceof Element) || event.target === host || host.contains(event.target)) return;
      clear(); highlighted = event.target; previousOutline = highlighted.style.outline; highlighted.style.outline = "3px solid #2688ff";
    };
    const finish = () => {
      clear(); document.removeEventListener("mousemove", move, true); document.removeEventListener("click", choose, true); document.removeEventListener("keydown", key, true);
      ui.picker.hidden = true; ui.picker.textContent = "移动鼠标选择表单区域，单击确认；按 Esc 取消"; ui.panel.hidden = false; ui.launcher.hidden = true;
    };
    const choose = (event) => {
      if (!event.isTrusted) return;
      event.preventDefault(); event.stopImmediatePropagation(); const target = event.target; finish(); state.pickCleanup = null;
      task(async () => {
        const result = await bridge().scan(target);
        const fields = Array.isArray(result?.fields) ? result.fields : [];
        if (fields.length !== 1) throw new Error(fields.length ? "请直接点击一个输入框" : "该位置不是可填写字段");
        await apply([{ fieldId: fields[0].id, value: fact.value }]);
      });
    };
    const key = (event) => { if (event.key === "Escape") { event.preventDefault(); finish(); state.pickCleanup = null; setStatus("已取消单项填写"); } };
    state.pickCleanup = finish;
    document.addEventListener("mousemove", move, true); document.addEventListener("click", choose, true); document.addEventListener("keydown", key, true);
  }

  ui.launcher.onclick = () => { ui.panel.hidden = false; ui.launcher.hidden = true; };
  $(".minimize").onclick = () => { ui.panel.hidden = true; ui.launcher.hidden = false; };
  $(".close").onclick = () => { stopPicking(); ui.panel.hidden = true; ui.launcher.hidden = false; };
  ui.edit.onclick = (event) => {
    if (!event.isTrusted) return;
    return task(async () => { await message({ type: "OPEN_WORKBENCH" }); setStatus("已打开简历工作台"); });
  };
  ui.scan.onclick = (event) => { if (event.isTrusted) return task(() => scan()); };
  ui.selected.onclick = (event) => { if (event.isTrusted && !state.busy) pickRegion(); };
  ui.assist.onclick = (event) => { if (event.isTrusted) return task(showFacts); };
  ui.prepare.onclick = (event) => {
    if (!event.isTrusted) return;
    return task(async () => {
      state.cancelRequested = false;
      const factsResult = await message({ type: "RESUME_FACTS", resumeId: ui.resume.value });
      const counts = resumeCollectionCounts(factsResult.facts);
      ui.stop.hidden = false;
      setStatus("正在按本地简历条数补齐已确认的经历分区…");
      try {
        const result = await workflow().prepare(counts);
        const rescanned = await scan();
        const detail = result.remaining ? `，仍缺 ${result.remaining} 条；请手动新增或展开对应分区后重新识别` : "";
        setStatus(`已新增 ${result.added} 条经历并重新识别 ${rescanned.fields.length} 个字段${detail}。请检查预览。`, result.remaining ? "error" : "success");
      } finally {
        ui.stop.hidden = true;
      }
    });
  };
  ui.stop.onclick = (event) => {
    if (!event.isTrusted) return;
    let cancelled = false;
    const workflowApi = globalThis.__personalResumeWorkflow;
    const bridgeApi = globalThis.__personalResumeBridge;
    if (typeof workflowApi?.cancel === "function") cancelled = workflowApi.cancel() || cancelled;
    if (typeof bridgeApi?.cancel === "function") cancelled = bridgeApi.cancel() || cancelled;
    if (cancelled) {
      state.cancelRequested = true;
      setStatus("正在停止当前操作；已经完成的填写会保留，其余项目将跳过…");
    }
  };
  $(".facts-close").onclick = () => { ui.facts.hidden = true; setStatus("可选择一键填写或选区填写"); };
  ui.ai.onclick = (event) => {
    if (!event.isTrusted) return;
    return task(async () => {
    if (!state.fields.length) throw new Error("请先识别页面字段");
    const result = await message({ type: "MATCH", fields: state.fields, resumeId: ui.resume.value });
    state.items = normalizedItems(result.items);
    renderItems();
    setStatus(`AI 匹配 ${state.items.length} 项。请逐项检查后确认填写。`);
    });
  };
  ui.confirm.onclick = (event) => {
    if (!event.isTrusted) return;
    return task(async () => {
    const selected = Array.from(ui.items.querySelectorAll("input:checked"))
      .map((input) => state.items[Number(input.dataset.index)])
      .filter(Boolean);
    const result = await apply(selected);
    const rescanned = await scan(undefined, { remainingOnly: true, preserveIssues: true });
    if (result.cancelled) {
      setStatus(`已停止当前操作。已经完成的填写会保留；已重新识别，剩余 ${rescanned.items.length} 项可填写。`, "error");
      return;
    }
    const labels = { applied: "成功", skipped: "跳过", failed: "失败", protected: "保护已有值" };
    const counts = {};
    for (const entry of result?.results || result || []) {
      const key = entry.reason === "non_empty" ? "protected" : entry.status;
      counts[key] = (counts[key] || 0) + 1;
    }
    const detail = Object.entries(counts).map(([key, count]) => `${labels[key] || key} ${count} 项`).join("，");
    const help = counts.skipped || counts.failed ? " 下拉无法打开或选项未找到时，请手动打开控件，再用辅助填写或重新识别。" : "";
    setStatus(`填写结果：${detail || "没有返回结果"}。已重新识别，剩余 ${rescanned.items.length} 项可填写；请在页面复核。${help}`, counts.failed ? "error" : "success");
    });
  };
  ui.resume.onchange = (event) => {
    if (!event.isTrusted) return;
    state.fields = []; state.items = []; ui.preview.hidden = true; ui.facts.hidden = true;
    setStatus("简历已切换，请重新识别当前页面");
  };

  globalThis[API_KEY] = {
    reopen() {
      stopPicking();
      ui.panel.hidden = false;
      ui.launcher.hidden = true;
    },
  };

  task(async () => {
    const result = await message({ type: "PANEL_STATE" });
    const resumes = Array.isArray(result.resumes) ? result.resumes : [];
    ui.resume.replaceChildren();
    for (const resume of resumes) {
      const option = document.createElement("option");
      option.value = resume.id;
      option.textContent = resume.name || "未命名简历";
      ui.resume.append(option);
    }
    if (result.activeId) ui.resume.value = result.activeId;
    if (!resumes.length) throw new Error("尚无简历，请先打开工作台创建简历");
    setStatus("已就绪。识别结果会先预览，确认后才写入页面。", "success");
  });
})();
