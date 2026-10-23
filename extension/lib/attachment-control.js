import {getAttachmentForUpload, MAX_ATTACHMENT_BYTES, validateAbsoluteAttachmentPath} from './attachments.js';

const PROTOCOL_VERSION = '1.3';
const TARGET_ID = /^rh-upload-[a-z0-9-]{8,120}$/i;
const activeTabs = new Set();

const result = (ok, status, extra = {}) => ({ok, status, ...extra});

function apiFrom(deps = {}) {
  return deps.chrome || globalThis.chrome;
}

function cleanTargetId(targetId) {
  const value = String(targetId || '');
  if (!TARGET_ID.test(value)) throw Object.assign(new Error('文件控件标识无效'), {code: 'invalid_target'});
  return value;
}

function extensionOf(name) {
  const match = /(?:^|\/)([^/]+)$/.exec(String(name || '').replaceAll('\\', '/'));
  const dot = match?.[1]?.lastIndexOf('.') ?? -1;
  return dot > 0 ? match[1].slice(dot).toLowerCase() : '';
}

function mimeFromName(name) {
  return ({
    '.pdf': 'application/pdf', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.txt': 'text/plain', '.zip': 'application/zip'
  })[extensionOf(name)] || '';
}

export function attachmentMatchesAccept(attachment, accept = '') {
  const tokens = String(accept || '').split(',').map(token => token.trim().toLowerCase()).filter(Boolean);
  if (!tokens.length) return true;
  const mime = String(attachment?.mime || mimeFromName(attachment?.name) || '').toLowerCase();
  const extension = extensionOf(attachment?.name);
  return tokens.some(token => {
    if (token.startsWith('.')) return token === extension;
    if (token.endsWith('/*')) return !!mime && mime.startsWith(token.slice(0, -1));
    return !!mime && token === mime;
  });
}

function scanFileInputs() {
  const text = value => String(value || '').replace(/\s+/g, ' ').trim();
  const roots = [document], inputs = [];
  for (let cursor = 0; cursor < roots.length; cursor++) {
    const root = roots[cursor];
    inputs.push(...root.querySelectorAll('input[type="file"]'));
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
  }
  return inputs.map((input, index) => {
    let id = input.getAttribute('data-resume-helper-upload-id');
    if (!/^rh-upload-[a-z0-9-]{8,120}$/i.test(id || '')) {
      const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
      id = `rh-upload-${token}`;
      input.setAttribute('data-resume-helper-upload-id', id);
    }
    const explicit = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
    const wrapping = input.closest('label');
    const nearby = input.closest('[class*="upload"], [class*="file"], [role="group"], fieldset');
    const label = text(input.getAttribute('aria-label') || explicit?.innerText || wrapping?.innerText || nearby?.innerText || input.name || '文件上传').slice(0, 160);
    const rect = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    return {
      id, label, accept: input.accept || '', multiple: !!input.multiple, disabled: !!input.disabled,
      required: !!input.required, selectedCount: input.files?.length || 0,
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    };
  });
}

function inspectFileInput(targetId) {
  const roots = [document];
  let input = null;
  for (let cursor = 0; cursor < roots.length && !input; cursor++) {
    const root = roots[cursor];
    input = [...root.querySelectorAll('input[type="file"]')].find(item => item.getAttribute('data-resume-helper-upload-id') === targetId) || null;
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
  }
  if (!input) return {ok: false, reason: 'target_missing'};
  return {
    ok: true, id: targetId, accept: input.accept || '', multiple: !!input.multiple,
    disabled: !!input.disabled, selectedCount: input.files?.length || 0,
    selectedNames: [...(input.files || [])].map(file => file.name).slice(0, 20)
  };
}

function selectBlobFile(targetId, payload) {
  const roots = [document];
  let input = null;
  for (let cursor = 0; cursor < roots.length && !input; cursor++) {
    const root = roots[cursor];
    input = [...root.querySelectorAll('input[type="file"]')].find(item => item.getAttribute('data-resume-helper-upload-id') === targetId) || null;
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
  }
  if (!input || input.disabled) return {ok: false, reason: input ? 'target_disabled' : 'target_missing'};
  const tokens = String(input.accept || '').split(',').map(token => token.trim().toLowerCase()).filter(Boolean);
  const mime = String(payload.mime || '').toLowerCase();
  const name = String(payload.name || 'attachment');
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : '';
  if (tokens.length && !tokens.some(token => token.startsWith('.') ? token === extension : token.endsWith('/*') ? mime.startsWith(token.slice(0, -1)) : !!mime && token === mime)) {
    return {ok: false, reason: 'accept_mismatch'};
  }
  try {
    const binary = atob(payload.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const file = new File([bytes], name, {type: payload.mime || '', lastModified: payload.lastModified || Date.now()});
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
    input.dispatchEvent(new Event('change', {bubbles: true, composed: true}));
    return {ok: input.files?.length === 1 && input.files[0]?.name === name, selectedCount: input.files?.length || 0, selectedNames: [...(input.files || [])].map(item => item.name)};
  } catch (error) {
    return {ok: false, reason: 'selection_failed', error: error?.message || String(error)};
  }
}

async function execute(chromeApi, tabId, func, args = []) {
  const output = await chromeApi.scripting.executeScript({target: {tabId}, world: 'ISOLATED', func, args});
  return output?.[0]?.result;
}

export async function scanAttachmentTargets(tabId, deps = {}) {
  tabId = Number(tabId);
  if (!Number.isInteger(tabId) || tabId < 0) return result(false, 'invalid_request');
  try {
    const targets = await execute(apiFrom(deps), tabId, scanFileInputs);
    return result(true, 'scanned', {targets: Array.isArray(targets) ? targets : []});
  } catch (error) {
    return result(false, 'scan_failed', {error: error?.message || String(error)});
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

async function ensureDebuggerAvailable(chromeApi, tabId) {
  const granted = !chromeApi.permissions?.contains || await chromeApi.permissions.contains({permissions: ['debugger']});
  if (!granted) throw Object.assign(new Error('未授权浏览器文件输入控制'), {code: 'debugger_permission_required'});
  const targets = chromeApi.debugger.getTargets ? await chromeApi.debugger.getTargets() : [];
  if (targets.some(target => target.tabId === tabId && target.attached)) {
    throw Object.assign(new Error('该页面已有开发者工具或其他调试连接'), {code: 'debugger_busy'});
  }
}

function findFileInputNode(root, targetId) {
  const queue = [root], matches = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const node = queue[cursor];
    const attributes = {};
    for (let index = 0; index < (node.attributes?.length || 0); index += 2) attributes[node.attributes[index]] = node.attributes[index + 1];
    if (String(node.nodeName).toLowerCase() === 'input' && String(attributes.type).toLowerCase() === 'file' && attributes['data-resume-helper-upload-id'] === targetId) {
      matches.push(node.nodeId);
    }
    for (const key of ['children', 'shadowRoots', 'pseudoElements']) if (Array.isArray(node[key])) queue.push(...node[key]);
    for (const key of ['contentDocument', 'templateContent']) if (node[key]) queue.push(node[key]);
  }
  return matches;
}

async function selectPathFile(chromeApi, tabId, targetId, path) {
  await ensureDebuggerAvailable(chromeApi, tabId);
  const debuggee = {tabId};
  let attached = false;
  try {
    await chromeApi.debugger.attach(debuggee, PROTOCOL_VERSION);
    attached = true;
    await chromeApi.debugger.sendCommand(debuggee, 'DOM.enable');
    const document = await chromeApi.debugger.sendCommand(debuggee, 'DOM.getDocument', {depth: -1, pierce: true});
    const nodeIds = findFileInputNode(document.root, targetId);
    if (nodeIds.length !== 1) throw Object.assign(new Error('文件控件已变化，请重新扫描'), {code: nodeIds.length ? 'ambiguous_target' : 'target_missing'});
    await chromeApi.debugger.sendCommand(debuggee, 'DOM.setFileInputFiles', {files: [path], nodeId: nodeIds[0]});
  } finally {
    if (attached) {
      try { await chromeApi.debugger.detach(debuggee); } catch {}
    }
  }
}

export async function applyStoredAttachment({tabId, targetId, attachmentId} = {}, deps = {}) {
  tabId = Number(tabId);
  attachmentId = String(attachmentId || '');
  try { targetId = cleanTargetId(targetId); }
  catch (error) { return result(false, error.code || 'invalid_target'); }
  if (!Number.isInteger(tabId) || tabId < 0 || !attachmentId || attachmentId.length > 200) return result(false, 'invalid_request');
  if (activeTabs.has(tabId)) return result(false, 'attachment_control_busy');
  activeTabs.add(tabId);
  const chromeApi = apiFrom(deps);
  try {
    const attachment = await (deps.getAttachment || getAttachmentForUpload)(attachmentId, deps);
    if (!attachment || !['blob', 'path'].includes(attachment.source)) return result(false, 'invalid_attachment');
    if (attachment.size != null && attachment.size > MAX_ATTACHMENT_BYTES) return result(false, 'file_too_large');
    const target = await execute(chromeApi, tabId, inspectFileInput, [targetId]);
    if (!target?.ok) return result(false, target?.reason || 'target_missing');
    if (target.disabled) return result(false, 'target_disabled');
    if (target.selectedCount) return result(false, 'target_non_empty');
    const actualPathName = attachment.source === 'path' ? String(attachment.path || '').split(/[\\/]/).filter(Boolean).at(-1) : '';
    const checkedAttachment = attachment.source === 'path'
      ? {...attachment, name: actualPathName, mime: attachment.mime || mimeFromName(actualPathName)}
      : {...attachment, mime: attachment.mime || mimeFromName(attachment.name)};
    if (!attachmentMatchesAccept(checkedAttachment, target.accept)) return result(false, 'accept_mismatch', {accept: target.accept});

    let selected;
    if (attachment.source === 'blob') {
      if (!(attachment.blob instanceof Blob)) return result(false, 'attachment_data_missing');
      const base64 = arrayBufferToBase64(await attachment.blob.arrayBuffer());
      selected = await execute(chromeApi, tabId, selectBlobFile, [targetId, {
        base64, name: attachment.name, mime: checkedAttachment.mime || '', lastModified: attachment.lastModified || Date.now()
      }]);
      if (!selected?.ok) return result(false, selected?.reason || 'selection_failed', {error: selected?.error});
    } else {
      const path = validateAbsoluteAttachmentPath(attachment.path);
      await selectPathFile(chromeApi, tabId, targetId, path);
      selected = await execute(chromeApi, tabId, inspectFileInput, [targetId]);
      if (!selected?.ok || selected.selectedCount !== 1 || !selected.selectedNames?.includes(actualPathName)) {
        return result(false, selected?.reason || 'selection_not_confirmed');
      }
    }

    return result(true, 'selected_for_review', {
      attachment: {id: attachment.id, name: attachment.name, kind: attachment.kind},
      targetId, selectedCount: selected.selectedCount,
      selectedNames: selected.selectedNames || [],
      message: '文件已选择；网站是否完成接收仍需在页面复核。扩展未提交申请。'
    });
  } catch (error) {
    return result(false, error?.code || 'attachment_apply_failed', {error: error?.message || String(error)});
  } finally {
    activeTabs.delete(tabId);
  }
}

export const ATTACHMENT_MESSAGE_PROTOCOL = Object.freeze({
  list: 'ATTACHMENTS_LIST',
  saveFiles: 'ATTACHMENTS_SAVE_FILES',
  savePath: 'ATTACHMENTS_SAVE_PATH',
  remove: 'ATTACHMENTS_DELETE',
  targets: 'ATTACHMENT_TARGETS',
  apply: 'ATTACHMENT_APPLY'
});
