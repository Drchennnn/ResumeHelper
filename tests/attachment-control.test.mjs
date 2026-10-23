import test from 'node:test';
import assert from 'node:assert/strict';
import {applyStoredAttachment, attachmentMatchesAccept, scanAttachmentTargets} from '../extension/lib/attachment-control.js';

function scriptingMock(results) {
  const calls = [];
  return {
    calls,
    api: {executeScript: async options => {
      calls.push(options);
      const value = results.shift();
      return [{frameId: 0, result: typeof value === 'function' ? value(options) : value}];
    }}
  };
}

test('accept matching supports extensions, exact MIME and MIME families', () => {
  const pdf = {name: 'resume.PDF', mime: 'application/pdf'};
  assert.equal(attachmentMatchesAccept(pdf, '.pdf'), true);
  assert.equal(attachmentMatchesAccept(pdf, 'application/pdf'), true);
  assert.equal(attachmentMatchesAccept({name: 'photo.png', mime: 'image/png'}, 'image/*'), true);
  assert.equal(attachmentMatchesAccept(pdf, '.doc,.docx'), false);
  assert.equal(attachmentMatchesAccept({name: 'resume.pdf', mime: ''}, 'application/pdf'), true);
});

test('scans only through the self-contained file-input scanner', async () => {
  const scripting = scriptingMock([[{id: 'rh-upload-12345678', label: '上传简历', accept: '.pdf'}]]);
  const outcome = await scanAttachmentTargets(7, {chrome: {scripting: scripting.api}});
  assert.equal(outcome.status, 'scanned');
  assert.equal(outcome.targets[0].label, '上传简历');
  assert.equal(scripting.calls[0].world, 'ISOLATED');
  assert.equal(scripting.calls[0].target.tabId, 7);
  assert.equal(typeof scripting.calls[0].func, 'function');
});

test('selects a stored Blob without exposing the Blob object to the page', async () => {
  const scripting = scriptingMock([
    {ok: true, accept: '.pdf', disabled: false, selectedCount: 0},
    {ok: true, selectedCount: 1, selectedNames: ['resume.pdf']}
  ]);
  const chrome = {scripting: scripting.api};
  const attachment = {id: 'a1', source: 'blob', name: 'resume.pdf', kind: 'resume', mime: 'application/pdf', size: 4, blob: new Blob(['test']), lastModified: 1};
  const outcome = await applyStoredAttachment({tabId: 7, targetId: 'rh-upload-12345678', attachmentId: 'a1'}, {chrome, getAttachment: async () => attachment});
  assert.equal(outcome.status, 'selected_for_review');
  assert.equal(outcome.selectedNames[0], 'resume.pdf');
  const payload = scripting.calls[1].args[1];
  assert.equal(payload.base64, 'dGVzdA==');
  assert.equal('blob' in payload, false);
  assert.equal('path' in payload, false);
});

test('infers a Blob MIME from its extension before isolated-world validation', async () => {
  const scripting = scriptingMock([
    {ok: true, accept: 'application/pdf', disabled: false, selectedCount: 0},
    options => ({ok: options.args[1].mime === 'application/pdf', selectedCount: 1, selectedNames: ['resume.pdf']})
  ]);
  const attachment = {id: 'a1', source: 'blob', name: 'resume.pdf', kind: 'resume', mime: '', size: 1, blob: new Blob(['x'])};
  const outcome = await applyStoredAttachment({tabId: 7, targetId: 'rh-upload-12345678', attachmentId: 'a1'}, {chrome: {scripting: scripting.api}, getAttachment: async () => attachment});
  assert.equal(outcome.status, 'selected_for_review');
  assert.equal(scripting.calls[1].args[1].mime, 'application/pdf');
});

test('uses DOM.setFileInputFiles for absolute paths and always detaches', async () => {
  const scripting = scriptingMock([
    {ok: true, accept: 'application/pdf', disabled: false, selectedCount: 0},
    {ok: true, accept: 'application/pdf', disabled: false, selectedCount: 1, selectedNames: ['resume.pdf']}
  ]);
  const commands = [];
  const chrome = {
    scripting: scripting.api,
    permissions: {contains: async () => true},
    debugger: {
      getTargets: async () => [],
      attach: async (_target, version) => { assert.equal(version, '1.3'); },
      detach: async () => { commands.push({method: 'detach'}); },
      sendCommand: async (_target, method, params) => {
        commands.push({method, params});
        if (method === 'DOM.getDocument') return {root: {nodeId: 1, children: [{nodeId: 9, nodeName: 'INPUT', attributes: ['type', 'file', 'data-resume-helper-upload-id', 'rh-upload-12345678']}]}};
        return {};
      }
    }
  };
  const attachment = {id: 'a1', source: 'path', path: '/Users/test/resume.pdf', name: 'resume.pdf', kind: 'resume', mime: 'application/pdf', size: null};
  const outcome = await applyStoredAttachment({tabId: 7, targetId: 'rh-upload-12345678', attachmentId: 'a1'}, {chrome, getAttachment: async () => attachment});
  assert.equal(outcome.status, 'selected_for_review');
  const setFiles = commands.find(call => call.method === 'DOM.setFileInputFiles');
  assert.deepEqual(setFiles.params, {files: ['/Users/test/resume.pdf'], nodeId: 9});
  assert.equal(commands.some(call => call.method === 'Runtime.evaluate'), false);
  assert.equal(commands.at(-1).method, 'detach');
});

test('rejects incompatible attachments before debugger attachment', async () => {
  const scripting = scriptingMock([{ok: true, accept: '.docx', disabled: false, selectedCount: 0}]);
  let attached = 0;
  const chrome = {scripting: scripting.api, debugger: {attach: async () => { attached++; }}};
  const attachment = {id: 'a1', source: 'path', path: '/Users/test/resume.pdf', name: 'resume.pdf', mime: 'application/pdf'};
  const outcome = await applyStoredAttachment({tabId: 7, targetId: 'rh-upload-12345678', attachmentId: 'a1'}, {chrome, getAttachment: async () => attachment});
  assert.equal(outcome.reason || outcome.status, 'accept_mismatch');
  assert.equal(attached, 0);
});

test('protects a non-empty file input and does not replace a manual selection', async () => {
  const scripting = scriptingMock([{ok: true, accept: '.pdf', disabled: false, selectedCount: 1, selectedNames: ['manual.pdf']}]);
  const attachment = {id: 'a1', source: 'blob', name: 'resume.pdf', mime: 'application/pdf', size: 1, blob: new Blob(['x'])};
  const outcome = await applyStoredAttachment({tabId: 7, targetId: 'rh-upload-12345678', attachmentId: 'a1'}, {chrome: {scripting: scripting.api}, getAttachment: async () => attachment});
  assert.equal(outcome.status, 'target_non_empty');
  assert.equal(scripting.calls.length, 1);
});

test('path verification requires the selected basename and ignores a display alias', async () => {
  const scripting = scriptingMock([
    {ok: true, accept: 'application/pdf', disabled: false, selectedCount: 0},
    {ok: true, accept: 'application/pdf', disabled: false, selectedCount: 1, selectedNames: ['old.pdf']}
  ]);
  const chrome = {
    scripting: scripting.api,
    permissions: {contains: async () => true},
    debugger: {
      getTargets: async () => [], attach: async () => {}, detach: async () => {},
      sendCommand: async (_target, method) => method === 'DOM.getDocument'
        ? {root: {nodeId: 1, children: [{nodeId: 9, nodeName: 'INPUT', attributes: ['type', 'file', 'data-resume-helper-upload-id', 'rh-upload-12345678']}]}}
        : {}
    }
  };
  const attachment = {id: 'a1', source: 'path', path: '/Users/test/resume.pdf', name: '求职简历最新版', mime: '', kind: 'resume'};
  const outcome = await applyStoredAttachment({tabId: 7, targetId: 'rh-upload-12345678', attachmentId: 'a1'}, {chrome, getAttachment: async () => attachment});
  assert.equal(outcome.status, 'selection_not_confirmed');
});
