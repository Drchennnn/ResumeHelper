(() => {
  const editors = new WeakMap();
  for (const root of document.querySelectorAll(".ql-editor")) {
    let value = root.textContent || "";
    editors.set(root, {
      setText(text) { value = String(text); root.textContent = value; },
      getText() { return `${value}\n`; },
    });
  }
  globalThis.Quill = { find(root) { return editors.get(root) || null; } };
})();
