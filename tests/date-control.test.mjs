import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyDateValue, createDateControl, isLeapYear, isValidCalendarDate, isValidMonth} from '../extension/lib/date-control.js';

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.value = '';
    this.type = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelector(selector) {
    const match = (node) => selector.startsWith('.') ? node.className?.split(' ').includes(selector.slice(1)) : node.tagName === selector.toUpperCase();
    const visit = (node) => {
      for (const child of node.children) {
        if (match(child)) return child;
        const nested = visit(child);
        if (nested) return nested;
      }
      return null;
    };
    return visit(this);
  }
}
const document = {createElement: (tag) => new FakeElement(tag)};

test('calendar helpers validate leap days without timezone conversion', () => {
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(1900), false);
  assert.equal(isValidCalendarDate('2024-02-29'), true);
  assert.equal(isValidCalendarDate('2023-02-29'), false);
  assert.equal(isValidCalendarDate('2024-04-31'), false);
  assert.equal(isValidMonth('2024-02'), true);
  assert.equal(isValidMonth('2024-13'), false);
  assert.deepEqual(classifyDateValue('2024-02-29'), {kind: 'date', value: '2024-02-29'});
  assert.deepEqual(classifyDateValue('2024-02'), {kind: 'month', value: '2024-02'});
});

test('known month and date values use native controls and preserve the main input id', () => {
  const month = createDateControl({document, field: {key: 'start_date', label: '开始时间', type: 'month'}, value: '2024-02', id: 'start'});
  assert.equal(month.querySelector('.date-value').type, 'month');
  assert.equal(month.querySelector('.date-value').value, '2024-02');
  assert.equal(month.querySelector('.date-value').id, 'start');

  const date = createDateControl({document, field: {key: 'birth_date', label: '出生日期', type: 'date'}, value: '2024-02-29', id: 'birth'});
  assert.equal(date.querySelector('.date-value').type, 'date');
  assert.equal(date.querySelector('.date-value').value, '2024-02-29');
});

test('changing precision never truncates a stored full date before a real choice', () => {
  const changes = [];
  const control = createDateControl({document, field: {key: 'award_date', label: '获奖时间', type: 'date'}, value: '2024-02-29', onChange: (value) => changes.push(value)});
  const precision = control.querySelector('.date-precision');
  const input = control.querySelector('.date-value');
  const note = control.querySelector('.date-preserved-value');
  precision.value = 'month';
  precision.onchange();
  assert.equal(input.type, 'month');
  assert.equal(input.value, '2024-02');
  assert.deepEqual(changes, []);
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /2024-02-29/);
  input.value = '2025-03';
  input.onchange();
  assert.deepEqual(changes, ['2025-03']);
  input.value = '';
  input.onchange();
  assert.deepEqual(changes, ['2025-03', '']);
});

test('nonstandard values stay editable until the user explicitly picks a native date', () => {
  const changes = [];
  const control = createDateControl({document, field: {key: 'graduation_time', label: '毕业时间', type: 'date'}, value: '2024 年夏季', onChange: (value) => changes.push(value)});
  const precision = control.querySelector('.date-precision');
  const input = control.querySelector('.date-value');
  assert.equal(input.type, 'text');
  assert.equal(input.value, '2024 年夏季');
  precision.value = 'date';
  precision.onchange();
  assert.equal(input.type, 'date');
  assert.equal(input.value, '');
  assert.deepEqual(changes, []);
  input.value = '2024-07-01';
  input.onchange();
  assert.deepEqual(changes, ['2024-07-01']);
});

test('end dates support explicit current and clear actions', () => {
  const changes = [];
  const control = createDateControl({document, field: {key: 'end_date', label: '结束时间', type: 'month'}, value: '2024-06', onChange: (value) => changes.push(value)});
  const checkbox = control.querySelector('.date-current').children[0];
  const input = control.querySelector('.date-value');
  checkbox.checked = true;
  checkbox.onchange();
  assert.equal(input.disabled, true);
  assert.deepEqual(changes, ['至今']);
  checkbox.checked = false;
  checkbox.onchange();
  assert.equal(input.disabled, false);
  assert.deepEqual(changes, ['至今', '']);
});

test('an existing current value is not cleared during initialization', () => {
  const changes = [];
  const control = createDateControl({document, field: {key: 'end_date', label: '结束时间', type: 'month'}, value: '至今', onChange: (value) => changes.push(value)});
  const checkbox = control.querySelector('.date-current').children[0];
  assert.equal(checkbox.checked, true);
  assert.equal(control.querySelector('.date-value').disabled, true);
  assert.deepEqual(changes, []);
});
