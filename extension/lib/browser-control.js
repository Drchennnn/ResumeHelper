import {planVisualAction as defaultPlanVisualAction} from './ai.js';

const PROTOCOL_VERSION = '1.3';
const MAX_VISUAL_STEPS = 8;
const MAX_SCROLL_DELTA = 600;
const TEXT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'number', 'textarea', 'contenteditable']);
const PICKER_TYPES = new Set(['select', 'select-one', 'select-multiple', 'combobox', 'date', 'month', 'date-picker', 'date-range']);
const BLOCKED_LABEL = /(?:提交|保存|确认投递|申请职位|删除|注销|同意|协议|条款|隐私|授权|上传|附件|文件|密码|验证码|支付|银行卡)/i;
const activeControls = new Map();

const result = (status, reason = '', extra = {}) => ({ok: status === 'applied', status, ...(reason ? {reason} : {}), ...extra});
const normalized = value => String(value ?? '').toLowerCase().replace(/[\s\u3000\-_/：:，,。.()（）\[\]]+/g, '');
const finite = value => Number.isFinite(Number(value));

function apiFrom(deps = {}) {
  return deps.chrome || globalThis.chrome;
}

function safeRect(rect) {
  if (!rect || !['x', 'y', 'width', 'height'].every(key => finite(rect[key]))) return null;
  const value = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(rect[key])]));
  return value.width > 0 && value.height > 0 ? value : null;
}

function pointInViewport(point, viewport) {
  return finite(point?.x) && finite(point?.y) && point.x >= 0 && point.y >= 0 && point.x <= Number(viewport?.width) && point.y <= Number(viewport?.height);
}

function center(rect) {
  return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
}

function aborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error('浏览器输入已取消'), {name: 'AbortError'});
}

async function sendTabMessage(chromeApi, tabId, message, signal, allowFailure = false) {
  aborted(signal);
  const response = await chromeApi.tabs.sendMessage(tabId, message);
  aborted(signal);
  if (!response || (!allowFailure && response.ok !== true)) throw new Error(response?.error || response?.reason || '页面没有响应浏览器输入请求');
  return response;
}

export async function getBrowserControlPermissionState(deps = {}) {
  const chromeApi = apiFrom(deps);
  const supported = !!(chromeApi?.permissions?.contains && chromeApi?.debugger?.attach && chromeApi?.debugger?.sendCommand);
  if (!supported) return {supported: false, granted: false};
  return {supported: true, granted: !!(await chromeApi.permissions.contains({permissions: ['debugger']}))};
}

export async function hasBrowserControlPermission(deps = {}) {
  return (await getBrowserControlPermissionState(deps)).granted;
}

export function stopBrowserControl(tabId) {
  if (tabId == null) {
    const controllers = [...activeControls.values()];
    for (const controller of controllers) controller.abort();
    return controllers.length > 0;
  }
  const controller = activeControls.get(Number(tabId));
  if (!controller) return false;
  controller.abort();
  return true;
}

async function ensureDebuggerAvailable(chromeApi, tabId) {
  if (!chromeApi.debugger.getTargets) return;
  const targets = await chromeApi.debugger.getTargets();
  if (targets.some(target => target.tabId === tabId && target.attached)) {
    throw Object.assign(new Error('该页面已有开发者工具或其他调试连接，请关闭后重试'), {code: 'debugger_busy'});
  }
}

function validateTarget(target, fieldId, overwrite) {
  if (!target || String(target.fieldId) !== String(fieldId)) throw Object.assign(new Error('页面返回了不一致的字段目标'), {code: 'target_mismatch'});
  if ((target.nonempty ?? target.nonEmpty) && !overwrite) throw Object.assign(new Error('字段已有内容，未覆盖'), {code: 'non_empty'});
  if (target.blocked || BLOCKED_LABEL.test(`${target.label || ''} ${target.section || ''}`)) {
    const reason = ['non_empty', 'unknown_field', 'detached_field', 'ambiguous_field', 'unavailable_field'].includes(target.reason)
      ? target.reason : 'unsafe_target';
    throw Object.assign(new Error(target.reason || '该区域不允许自动操作'), {code: reason});
  }
  const rect = safeRect(target.rect);
  const viewport = target.viewport;
  if (!rect || !finite(viewport?.width) || !finite(viewport?.height) || !pointInViewport(center(rect), viewport)) {
    throw Object.assign(new Error('字段不在当前可操作视口内'), {code: 'target_out_of_view'});
  }
  const type = String(target.type || '').toLowerCase();
  if (!TEXT_TYPES.has(type) && !PICKER_TYPES.has(type)) throw Object.assign(new Error('该字段类型不允许浏览器输入'), {code: 'unsupported_control'});
  return {...target, type, rect, viewport: {width: Number(viewport.width), height: Number(viewport.height)}};
}

async function guardPoint(chromeApi, tabId, fieldId, point, signal, candidateId) {
  const response = await sendTabMessage(chromeApi, tabId, {type: 'CONTROL_GUARD', fieldId, x: point.x, y: point.y, ...(candidateId ? {candidateId} : {})}, signal);
  if (!response.allowed) throw Object.assign(new Error(response.reason || '页面安全检查拒绝了该点击'), {code: 'unsafe_action'});
}

async function command(chromeApi, debuggee, method, params, signal) {
  aborted(signal);
  const value = await chromeApi.debugger.sendCommand(debuggee, method, params);
  aborted(signal);
  return value;
}

async function clickPoint(chromeApi, debuggee, tabId, fieldId, point, signal, candidateId) {
  await guardPoint(chromeApi, tabId, fieldId, point, signal, candidateId);
  await command(chromeApi, debuggee, 'Input.dispatchMouseEvent', {type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1}, signal);
  await command(chromeApi, debuggee, 'Input.dispatchMouseEvent', {type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1}, signal);
}

async function verify(chromeApi, tabId, fieldId, value, signal) {
  const response = await sendTabMessage(chromeApi, tabId, {type: 'CONTROL_VERIFY', fieldId, value}, signal);
  return {verified: !!(response.verified ?? response.matched), actual: response.actual, reason: response.reason};
}

async function fillText(chromeApi, debuggee, tabId, target, value, signal) {
  await clickPoint(chromeApi, debuggee, tabId, target.fieldId, center(target.rect), signal);
  await command(chromeApi, debuggee, 'Input.dispatchKeyEvent', {type: 'rawKeyDown', key: 'a', code: 'KeyA', commands: ['selectAll']}, signal);
  await command(chromeApi, debuggee, 'Input.dispatchKeyEvent', {type: 'keyUp', key: 'a', code: 'KeyA'}, signal);
  await command(chromeApi, debuggee, 'Input.insertText', {text: value}, signal);
  await command(chromeApi, debuggee, 'Input.dispatchKeyEvent', {type: 'rawKeyDown', key: 'Tab', code: 'Tab'}, signal);
  await command(chromeApi, debuggee, 'Input.dispatchKeyEvent', {type: 'keyUp', key: 'Tab', code: 'Tab'}, signal);
  return verify(chromeApi, tabId, target.fieldId, value, signal);
}

function optionsFrom(response) {
  const list = Array.isArray(response?.options) ? response.options : Array.isArray(response?.candidates) ? response.candidates : [];
  return list.map(option => ({...option, id: String(option.id || ''), label: String(option.label || ''), rect: safeRect(option.rect)}))
    .filter(option => option.id && option.label && option.rect && !option.disabled && !BLOCKED_LABEL.test(option.label));
}

function dateParts(value) {
  const match = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) return [];
  return [match[1], `${Number(match[2])}`, match[3] ? `${Number(match[3])}` : ''].filter(Boolean);
}

function chooseOption(options, value, history) {
  const wanted = normalized(value);
  const unused = options.filter(option => !history.some(item => item.candidateId === option.id));
  const exact = unused.find(option => normalized(option.label) === wanted || normalized(option.id) === wanted);
  if (exact) return exact;
  const parts = [...dateParts(value), ...String(value).split(/[\/／>＞;；,，]+/).map(part => part.trim()).filter(Boolean)];
  for (const part of parts) {
    const key = normalized(part);
    const found = unused.find(option => {
      const label = normalized(option.label);
      return label === key || label === `${key}年` || label === `${key}月` || label === `${key}日`;
    });
    if (found) return found;
  }
  return unused.find(option => normalized(option.label).length >= 2 && wanted.includes(normalized(option.label))) || null;
}

async function waitForUi(deps, signal) {
  aborted(signal);
  if (deps.wait) await deps.wait();
  else await new Promise(resolve => setTimeout(resolve, 80));
  aborted(signal);
}

async function tryDomOptions(chromeApi, debuggee, tabId, target, value, history, deps, signal) {
  await clickPoint(chromeApi, debuggee, tabId, target.fieldId, center(target.rect), signal);
  for (let step = 0; step < MAX_VISUAL_STEPS; step++) {
    await waitForUi(deps, signal);
    const state = await sendTabMessage(chromeApi, tabId, {type: 'CONTROL_OPTIONS', fieldId: target.fieldId}, signal);
    const option = chooseOption(optionsFrom(state), value, history);
    if (!option) return {verified: false, state};
    await clickPoint(chromeApi, debuggee, tabId, target.fieldId, center(option.rect), signal, option.id);
    history.push({action: 'click', candidateId: option.id, label: option.label});
    await waitForUi(deps, signal);
    const checked = await verify(chromeApi, tabId, target.fieldId, value, signal);
    if (checked.verified) return checked;
  }
  return {verified: false};
}

function pngSize(base64) {
  try {
    const binary = atob(base64.slice(0, 64));
    if (binary.length < 24 || binary.slice(1, 4) !== 'PNG') return {};
    const read = offset => ((binary.charCodeAt(offset) << 24) | (binary.charCodeAt(offset + 1) << 16) | (binary.charCodeAt(offset + 2) << 8) | binary.charCodeAt(offset + 3)) >>> 0;
    return {imageWidth: read(16), imageHeight: read(20)};
  } catch { return {}; }
}

function visualPoint(plan, candidates, viewport) {
  if (plan.candidateId) {
    const candidate = candidates.find(item => item.id === String(plan.candidateId));
    if (!candidate) throw Object.assign(new Error('视觉模型引用了不存在的候选项'), {code: 'unsafe_action'});
    return {...center(candidate.rect), candidateId: candidate.id};
  }
  if (!finite(plan.x) || !finite(plan.y)) throw Object.assign(new Error('视觉模型没有返回有效点击坐标'), {code: 'unsafe_action'});
  const point = plan.coordinateSpace === 'css'
    ? {x: Number(plan.x), y: Number(plan.y)}
    : {x: viewport.originX + Number(plan.x) / viewport.scaleX, y: viewport.originY + Number(plan.y) / viewport.scaleY};
  if (!pointInViewport(point, viewport)) throw Object.assign(new Error('视觉模型点击坐标超出视口'), {code: 'unsafe_action'});
  return point;
}

async function tryVision(chromeApi, debuggee, tabId, target, value, history, settings, deps, signal) {
  const planner = deps.planVisualAction || defaultPlanVisualAction;
  if (typeof planner !== 'function') return {verified: false, reason: 'vision_unavailable'};
  for (let step = 0; step < MAX_VISUAL_STEPS; step++) {
    aborted(signal);
    const state = await sendTabMessage(chromeApi, tabId, {type: 'CONTROL_OPTIONS', fieldId: target.fieldId}, signal);
    const candidates = optionsFrom(state);
    const rects = [target.rect, state.pickerRect, ...(Array.isArray(state.regions) ? state.regions : []), ...candidates.map(item => item.rect)];
    // Keep the screenshot coordinate origin aligned with the CSS viewport. The
    // action planner still receives only the verified target/picker regions.
    const clip = {x: 0, y: 0, width: target.viewport.width, height: target.viewport.height, scale: 1};
    const shot = await command(chromeApi, debuggee, 'Page.captureScreenshot', {format: 'png', fromSurface: true, captureBeyondViewport: false, clip}, signal);
    if (!shot?.data) throw new Error('浏览器没有返回页面截图');
    const size = pngSize(shot.data);
    const viewport = {...target.viewport, ...size, originX: clip.x, originY: clip.y};
    viewport.imageWidth ||= clip.width;
    viewport.imageHeight ||= clip.height;
    viewport.scaleX = viewport.imageWidth / clip.width;
    viewport.scaleY = viewport.imageHeight / clip.height;
    const plan = await planner({image: `data:image/png;base64,${shot.data}`, field: {id: target.fieldId, type: target.type, label: target.label, section: target.section}, value, candidates, regions: rects.map(safeRect).filter(Boolean), history: history.slice(), viewport}, settings);
    aborted(signal);
    if (!plan || plan.action === 'manual') return {verified: false, reason: plan?.reason || 'visual_manual_required'};
    if (plan.action === 'done') return {...await verify(chromeApi, tabId, target.fieldId, value, signal), method: 'vision'};
    if (plan.action === 'scroll') {
      const deltaY = Math.max(-MAX_SCROLL_DELTA, Math.min(MAX_SCROLL_DELTA, Number(plan.deltaY)));
      if (!Number.isFinite(deltaY) || deltaY === 0) return {verified: false, reason: 'invalid_visual_scroll'};
      const point = center(target.rect);
      await guardPoint(chromeApi, tabId, target.fieldId, point, signal);
      await command(chromeApi, debuggee, 'Input.dispatchMouseEvent', {type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY}, signal);
      history.push({action: 'scroll', deltaY});
    } else if (plan.action === 'click') {
      const point = visualPoint(plan, candidates, viewport);
      await clickPoint(chromeApi, debuggee, tabId, target.fieldId, point, signal, point.candidateId);
      history.push({action: 'click', candidateId: point.candidateId || '', x: point.x, y: point.y});
    } else {
      return {verified: false, reason: 'invalid_visual_action'};
    }
    await waitForUi(deps, signal);
    const checked = await verify(chromeApi, tabId, target.fieldId, value, signal);
    if (checked.verified) return {...checked, method: 'vision'};
  }
  return {verified: false, reason: 'control_step_limit'};
}

export async function fillWithBrowserControl({tabId, fieldId, value, overwrite = false, vision = false, settings, signal} = {}, deps = {}) {
  tabId = Number(tabId);
  fieldId = String(fieldId || '');
  if (!Number.isInteger(tabId) || tabId < 0 || !fieldId || typeof value !== 'string') return result('failed', 'invalid_request');
  if (activeControls.has(tabId)) return result('failed', 'control_busy');
  const chromeApi = apiFrom(deps);
  const ownController = new AbortController();
  const onAbort = () => ownController.abort();
  if (signal?.aborted) ownController.abort();
  signal?.addEventListener?.('abort', onAbort, {once: true});
  activeControls.set(tabId, ownController);
  const controlSignal = ownController.signal;
  const debuggee = {tabId};
  let attached = false;
  try {
    const permission = await getBrowserControlPermissionState({chrome: chromeApi});
    if (!permission.supported) return result('failed', 'debugger_unavailable');
    if (!permission.granted) return result('failed', 'debugger_permission_required');
    const prepared = await sendTabMessage(chromeApi, tabId, {type: 'CONTROL_TARGET', fieldId, overwrite}, controlSignal, true);
    let target;
    try { target = validateTarget(prepared.target || prepared, fieldId, overwrite); }
    catch (error) { return result(error.code === 'non_empty' ? 'skipped' : 'failed', error.code || 'unsafe_target'); }
    await ensureDebuggerAvailable(chromeApi, tabId);
    aborted(controlSignal);
    try { await chromeApi.debugger.attach(debuggee, PROTOCOL_VERSION); attached = true; }
    catch (error) {
      if (/already attached|another debugger|debugger.*attached/i.test(error?.message || '')) return result('failed', 'debugger_busy');
      return result('failed', 'debugger_unavailable', {error: error?.message || String(error)});
    }
    let checked;
    if (TEXT_TYPES.has(target.type)) checked = await fillText(chromeApi, debuggee, tabId, target, value, controlSignal);
    else {
      const history = [];
      checked = await tryDomOptions(chromeApi, debuggee, tabId, target, value, history, deps, controlSignal);
      if (!checked.verified && vision) checked = await tryVision(chromeApi, debuggee, tabId, target, value, history, settings, deps, controlSignal);
    }
    return checked.verified
      ? result('applied', '', {method: checked.method || 'browser-control', actual: checked.actual})
      : result('failed', checked.reason || 'value_mismatch', {actual: checked.actual});
  } catch (error) {
    if (error?.name === 'AbortError') return result('skipped', 'cancelled');
    return result('failed', error?.code || 'browser_control_failed', {error: error?.message || String(error)});
  } finally {
    if (attached) {
      try { await chromeApi.debugger.detach(debuggee); } catch {}
    }
    signal?.removeEventListener?.('abort', onAbort);
    if (activeControls.get(tabId) === ownController) activeControls.delete(tabId);
  }
}
