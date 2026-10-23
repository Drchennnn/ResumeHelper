/*
 * Page bridge API:
 *   { type: "SCAN" } -> { fields, url, title }
 *   { type: "APPLY", items: [{ fieldId, value }], overwrite?: boolean }
 *     -> { results: [{ fieldId, status, reason? }] }
 *   { type: "CANCEL" } -> { cancelled: true }
 *
 * This file is deliberately self-contained so it can run as an MV3 content
 * script without a build step or page-owned dependencies.
 */
(function installPersonalResumeContentScript() {
  "use strict";

  const INSTALL_KEY = "__personalResumeContentScriptInstalled__";
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  const fieldElements = new Map();
  const elementIds = new WeakMap();
  let nextFieldId = 1;
  const documentNonce = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  const MAX_TEXT_LENGTH = 10000;
  const CONTROL_TIMEOUT_MS = 1600;
  const POLL_INTERVAL_MS = 40;
  const FIELD_SELECTOR = [
    "input",
    "textarea",
    "select",
    "[contenteditable]:not([contenteditable='false'])",
    "[role='combobox']",
    "[aria-haspopup='listbox']",
    "[aria-haspopup='tree']",
  ].join(",");
  const EXCLUDED_INPUT_TYPES = new Set([
    "button",
    "file",
    "hidden",
    "image",
    "password",
    "reset",
    "submit",
  ]);

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element || element.hidden || element.disabled) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    if (typeof element.closest === "function" && element.closest("[hidden],[aria-hidden='true']")) {
      return false;
    }
    if (typeof getComputedStyle === "function") {
      const style = getComputedStyle(element);
      if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    }
    if (typeof element.getClientRects === "function" && element.getClientRects().length === 0) {
      return false;
    }
    return true;
  }

  function isSupportedField(element) {
    if (element.closest?.('[data-personal-resume-ui]') || element.getRootNode?.()?.host?.hasAttribute?.('data-personal-resume-ui')) return false;
    const tag = String(element.tagName || "").toLowerCase();
    if (!isVisible(element)) return false;
    const customPicker = isCustomPicker(element);
    if ((element.readOnly || element.getAttribute("readonly") !== null) && !customPicker) return false;
    if (tag === "input") {
      const type = String(element.type || "text").toLowerCase();
      if (EXCLUDED_INPUT_TYPES.has(type)) return false;
      if (type === "checkbox" && isSensitiveConsentCheckbox(element)) return false;
      return true;
    }
    return tag === "textarea" || tag === "select" || element.isContentEditable || customPicker;
  }

  function isCustomPicker(element) {
    if (!element || String(element.tagName || "").toLowerCase() === "select") return false;
    const role = cleanText(element.getAttribute?.("role")).toLowerCase();
    const popup = cleanText(element.getAttribute?.("aria-haspopup")).toLowerCase();
    return role === "combobox" || ["listbox", "tree", "grid", "dialog"].includes(popup);
  }

  function isSensitiveConsentCheckbox(element) {
    const context = [
      getLabel(element),
      element.getAttribute("name"),
      element.getAttribute("id"),
    ].join(" ");
    return /((同意|接受|阅读).{0,12}(条款|隐私|声明|协议|授权)|(条款|隐私|声明|协议).{0,12}(同意|接受|授权)|用户协议|隐私政策)/i.test(context);
  }

  function rootsWithOpenShadows(root) {
    const roots = [root];
    for (let index = 0; index < roots.length; index += 1) {
      const current = roots[index];
      if (typeof current.querySelectorAll !== "function") continue;
      for (const node of current.querySelectorAll("*")) {
        if (node.hasAttribute?.('data-personal-resume-ui')) continue;
        if (node.shadowRoot && node.shadowRoot.mode !== "closed") roots.push(node.shadowRoot);
      }
    }
    return roots;
  }

  function getLabel(element) {
    const direct = cleanText(
      element.getAttribute("aria-label") || element.getAttribute("data-form-field-i18n-name"),
    );
    if (direct) return disambiguateGroupedLabel(element, direct);

    const labelledBy = cleanText(element.getAttribute("aria-labelledby"));
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => cleanText(node.textContent))
        .filter(Boolean)
        .join(" ");
      if (text) return disambiguateGroupedLabel(element, text);
    }

    if (element.labels && element.labels.length) {
      const text = Array.from(element.labels)
        .map(labelTextWithoutControls)
        .filter(Boolean)
        .join(" ");
      if (text) return disambiguateGroupedLabel(element, text);
    }

    if (typeof element.closest === "function") {
      const wrappingLabel = element.closest("label");
      if (wrappingLabel) {
        const text = labelTextWithoutControls(wrappingLabel);
        if (text) return disambiguateGroupedLabel(element, text);
      }

      // Formily, Semi Design (Feishu/ByteDance), Ant Design and similar
      // libraries often render the visual label outside the actual control.
      const fieldContainer = element.closest(
        "[id^='formily-item-'],[data-form-field-i18n-name],.formily-element-form-item,.semi-form-field,.semi-form-field-main,[class*='form-item'],[class*='FormItem'],[data-formily-field]",
      );
      const containerLabel = cleanText(fieldContainer?.getAttribute?.("data-form-field-i18n-name"));
      if (containerLabel) return disambiguateGroupedLabel(element, containerLabel);
      const visualLabel = fieldContainer?.querySelector?.(
        "label,.semi-form-field-label,[class*='form-item-label'],[class*='FormItem_label'],[data-formily-label]",
      );
      const text = labelTextWithoutControls(visualLabel);
      if (text) return disambiguateGroupedLabel(element, text);
    }

    return disambiguateGroupedLabel(element, (
      cleanText(element.getAttribute("placeholder")) ||
      cleanText(element.getAttribute("name")) ||
      cleanText(element.id) ||
      "未命名字段"
    ));
  }

  function disambiguateGroupedLabel(element, label) {
    const range = element.closest?.(
      ".throne-biz-date-range-picker-wrapper,[class*='date-range-picker'],[class*='DateRangePicker']",
    );
    if (range?.querySelectorAll) {
      const inputs = Array.from(range.querySelectorAll("input"));
      const index = inputs.indexOf(element);
      if (index === 0) return `${label}（开始）`;
      if (index === 1) return `${label}（结束）`;
    }
    if (isCustomPicker(element) && /(手机|电话|mobile|phone)/i.test(label) &&
      !/(区号|国家|地区|country|code)/i.test(label)) {
      return `${label}（国家/地区代码）`;
    }
    if (isCustomPicker(element) && /(证件|身份证|passport|identity)/i.test(label) && !/(类型|type)/i.test(label)) {
      return `${label}（证件类型）`;
    }
    return label;
  }

  function labelTextWithoutControls(label) {
    if (!label) return "";
    if (typeof label.cloneNode !== "function") return cleanText(label.textContent);
    try {
      const clone = label.cloneNode(true);
      if (clone && typeof clone.querySelectorAll === "function") {
        for (const control of clone.querySelectorAll("input,select,textarea,button")) {
          if (typeof control.remove === "function") control.remove();
        }
      }
      return cleanText(clone && clone.textContent);
    } catch (error) {
      return cleanText(label.textContent);
    }
  }

  function getSection(element) {
    if (typeof element.closest !== "function") return undefined;
    const start = element.closest(
      "[id^='formily-item-'],[data-form-field-i18n-name],.formily-element-form-item,.semi-form-field,[class*='form-item'],[class*='FormItem'],[data-formily-field]",
    )?.parentElement || element.parentElement || element;
    const namedContainer = start.closest(
      "[data-section],[data-section-title],[aria-label],fieldset,section,[class*='form-section'],[class*='FormSection'],[class*='resume-module'],[class*='applyFormModuleWrapper']",
    ) || element.closest("[data-section],[aria-label],fieldset,section");
    if (!namedContainer) return undefined;
    const explicit = cleanText(
      namedContainer.getAttribute("data-section") ||
      namedContainer.getAttribute("data-section-title") ||
      namedContainer.getAttribute("aria-label"),
    );
    if (explicit) return explicit;
    const heading = namedContainer.querySelector(
      "legend,h1,h2,h3,h4,h5,h6,[class*='section-title'],[class*='SectionTitle'],[class*='module-title']",
    );
    if (heading) return cleanText(heading.textContent) || undefined;
    const first = cleanText(namedContainer.firstElementChild?.textContent);
    if (!first || first.length > 60) return undefined;
    const repeated = first.match(/^(.{2,12})请填写\1/);
    return repeated ? repeated[1] : first || undefined;
  }

  function getFieldId(element) {
    let fieldId = elementIds.get(element);
    if (!fieldId) {
      fieldId = `${documentNonce}-field-${nextFieldId++}`;
      elementIds.set(element, fieldId);
    }
    fieldElements.set(fieldId, element);
    return fieldId;
  }

  function fieldType(element) {
    const tag = String(element.tagName || "").toLowerCase();
    if (tag === "select") return element.multiple ? "select-multiple" : "select-one";
    if (tag === "textarea") return "textarea";
    if (element.isContentEditable) return "contenteditable";
    if (isDatePicker(element) && (
      isCustomPicker(element) || element.closest?.(".throne-biz-date-range-picker-wrapper,[class*='date-range-picker'],[class*='DateRangePicker']")
    )) return "date-picker";
    if (isCustomPicker(element)) return "combobox";
    return String(element.type || "text").toLowerCase();
  }

  function isDatePicker(element) {
    const context = [
      getLabel(element),
      element.getAttribute?.("placeholder"),
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("data-type"),
      element.className,
    ].map(cleanText).join(" ");
    return /(日期|时间|年月|入学|毕业|开始|结束|date|month|year|picker)/i.test(context);
  }

  function currentValue(element, type) {
    if (type === "checkbox" || type === "radio") return Boolean(element.checked);
    if (type === "contenteditable") return cleanText(element.textContent);
    if (element.value != null && String(element.value)) return String(element.value);
    if (type === "combobox" || type === "date-picker") {
      const explicit = cleanText(
        element.getAttribute?.("aria-valuetext") || element.getAttribute?.("data-value"),
      );
      if (explicit) return explicit;
      const selectedValues = selectedPickerValues(element);
      return selectedValues.length ? selectedValues.join("；") : cleanText(element.textContent);
    }
    return element.value == null ? "" : String(element.value);
  }

  function selectedPickerValues(element) {
    const root = element.closest?.(
      ".ud__select,.semi-select,.ant-select,[class*='select-wrapper'],[class*='SelectWrapper']",
    ) || element;
    const values = Array.from(root.querySelectorAll?.(
      "[aria-selected='true'],[data-selected='true'],.ud__select__selector__selectItem,.semi-select-selection-text,.ant-select-selection-item,[class*='selected-value']",
    ) || []).map((node) => cleanText(node.textContent)).filter(Boolean);
    if (!isMultiPicker(element)) return values;
    // Some UD multi-select versions expose every chip in one combined text
    // node (for example `深圳；北京`) instead of one node per selection.
    return values.flatMap((value) => value.split(/[；;、\n]+/).map(cleanText).filter(Boolean));
  }

  function isMultiPicker(element) {
    if (element.getAttribute?.("aria-multiselectable") === "true") return true;
    const root = element.closest?.(
      ".ud__select,[class*='select-wrapper'],[class*='SelectWrapper']",
    ) || element;
    return Boolean(root.querySelector?.(
      ".ud__select__selector-multiple,[aria-multiselectable='true'],[class*='select-multiple'],[class*='SelectMultiple']",
    ));
  }

  function describeField(element) {
    const type = fieldType(element);
    const field = {
      id: getFieldId(element),
      label: getLabel(element),
      type,
      value: currentValue(element, type),
    };
    const section = getSection(element);
    if (section) field.section = section;
    const fieldKey = trustedFieldKey(element);
    if (fieldKey) field.fieldKey = fieldKey;
    const preciseRecord = element.closest?.(
      "[class*='apply-form-array-card-content'],[data-form-array-item]",
    );
    const record = preciseRecord || element.closest?.("[class*='form-array-card']");
    if (record) {
      const collection = record.parentElement?.closest?.(
        "[id^='formily-item-'][id$='_list'],[data-form-array],[class*='applyFormModuleWrapper'],[class*='form-array']",
      ) || record.parentElement;
      const recordSelector = preciseRecord
        ? "[class*='apply-form-array-card-content'],[data-form-array-item]"
        : "[class*='form-array-card']";
      const records = Array.from(collection?.querySelectorAll?.(
        recordSelector,
      ) || []);
      const groupIndex = records.indexOf(record);
      if (groupIndex >= 0) {
        field.groupIndex = groupIndex;
        field.groupCount = records.length;
      }
    }
    if (String(element.tagName || "").toLowerCase() === "select") {
      field.options = Array.from(element.options || []).map((option) => ({
        value: String(option.value),
        label: cleanText(option.textContent || option.label),
      }));
    } else if (type === "combobox") {
      const options = visiblePickerOptions(element).map((option) => ({
        value: cleanText(option.getAttribute?.("data-value") || option.getAttribute?.("value") || option.textContent),
        label: cleanText(option.textContent),
      })).filter((option) => option.label);
      if (options.length) field.options = options;
    }
    return field;
  }

  function trustedFieldKey(element) {
    const range = element.closest?.(
      ".throne-biz-date-range-picker-wrapper,[class*='date-range-picker'],[class*='DateRangePicker']",
    );
    if (range?.querySelectorAll) {
      const inputs = Array.from(range.querySelectorAll("input"));
      const index = inputs.indexOf(element);
      if (index === 0) return "start_date";
      if (index === 1) return "end_date";
    }
    const raw = cleanText(
      element.getAttribute?.("data-form-field-name") ||
      element.closest?.("[data-form-field-name]")?.getAttribute?.("data-form-field-name"),
    );
    const candidate = raw.split(/[.\[\]]+/).filter(Boolean).at(-1) || "";
    // Only exact canonical keys are accepted. Site-specific names such as
    // `education_type` deliberately stay label-matched instead of being guessed.
    const allowed = new Set([
      "name", "email", "phone", "school", "degree", "major", "department",
      "start_date", "end_date", "position", "company", "project_name",
      "preferred_city", "target_position", "self_introduction",
    ]);
    return allowed.has(candidate) ? candidate : undefined;
  }

  function scanPage(scope = document) {
    for (const [fieldId, element] of fieldElements) {
      if (!element.isConnected) fieldElements.delete(fieldId);
    }
    const elements = [];
    const seen = new Set();
    for (const root of rootsWithOpenShadows(scope)) {
      const candidates = [...root.querySelectorAll(FIELD_SELECTOR)];
      if (root.matches?.(FIELD_SELECTOR)) candidates.unshift(root);
      for (const element of candidates) {
        if (!seen.has(element) && isSupportedField(element)) {
          seen.add(element);
          elements.push(element);
        }
      }
    }
    return {
      fields: elements.map(describeField),
      url: String(location.href),
      title: String(document.title || ""),
    };
  }

  function nativeSetter(element, property, value) {
    let prototype = Object.getPrototypeOf(element);
    while (prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (descriptor && typeof descriptor.set === "function") {
        descriptor.set.call(element, value);
        return;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    element[property] = value;
  }

  function emitChangeEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  function dispatchPointerClick(element) {
    element.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
    element.focus?.({ preventScroll: true });
    const EventClass = globalThis.PointerEvent || globalThis.MouseEvent || Event;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      element.dispatchEvent(new EventClass(type, { bubbles: true, composed: true, cancelable: true }));
    }
    if (typeof element.click === "function") element.click();
    else element.dispatchEvent(new EventClass("click", { bubbles: true, composed: true, cancelable: true }));
  }

  function pickerRoots(element, allowDetachedPortal = false) {
    const roots = [];
    const ids = cleanText(
      element.getAttribute?.("aria-controls") || element.getAttribute?.("aria-owns"),
    ).split(/\s+/).filter(Boolean);
    for (const id of ids) {
      const owned = document.getElementById?.(id);
      if (owned) roots.push(owned);
    }
    const hasOwnedPopup = roots.length > 0;
    const inline = element.closest?.(
      ".ud__select,.semi-select,.ant-select,.el-select,[class*='select-wrapper'],[class*='SelectWrapper']",
    );
    if (inline) roots.push(inline);
    const isActiveOrOpen = document.activeElement === element ||
      element.getAttribute?.("aria-expanded") === "true";
    if (!hasOwnedPopup && (allowDetachedPortal || isActiveOrOpen)) {
      const popupSelector = [
        "[role='listbox']", "[role='tree']", ".ud__select__list", ".semi-select-option-list",
        ".ant-select-dropdown", ".ant-cascader-menus", ".el-select-dropdown",
      ].join(",");
      const popups = Array.from(document.querySelectorAll?.(popupSelector) || []).filter(isVisible);
      // A single visible popup after opening the control is a bounded association.
      // Multiple unrelated portals are ambiguous and must never be guessed.
      if (popups.length === 1 && !roots.includes(popups[0])) roots.push(popups[0]);
    }
    if (element.getRootNode && element.getRootNode() !== document) roots.push(element.getRootNode());
    return [...new Set(roots)];
  }

  function visiblePickerOptions(element, allowDetachedPortal = false) {
    const selectors = [
      "[role='option']",
      "[role='treeitem']",
      ".semi-select-option",
      ".semi-cascader-option",
      ".ud__select__list__item",
      ".ant-select-item-option",
      ".ant-cascader-menu-item",
      ".el-select-dropdown__item",
      "[class*='select-option']",
      "[class*='SelectOption']",
    ].join(",");
    const options = [];
    const seen = new Set();
    for (const root of pickerRoots(element, allowDetachedPortal)) {
      for (const option of root.querySelectorAll?.(selectors) || []) {
        if (seen.has(option) || !isVisible(option)) continue;
        if (option.closest?.("[data-personal-resume-ui]")) continue;
        seen.add(option);
        options.push(option);
      }
    }
    return options;
  }

  function isDisabledOption(option) {
    return Boolean(
      option.disabled ||
      option.getAttribute?.("aria-disabled") === "true" ||
      option.getAttribute?.("data-disabled") === "true" ||
      /(^|[\s_-])disabled([\s_-]|$)/i.test(cleanText(option.className)),
    );
  }

  function normalizedChoice(value) {
    return cleanText(value).replace(/[\s\u00a0]+/g, "").replace(/[，,、;；]$/, "").toLowerCase();
  }

  function findExactPickerOption(element, requested) {
    const expected = normalizedChoice(requested);
    if (!expected) return null;
    return visiblePickerOptions(element, true).find((option) => {
      const values = [
        option.textContent,
        option.getAttribute?.("data-value"),
        option.getAttribute?.("value"),
        option.getAttribute?.("aria-label"),
      ].map(normalizedChoice).filter(Boolean);
      return values.includes(expected);
    }) || null;
  }

  function normalizedRegionSegment(value) {
    return normalizedChoice(value).replace(/(特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|省|市|区|县)$/u, "");
  }

  function isCascaderPicker(element) {
    if (cleanText(element.getAttribute?.("aria-haspopup")).toLowerCase() === "tree") return true;
    return Boolean(element.closest?.(
      ".ant-cascader,.el-cascader,.semi-cascader,.ud__cascader,[class*='cascader'],[class*='Cascader']",
    ));
  }

  function exactCascaderOptions(element, requested) {
    const expected = normalizedRegionSegment(requested);
    return visiblePickerOptions(element, true).filter((option) => {
      const values = [
        option.textContent,
        option.getAttribute?.("data-value"),
        option.getAttribute?.("value"),
        option.getAttribute?.("aria-label"),
      ].map(normalizedRegionSegment).filter(Boolean);
      return values.includes(expected);
    });
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function waitFor(check, operationId, timeout = CONTROL_TIMEOUT_MS) {
    const deadline = Date.now() + timeout;
    do {
      if (operationId !== activeOperationId) return { cancelled: true };
      const value = check();
      if (value) return { value };
      await delay(POLL_INTERVAL_MS);
    } while (Date.now() < deadline);
    return { timeout: true };
  }

  function editablePickerInput(element) {
    const tag = String(element.tagName || "").toLowerCase();
    if (tag === "input" && !element.readOnly && element.getAttribute("readonly") === null) return element;
    const input = element.querySelector?.("input:not([readonly])");
    return input || null;
  }

  function sendEscape(element) {
    const KeyboardClass = globalThis.KeyboardEvent || Event;
    element.dispatchEvent?.(new KeyboardClass("keydown", {
      key: "Escape", code: "Escape", bubbles: true, composed: true, cancelable: true,
    }));
  }

  function yearMonth(value) {
    const match = cleanText(value).match(/(19|20)\d{2}\D{0,3}(0?[1-9]|1[0-2])/);
    if (!match) return "";
    const year = match[0].match(/(19|20)\d{2}/)?.[0] || "";
    return year && match[2] ? `${year}-${String(match[2]).padStart(2, "0")}` : "";
  }

  function findVisible(root, selector) {
    return Array.from(root.querySelectorAll?.(selector) || []).find((node) => isVisible(node)) || null;
  }

  function visibleUdYearHeader() {
    return findVisible(document, ".ud__picker-panel-header-btn");
  }

  function udYearNavigationRoot(header) {
    return header?.closest?.(".ud__picker-panel-header-inner") ||
      header?.parentElement?.closest?.(".ud__picker-panel-header-inner") ||
      header?.parentElement?.parentElement ||
      header?.parentElement ||
      document;
  }

  async function applyUdMonthPicker(element, requested, operationId) {
    const target = yearMonth(requested);
    if (!target) return null;
    const targetYear = Number(target.slice(0, 4));
    const targetMonth = Number(target.slice(5, 7));
    const headerWait = await waitFor(
      () => visibleUdYearHeader(), operationId, 500,
    );
    if (headerWait.cancelled) return { status: "skipped", reason: "cancelled" };
    let header = headerWait.value;
    if (!header) return null;
    let currentYear = Number(cleanText(header.textContent).match(/(19|20)\d{2}/)?.[0]);
    if (!Number.isInteger(currentYear) || Math.abs(currentYear - targetYear) > 80) {
      return { status: "skipped", reason: "unsupported_custom_date_panel" };
    }
    while (currentYear !== targetYear) {
      if (operationId !== activeOperationId) return { status: "skipped", reason: "cancelled" };
      const iconName = currentYear > targetYear ? "LeftBoldOutlined" : "RightBoldOutlined";
      header = visibleUdYearHeader() || header;
      const controls = udYearNavigationRoot(header);
      const button = Array.from(controls.querySelectorAll?.("button") || []).find(
        (candidate) => candidate.querySelector?.(`[data-icon='${iconName}']`),
      );
      if (!button) return { status: "skipped", reason: "unsupported_custom_date_panel" };
      const previousYear = currentYear;
      dispatchPointerClick(button);
      const changed = await waitFor(() => {
        const nextHeader = visibleUdYearHeader();
        const next = Number(cleanText(nextHeader?.textContent).match(/(19|20)\d{2}/)?.[0]);
        if (Number.isInteger(next) && next !== previousYear) header = nextHeader;
        return Number.isInteger(next) && next !== previousYear ? next : 0;
      }, operationId, 500);
      if (!changed.value) return {
        status: changed.cancelled ? "skipped" : "failed",
        reason: changed.cancelled ? "cancelled" : "date_navigation_timeout",
      };
      currentYear = changed.value;
    }
    const month = Array.from(document.querySelectorAll?.(
      ".ud__picker-month-panel-cell .ud__picker__cell-interactive-area",
    ) || []).find((candidate) => (
      isVisible(candidate) && Number(cleanText(candidate.textContent).match(/\d{1,2}/)?.[0]) === targetMonth
    ));
    if (!month) return { status: "skipped", reason: "unsupported_custom_date_panel" };
    dispatchPointerClick(month);
    const readback = await waitFor(() => yearMonth(currentValue(element, fieldType(element))) === target, operationId, 700);
    if (readback.cancelled) return { status: "skipped", reason: "cancelled" };
    return readback.value
      ? { status: "applied" }
      : { status: "failed", reason: "value_mismatch" };
  }

  async function applyCascaderPath(element, requested, operationId) {
    if (!isCascaderPicker(element)) return null;
    const segments = requested.split(/\s*(?:\/|>|›|→)\s*/).map(cleanText).filter(Boolean);
    if (segments.length < 2) return null;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const found = await waitFor(() => {
        const matches = exactCascaderOptions(element, segment);
        return matches.length ? matches : null;
      }, operationId);
      if (found.cancelled) return { status: "skipped", reason: "cancelled" };
      const matches = found.value || [];
      if (!matches.length) return { status: "skipped", reason: `cascader_option_not_found:${index}` };
      if (matches.length !== 1) return { status: "skipped", reason: `cascader_option_ambiguous:${index}` };
      const option = matches[0];
      if (isDisabledOption(option)) return { status: "skipped", reason: "option_disabled" };
      dispatchPointerClick(option);
      if (index < segments.length - 1) {
        const next = segments[index + 1];
        const advanced = await waitFor(() => exactCascaderOptions(element, next).length === 1, operationId, 700);
        if (advanced.cancelled) return { status: "skipped", reason: "cancelled" };
        if (!advanced.value) return { status: "failed", reason: `cascader_level_timeout:${index + 1}` };
      }
    }
    const finalSegment = normalizedRegionSegment(segments.at(-1));
    const readback = await waitFor(() => {
      const value = currentValue(element, fieldType(element));
      const selected = selectedPickerValues(element);
      const currentPath = value.split(/\s*(?:\/|>|›|→|；)\s*/).map(normalizedRegionSegment).filter(Boolean);
      return (
        currentPath.length >= segments.length &&
        segments.every((segment, index) => currentPath[index] === normalizedRegionSegment(segment))
      ) || normalizedRegionSegment(value) === finalSegment || selected.some((item) => normalizedRegionSegment(item) === finalSegment);
    }, operationId, 700);
    if (readback.cancelled) return { status: "skipped", reason: "cancelled" };
    return readback.value
      ? { status: "applied" }
      : { status: "failed", reason: "value_mismatch" };
  }

  async function applyCustomPicker(element, value, operationId) {
    const requested = cleanText(value);
    if (!requested) return { status: "skipped", reason: "empty_choice" };
    const choices = isMultiPicker(element)
      ? requested.split(/[；;、\n]+/).map(cleanText).filter(Boolean)
      : [requested];
    if (choices.length > 1) {
      for (const choice of choices) {
        if (selectedPickerValues(element).some((selected) => normalizedChoice(selected) === normalizedChoice(choice))) {
          continue;
        }
        const result = await applyCustomPicker(element, choice, operationId);
        if (result.status !== "applied") return result;
      }
      return { status: "applied" };
    }
    const before = currentValue(element, fieldType(element));
    element.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
    dispatchPointerClick(element);

    if (fieldType(element) === "date-picker") {
      const dateResult = await applyUdMonthPicker(element, requested, operationId);
      if (dateResult) return dateResult;
    }
    const cascaderResult = await applyCascaderPath(element, requested, operationId);
    if (cascaderResult) return cascaderResult;

    let option = findExactPickerOption(element, requested);
    const search = editablePickerInput(element);
    const originalSearchValue = search?.value == null ? "" : String(search.value);
    if (!option) {
      const opened = await waitFor(() => findExactPickerOption(element, requested), operationId, 320);
      if (opened.cancelled) return { status: "skipped", reason: "cancelled" };
      option = opened.value || null;
    }
    if (!option && search) {
      search.focus?.({ preventScroll: true });
      nativeSetter(search, "value", requested);
      search.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      const waited = await waitFor(() => findExactPickerOption(element, requested), operationId);
      if (waited.cancelled) return { status: "skipped", reason: "cancelled" };
      option = waited.value || null;
    }
    if (!option) {
      if (search && String(search.value) !== originalSearchValue) {
        nativeSetter(search, "value", originalSearchValue);
        search.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      }
      sendEscape(element);
      return {
        status: "skipped",
        reason: fieldType(element) === "date-picker"
          ? "unsupported_custom_date_panel"
          : (pickerRoots(element, true).length ? "option_not_found" : "custom_menu_needs_manual_open"),
      };
    }
    if (isDisabledOption(option)) {
      sendEscape(element);
      return { status: "skipped", reason: "option_disabled" };
    }
    dispatchPointerClick(option);
    const changed = await waitFor(() => {
      const after = currentValue(element, fieldType(element));
      if (selectedPickerValues(element).some((selected) => normalizedChoice(selected) === normalizedChoice(requested))) {
        return true;
      }
      if (option.getAttribute?.("aria-selected") === "true" || option.getAttribute?.("data-selected") === "true") {
        return true;
      }
      return normalizedChoice(after) === normalizedChoice(requested) && (
        !search || search !== element || element.getAttribute?.("aria-expanded") === "false"
      );
    }, operationId, 600);
    if (changed.cancelled) return { status: "skipped", reason: "cancelled" };
    if (!changed.value) return { status: "failed", reason: "value_mismatch" };
    if (before !== currentValue(element, fieldType(element))) emitChangeEvents(element);
    return { status: "applied" };
  }

  function hasExistingValue(element, type) {
    if (type === "checkbox") return Boolean(element.checked);
    if (type === "radio") return radioGroupHasSelection(element);
    return cleanText(currentValue(element, type)) !== "";
  }

  function radioGroupHasSelection(element) {
    const name = String(element.name || element.getAttribute("name") || "");
    if (!name) return Boolean(element.checked);
    const root = element.form || (typeof element.getRootNode === "function" && element.getRootNode()) || document;
    if (!root || typeof root.querySelectorAll !== "function") return Boolean(element.checked);
    return Array.from(root.querySelectorAll("input[type='radio']")).some(
      (candidate) => String(candidate.name || candidate.getAttribute("name") || "") === name && candidate.checked,
    );
  }

  function booleanValue(value) {
    if (value === true || value === false) return value;
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on", "是", "勾选"].includes(normalized)) return true;
    if (["false", "0", "no", "off", "否", "取消"].includes(normalized)) return false;
    return null;
  }

  function validatedText(element, value) {
    const text = value == null ? "" : String(value);
    const declared = Number(element.maxLength);
    const limit = Number.isInteger(declared) && declared >= 0 ? Math.min(declared, MAX_TEXT_LENGTH) : MAX_TEXT_LENGTH;
    if (text.length > limit) return { error: "too_long" };
    return { text };
  }

  async function applyValue(element, value, operationId) {
    const type = fieldType(element);
    const tag = String(element.tagName || "").toLowerCase();

    if (type === "combobox" || type === "date-picker") {
      return applyCustomPicker(element, value, operationId);
    } else if (type === "checkbox") {
      const checked = booleanValue(value);
      if (checked === null) return { status: "skipped", reason: "checkbox_requires_boolean" };
      nativeSetter(element, "checked", checked);
    } else if (type === "radio") {
      const checked = booleanValue(value);
      const matchesValue = String(value) === String(element.value);
      if (checked === null && !matchesValue) {
        return { status: "skipped", reason: "radio_value_mismatch" };
      }
      nativeSetter(element, "checked", checked === null ? true : checked);
    } else if (tag === "select") {
      const requested = String(value);
      const option = Array.from(element.options || []).find(
        (candidate) => String(candidate.value) === requested || cleanText(candidate.textContent) === requested,
      );
      if (!option) return { status: "skipped", reason: "option_not_found" };
      if (option.disabled || (option.parentElement && option.parentElement.disabled)) {
        return { status: "skipped", reason: "option_disabled" };
      }
      nativeSetter(element, "value", String(option.value));
    } else if (type === "contenteditable") {
      const validated = validatedText(element, value);
      if (validated.error) return { status: "skipped", reason: validated.error };
      element.textContent = validated.text;
    } else {
      const validated = validatedText(element, value);
      if (validated.error) return { status: "skipped", reason: validated.error };
      nativeSetter(element, "value", validated.text);
    }

    emitChangeEvents(element);
    if (type === "checkbox" || type === "radio") {
      const expected = type === "radio" && booleanValue(value) === null ? true : booleanValue(value);
      if (Boolean(element.checked) !== expected) return { status: "failed", reason: "value_mismatch" };
    } else if (tag === "select") {
      const requested = String(value);
      const option = Array.from(element.options || []).find(
        (candidate) => String(candidate.value) === requested || cleanText(candidate.textContent) === requested,
      );
      if (!option || String(element.value) !== String(option.value)) {
        return { status: "failed", reason: "value_mismatch" };
      }
    } else if (type === "contenteditable") {
      if (String(element.textContent || "") !== String(value == null ? "" : value)) {
        return { status: "failed", reason: "value_mismatch" };
      }
    } else if (String(element.value) !== String(value == null ? "" : value)) {
      return { status: "failed", reason: "value_mismatch" };
    }
    return { status: "applied" };
  }

  let activeOperationId = 0;

  function cancelApply() {
    activeOperationId += 1;
    return { cancelled: true };
  }

  async function applyItems(items, overwrite) {
    if (!Array.isArray(items)) return [];
    const operationId = ++activeOperationId;
    const results = [];
    for (const item of items) {
      const fieldId = item && typeof item.fieldId === "string" ? item.fieldId : "";
      try {
        if (operationId !== activeOperationId) {
          results.push({ fieldId, status: "skipped", reason: "cancelled" });
          continue;
        }
        const element = fieldElements.get(fieldId);
        if (!element) { results.push({ fieldId, status: "skipped", reason: "unknown_field" }); continue; }
        if (!element.isConnected) {
          fieldElements.delete(fieldId);
          results.push({ fieldId, status: "skipped", reason: "detached_field" }); continue;
        }
        if (!isSupportedField(element)) { results.push({ fieldId, status: "skipped", reason: "unavailable_field" }); continue; }
        const type = fieldType(element);
        if (!overwrite && hasExistingValue(element, type)) {
          results.push({ fieldId, status: "skipped", reason: "non_empty" }); continue;
        }
        const result = await applyValue(element, item.value, operationId);
        results.push({ fieldId, ...result });
      } catch (error) {
        results.push({ fieldId, status: "failed", reason: "exception" });
      }
    }
    return results;
  }

  // Shared only within Chrome's isolated extension world; no page message bridge.
  globalThis.__personalResumeBridge = {scan: scanPage, apply: applyItems, cancel: cancelApply};
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!sender || sender.id !== chrome.runtime.id) return false;
    if (!message || typeof message !== "object") return false;
    if (message.type === "SCAN") {
      sendResponse(scanPage());
      return false;
    }
    if (message.type === "APPLY") {
      applyItems(message.items, message.overwrite === true)
        .then((results) => sendResponse({ results }))
        .catch(() => sendResponse({ results: [], error: "apply_failed" }));
      return true;
    }
    if (message.type === "CANCEL") {
      sendResponse(cancelApply());
      return false;
    }
    return false;
  });
})();
