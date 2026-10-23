import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteAttachment, getAttachmentForUpload, listAttachments,
  MAX_ATTACHMENT_BYTES, saveAttachmentFiles, saveAttachmentPath,
  validateAbsoluteAttachmentPath
} from '../extension/lib/attachments.js';

function asyncRequest(value) {
  const request = {};
  setTimeout(() => { request.result = value; request.onsuccess?.(); }, 0);
  return request;
}

function fakeIndexedDB() {
  const records = new Map();
  let database;
  const store = {
    indexNames: {contains: () => false},
    createIndex() {},
    getAll: () => asyncRequest([...records.values()]),
    get: id => asyncRequest(records.get(id)),
    put(record) { records.set(record.id, structuredClone(record)); return asyncRequest(record.id); },
    delete(id) { records.delete(id); return asyncRequest(undefined); }
  };
  const makeTransaction = () => {
    const transaction = {objectStore: () => store};
    setTimeout(() => transaction.oncomplete?.(), 2);
    return transaction;
  };
  database = {
    objectStoreNames: {contains: () => true},
    createObjectStore: () => store,
    transaction: makeTransaction,
    close() {}
  };
  return {
    records,
    open() {
      const request = {};
      setTimeout(() => { request.result = database; request.onsuccess?.(); }, 0);
      return request;
    }
  };
}

test('validates local absolute paths and rejects URL, relative and glob input', () => {
  assert.equal(validateAbsoluteAttachmentPath('/Users/test/resume.pdf'), '/Users/test/resume.pdf');
  assert.equal(validateAbsoluteAttachmentPath('C:\\Users\\test\\resume.pdf'), 'C:\\Users\\test\\resume.pdf');
  for (const invalid of ['resume.pdf', 'file:///tmp/resume.pdf', 'https://example.test/resume.pdf', '/tmp/*.pdf', '/tmp/a[1].pdf', '/tmp/']) {
    assert.throws(() => validateAbsoluteAttachmentPath(invalid));
  }
});

test('stores file bytes in IndexedDB while public metadata omits bytes and paths', async () => {
  const indexedDB = fakeIndexedDB();
  const file = new File(['fictional resume'], 'resume.pdf', {type: 'application/pdf', lastModified: 123});
  const [saved] = await saveAttachmentFiles({resumeId: 'profile-1', kind: 'resume', files: [file]}, {indexedDB});
  assert.equal(saved.name, 'resume.pdf');
  assert.equal('blob' in saved, false);
  assert.equal('path' in saved, false);

  const [listed] = await listAttachments({resumeId: 'profile-1'}, {indexedDB});
  assert.deepEqual(listed, saved);
  const internal = await getAttachmentForUpload(saved.id, {indexedDB});
  assert.equal(await internal.blob.text(), 'fictional resume');

  await deleteAttachment(saved.id, {indexedDB});
  assert.deepEqual(await listAttachments({resumeId: 'profile-1'}, {indexedDB}), []);
});

test('stores a hidden path record and enforces per-file and total budgets', async () => {
  const indexedDB = fakeIndexedDB();
  const saved = await saveAttachmentPath({resumeId: 'profile-1', kind: 'transcript', path: '/Users/test/transcript.pdf'}, {indexedDB});
  assert.equal(saved.name, 'transcript.pdf');
  assert.equal('path' in saved, false);
  assert.equal((await getAttachmentForUpload(saved.id, {indexedDB})).path, '/Users/test/transcript.pdf');

  await assert.rejects(
    saveAttachmentFiles({resumeId: 'profile-1', kind: 'resume', files: [new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], 'large.pdf')]}, {indexedDB}),
    /10 MB/
  );

  const shared = new Uint8Array(MAX_ATTACHMENT_BYTES);
  await saveAttachmentFiles({resumeId: 'profile-1', kind: 'other', files: [1, 2, 3].map(index => new File([shared], `${index}.bin`))}, {indexedDB});
  await assert.rejects(
    saveAttachmentFiles({resumeId: 'profile-1', kind: 'other', files: [new File(['x'], 'extra.bin')]}, {indexedDB}),
    /30 MB/
  );
});
