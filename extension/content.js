/*
 * Page bridge API:
 *   { type: "SCAN" } -> { fields, url, title }
 *   { type: "APPLY", items: [{ fieldId, value }], overwrite?: boolean }
 *     -> { results: [{ fieldId, status, reason? }] }
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
  const FIELD_SELECTOR = [
    "input",
    "textarea",
    "select",
    "[contenteditable]:not([contenteditable='false'])",
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
    if (element.readOnly || element.getAttribute("readonly") !== null) return false;
    if (tag === "input") {
      const type = String(element.type || "text").toLowerCase();
      if (EXCLUDED_INPUT_TYPES.has(type)) return false;
      if (type === "checkbox" && isSensitiveConsentCheckbox(element)) return false;
      return true;
    }
    return tag === "textarea" || tag === "select" || element.isContentEditable;
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
    const direct = cleanText(element.getAttribute("aria-label"));
    if (direct) return direct;

    const labelledBy = cleanText(element.getAttribute("aria-labelledby"));
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => cleanText(node.textContent))
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }

    if (element.labels && element.labels.length) {
      const text = Array.from(element.labels)
        .map(labelTextWithoutControls)
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }

    if (typeof element.closest === "function") {
      const wrappingLabel = element.closest("label");
      if (wrappingLabel) {
        const text = labelTextWithoutControls(wrappingLabel);
        if (text) return text;
      }
    }

    return (
      cleanText(element.getAttribute("placeholder")) ||
      cleanText(element.getAttribute("name")) ||
      cleanText(element.id) ||
      "未命名字段"
    );
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
    const namedContainer = (element.parentElement || element).closest("[data-section],[aria-label],fieldset,section");
    if (!namedContainer) return undefined;
    const explicit = cleanText(
      namedContainer.getAttribute("data-section") || namedContainer.getAttribute("aria-label"),
    );
    if (explicit) return explicit;
    const heading = namedContainer.querySelector("legend,h1,h2,h3,h4,h5,h6");
    return heading ? cleanText(heading.textContent) || undefined : undefined;
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
    return String(element.type || "text").toLowerCase();
  }

  function currentValue(element, type) {
    if (type === "checkbox" || type === "radio") return Boolean(element.checked);
    if (type === "contenteditable") return cleanText(element.textContent);
    return element.value == null ? "" : String(element.value);
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
    if (String(element.tagName || "").toLowerCase() === "select") {
      field.options = Array.from(element.options || []).map((option) => ({
        value: String(option.value),
        label: cleanText(option.textContent || option.label),
      }));
    }
    return field;
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

  function applyValue(element, value) {
    const type = fieldType(element);
    const tag = String(element.tagName || "").toLowerCase();

    if (type === "checkbox") {
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

  function applyItems(items, overwrite) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => {
      const fieldId = item && typeof item.fieldId === "string" ? item.fieldId : "";
      try {
        const element = fieldElements.get(fieldId);
        if (!element) return { fieldId, status: "skipped", reason: "unknown_field" };
        if (!element.isConnected) {
          fieldElements.delete(fieldId);
          return { fieldId, status: "skipped", reason: "detached_field" };
        }
        if (!isSupportedField(element)) return { fieldId, status: "skipped", reason: "unavailable_field" };
        const type = fieldType(element);
        if (!overwrite && hasExistingValue(element, type)) {
          return { fieldId, status: "skipped", reason: "non_empty" };
        }
        const result = applyValue(element, item.value);
        return { fieldId, ...result };
      } catch (error) {
        return { fieldId, status: "failed", reason: "exception" };
      }
    });
  }

  // Shared only within Chrome's isolated extension world; no page message bridge.
  globalThis.__personalResumeBridge = {scan: scanPage, apply: applyItems};
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!sender || sender.id !== chrome.runtime.id) return false;
    if (!message || typeof message !== "object") return false;
    if (message.type === "SCAN") {
      sendResponse(scanPage());
      return false;
    }
    if (message.type === "APPLY") {
      sendResponse({ results: applyItems(message.items, message.overwrite === true) });
      return false;
    }
    return false;
  });
})();
