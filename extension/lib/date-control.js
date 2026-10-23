const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
let dateControlCounter = 0;

export function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function isValidMonth(value) {
  const match = MONTH_PATTERN.exec(String(value ?? ''));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1 && month >= 1 && month <= 12;
}

export function isValidCalendarDate(value) {
  const match = DATE_PATTERN.exec(String(value ?? ''));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

export function classifyDateValue(value) {
  const text = String(value ?? '');
  if (text === '') return {kind: 'empty', value: text};
  if (text === '至今') return {kind: 'current', value: text};
  if (isValidCalendarDate(text)) return {kind: 'date', value: text};
  if (isValidMonth(text)) return {kind: 'month', value: text};
  return {kind: 'raw', value: text};
}

function isEndField(field) {
  return field?.key === 'end_date' || field?.allowCurrent === true;
}

function preferredMode(field) {
  return field?.type === 'date' ? 'date' : 'month';
}

function option(document, value, label) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

/**
 * Build an editable date field without normalizing stored data behind the
 * user's back. The returned container can be appended directly to a label.
 */
export function createDateControl({document = globalThis.document, field = {}, value = '', onChange = () => {}, id}) {
  if (!document?.createElement) throw new TypeError('document.createElement is required');
  const initial = classifyDateValue(value);
  const initialText = initial.value;
  const label = String(field.label || '日期');
  let committedValue = initialText;
  let mode = ['date', 'month', 'raw'].includes(initial.kind) ? initial.kind : preferredMode(field);

  const container = document.createElement('div');
  container.className = 'date-control';
  const toolbar = document.createElement('div');
  toolbar.className = 'date-control-toolbar';
  const precision = document.createElement('select');
  precision.className = 'date-precision';
  precision.setAttribute('aria-label', `${label}精度`);
  if (initial.kind === 'raw') precision.append(option(document, 'raw', '保留原值'));
  precision.append(option(document, 'month', '按月'), option(document, 'date', '具体日期'));
  precision.value = mode;

  const input = document.createElement('input');
  input.id = id || `date-${field.key || 'value'}-${++dateControlCounter}`;
  input.className = 'date-value';
  input.setAttribute('aria-label', label);
  input.autocomplete = 'off';

  const preserved = document.createElement('small');
  preserved.className = 'date-preserved-value';
  preserved.hidden = true;

  function updatePreservedNote() {
    const current = classifyDateValue(committedValue);
    const compatible = current.kind === mode || current.kind === 'empty';
    preserved.hidden = compatible || current.kind === 'current';
    preserved.textContent = preserved.hidden ? '' : `原值“${committedValue}”仍保留，选择新日期后才会替换。`;
  }

  function renderInput(nextMode) {
    mode = nextMode;
    input.type = mode === 'raw' ? 'text' : mode;
    const current = classifyDateValue(committedValue);
    if (mode === 'raw') input.value = committedValue;
    else if (current.kind === mode) input.value = committedValue;
    else if (mode === 'month' && current.kind === 'date') input.value = committedValue.slice(0, 7);
    else input.value = '';
    updatePreservedNote();
  }

  precision.onchange = () => renderInput(precision.value);
  input.oninput = () => {
    if (mode !== 'raw') return;
    committedValue = input.value;
    onChange(committedValue);
    updatePreservedNote();
  };
  input.onchange = () => {
    if (mode === 'raw') return;
    if (input.value !== '' && !(mode === 'month' ? isValidMonth(input.value) : isValidCalendarDate(input.value))) return;
    committedValue = input.value;
    onChange(committedValue);
    updatePreservedNote();
  };

  toolbar.append(precision);
  let currentCheckbox = null;
  if (isEndField(field)) {
    const currentLabel = document.createElement('span');
    currentLabel.className = 'date-current';
    currentCheckbox = document.createElement('input');
    currentCheckbox.type = 'checkbox';
    currentCheckbox.checked = initial.kind === 'current';
    currentCheckbox.setAttribute('aria-label', `${label}至今`);
    const caption = document.createElement('span');
    caption.textContent = '至今';
    currentCheckbox.onchange = () => {
      if (currentCheckbox.checked) {
        committedValue = '至今';
        input.disabled = true;
        precision.disabled = true;
        onChange(committedValue);
      } else {
        committedValue = '';
        input.disabled = false;
        precision.disabled = false;
        renderInput(precision.value);
        onChange(committedValue);
      }
      updatePreservedNote();
    };
    currentLabel.append(currentCheckbox, caption);
    toolbar.append(currentLabel);
  }

  renderInput(mode);
  if (currentCheckbox?.checked) {
    input.disabled = true;
    precision.disabled = true;
  }
  container.append(toolbar, input, preserved);
  return container;
}
