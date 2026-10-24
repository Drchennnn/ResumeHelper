(function installPersonalResumeSession() {
  "use strict";

  const API_KEY = "__personalResumeSession";
  if (globalThis[API_KEY]?.run) return;

  const MAX_ROUNDS = 5;
  const MAX_DURATION_MS = 60000;
  let activeRun = null;

  const plainSignature = (value) => {
    const seen = new WeakSet();
    try {
      return JSON.stringify(value, (key, item) => {
        if (typeof item === "function") return undefined;
        if (item && typeof item === "object") {
          if (seen.has(item)) return "[circular]";
          seen.add(item);
          if (!Array.isArray(item)) return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
        }
        return item;
      });
    } catch {
      return String(value);
    }
  };

  const itemSignature = (item) => plainSignature({
    fieldId: item?.fieldId ?? item?.targetId ?? item?.id ?? "",
    sourcePath: item?.sourcePath ?? "",
    value: item?.value ?? item?.selectedValue ?? "",
  });

  function planItems(plan) {
    if (Array.isArray(plan)) return { key: null, items: plan };
    for (const key of ["matches", "items", "plans", "fields"]) {
      if (Array.isArray(plan?.[key])) return { key, items: plan[key] };
    }
    return { key: null, items: [] };
  }

  function filterPlan(plan, failed, approved) {
    const { key, items } = planItems(plan);
    if (!items.length) return { plan, count: 0 };
    const filtered = items.filter((item) => {
      if (failed.has(itemSignature(item))) return false;
      const paths = item?.sourcePaths || [item?.sourcePath];
      if (approved && (!paths.length || paths.some(path => !path || !approved.has(path)))) return false;
      return true;
    });
    if (Array.isArray(plan)) return { plan: filtered, count: filtered.length };
    return { plan: { ...plan, [key]: filtered }, count: filtered.length };
  }

  function resultFailures(result) {
    for (const key of ["failures", "failed", "manual"]) {
      if (Array.isArray(result?.[key])) return result[key];
    }
    if (Array.isArray(result)) return result.filter((item) => ["failed", "skipped", "manual", "error"].includes(item?.status) && item?.reason !== "non_empty");
    return [];
  }

  function appliedCount(result) {
    if (Number.isFinite(result?.applied)) return Math.max(0, result.applied);
    if (Array.isArray(result)) return result.filter((item) => ["applied", "filled", "success"].includes(item?.status)).length;
    return 0;
  }

  function needsUser(result) {
    if (!result || typeof result !== "object") return false;
    return Boolean(
      result.requiresDialog
      || result.siteConfirmationRequired
      || result.unknownDialog
      || result.status === "requires_dialog"
      || result.status === "site_confirmation_required"
    );
  }

  function assertActive(run) {
    if (activeRun !== run || run.cancelled || run.controller.signal.aborted) throw new Error("连续填写已停止");
    if (Date.now() >= run.deadline) {
      run.controller.abort("timeout");
      throw new Error("连续填写达到 60 秒上限");
    }
    if (String(globalThis.location?.href || "") !== run.startUrl) throw new Error("页面地址已变化，连续填写已暂停");
  }

  async function callStage(run, name, callback, value, context) {
    assertActive(run);
    const remaining = Math.max(1, run.deadline - Date.now());
    let timer;
    let abortHandler;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => callback(value, context)),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            run.controller.abort("timeout");
            reject(new Error(`${name}超时`));
          }, remaining);
        }),
        new Promise((_, reject) => {
          abortHandler = () => reject(new Error(run.controller.signal.reason === "timeout" ? `${name}超时` : "连续填写已停止"));
          run.controller.signal.addEventListener("abort", abortHandler, { once: true });
        }),
      ]);
      assertActive(run);
      return result;
    } finally {
      clearTimeout(timer);
      if (abortHandler) run.controller.signal.removeEventListener("abort", abortHandler);
    }
  }

  async function run(callbacks, options = {}) {
    if (![callbacks?.scan, callbacks?.match, callbacks?.apply].every((callback) => typeof callback === "function")) {
      throw new Error("连续填写需要 scan、match、apply 回调");
    }
    if (!Array.isArray(options.approvedSourcePaths)) throw new Error("连续填写缺少用户已确认的资料范围");
    if (activeRun) {
      activeRun.cancelled = true;
      activeRun.controller.abort("replaced");
    }
    const maxRounds = Math.min(MAX_ROUNDS, Math.max(1, Number.isInteger(options.maxRounds) ? options.maxRounds : MAX_ROUNDS));
    const durationMs = Math.min(MAX_DURATION_MS, Math.max(100, Number.isFinite(options.timeoutMs) ? options.timeoutMs : MAX_DURATION_MS));
    const session = {
      cancelled: false,
      controller: new AbortController(),
      startUrl: String(globalThis.location?.href || ""),
      deadline: Date.now() + durationMs,
    };
    activeRun = session;
    const approved = new Set(options.approvedSourcePaths.filter((path) => typeof path === "string" && path));
    const failed = new Set();
    const rounds = [];
    let previousPlan = "";

    try {
      callbacks.onProgress?.({ status: "started", maxRounds, durationMs });
      for (let round = 1; round <= maxRounds; round += 1) {
        const context = { round, maxRounds, signal: session.controller.signal, failedSignatures: new Set(failed), approvedSourcePaths: new Set(approved) };
        const scanResult = await callStage(session, "扫描", callbacks.scan, context, context);
        const matchResult = await callStage(session, "匹配", callbacks.match, scanResult, context);
        const filtered = filterPlan(matchResult, failed, approved);
        const planSignature = plainSignature(filtered.plan);
        if (!filtered.count) {
          rounds.push({ round, status: "no_candidates" });
          return { ok: true, status: "complete", rounds, failed: failed.size };
        }
        if (planSignature === previousPlan) {
          rounds.push({ round, status: "repeated_plan", candidates: filtered.count });
          return { ok: true, status: "stalled", reason: "repeated_plan", rounds, failed: failed.size };
        }
        previousPlan = planSignature;
        const applyResult = await callStage(session, "填写", callbacks.apply, filtered.plan, context);
        if (needsUser(applyResult)) {
          rounds.push({ round, status: "requires_user", candidates: filtered.count });
          return { ok: true, status: "requires_user", rounds, failed: failed.size };
        }
        const failures = resultFailures(applyResult);
        const attempted = planItems(filtered.plan).items;
        for (const failure of failures) {
          const failureId = failure?.fieldId ?? failure?.targetId ?? failure?.id;
          const matchingAttempt = attempted.find((item) => (item?.fieldId ?? item?.targetId ?? item?.id) === failureId);
          failed.add(itemSignature(matchingAttempt || failure));
        }
        const applied = appliedCount(applyResult);
        rounds.push({ round, status: applied ? "applied" : failures.length ? "failed" : "no_progress", candidates: filtered.count, applied, failed: failures.length });
        callbacks.onProgress?.({ status: "round", ...rounds.at(-1) });
        if (!applied) return { ok: true, status: failures.length ? "stalled" : "complete", rounds, failed: failed.size };
        if (typeof callbacks.settle === "function") await callStage(session, "等待页面稳定", callbacks.settle, context, context);
      }
      return { ok: true, status: "round_limit", rounds, failed: failed.size };
    } finally {
      session.cancelled = true;
      session.controller.abort("finished");
      if (activeRun === session) activeRun = null;
      callbacks.onProgress?.({ status: "finished", rounds: rounds.length });
    }
  }

  globalThis[API_KEY] = {
    run,
    cancel() {
      if (!activeRun) return false;
      activeRun.cancelled = true;
      activeRun.controller.abort("cancelled");
      return true;
    },
  };
})();
