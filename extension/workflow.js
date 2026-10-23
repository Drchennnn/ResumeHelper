(function installPersonalResumeWorkflow() {
  "use strict";

  const API_KEY = "__personalResumeWorkflow";
  if (globalThis[API_KEY]?.prepare) return;
  const RECORD_SELECTOR = "[class*='apply-form-array-card-content'],[data-resume-helper-record],[class*='formGroupItem']";
  const MAX_ADDITIONS = 30;
  const DEFAULT_TIMEOUT_MS = 2500;
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

  function addButton(root) {
    return Array.from(root?.querySelectorAll?.("button,[role='button']") || []).find((candidate) => {
      const text = String(candidate.textContent || "").trim();
      const tag = String(candidate.tagName || "").toLowerCase();
      const role = String(candidate.getAttribute?.("role") || "").toLowerCase();
      const type = String(candidate.getAttribute?.("type") || candidate.type || "button").toLowerCase();
      const hasNavigation = candidate.getAttribute?.("href") !== null;
      const supported = tag === "button" ? type !== "submit" : role === "button" && !hasNavigation;
      return supported && /^(?:[+＋]\s*)?(?:添加|新增)$/.test(text) && visible(candidate) && root.contains(candidate);
    });
  }

  function cancelled(run) {
    if (activeRun !== run || run.cancelled) throw new Error("已停止补齐经历条目");
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
        if (current > before) { finish(null, current); return; }
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

    try {
      for (const spec of SECTIONS) {
        cancelled(run);
        const desired = requestedCount(counts, spec.key);
        let root = (spec.id && document.getElementById(spec.id))
          || document.querySelector?.(`[data-resume-helper-section='${spec.key}']`);
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
          const button = addButton(root);
          if (!button) { status = "no_safe_add_button"; break; }
          const count = recordCount(root);
          button.click();
          try {
            await waitForIncrease(root, count, run, timeoutMs);
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

  globalThis[API_KEY] = {
    prepare,
    cancel() {
      if (!activeRun) return false;
      activeRun.cancelled = true;
      return true;
    },
  };
})();
