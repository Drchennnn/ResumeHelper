const DB_NAME = 'personalResumeAttachmentsV1';
const DB_VERSION = 1;
const STORE_NAME = 'attachments';

export const ATTACHMENT_KINDS = Object.freeze(['resume', 'transcript', 'certificate', 'other']);
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 30 * 1024 * 1024;

const kindSet = new Set(ATTACHMENT_KINDS);
const requestValue = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
});
const transactionDone = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
  transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
});

function cleanText(value, label, max = 240) {
  const result = String(value || '').trim();
  if (!result || result.length > max || /[\0\r\n]/.test(result)) throw new Error(`${label}无效`);
  return result;
}

function normalizeKind(kind) {
  const value = String(kind || '').trim();
  if (!kindSet.has(value)) throw new Error('附件分类无效');
  return value;
}

function normalizeSize(value) {
  if (value == null || value === '') return null;
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('附件大小无效');
  if (size > MAX_ATTACHMENT_BYTES) throw new Error('单个附件不能超过 10 MB');
  return size;
}

function publicRecord(record) {
  return {
    id: record.id,
    resumeId: record.resumeId,
    kind: record.kind,
    source: record.source,
    name: record.name,
    mime: record.mime || '',
    size: record.size ?? null,
    lastModified: record.lastModified ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export function validateAbsoluteAttachmentPath(value) {
  const path = String(value || '');
  if (!path || path !== path.trim() || path.length > 4096 || /[\0\r\n]/.test(path) || /[\\/]$/.test(path)) throw new Error('本地文件路径无效');
  if ((/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) || /[*?\[\]{}]/.test(path)) throw new Error('请输入不含 URL 或通配符的绝对路径');
  const absolute = path.startsWith('/') || /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\');
  if (!absolute) throw new Error('请输入绝对文件路径');
  const name = path.split(/[\\/]/).filter(Boolean).at(-1);
  if (!name || name === '.' || name === '..') throw new Error('本地文件路径必须指向文件');
  return path;
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function openAttachmentDatabase(indexedDb = globalThis.indexedDB) {
  if (!indexedDb?.open) return Promise.reject(new Error('当前环境不支持 IndexedDB'));
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, {keyPath: 'id'});
      if (!store.indexNames.contains('resumeId')) store.createIndex('resumeId', 'resumeId', {unique: false});
      if (!store.indexNames.contains('resumeKind')) store.createIndex('resumeKind', ['resumeId', 'kind'], {unique: false});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开附件数据库'));
    request.onblocked = () => reject(new Error('附件数据库正被其他页面占用'));
  });
}

async function withStore(mode, run, deps = {}) {
  const db = await openAttachmentDatabase(deps.indexedDB);
  try {
    const transaction = db.transaction(STORE_NAME, mode);
    const result = await run(transaction.objectStore(STORE_NAME), transaction);
    if (mode === 'readwrite') await transactionDone(transaction);
    return result;
  } finally {
    db.close();
  }
}

async function allRecords(deps = {}) {
  return withStore('readonly', store => requestValue(store.getAll()), deps);
}

async function underStorageLock(run) {
  return globalThis.navigator?.locks?.request
    ? navigator.locks.request('personal-resume-attachments', run)
    : run();
}

function currentKnownBytes(records) {
  return records.reduce((total, record) => total + (Number.isSafeInteger(record.size) ? record.size : 0), 0);
}

async function saveRecords(records, deps = {}) {
  return underStorageLock(async () => {
    const existing = await allRecords(deps);
    const replaced = new Set(records.map(record => record.id));
    const existingBytes = currentKnownBytes(existing.filter(record => !replaced.has(record.id)));
    const addedBytes = currentKnownBytes(records);
    if (existingBytes + addedBytes > MAX_ATTACHMENT_TOTAL_BYTES) throw new Error('附件库总大小不能超过 30 MB');
    await withStore('readwrite', store => {
      for (const record of records) store.put(record);
    }, deps);
    return records.map(publicRecord);
  });
}

export async function saveAttachmentFiles({resumeId, kind, files} = {}, deps = {}) {
  resumeId = cleanText(resumeId, '简历 ID', 160);
  kind = normalizeKind(kind);
  const values = Array.from(files || []);
  if (!values.length) throw new Error('请选择附件');
  const now = new Date().toISOString();
  const records = values.map(file => {
    if (!(file instanceof Blob)) throw new Error('附件必须是本地文件');
    const size = normalizeSize(file.size);
    const name = cleanText(file.name || 'attachment', '附件名称');
    return {
      id: randomId(), resumeId, kind, source: 'blob', name,
      mime: String(file.type || '').slice(0, 160), size,
      lastModified: Number.isFinite(file.lastModified) ? Number(file.lastModified) : null,
      blob: file, createdAt: now, updatedAt: now
    };
  });
  return saveRecords(records, deps);
}

export async function saveAttachmentPath({resumeId, kind, path, name, mime = '', size = null} = {}, deps = {}) {
  resumeId = cleanText(resumeId, '简历 ID', 160);
  kind = normalizeKind(kind);
  path = validateAbsoluteAttachmentPath(path);
  size = normalizeSize(size);
  const inferredName = path.split(/[\\/]/).filter(Boolean).at(-1);
  const now = new Date().toISOString();
  const record = {
    id: randomId(), resumeId, kind, source: 'path',
    name: cleanText(name || inferredName, '附件名称'),
    mime: String(mime || '').trim().slice(0, 160), size,
    lastModified: null, path, createdAt: now, updatedAt: now
  };
  return (await saveRecords([record], deps))[0];
}

export async function listAttachments({resumeId, kind} = {}, deps = {}) {
  const records = await allRecords(deps);
  const filtered = records.filter(record =>
    (!resumeId || record.resumeId === String(resumeId)) && (!kind || record.kind === String(kind))
  );
  return filtered.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(publicRecord);
}

// Background-only access. Never return this value to content scripts.
export async function getAttachmentForUpload(id, deps = {}) {
  id = cleanText(id, '附件 ID', 200);
  const record = await withStore('readonly', store => requestValue(store.get(id)), deps);
  if (!record) throw new Error('附件不存在或已删除');
  return record;
}

export async function deleteAttachment(id, deps = {}) {
  id = cleanText(id, '附件 ID', 200);
  await withStore('readwrite', store => store.delete(id), deps);
  return true;
}
