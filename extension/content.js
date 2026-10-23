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
  const fieldAnchors = new Map();
  const controlCandidates = new Map();
  const candidateIds = new WeakMap();
  const elementIds = new WeakMap();
  let nextFieldId = 1;
  let nextCandidateId = 1;
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
  const FIELD_CONTAINER_SELECTOR = [
    "[id^='formily-item-']", "[data-form-field-i18n-name]", "[data-formily-field]",
    ".formily-element-form-item", ".semi-form-field", ".semi-form-field-main",
    "[class*='fieldItem']", "[class*='FieldItem']", "[class*='field-item']",
    "[class*='form-item']", "[class*='FormItem']",
  ].join(",");
  const RECORD_SELECTOR = [
    "[data-form-array-item]", "[class*='apply-form-array-card-content']",
    "[class*='formGroupItem']", "[class*='FormGroupItem']", "[class*='form-group-item']",
    "[class*='form-array-card']",
  ].join(",");
  const DANGEROUS_CONTROL_TEXT = /(提交|保存|删除|移除|上传|发送|投递|确认提交|同意|接受|条款|协议|隐私|授权|submit|save|delete|remove|upload|send|agree|accept)/i;
  const CONTROL_FALLBACK_BLOCKED_REASONS = new Set([
    "cancelled", "non_empty", "too_long", "option_disabled", "empty_choice",
    "checkbox_requires_boolean", "radio_value_mismatch", "unsafe_control",
    "date_precision_required", "date_present_unavailable",
    "site_confirmation_required",
  ]);
  const HIGHEST_DEGREE_CONFIRMATION_TEXT = "已选择另一学历为最高学历，请确认是否修改？";

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function shortText(value, limit = 240) {
    const text = cleanText(value);
    return text && text.length <= limit ? text : text.slice(0, limit);
  }

  function fieldContainer(element) {
    return element?.closest?.(FIELD_CONTAINER_SELECTOR) || null;
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
    return role === "combobox" || ["listbox", "tree", "grid", "dialog"].includes(popup) || Boolean(pickerControlRoot(element));
  }

  function pickerControlRoot(element) {
    return element?.closest?.([
      ".ant-select", ".ant-cascader", ".ant-picker", ".semi-select", ".semi-cascader",
      ".ud__select", ".ud__cascader", ".el-select", ".el-cascader",
      "[class*='selectWrapper']", "[class*='SelectWrapper']", "[class*='select-wrapper']",
      "[class*='cascader']", "[class*='Cascader']", "[class*='datePicker']",
      "[class*='DatePicker']", "[class*='date-picker']", "[class*='dateRangePicker']",
    ].join(",")) || null;
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
    const inputType = String(element.type || "").toLowerCase();
    if (inputType === "radio") {
      const groupTitle = radioGroupTitle(element);
      const choice = radioChoiceLabel(element);
      if (groupTitle) {
        return disambiguateGroupedLabel(element, choice && choice !== groupTitle ? `${groupTitle}：${choice}` : groupTitle);
      }
    }
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

    const container = fieldContainer(element);
    const visualLabel = container?.querySelector?.([
      "label", ".semi-form-field-label", "[class*='filedName']", "[class*='FiledName']",
      "[class*='fieldName']", "[class*='FieldName']", "[class*='field-name']",
      "[class*='form-item-label']", "[class*='FormItem_label']", "[data-formily-label]",
    ].join(","));
    const visualText = labelTextWithoutControls(visualLabel);
    if (inputType === "radio" && visualText) {
      const choice = radioChoiceLabel(element);
      return disambiguateGroupedLabel(element, choice && choice !== visualText ? `${visualText}：${choice}` : visualText);
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
      const fieldRoot = fieldContainer(element);
      const containerLabel = cleanText(fieldRoot?.getAttribute?.("data-form-field-i18n-name"));
      if (containerLabel) return disambiguateGroupedLabel(element, containerLabel);
      const text = labelTextWithoutControls(fieldRoot?.querySelector?.(
        "label,.semi-form-field-label,[class*='filedName'],[class*='FiledName'],[class*='fieldName'],[class*='FieldName'],[class*='field-name'],[class*='form-item-label'],[class*='FormItem_label'],[data-formily-label]",
      ));
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
      ".throne-biz-date-range-picker-wrapper,[class*='date-range-picker'],[class*='DateRangePicker'],[class*='dateRangePicker']",
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

  function radioChoiceLabel(element) {
    return Array.from(element?.labels || []).map(labelTextWithoutControls).filter(Boolean).join(" ") ||
      cleanText(element?.getAttribute?.("aria-label")) || cleanText(element?.value);
  }

  function radioGroupTitle(element) {
    const container = fieldContainer(element) || element?.closest?.(
      "[role='radiogroup'],fieldset,[class*='radioGroup'],[class*='RadioGroup'],[class*='radio-group']",
    );
    if (!container) return "";
    const explicit = cleanText(container.getAttribute?.("aria-label"));
    if (explicit) return explicit;
    const labelledBy = cleanText(container.getAttribute?.("aria-labelledby"));
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById?.(id)).filter(Boolean)
        .map((node) => cleanText(node.textContent)).filter(Boolean).join(" ");
      if (text) return text;
    }
    const title = container.querySelector?.([
      "legend", "[class*='filedName']", "[class*='FiledName']", "[class*='fieldName']",
      "[class*='FieldName']", "[class*='form-item-label']", "[class*='FormItem_label']",
    ].join(","));
    return labelTextWithoutControls(title);
  }

  function radioChoiceBoolean(element) {
    const choice = normalizedChoice(radioChoiceLabel(element));
    if (["是", "yes", "true", "1", "最高学历", "当前最高学历"].includes(choice)) return true;
    if (["否", "no", "false", "0", "不是", "非最高学历"].includes(choice)) return false;
    return null;
  }

  function getSection(element) {
    if (typeof element.closest !== "function") return undefined;
    const start = fieldContainer(element)?.parentElement || element.parentElement || element;
    const namedContainer = start.closest(
      "[data-section],[data-section-title],[aria-label],fieldset,section,[class*='form-section'],[class*='FormSection'],[class*='resume-module'],[class*='applyFormModuleWrapper'],[class*='gridContainer'],[class*='GridContainer']",
    ) || element.closest("[data-section],[aria-label],fieldset,section");
    if (!namedContainer) return undefined;
    const explicit = cleanText(
      namedContainer.getAttribute("data-section") ||
      namedContainer.getAttribute("data-section-title") ||
      namedContainer.getAttribute("aria-label"),
    );
    if (explicit) return explicit;
    const heading = namedContainer.querySelector(
      "legend,h1,h2,h3,h4,h5,h6,[class*='section-title'],[class*='SectionTitle'],[class*='module-title'],[class*='title']",
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
      isCustomPicker(element) || element.closest?.(".throne-biz-date-range-picker-wrapper,[class*='date-range-picker'],[class*='DateRangePicker'],[class*='dateRangePicker']")
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
      if (selectedValues.length) return selectedValues.join("；");
      const text = cleanText(element.textContent);
      const placeholder = cleanText(element.getAttribute?.("placeholder"));
      if (!text || text === placeholder || /^(请选择|请输入|请填写|请录入|搜索|select|choose|search)/i.test(text)) return "";
      return text;
    }
    return element.value == null ? "" : String(element.value);
  }

  function selectedPickerValues(element) {
    const root = element.closest?.(
      ".ud__select,.semi-select,.ant-select,.ant-cascader-picker,.semi-cascader,[class*='select-wrapper'],[class*='SelectWrapper'],[class*='cascader']",
    ) || element;
    const values = Array.from(root.querySelectorAll?.(
      "[aria-selected='true'],[data-selected='true'],.ud__select__selector__selectItem,.semi-select-selection-text,.ant-select-selection-item,.ant-select-selection-selected-value,.ant-cascader-picker-label,[class*='selected-value']",
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

  function elementRect(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) return undefined;
    const result = {
      x: Number(rect.x ?? rect.left ?? 0),
      y: Number(rect.y ?? rect.top ?? 0),
      width: Number(rect.width ?? Math.max(0, (rect.right || 0) - (rect.left || 0))),
      height: Number(rect.height ?? Math.max(0, (rect.bottom || 0) - (rect.top || 0))),
    };
    return Object.values(result).every(Number.isFinite) ? result : undefined;
  }

  function recordInfo(element) {
    const record = element.closest?.(RECORD_SELECTOR);
    if (!record) return {};
    const collection = record.parentElement?.closest?.(
      "[id^='formily-item-'][id$='_list'],[data-form-array],[class*='applyFormModuleWrapper'],[class*='form-array'],[class*='gridContainer'],[class*='GridContainer']",
    ) || record.parentElement;
    const records = Array.from(collection?.querySelectorAll?.(RECORD_SELECTOR) || [])
      .filter((candidate) => candidate.parentElement === record.parentElement || candidate === record);
    const groupIndex = records.indexOf(record);
    const heading = record.querySelector?.("h1,h2,h3,h4,h5,h6,[class*='recordTitle'],[class*='itemTitle'],[class*='card-title']");
    let recordLabel = shortText(heading?.textContent, 100);
    if (!recordLabel) {
      const controls = Array.from(record.querySelectorAll?.("input,textarea,select,[role='combobox']") || []);
      const anchor = controls.find((candidate) => {
        const label = getLabel(candidate);
        return /(学校|院校|公司|单位|组织|项目名称|school|university|company|project)/i.test(label) &&
          !/(姓名|手机|电话|邮箱|证件|地址|name|phone|email|identity)/i.test(label) &&
          cleanText(currentValue(candidate, fieldType(candidate)));
      });
      if (anchor) recordLabel = shortText(currentValue(anchor, fieldType(anchor)), 100);
      else {
        const hasExistingContent = controls.some((candidate) => {
          const type = fieldType(candidate);
          const value = currentValue(candidate, type);
          if (type === "radio" || type === "checkbox") return value === true;
          return cleanText(value) !== "";
        });
        if (hasExistingContent) recordLabel = "未识别的已有记录";
      }
    }
    return {
      record,
      groupIndex: groupIndex >= 0 ? groupIndex : undefined,
      groupCount: groupIndex >= 0 ? records.length : undefined,
      recordLabel: recordLabel || undefined,
    };
  }

  function fieldHelpText(element) {
    const container = fieldContainer(element);
    const described = cleanText(element.getAttribute?.("aria-describedby"));
    const describedText = described.split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById?.(id)).filter(Boolean)
      .map((node) => cleanText(node.textContent)).filter(Boolean).join(" ");
    if (describedText) return shortText(describedText);
    const help = container?.querySelector?.(
      "[class*='help'],[class*='Help'],[class*='tip'],[class*='Tip'],[class*='description'],[class*='Description'],[class*='extra'],[aria-live]",
    );
    return shortText(help?.textContent) || undefined;
  }

  function fieldContext(element, label, section, recordLabel) {
    return shortText([section, recordLabel, label, fieldHelpText(element)].filter(Boolean).join(" / ")) || undefined;
  }

  function describeField(element) {
    const type = fieldType(element);
    const label = getLabel(element);
    const section = getSection(element);
    const record = recordInfo(element);
    const field = {
      id: getFieldId(element),
      label,
      type,
      value: currentValue(element, type),
    };
    if (section) field.section = section;
    const helpText = fieldHelpText(element);
    if (helpText) field.helpText = helpText;
    const context = fieldContext(element, label, section, record.recordLabel);
    if (context) field.context = context;
    if (record.recordLabel) field.recordLabel = record.recordLabel;
    if (record.groupIndex !== undefined) field.groupIndex = record.groupIndex;
    if (record.groupCount !== undefined) field.groupCount = record.groupCount;
    const rect = elementRect(pickerControlRoot(element) || element);
    if (rect) field.rect = rect;
    const fieldKey = trustedFieldKey(element);
    if (fieldKey) field.fieldKey = fieldKey;
    if (String(element.tagName || "").toLowerCase() === "select") {
      field.options = Array.from(element.options || []).map((option) => ({
        value: String(option.value),
        label: cleanText(option.textContent || option.label),
      }));
    } else if (type === "radio") {
      field.options = [{ value: String(element.value || ""), label: radioChoiceLabel(element) }]
        .filter((option) => option.value && option.label);
    } else if (type === "combobox") {
      const options = visiblePickerOptions(element).map((option) => ({
        value: cleanText(option.getAttribute?.("data-value") || option.getAttribute?.("value") || option.textContent),
        label: cleanText(option.textContent),
      })).filter((option) => option.label);
      if (options.length) field.options = options;
    }
    fieldAnchors.set(field.id, {
      label: field.label,
      type: field.type,
      section: field.section || "",
      recordLabel: field.recordLabel || "",
      groupIndex: field.groupIndex,
      groupCount: field.groupCount,
    });
    return field;
  }

  function trustedFieldKey(element) {
    const range = element.closest?.(
      ".throne-biz-date-range-picker-wrapper,[class*='date-range-picker'],[class*='DateRangePicker'],[class*='dateRangePicker']",
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
      ".ud__select,.semi-select,.ant-select,.ant-cascader-picker,.semi-cascader,.el-select,[class*='select-wrapper'],[class*='SelectWrapper'],[class*='cascader']",
    );
    if (inline) roots.push(inline);
    const isActiveOrOpen = document.activeElement === element ||
      element.getAttribute?.("aria-expanded") === "true";
    if (!hasOwnedPopup && (allowDetachedPortal || isActiveOrOpen)) {
      const popupSelector = [
        "[role='listbox']", "[role='tree']", ".ud__select__list", ".semi-select-option-list",
        "[role='dialog']", "[role='grid']", ".ant-select-dropdown", ".ant-cascader-menus",
        ".ant-picker-dropdown", ".ant-calendar-picker-container", ".ant-calendar", ".semi-datepicker", ".ud__picker", ".el-select-dropdown",
        ".el-picker-panel", "[class*='date-picker-panel']", "[class*='DatePickerPanel']",
      ].join(",");
      const visiblePopups = [...new Set(Array.from(document.querySelectorAll?.(popupSelector) || []).filter(isVisible))];
      const popups = visiblePopups.filter((candidate) => !visiblePopups.some((other) => (
        other !== candidate && typeof other.contains === "function" && other.contains(candidate)
      )));
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
      ".ant-cascader-menu-item[role='menuitem']",
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

  function visibleControlCandidates(element) {
    const candidates = visiblePickerOptions(element, true);
    const seen = new Set(candidates);
    const selector = [
      "button", "[role='button']", "[role='gridcell']", "[role='cell']",
      ".ud__picker__cell-interactive-area", ".ant-picker-cell-inner",
      ".ant-calendar-date", ".ant-calendar-prev-year-btn", ".ant-calendar-next-year-btn",
      ".ant-calendar-prev-month-btn", ".ant-calendar-next-month-btn",
      ".semi-datepicker-day", ".el-date-table td",
    ].join(",");
    for (const root of pickerRoots(element, true)) {
      for (const candidate of root.querySelectorAll?.(selector) || []) {
        if (seen.has(candidate) || !isVisible(candidate) || isDisabledOption(candidate)) continue;
        if (candidate.closest?.("[data-personal-resume-ui]")) continue;
        const label = shortText(
          candidate.getAttribute?.("aria-label") || candidate.getAttribute?.("title") || candidate.textContent,
          120,
        );
        if (!label || DANGEROUS_CONTROL_TEXT.test(label)) continue;
        seen.add(candidate);
        candidates.push(candidate);
      }
    }
    return candidates;
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

  function normalizedCascaderSegment(value) {
    return normalizedChoice(String(value || "").replace(/[（(][^）)]*[）)]/g, ""))
      .replace(/相关(?=类$)/u, "");
  }

  function isEducationPrefix(value) {
    return /^(?:(?:专业学位|学术学位)?(?:博士|硕士)|本科|专科|大专|高中|中专|普通教育|统招|非统招|自考|其他)/i.test(
      normalizedCascaderSegment(value),
    );
  }

  function isCascaderPicker(element) {
    if (cleanText(element.getAttribute?.("aria-haspopup")).toLowerCase() === "tree") return true;
    return Boolean(element.closest?.(
      ".ant-cascader,.el-cascader,.semi-cascader,.ud__cascader,[class*='cascader'],[class*='Cascader']",
    ));
  }

  function exactCascaderOptions(element, requested) {
    const normalize = /(地址|地区|城市|省市|居住|户籍)/i.test(getLabel(element))
      ? normalizedRegionSegment
      : normalizedCascaderSegment;
    const expected = normalize(requested);
    return visiblePickerOptions(element, true).filter((option) => {
      const values = [
        option.textContent,
        option.getAttribute?.("data-value"),
        option.getAttribute?.("value"),
        option.getAttribute?.("aria-label"),
      ].map(normalize).filter(Boolean);
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

  function exactDate(value) {
    const match = cleanText(value).match(/^((?:19|20)\d{2})\D{0,3}(0?[1-9]|1[0-2])\D{0,3}(0?[1-9]|[12]\d|3[01])$/);
    if (!match) return "";
    return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
  }

  function isPresentDate(value) {
    return /^(至今|现在|当前|今|present|current|now)$/i.test(cleanText(value));
  }

  function normalizedDateCandidate(value) {
    const text = cleanText(value);
    const chinese = text.match(/((?:19|20)\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    if (chinese) return `${chinese[1]}-${String(chinese[2]).padStart(2, "0")}-${String(chinese[3]).padStart(2, "0")}`;
    return exactDate(text);
  }

  function antDatePanelRoots(element) {
    return pickerRoots(element, true).filter((root) => (
      root.matches?.(".ant-calendar-picker-container,.ant-calendar,.ant-picker-dropdown") ||
      root.querySelector?.(".ant-calendar-date,[data-value],td[title]")
    ));
  }

  function findExactAntDateCell(element, requested) {
    const target = exactDate(requested);
    if (!target) return null;
    const selector = ".ant-calendar-date,.ant-picker-cell-inner,td[title],[data-value]";
    const matches = new Map();
    for (const root of antDatePanelRoots(element)) {
      for (const candidate of root.querySelectorAll?.(selector) || []) {
        if (!isVisible(candidate) || isDisabledOption(candidate)) continue;
        const values = [
          candidate.getAttribute?.("title"), candidate.getAttribute?.("data-value"),
          candidate.parentElement?.getAttribute?.("title"), candidate.textContent,
        ].map(normalizedDateCandidate).filter(Boolean);
        if (!values.includes(target)) continue;
        const unit = candidate.closest?.("td[title],[role='gridcell'],.ant-picker-cell") || candidate;
        const preferred = candidate.matches?.(".ant-calendar-date,.ant-picker-cell-inner")
          ? candidate
          : (unit.querySelector?.(".ant-calendar-date,.ant-picker-cell-inner") || candidate);
        const previous = matches.get(unit);
        if (!previous || preferred !== unit) matches.set(unit, preferred);
      }
    }
    return matches.size === 1 ? [...matches.values()][0] : null;
  }

  async function applyAntDatePicker(element, requested, operationId) {
    const panels = antDatePanelRoots(element);
    if (!panels.length) return null;
    const explicitOption = findExactPickerOption(element, requested);
    if (isPresentDate(requested)) {
      if (!explicitOption) return { status: "skipped", reason: "date_present_unavailable" };
      return null;
    }
    if (yearMonth(requested) && !exactDate(requested)) {
      return { status: "skipped", reason: "date_precision_required" };
    }
    const target = exactDate(requested);
    if (!target) return null;
    const cell = findExactAntDateCell(element, requested);
    if (!cell) return null;
    dispatchPointerClick(cell);
    const readback = await waitFor(
      () => exactDate(currentValue(element, fieldType(element))) === target,
      operationId,
      700,
    );
    if (readback.cancelled) return { status: "skipped", reason: "cancelled" };
    return readback.value
      ? { status: "applied" }
      : { status: "failed", reason: "value_mismatch" };
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
    const rawSegments = requested.split(/\s*(?:\/|>|›|→)\s*/).map(cleanText).filter(Boolean);
    const segments = rawSegments.length > 2 && isEducationPrefix(rawSegments[0])
      ? rawSegments.slice(1)
      : rawSegments;
    if (segments.length < 2) return null;
    const closeWith = (result) => {
      sendEscape(element);
      return result;
    };
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const found = await waitFor(() => {
        const matches = exactCascaderOptions(element, segment);
        return matches.length ? matches : null;
      }, operationId);
      if (found.cancelled) return closeWith({ status: "skipped", reason: "cancelled" });
      const matches = found.value || [];
      if (!matches.length) return closeWith({ status: "skipped", reason: `cascader_option_not_found:${index}` });
      if (matches.length !== 1) return closeWith({ status: "skipped", reason: `cascader_option_ambiguous:${index}` });
      const option = matches[0];
      if (isDisabledOption(option)) return closeWith({ status: "skipped", reason: "option_disabled" });
      dispatchPointerClick(option);
      if (index < segments.length - 1) {
        const next = segments[index + 1];
        const advanced = await waitFor(() => exactCascaderOptions(element, next).length === 1, operationId, 700);
        if (advanced.cancelled) return closeWith({ status: "skipped", reason: "cancelled" });
        if (!advanced.value) return closeWith({ status: "failed", reason: `cascader_level_timeout:${index + 1}` });
      }
    }
    const normalize = /(地址|地区|城市|省市|居住|户籍)/i.test(getLabel(element))
      ? normalizedRegionSegment
      : normalizedCascaderSegment;
    const finalSegment = normalize(segments.at(-1));
    const readback = await waitFor(() => {
      const value = currentValue(element, fieldType(element));
      const selected = selectedPickerValues(element);
      const currentPath = value.split(/\s*(?:\/|>|›|→|；)\s*/).map(normalize).filter(Boolean);
      return (
        currentPath.length >= segments.length &&
        segments.every((segment, index) => currentPath[index] === normalize(segment))
      ) || normalize(value) === finalSegment || selected.some((item) => normalize(item) === finalSegment);
    }, operationId, 700);
    if (readback.cancelled) return closeWith({ status: "skipped", reason: "cancelled" });
    return readback.value
      ? { status: "applied" }
      : closeWith({ status: "failed", reason: "value_mismatch" });
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
      const antDateResult = await applyAntDatePicker(element, requested, operationId);
      if (antDateResult) return antDateResult;
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
    return radioGroupElements(element).some((candidate) => candidate.checked);
  }

  function radioGroupElements(element) {
    const name = String(element.name || element.getAttribute("name") || "");
    if (name) {
      const root = element.form || (typeof element.getRootNode === "function" && element.getRootNode()) || document;
      if (!root || typeof root.querySelectorAll !== "function") return [element];
      return Array.from(root.querySelectorAll("input[type='radio']")).filter(
        (candidate) => String(candidate.name || candidate.getAttribute("name") || "") === name,
      );
    }
    const group = element.closest?.(
      "[role='radiogroup'],.ant-radio-group,.semi-radio-group,[class*='radioGroup'],[class*='RadioGroup'],[class*='radio-group']",
    );
    if (!group?.querySelectorAll) return [element];
    const peers = Array.from(group.querySelectorAll("input[type='radio']"));
    return peers.includes(element) ? peers : [element];
  }

  function selectRadioElement(element) {
    element.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
    element.focus?.({ preventScroll: true });
    // A native click is the one interaction React-controlled radios expect. Do
    // not pre-set the value or emit a second change event: either can make a
    // site's confirmation effect run twice.
    if (typeof element.click === "function") element.click();
    else element.dispatchEvent(new Event("click", { bubbles: true, composed: true, cancelable: true }));
    if (element.checked) return;

    // Minimal fallback for non-native/custom test controls. Only the selected
    // radio emits a change; browsers clear its peers as part of one selection.
    for (const peer of radioGroupElements(element)) {
      if (peer !== element && peer.checked) nativeSetter(peer, "checked", false);
    }
    nativeSetter(element, "checked", true);
    emitChangeEvents(element);
  }

  function normalizedConfirmationText(value) {
    return cleanText(value).replace(/[\s\u00a0]+/g, "");
  }

  function highestDegreeConfirmationModal() {
    const selector = ".ant-modal-confirm:not([aria-hidden='true']),[role='dialog'].ant-modal-confirm:not([aria-hidden='true'])";
    const matches = Array.from(document.querySelectorAll?.(selector) || []).filter((modal) => {
      if (!isVisible(modal)) return false;
      const content = modal.querySelector?.(
        ".ant-modal-confirm-content,.ant-modal-confirm-body .ant-modal-confirm-content",
      );
      return normalizedConfirmationText(content?.textContent) ===
        normalizedConfirmationText(HIGHEST_DEGREE_CONFIRMATION_TEXT);
    });
    return matches.length === 1 ? matches[0] : (matches.length > 1 ? "ambiguous" : null);
  }

  function exactHighestDegreeConfirmButton(modal) {
    const buttons = Array.from(modal.querySelectorAll?.("button") || []).filter((button) => {
      if (!isVisible(button) || button.disabled) return false;
      return ["确认", "确定", "确认修改"].includes(cleanText(button.textContent));
    });
    return buttons.length === 1 ? buttons[0] : null;
  }

  async function handleHighestDegreeConfirmation(element, operationId) {
    if (radioChoiceBoolean(element) !== true || !/是否最高学历/.test(radioGroupTitle(element))) {
      return { status: "applied" };
    }
    const deadline = Date.now() + 400;
    let modal = null;
    do {
      if (operationId !== activeOperationId) return { status: "skipped", reason: "cancelled" };
      modal = highestDegreeConfirmationModal();
      if (modal) break;
      await delay(POLL_INTERVAL_MS);
    } while (Date.now() < deadline);
    if (!modal) return { status: "applied" };
    if (modal === "ambiguous") return { status: "skipped", reason: "site_confirmation_required" };

    const confirm = exactHighestDegreeConfirmButton(modal);
    if (!confirm) return { status: "skipped", reason: "site_confirmation_required" };
    confirm.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
    confirm.focus?.({ preventScroll: true });
    if (typeof confirm.click === "function") confirm.click();
    else confirm.dispatchEvent(new Event("click", { bubbles: true, composed: true, cancelable: true }));
    const closed = await waitFor(
      () => !modal.isConnected || !isVisible(modal) || highestDegreeConfirmationModal() !== modal,
      operationId,
      1200,
    );
    if (closed.cancelled) return { status: "skipped", reason: "cancelled" };
    if (!closed.value) return { status: "skipped", reason: "site_confirmation_required" };
    return element.checked
      ? { status: "applied" }
      : { status: "failed", reason: "value_mismatch" };
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
      const choiceBoolean = radioChoiceBoolean(element);
      const matchesBooleanChoice = checked !== null && choiceBoolean !== null && checked === choiceBoolean;
      if (checked === null && !matchesValue) {
        return { status: "skipped", reason: "radio_value_mismatch" };
      }
      if (checked !== null && choiceBoolean !== null && !matchesBooleanChoice) {
        return { status: "skipped", reason: "radio_value_mismatch" };
      }
      if (checked === null || matchesBooleanChoice || checked === true) {
        selectRadioElement(element);
        if (!element.checked) return { status: "failed", reason: "value_mismatch" };
        return handleHighestDegreeConfirmation(element, operationId);
      }
      else nativeSetter(element, "checked", false);
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
      const expected = type === "radio" ? true : booleanValue(value);
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
    globalThis.__personalResumeFloatingPanel?.resume?.();
    if (typeof chrome.runtime?.sendMessage === "function") {
      try { chrome.runtime.sendMessage({ type: "CONTROL_CANCEL" }); } catch (error) { /* optional controller */ }
    }
    return { cancelled: true };
  }

  function allSupportedElements() {
    const elements = [];
    const seen = new Set();
    for (const root of rootsWithOpenShadows(document)) {
      for (const element of root.querySelectorAll?.(FIELD_SELECTOR) || []) {
        if (!seen.has(element) && isSupportedField(element)) {
          seen.add(element);
          elements.push(element);
        }
      }
    }
    return elements;
  }

  function relocateField(fieldId) {
    const anchor = fieldAnchors.get(fieldId);
    if (!anchor) return { reason: "unknown_field" };
    const matches = allSupportedElements().filter((candidate) => {
      if (getLabel(candidate) !== anchor.label || fieldType(candidate) !== anchor.type) return false;
      if ((getSection(candidate) || "") !== anchor.section) return false;
      const record = recordInfo(candidate);
      if (anchor.groupIndex !== undefined && record.groupIndex !== anchor.groupIndex) return false;
      if (anchor.groupCount !== undefined && record.groupCount !== anchor.groupCount) return false;
      if (anchor.recordLabel && (record.recordLabel || "") !== anchor.recordLabel) return false;
      return true;
    });
    if (matches.length !== 1) return { reason: matches.length ? "relocation_ambiguous" : "relocation_not_found" };
    fieldElements.set(fieldId, matches[0]);
    return { element: matches[0] };
  }

  function resolveField(fieldId) {
    const current = fieldElements.get(fieldId);
    if (current?.isConnected && isSupportedField(current)) return { element: current };
    const relocated = relocateField(fieldId);
    if (!relocated.element && current && !current.isConnected && relocated.reason === "relocation_not_found") {
      return { reason: "detached_field" };
    }
    return relocated;
  }

  function targetRoot(element) {
    return pickerControlRoot(element) || element;
  }

  function viewportSize() {
    return {
      width: Number(globalThis.innerWidth || document.documentElement?.clientWidth || 0),
      height: Number(globalThis.innerHeight || document.documentElement?.clientHeight || 0),
    };
  }

  function isDangerousControl(element) {
    const type = String(element?.type || "").toLowerCase();
    if (["file", "submit", "button", "image", "password"].includes(type)) return true;
    return DANGEROUS_CONTROL_TEXT.test([
      getLabel(element), element?.textContent, element?.getAttribute?.("aria-label"),
      element?.getAttribute?.("title"), element?.getAttribute?.("name"),
    ].map(cleanText).join(" "));
  }

  function controlTarget(fieldId, options = {}) {
    const operationId = activeOperationId;
    const resolved = resolveField(fieldId);
    if (!resolved.element) return { ok: false, fieldId, blocked: true, reason: resolved.reason, operationId };
    const element = resolved.element;
    const type = fieldType(element);
    const nonempty = hasExistingValue(element, type);
    const blocked = isDangerousControl(element) || (!options.overwrite && nonempty);
    const root = targetRoot(element);
    if (!blocked) {
      globalThis.__personalResumeFloatingPanel?.suspend?.();
      root.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
      element.focus?.({ preventScroll: true });
    }
    const description = describeField(element);
    return {
      ok: !blocked,
      fieldId,
      type,
      label: description.label,
      section: description.section,
      recordLabel: description.recordLabel,
      groupIndex: description.groupIndex,
      groupCount: description.groupCount,
      nonempty,
      blocked,
      reason: blocked ? (nonempty && !options.overwrite ? "non_empty" : "unsafe_control") : undefined,
      rect: elementRect(root),
      viewport: viewportSize(),
      operationId,
    };
  }

  function candidateId(option) {
    let id = candidateIds.get(option);
    if (!id) {
      id = `candidate-${documentNonce}-${nextCandidateId++}`;
      candidateIds.set(option, id);
    }
    controlCandidates.set(id, option);
    return id;
  }

  function controlOptions(fieldId) {
    const operationId = activeOperationId;
    const resolved = resolveField(fieldId);
    if (!resolved.element) return { ok: false, fieldId, options: [], reason: resolved.reason, operationId };
    const element = resolved.element;
    const roots = pickerRoots(element, true).filter(isVisible);
    const options = visibleControlCandidates(element).map((option) => ({
      id: candidateId(option),
      label: shortText(option.getAttribute?.("aria-label") || option.getAttribute?.("title") || option.textContent, 120),
      disabled: isDisabledOption(option),
      rect: elementRect(option),
    })).filter((option) => option.label && rectIntersectsViewport(option.rect));
    const pickerRoot = roots.length === 1 ? roots[0] : (pickerControlRoot(element) || element);
    return {
      ok: true,
      fieldId,
      pickerRect: elementRect(pickerRoot),
      options,
      operationId,
    };
  }

  function pointInRect(x, y, rect) {
    return Boolean(rect && Number.isFinite(x) && Number.isFinite(y) &&
      x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height);
  }

  function rectIntersectsViewport(rect) {
    const viewport = viewportSize();
    return Boolean(rect && rect.width > 0 && rect.height > 0 &&
      rect.x < viewport.width && rect.y < viewport.height &&
      rect.x + rect.width > 0 && rect.y + rect.height > 0);
  }

  function pointInActivationZone(x, y, rect) {
    if (!rect) return false;
    const insetX = Math.min(rect.width * 0.2, 24);
    const insetY = Math.min(rect.height * 0.15, 8);
    return pointInRect(x, y, {
      x: rect.x + insetX,
      y: rect.y + insetY,
      width: Math.max(0, rect.width - insetX * 2),
      height: Math.max(0, rect.height - insetY * 2),
    });
  }

  function pointHitsElement(element, x, y) {
    if (typeof document.elementFromPoint !== "function") return true;
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit && (hit === element || element?.contains?.(hit)));
  }

  function guardControlPoint(fieldId, x, y, candidateIdValue) {
    const operationId = activeOperationId;
    const resolved = resolveField(fieldId);
    if (!resolved.element) return { ok: false, allowed: false, reason: resolved.reason, operationId };
    const element = resolved.element;
    if (isDangerousControl(element)) return { ok: true, allowed: false, reason: "unsafe_control", operationId };
    const candidate = candidateIdValue ? controlCandidates.get(candidateIdValue) : null;
    const candidateLabel = shortText(
      candidate?.getAttribute?.("aria-label") || candidate?.getAttribute?.("title") || candidate?.textContent,
      120,
    );
    if (candidateIdValue && (!candidate || !candidate.isConnected || !isVisible(candidate) ||
      isDisabledOption(candidate) || DANGEROUS_CONTROL_TEXT.test(candidateLabel))) {
      return { ok: true, allowed: false, reason: "invalid_candidate", operationId };
    }
    const root = targetRoot(element);
    const targetAllowed = pointInActivationZone(x, y, elementRect(root)) && pointHitsElement(root, x, y);
    const boundOptions = visibleControlCandidates(element);
    const optionAllowed = candidate
      ? boundOptions.includes(candidate) && pointInRect(x, y, elementRect(candidate)) && pointHitsElement(candidate, x, y)
      : boundOptions.some((option) => !isDisabledOption(option) &&
        pointInRect(x, y, elementRect(option)) && pointHitsElement(option, x, y));
    return {
      ok: true,
      allowed: Boolean(targetAllowed || optionAllowed),
      reason: targetAllowed || optionAllowed ? undefined : "outside_control_bounds",
      operationId,
    };
  }

  function verifyControl(fieldId, value) {
    const operationId = activeOperationId;
    const resolved = resolveField(fieldId);
    if (!resolved.element) return { ok: false, verified: false, reason: resolved.reason, operationId };
    const type = fieldType(resolved.element);
    const actual = currentValue(resolved.element, type);
    const expected = cleanText(value);
    const boolean = booleanValue(value);
    const radioVerified = type === "radio" && boolean !== null &&
      radioChoiceBoolean(resolved.element) === boolean && Boolean(resolved.element.checked);
    const verified = radioVerified || normalizedChoice(actual) === normalizedChoice(expected) ||
      selectedPickerValues(resolved.element).some((selected) => normalizedChoice(selected) === normalizedChoice(expected));
    return { ok: true, verified, actual: shortText(actual, 200), reason: verified ? undefined : "value_mismatch", operationId };
  }

  async function requestControlFill(item, overwrite, options, operationId) {
    if (!item?.sourcePath || typeof chrome.runtime?.sendMessage !== "function") return null;
    if (operationId !== activeOperationId) return { status: "skipped", reason: "cancelled" };
    try {
      const response = await chrome.runtime.sendMessage({
        type: "CONTROL_FILL",
        fieldId: item.fieldId,
        sourcePath: item.sourcePath,
        resumeId: options.resumeId,
        overwrite,
        vision: options.visionFallback === true,
        operationId,
      });
      if (operationId !== activeOperationId) return { status: "skipped", reason: "cancelled" };
      const result = response?.result && typeof response.result === "object"
        ? response.result
        : (response?.status ? {
          status: response.status,
          reason: response.reason,
          method: response.method,
          via: response.via,
        } : null);
      if (result?.status === "applied" && !verifyControl(item.fieldId, item.value).verified) {
        return { status: "failed", reason: "control_verification_failed" };
      }
      return result;
    } catch (error) {
      return null;
    }
  }

  async function applyItems(items, overwrite, options = {}) {
    if (!Array.isArray(items)) return [];
    const operationId = ++activeOperationId;
    const results = [];
    let confirmationBlocked = false;
    for (const item of items) {
      const fieldId = item && typeof item.fieldId === "string" ? item.fieldId : "";
      try {
        if (confirmationBlocked) {
          results.push({ fieldId, status: "skipped", reason: "site_confirmation_required" });
          continue;
        }
        if (operationId !== activeOperationId) {
          results.push({ fieldId, status: "skipped", reason: "cancelled" });
          continue;
        }
        const resolved = resolveField(fieldId);
        const element = resolved.element;
        if (!element) { results.push({ fieldId, status: "skipped", reason: resolved.reason }); continue; }
        const type = fieldType(element);
        if (!overwrite && hasExistingValue(element, type)) {
          results.push({ fieldId, status: "skipped", reason: "non_empty" }); continue;
        }
        let result = await applyValue(element, item.value, operationId);
        if (result.status !== "applied" && !CONTROL_FALLBACK_BLOCKED_REASONS.has(result.reason) &&
          options.browserControl === true) {
          result = await requestControlFill(item, overwrite, options, operationId) || result;
        }
        results.push({ fieldId, ...result });
        if (result.reason === "site_confirmation_required") confirmationBlocked = true;
      } catch (error) {
        const fallback = options.browserControl === true
          ? await requestControlFill(item, overwrite, options, operationId) : null;
        results.push({ fieldId, ...(fallback || { status: "failed", reason: "exception" }) });
      }
    }
    return results;
  }

  // Shared only within Chrome's isolated extension world; no page message bridge.
  globalThis.__personalResumeBridge = {
    scan: scanPage,
    apply: applyItems,
    cancel: cancelApply,
    controlTarget,
    controlOptions,
    verifyControl,
    guardControlPoint,
  };
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!sender || sender.id !== chrome.runtime.id) return false;
    if (!message || typeof message !== "object") return false;
    if (message.type === "SCAN") {
      sendResponse(scanPage());
      return false;
    }
    if (message.type === "APPLY") {
      applyItems(message.items, message.overwrite === true, message.options || {})
        .then((results) => sendResponse({ results }))
        .catch(() => sendResponse({ results: [], error: "apply_failed" }));
      return true;
    }
    if (message.type === "CANCEL") {
      sendResponse(cancelApply());
      return false;
    }
    if (message.type === "CONTROL_TARGET") {
      sendResponse(controlTarget(message.fieldId, { overwrite: message.overwrite === true }));
      return false;
    }
    if (message.type === "CONTROL_OPTIONS") {
      sendResponse(controlOptions(message.fieldId));
      return false;
    }
    if (message.type === "CONTROL_VERIFY") {
      sendResponse(verifyControl(message.fieldId, message.value));
      return false;
    }
    if (message.type === "CONTROL_GUARD") {
      sendResponse(guardControlPoint(message.fieldId, Number(message.x), Number(message.y), message.candidateId));
      return false;
    }
    if (message.type === "CONTROL_END") {
      globalThis.__personalResumeFloatingPanel?.resume?.();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
