(function installPersonalResumeWorkflow() {
  "use strict";

  const API_KEY = "__personalResumeWorkflow";
  if (globalThis[API_KEY]?.prepare) return;
  const RECORD_SELECTOR = "[class*='apply-form-array-card-content'],[data-resume-helper-record],[class*='formGroupItem']";
  const MAX_ADDITIONS = 30;
  const DEFAULT_TIMEOUT_MS = 2500;
  const MAX_OBSERVE_TIMEOUT_MS = 60000;
  const FIELD_SELECTOR = "input,textarea,select,[contenteditable='true'],[role='textbox'],[role='combobox'],[data-form-field-name]";
  const UI_SELECTOR = "#personal-resume-floating-host,[data-resume-helper-ui]";
  const SECTIONS = [
    { key: "education", id: "formily-item-education_list", jdId: "edu", title: "教育经历" },
    { key: "internships", jdId: "experience", title: "实习经历" },
    { key: "cadre_experiences", jdId: "campus", title: "校园经历" },
    { key: "work_experience", id: "formily-item-career_list" },
    { key: "projects", id: "formily-item-project_list", jdId: "program", title: "项目经历" },
    { key: "certificate", id: "formily-item-certificate_list" },
    { key: "language_skills", id: "formily-item-language_list", jdId: "skill", title: "语言/证书/技能" },
  ];

  let activeRun = null;

  const recordCount = (root) => root?.querySelectorAll?.(RECORD_SELECTOR)?.length || 0;
  const requestedCount = (counts, key) => {
    const value = Number(counts?.[key]);
    return Number.isInteger(value) && value > 0 ? Math.min(value, 30) : 0;
  };

  function openNativeDetails(root) {
    const details = [];
    for (let node = root; node; node = node.parentElement) {
      if (String(node.tagName).toLowerCase() === "details") details.push(node);
    }
    for (const node of root?.querySelectorAll?.("details") || []) details.push(node);
    for (const node of details) node.open = true;
  }

  function visible(element) {
    if (!element || element.disabled || element.hidden) return false;
    if (element.getAttribute?.("aria-disabled") === "true") return false;
    if (element.getAttribute?.("aria-hidden") === "true") return false;
    if (element.closest?.("[hidden],[aria-hidden='true']")) return false;
    const style = globalThis.getComputedStyle?.(element);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    if (typeof element.getClientRects === "function" && element.getClientRects().length === 0) return false;
    return true;
  }

  const cleanText = (value) => String(value || "")
    .replace(/[\s：:*]/g, "")
    .replace(/[（(]必填[）)]/g, "")
    .trim();

  function addButton(root, spec) {
    const sectionTitle = cleanText(spec?.title);
    return Array.from(root?.querySelectorAll?.("button,[role='button']") || []).find((candidate) => {
      const text = cleanText(candidate.textContent);
      const tag = String(candidate.tagName || "").toLowerCase();
      const role = String(candidate.getAttribute?.("role") || "").toLowerCase();
      const type = String(candidate.getAttribute?.("type") || candidate.type || "button").toLowerCase();
      const hasNavigation = candidate.getAttribute?.("href") !== null;
      const supported = tag === "button" ? type !== "submit" : role === "button" && !hasNavigation;
      const generic = /^(?:[+＋])?(?:添加|新增)$/.test(text);
      const titled = sectionTitle && (text === `添加${sectionTitle}` || text === `新增${sectionTitle}`);
      return supported && (generic || titled) && visible(candidate) && root.contains(candidate);
    });
  }

  function sectionByHeading(spec) {
    if (!spec.title || typeof document.querySelectorAll !== "function") return null;
    const expected = cleanText(spec.title);
    for (const candidate of document.querySelectorAll("section,fieldset,[role='group'],[class*='section'],[class*='container']")) {
      const heading = candidate.querySelector?.("h1,h2,h3,h4,legend,[role='heading'],[class*='title']");
      if (cleanText(heading?.textContent) !== expected) continue;
      const hasFields = Boolean(candidate.querySelector?.(FIELD_SELECTOR));
      const hasRecords = recordCount(candidate) > 0;
      if ((hasFields || hasRecords || addButton(candidate, spec)) && visible(candidate)) return candidate;
    }
    return null;
  }

  function cancelled(run) {
    if (activeRun !== run || run.cancelled) throw new Error("已停止补齐经历条目");
  }

  function visibleDialog() {
    return Array.from(document.querySelectorAll?.("[role='dialog'],dialog,[class*='modal'],[class*='drawer']") || [])
      .find((node) => visible(node) && !node.closest?.(UI_SELECTOR));
  }

  function waitForIncrease(root, before, run, timeoutMs) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let timer;
      const finish = (error, value) => {
        clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      const check = () => {
        try { cancelled(run); } catch (error) { finish(error); return; }
        const current = recordCount(root);
        if (current > before) { finish(null, { type: "record", count: current }); return; }
        if (visibleDialog()) { finish(null, { type: "dialog", count: current }); return; }
        if (Date.now() - started >= timeoutMs) { finish(new Error("新增条目后未读到页面变化")); return; }
        timer = setTimeout(check, 40);
      };
      check();
    });
  }

  async function prepare(counts, options = {}) {
    if (!counts || typeof counts !== "object") throw new Error("缺少简历条目计数");
    if (activeRun) activeRun.cancelled = true;
    const run = { cancelled: false };
    activeRun = run;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(50, options.timeoutMs) : DEFAULT_TIMEOUT_MS;
    let budget = MAX_ADDITIONS;
    const sections = [];
    if (visibleDialog()) { activeRun = null; return {ok:true,added:0,remaining:0,sections,status:"requires_dialog"}; }

    try {
      for (const spec of SECTIONS) {
        cancelled(run);
        const desired = requestedCount(counts, spec.key);
        let root = (spec.id && document.getElementById(spec.id))
          || document.querySelector?.(`[data-resume-helper-section='${spec.key}']`)
          || sectionByHeading(spec);
        if (!root && spec.jdId && globalThis.location?.hostname === "campus.jd.com") {
          const candidate = document.getElementById(spec.jdId);
          const heading = candidate?.querySelector?.("[class*='titleContainer']");
          if (String(candidate?.className || "").includes("gridContainer") && String(heading?.textContent || "").trim().startsWith(spec.title)) root = candidate;
        }
        if (!root) {
          sections.push({ key: spec.key, desired, before: 0, added: 0, after: 0, remaining: desired, status: "unsupported" });
          continue;
        }
        openNativeDetails(root);
        const before = recordCount(root);
        const target = Math.max(0, desired - before);
        let added = 0;
        let status = target ? "ready" : "complete";
        let error = "";
        while (added < target && budget > 0) {
          cancelled(run);
          const button = addButton(root, spec);
          if (!button) { status = "no_safe_add_button"; break; }
          const count = recordCount(root);
          button.click();
          try {
            const outcome = await waitForIncrease(root, count, run, timeoutMs);
            if (outcome.type === "dialog") {
              status = "requires_dialog";
              error = "新增操作打开了需要用户确认的弹窗";
              break;
            }
          } catch (failure) {
            if (run.cancelled || activeRun !== run) throw failure;
            status = "timeout";
            error = failure?.message || "新增条目超时";
            break;
          }
          added += 1;
          budget -= 1;
          status = "added";
        }
        const after = recordCount(root);
        const remaining = Math.max(0, desired - after);
        if (remaining && budget === 0) status = "limit_reached";
        sections.push({ key: spec.key, desired, before, added, after, remaining, status, ...(error ? { error } : {}) });
        if(status === "requires_dialog") break;
      }
      return {
        ok: true,
        added: sections.reduce((sum, section) => sum + section.added, 0),
        remaining: sections.reduce((sum, section) => sum + section.remaining, 0),
        sections,
      };
    } finally {
      if (activeRun === run) activeRun = null;
    }
  }

  function structuralNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches?.(UI_SELECTOR) || node.closest?.(UI_SELECTOR)) return false;
    return Boolean(
      node.matches?.(`${FIELD_SELECTOR},${RECORD_SELECTOR},form,[role='form'],[role='dialog']`)
      || node.querySelector?.(`${FIELD_SELECTOR},${RECORD_SELECTOR},form,[role='form'],[role='dialog']`)
    );
  }

  function structureSnapshot(root = document) {
    const fields = Array.from(root.querySelectorAll?.(FIELD_SELECTOR) || []).filter((node) => !node.closest?.(UI_SELECTOR));
    const records = Array.from(root.querySelectorAll?.(RECORD_SELECTOR) || []).filter((node) => !node.closest?.(UI_SELECTOR));
    return { fields: fields.length, records: records.length };
  }

  function observe(options = {}) {
    const root = options.root || document;
    const target = root.documentElement || root;
    let revision = 0;
    let stopped = false;
    let lastChangeAt = Date.now();
    const waiters = new Set();
    const initial = structureSnapshot(root);
    let current = initial;

    const notify = () => {
      for (const waiter of [...waiters]) waiter();
    };
    const onMutations = (mutations) => {
      if (stopped) return;
      const relevant = mutations.some((mutation) => {
        if (mutation.type === "attributes") return structuralNode(mutation.target);
        return [...mutation.addedNodes, ...mutation.removedNodes].some(structuralNode);
      });
      if (!relevant) return;
      revision += 1;
      lastChangeAt = Date.now();
      current = structureSnapshot(root);
      notify();
    };
    const observer = typeof MutationObserver === "function"
      ? new MutationObserver(onMutations)
      : null;
    observer?.observe(target, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["hidden", "aria-hidden", "aria-disabled", "disabled", "role", "type"],
    });

    const bounded = (value, fallback) => Math.min(MAX_OBSERVE_TIMEOUT_MS, Math.max(10, Number.isFinite(value) ? value : fallback));
    const waitUntil = (predicate, timeoutMs, timeoutMessage) => new Promise((resolve, reject) => {
      const started = Date.now();
      let timer = null;
      const finish = (error, value) => {
        clearTimeout(timer);
        waiters.delete(check);
        if (error) reject(error); else resolve(value);
      };
      const check = () => {
        if (stopped) { finish(new Error("动态观察已停止")); return; }
        const value = predicate();
        if (value) { finish(null, value); return; }
        if (Date.now() - started >= timeoutMs) { finish(new Error(timeoutMessage)); return; }
        clearTimeout(timer);
        timer = setTimeout(check, Math.min(40, timeoutMs));
      };
      waiters.add(check);
      check();
    });

    return {
      snapshot() { return { revision, lastChangeAt, ...current }; },
      async waitForChanges(waitOptions = {}) {
        const since = Number.isInteger(waitOptions.since) ? waitOptions.since : revision;
        const timeoutMs = bounded(waitOptions.timeoutMs, DEFAULT_TIMEOUT_MS);
        const before = { revision: since, ...current };
        const after = await waitUntil(() => revision > since && { revision, lastChangeAt, ...current }, timeoutMs, "等待页面新增或替换字段超时");
        return { before, after };
      },
      async waitForQuiet(waitOptions = {}) {
        const quietMs = bounded(waitOptions.quietMs, 180);
        const timeoutMs = bounded(waitOptions.timeoutMs, DEFAULT_TIMEOUT_MS);
        return waitUntil(() => Date.now() - lastChangeAt >= quietMs && { revision, lastChangeAt, ...current }, timeoutMs, "等待页面稳定超时");
      },
      cancel() { if (stopped) return false; stopped = true; observer?.disconnect(); notify(); return true; },
      disconnect() { return this.cancel(); },
    };
  }

  const NEXT_LABELS = new Set(["下一步", "继续填写"]);
  const BLOCKED_STEP_LABEL = /(提交|保存|完成|同意|协议|申请|投递|删除)/;

  function validationErrors(root) {
    return Array.from(root?.querySelectorAll?.("[aria-invalid='true'],.ant-form-item-has-error,.el-form-item.is-error,[class*='error']") || [])
      .filter((node) => visible(node) && !node.closest?.(UI_SELECTOR));
  }

  function inspectNextStep() {
    if (visibleDialog()) return {status:"blocked",reason:"site_confirmation_required"};
    const forms = Array.from(document.querySelectorAll?.("form,[role='form'],[data-resume-helper-form]") || []).filter(visible);
    const scope = forms.length === 1 ? forms[0] : null;
    if (!scope) return { status: "unsupported", reason: forms.length ? "multiple_forms" : "no_form" };
    const candidates = Array.from(scope.querySelectorAll?.("button,[role='button']") || []).filter((node) => {
      const text = String(node.textContent || "").trim();
      return NEXT_LABELS.has(text) && !BLOCKED_STEP_LABEL.test(text) && visible(node);
    });
    if (candidates.length !== 1) return { status: "unsupported", reason: candidates.length ? "ambiguous" : "not_found", count: candidates.length };
    const errors = validationErrors(scope);
    if (errors.length) return { status: "blocked", reason: "validation_errors", count: errors.length };
    return { status: "ready", label: String(candidates[0].textContent || "").trim(), control: candidates[0] };
  }

  function advanceStep(options = {}) {
    if (options.explicit !== true) return { status: "blocked", reason: "explicit_confirmation_required" };
    const inspected = inspectNextStep();
    if (inspected.status !== "ready") return inspected;
    inspected.control.click();
    return { status: "clicked", label: inspected.label };
  }

  globalThis[API_KEY] = {
    prepare,
    observe,
    inspectNextStep,
    advanceStep,
    cancel() {
      if (!activeRun) return false;
      activeRun.cancelled = true;
      return true;
    },
  };
})();
