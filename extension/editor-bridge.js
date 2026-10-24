/*
 * Main-world rich-text bridge. It exposes one bounded operation: replace the
 * plain text of a supported editor that the isolated content script tagged.
 * The page never receives extension state, resume data beyond that one value,
 * API credentials, file access, or an arbitrary script/HTML execution path.
 */
(function installPersonalResumeEditorBridge() {
  "use strict";

  const INSTALL_KEY = "__personalResumeEditorBridgeInstalled__";
  const REQUEST_EVENT = "personal-resume-editor-request";
  const RESPONSE_EVENT = "personal-resume-editor-response";
  const TOKEN_ATTRIBUTE = "data-personal-resume-editor-token";
  const MAX_TEXT_LENGTH = 10000;
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  function plainTextFromHtml(html) {
    const container = document.createElement("div");
    container.innerHTML = String(html || "");
    for (const br of container.querySelectorAll?.("br") || []) br.replaceWith("\n");
    return String(container.textContent || "").replace(/\u00a0/g, " ");
  }

  function escapedPlainText(text) {
    const container = document.createElement("div");
    container.textContent = text;
    return container.innerHTML.replace(/\r?\n/g, "<br>");
  }

  function editorFor(target) {
    const id = String(target.id || "");
    const ck4 = id && globalThis.CKEDITOR?.instances?.[id];
    if (ck4 && typeof ck4.setData === "function" && typeof ck4.getData === "function") {
      return {
        kind: "ckeditor4",
        async set(text) {
          await new Promise((resolve) => {
            let settled = false;
            const finish = () => { if (!settled) { settled = true; resolve(); } };
            try { ck4.setData(escapedPlainText(text), { callback: finish }); }
            catch (error) { ck4.setData(escapedPlainText(text)); finish(); }
            setTimeout(finish, 800);
          });
          return plainTextFromHtml(ck4.getData());
        },
      };
    }

    const ck5Target = target.ckeditorInstance ? target : target.closest?.(".ck-editor__editable,[data-ckeditor-instance]");
    const ck5 = ck5Target?.ckeditorInstance;
    if (ck5 && typeof ck5.setData === "function" && typeof ck5.getData === "function") {
      return {
        kind: "ckeditor5",
        async set(text) {
          await ck5.setData(escapedPlainText(text));
          return plainTextFromHtml(ck5.getData());
        },
      };
    }

    const tiny = id && globalThis.tinymce?.get?.(id);
    if (tiny && typeof tiny.setContent === "function" && typeof tiny.getContent === "function") {
      return {
        kind: "tinymce",
        async set(text) {
          tiny.setContent(escapedPlainText(text), { format: "html" });
          return String(tiny.getContent({ format: "text" }) || "");
        },
      };
    }

    const quillRoot = target.matches?.(".ql-editor") ? target : target.querySelector?.(".ql-editor");
    const quill = quillRoot && globalThis.Quill?.find?.(quillRoot);
    if (quill && typeof quill.setText === "function" && typeof quill.getText === "function") {
      return {
        kind: "quill",
        async set(text) {
          quill.setText(text, "user");
          return String(quill.getText() || "").replace(/\n$/, "");
        },
      };
    }
    return null;
  }

  function respond(target, detail) {
    target.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      bubbles: false,
      composed: false,
      detail,
    }));
  }

  document.addEventListener(REQUEST_EVENT, async (event) => {
    const target = event.target;
    const detail = event.detail;
    if (!(target instanceof Element) || !detail || typeof detail !== "object") return;
    const token = String(detail.token || "");
    const requestId = String(detail.requestId || "");
    const text = typeof detail.text === "string" ? detail.text : "";
    if (!token || !requestId || detail.action !== "setPlainText" || detail.origin !== location.origin) return;
    if (!target.isConnected || target.getAttribute(TOKEN_ATTRIBUTE) !== token) return;
    if (text.length > MAX_TEXT_LENGTH) {
      respond(target, { token, requestId, ok: false, reason: "too_long" });
      return;
    }
    const editor = editorFor(target);
    if (!editor) {
      respond(target, { token, requestId, ok: false, reason: "unsupported_rich_text_editor" });
      return;
    }
    try {
      const actual = await editor.set(text);
      respond(target, {
        token,
        requestId,
        ok: actual === text,
        actual: String(actual || "").slice(0, MAX_TEXT_LENGTH),
        editor: editor.kind,
        reason: actual === text ? undefined : "value_mismatch",
      });
    } catch (error) {
      respond(target, { token, requestId, ok: false, reason: "editor_set_failed" });
    }
  }, true);
})();
