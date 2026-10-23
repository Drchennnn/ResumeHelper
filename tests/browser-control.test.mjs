import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fillWithBrowserControl,hasBrowserControlPermission,stopBrowserControl} from '../extension/lib/browser-control.js';

const target = {fieldId: 'field-1', type: 'text', label: '姓名', nonempty: false, rect: {x: 20, y: 30, width: 160, height: 32}, viewport: {width: 800, height: 600}};

function mockChrome({granted = true, messages, verify = true, guard = true, attached = false} = {}) {
  const commands = [], calls = {attach: 0, detach: 0};
  const chrome = {
    permissions: {contains: async () => granted},
    tabs: {sendMessage: async (_tabId, message) => {
      messages?.push(message);
      if (message.type === 'CONTROL_TARGET') return {ok: true, target};
      if (message.type === 'CONTROL_GUARD') return {ok: true, allowed: guard, reason: guard ? '' : 'outside'};
      if (message.type === 'CONTROL_VERIFY') return {ok: true, verified: verify, actual: verify ? message.value : ''};
      if (message.type === 'CONTROL_OPTIONS') return {ok: true, options: []};
      throw new Error(`unexpected ${message.type}`);
    }},
    debugger: {
      getTargets: async () => attached ? [{tabId: 7, attached: true}] : [],
      attach: async (_target, version) => { assert.equal(version, '1.3', 'Chrome debugger requires a supported protocol version'); calls.attach++; },
      detach: async () => { calls.detach++; },
      sendCommand: async (_target, method, params) => { commands.push({method, params}); return method === 'Page.captureScreenshot' ? {data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'} : {}; }
    }
  };
  return {chrome, commands, calls};
}

test('permission denial never attaches a debugger', async () => {
  const mock = mockChrome({granted: false});
  assert.equal(await hasBrowserControlPermission({chrome: mock.chrome}), false);
  const outcome = await fillWithBrowserControl({tabId: 7, fieldId: 'field-1', value: '林测试'}, {chrome: mock.chrome});
  assert.equal(outcome.reason, 'debugger_permission_required');
  assert.equal(mock.calls.attach, 0);
});

test('text control performs guarded trusted input, verifies and detaches', async () => {
  const messages = [], mock = mockChrome({messages});
  const outcome = await fillWithBrowserControl({tabId: 7, fieldId: 'field-1', value: '林测试'}, {chrome: mock.chrome, wait: async () => {}});
  assert.equal(outcome.status, 'applied');
  assert.equal(mock.calls.attach, 1);
  assert.equal(mock.calls.detach, 1);
  assert.equal(messages[0].type, 'CONTROL_TARGET');
  assert.equal(messages[1].type, 'CONTROL_GUARD');
  assert.ok(mock.commands.some(call => call.method === 'Input.insertText' && call.params.text === '林测试'));
  assert.ok(mock.commands.some(call => call.method === 'Input.dispatchKeyEvent' && call.params.commands?.includes('selectAll')));
  assert.deepEqual([...new Set(mock.commands.map(call => call.method))].sort(), ['Input.dispatchKeyEvent', 'Input.dispatchMouseEvent', 'Input.insertText']);
  assert.equal(mock.commands.at(-1).method, 'Input.dispatchKeyEvent');
  assert.equal(messages.at(-1).type, 'CONTROL_VERIFY');
});

test('guard rejection prevents every input command and still detaches', async () => {
  const mock = mockChrome({guard: false});
  const outcome = await fillWithBrowserControl({tabId: 7, fieldId: 'field-1', value: '林测试'}, {chrome: mock.chrome});
  assert.equal(outcome.reason, 'unsafe_action');
  assert.equal(mock.commands.length, 0);
  assert.equal(mock.calls.detach, 1);
});

test('existing debugger connection is reported without taking it over', async () => {
  const mock = mockChrome({attached: true});
  const outcome = await fillWithBrowserControl({tabId: 7, fieldId: 'field-1', value: '林测试'}, {chrome: mock.chrome});
  assert.equal(outcome.reason, 'debugger_busy');
  assert.equal(mock.calls.attach, 0);
  assert.equal(mock.calls.detach, 0);
});

test('stopBrowserControl cancels pending work before debugger input', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const mock = mockChrome();
  mock.chrome.tabs.sendMessage = async (_tabId, message) => {
    if (message.type === 'CONTROL_TARGET') { await waiting; return {ok: true, target}; }
    throw new Error('no later message expected');
  };
  const pending = fillWithBrowserControl({tabId: 7, fieldId: 'field-1', value: '林测试'}, {chrome: mock.chrome});
  await Promise.resolve();
  assert.equal(stopBrowserControl(7), true);
  release();
  const outcome = await pending;
  assert.equal(outcome.reason, 'cancelled');
  assert.equal(mock.calls.attach, 0);
});

test('visual fallback is capped at eight safe steps', async () => {
  const mock = mockChrome({verify: false});
  const pickerTarget = {...target, type: 'combobox', label: '学历类型'};
  let plans = 0, guards = 0;
  mock.chrome.tabs.sendMessage = async (_tabId, message) => {
    if (message.type === 'CONTROL_TARGET') return {ok: true, target: pickerTarget};
    if (message.type === 'CONTROL_GUARD') { guards++; return {ok: true, allowed: true}; }
    if (message.type === 'CONTROL_OPTIONS') return {ok: true, pickerRect: {x: 20, y: 70, width: 200, height: 200}, options: []};
    if (message.type === 'CONTROL_VERIFY') return {ok: true, verified: false};
    throw new Error(`unexpected ${message.type}`);
  };
  const outcome = await fillWithBrowserControl({tabId: 7, fieldId: 'field-1', value: '统招全日制', vision: true, settings: {}}, {
    chrome: mock.chrome,
    wait: async () => {},
    planVisualAction: async () => { plans++; return {action: 'click', x: 30, y: 80, coordinateSpace: 'css'}; }
  });
  assert.equal(outcome.reason, 'control_step_limit');
  assert.equal(plans, 8);
  assert.equal(mock.commands.filter(call => call.method === 'Page.captureScreenshot').length, 8);
  assert.ok(guards >= 9, 'initial picker click plus every visual click is guarded');
  assert.equal(mock.calls.detach, 1);
});


test('manifest declares required debugger access instead of an unsupported optional permission', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.permissions.includes('debugger'));
  assert.ok(!manifest.optional_permissions?.includes('debugger'));
});

test('disabling browser control cancels every active tab before input', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const mock = mockChrome();
  mock.chrome.tabs.sendMessage = async (_tabId, message) => {
    if (message.type === 'CONTROL_TARGET') { await waiting; return {ok: true, target}; }
    throw new Error('no input expected after disabling control');
  };
  const pending = [7, 8].map(tabId => fillWithBrowserControl({tabId, fieldId: 'field-1', value: '林测试'}, {chrome: mock.chrome}));
  await Promise.resolve();
  assert.equal(stopBrowserControl(), true);
  release();
  const outcomes = await Promise.all(pending);
  assert.deepEqual(outcomes.map(outcome => outcome.reason), ['cancelled', 'cancelled']);
  assert.equal(mock.calls.attach, 0);
});
