const frameCaches = new Map();
const operationEpochs = new Map();

function chromeApi() {
  if (!globalThis.chrome?.scripting || !globalThis.chrome?.tabs) {
    throw new Error("chrome_frame_api_unavailable");
  }
  return globalThis.chrome;
}

function frameTarget(tabId, frame) {
  const target = { tabId };
  if (frame.documentId) target.documentIds = [frame.documentId];
  else target.frameIds = [frame.frameId];
  return target;
}

function messageOptions(frame) {
  const options = { frameId: frame.frameId };
  if (frame.documentId) options.documentId = frame.documentId;
  return options;
}

function warning(code, details = {}) {
  return { code, ...details };
}

function globalFieldId(frameId, localId) {
  return `f${frameId}:${localId}`;
}

function safeOrigin(url) {
  try { return new URL(url).origin; } catch (error) { return ""; }
}

async function installFrameScripts(tabId) {
  const chrome = chromeApi();
  const warnings = [];
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["editor-bridge.js"],
      world: "MAIN",
    });
  } catch (error) {
    warnings.push(warning("editor_bridge_partial", { message: String(error?.message || error) }));
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["site-adapters.js", "content.js"],
      world: "ISOLATED",
    });
  } catch (error) {
    warnings.push(warning("frame_access_partial", { message: String(error?.message || error) }));
  }
  return warnings;
}

function scanInFrame() {
  const scan = globalThis.__personalResumeBridge?.scan?.();
  if (!scan) return null;
  const childFrames = Array.from(document.querySelectorAll?.("iframe,frame") || []).map((frame) => ({
    url: String(frame.src || frame.getAttribute?.("src") || ""),
  })).filter((frame) => frame.url);
  return { ...scan, childFrames };
}

export async function scanAllFrames(tabId) {
  const chrome = chromeApi();
  const warnings = await installFrameScripts(tabId);
  let injections;
  try {
    injections = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: scanInFrame,
      world: "ISOLATED",
    });
  } catch (error) {
    frameCaches.delete(tabId);
    return {
      fields: [],
      frames: [],
      warnings: [...warnings, warning("frame_scan_failed", { message: String(error?.message || error) })],
    };
  }

  const fieldCache = new Map();
  const frames = [];
  const fields = [];
  const accessibleUrls = new Set();
  for (const injection of injections || []) {
    const scan = injection?.result;
    if (!scan || !Array.isArray(scan.fields)) continue;
    const frame = {
      frameId: Number(injection.frameId || 0),
      documentId: typeof injection.documentId === "string" ? injection.documentId : "",
      url: String(scan.url || ""),
      title: String(scan.title || ""),
      childFrames: Array.isArray(scan.childFrames) ? scan.childFrames : [],
    };
    frames.push({ ...frame, fieldCount: scan.fields.length });
    if (frame.url) accessibleUrls.add(frame.url);
    for (const field of scan.fields) {
      if (!field || typeof field.id !== "string") continue;
      const id = globalFieldId(frame.frameId, field.id);
      const decorated = {
        ...field,
        id,
        frameId: frame.frameId,
        documentId: frame.documentId || undefined,
        frameUrl: frame.url,
      };
      fields.push(decorated);
      fieldCache.set(id, { frame, localFieldId: field.id });
    }
  }

  const seenWarnings = new Set();
  for (const frame of frames) {
    const parentOrigin = safeOrigin(frame.url);
    for (const child of frame.childFrames) {
      const childUrl = String(child?.url || "");
      if (!childUrl || accessibleUrls.has(childUrl)) continue;
      const childOrigin = safeOrigin(childUrl);
      if (!childOrigin || childOrigin === parentOrigin) continue;
      const key = `${frame.frameId}:${childOrigin}`;
      if (seenWarnings.has(key)) continue;
      seenWarnings.add(key);
      warnings.push(warning("cross_origin_frame_unavailable", {
        parentFrameId: frame.frameId,
        origin: childOrigin,
      }));
    }
  }
  frameCaches.set(tabId, { fields: fieldCache, frames, scannedAt: Date.now() });
  return {
    fields,
    frames: frames.map(({ childFrames, ...frame }) => frame),
    warnings,
  };
}

async function verifiedFrameScan(tabId, frame) {
  const chrome = chromeApi();
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "SCAN" }, messageOptions(frame));
    if (!response || String(response.url || "") !== frame.url) return null;
    return response;
  } catch (error) {
    return null;
  }
}

export async function applyFrameItems(tabId, items, options = {}) {
  const chrome = chromeApi();
  const cache = frameCaches.get(tabId);
  const epoch = (operationEpochs.get(tabId) || 0) + 1;
  operationEpochs.set(tabId, epoch);
  const results = [];
  const warnings = [];
  if (!cache || !Array.isArray(items)) {
    return { results, warnings: [warning("frame_scan_required")] };
  }
  const groups = new Map();
  for (const item of items) {
    const globalId = typeof item?.fieldId === "string" ? item.fieldId : "";
    const trusted = cache.fields.get(globalId);
    if (!trusted) {
      results.push({ fieldId: globalId, status: "skipped", reason: "unknown_frame_field" });
      continue;
    }
    const key = trusted.frame.documentId || `frame-${trusted.frame.frameId}`;
    if (!groups.has(key)) groups.set(key, { frame: trusted.frame, items: [] });
    groups.get(key).items.push({ globalId, localFieldId: trusted.localFieldId, item });
  }

  for (const group of groups.values()) {
    if (operationEpochs.get(tabId) !== epoch) {
      for (const entry of group.items) results.push({fieldId:entry.globalId,status:"skipped",reason:"cancelled"});
      continue;
    }
    const current = await verifiedFrameScan(tabId, group.frame);
    if (operationEpochs.get(tabId) !== epoch) {
      for (const entry of group.items) results.push({fieldId:entry.globalId,status:"skipped",reason:"cancelled"});
      continue;
    }
    if (!current) {
      for (const entry of group.items) {
        results.push({ fieldId: entry.globalId, status: "skipped", reason: "frame_document_changed" });
      }
      warnings.push(warning("frame_document_changed", { frameId: group.frame.frameId }));
      continue;
    }
    const frameOptions = {
      ...options,
      browserControl: group.frame.frameId === 0 && options.browserControl === true,
      frameRouted: true,
    };
    let response;
    try {
      response = await chrome.tabs.sendMessage(tabId, {
        type: "APPLY",
        items: group.items.map(({ localFieldId, item }) => ({ ...item, fieldId: localFieldId })),
        overwrite: options.overwrite === true,
        options: frameOptions,
      }, messageOptions(group.frame));
    } catch (error) {
      response = null;
    }
    const returned = Array.isArray(response?.results) ? response.results : [];
    group.items.forEach((entry, index) => {
      let result = returned[index] || { status: "failed", reason: "frame_apply_failed" };
      if (group.frame.frameId !== 0 && options.browserControl === true && result.status !== "applied" &&
        !["non_empty", "cancelled", "too_long"].includes(result.reason)) {
        result = { status: "skipped", reason: "iframe_control_requires_manual" };
      }
      results.push({ ...result, fieldId: entry.globalId });
    });
  }
  return { results, warnings };
}

export async function cancelFrameOperations(tabId) {
  operationEpochs.set(tabId,(operationEpochs.get(tabId)||0)+1);
  const chrome = chromeApi();
  const cache = frameCaches.get(tabId);
  const frames = cache?.frames || [{ frameId: 0, documentId: "" }];
  const results = [];
  const warnings = [];
  for (const frame of frames) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: "CANCEL" }, messageOptions(frame));
      results.push({ frameId: frame.frameId, cancelled: result?.cancelled === true });
    } catch (error) {
      warnings.push(warning("frame_cancel_failed", { frameId: frame.frameId }));
    }
  }
  return { cancelled: results.some((result) => result.cancelled), results, warnings };
}

export function clearFrameCache(tabId) {
  frameCaches.delete(tabId);
  operationEpochs.delete(tabId);
}

export const frameRouterInternals = { globalFieldId, scanInFrame, frameTarget };
