globalThis.chrome = { runtime: { id: "fictional-dynamic-fixture", onMessage: { addListener() {} } } };

document.addEventListener("DOMContentLoaded", () => {
  const result = document.querySelector("#result");
  const records = document.querySelector(".records");
  const next = document.querySelector(".next");
  const submit = document.querySelector(".submit");
  let nextClicks = 0;
  let submitClicks = 0;

  const addRecord = () => {
    const index = records.children.length;
    const row = document.createElement("div");
    row.className = "apply-form-array-card-content";
    row.dataset.resumeHelperRecord = "project";
    row.innerHTML = `<label>项目名称<input data-form-field-name="project_name_${index}" aria-label="项目名称"></label><div class="linked"></div>`;
    const name = row.querySelector("input");
    const reveal = () => {
      if (!name.value || row.querySelector("[aria-label='项目链接']")) return;
      setTimeout(() => {
        const wrapper = document.createElement("label");
        wrapper.textContent = "项目链接";
        const input = document.createElement("input");
        input.dataset.formFieldName = `project_url_${index}`;
        input.setAttribute("aria-label", "项目链接");
        wrapper.append(input);
        row.querySelector(".linked").replaceChildren(wrapper);
      }, 30);
    };
    name.addEventListener("input", reveal);
    name.addEventListener("change", reveal);
    records.append(row);
  };

  document.querySelector(".add-project").addEventListener("click", () => setTimeout(addRecord, 25));
  next.addEventListener("click", () => { nextClicks += 1; });
  submit.addEventListener("click", (event) => { event.preventDefault(); submitClicks += 1; });
  addRecord();

  document.querySelector("#run").addEventListener("click", async () => {
    const checks = [];
    const check = (condition, label) => {
      checks.push(`${condition ? "PASS" : "FAIL"} ${label}`);
      result.textContent = checks.join("\n");
      if (!condition) throw new Error(label);
    };
    const facts = [
      { name: "虚构课程检索系统", url: "https://example.invalid/project-one" },
      { name: "虚构客流预测系统", url: "https://example.invalid/project-two" },
    ];
    const approvedSourcePaths = facts.flatMap((_, index) => [`projects.${index}.name`, `projects.${index}.url`]);
    const watch = globalThis.__personalResumeWorkflow.observe();
    try {
      const prepared = await globalThis.__personalResumeWorkflow.prepare({ projects: 2 });
      check(prepared.added === 1 && records.children.length === 2, "按资料数安全新增项目记录");
      const session = await globalThis.__personalResumeSession.run({
        scan: () => globalThis.__personalResumeBridge.scan(),
        match(scan) {
          const plans = [];
          for (const field of scan.fields) {
            if (String(field.value || "").trim()) continue;
            const label = `${field.label || ""}${field.placeholder || ""}`;
            const index = Number.isInteger(field.groupIndex) ? field.groupIndex : 0;
            if (/项目名称/.test(label) && facts[index]) plans.push({ fieldId: field.id, sourcePath: `projects.${index}.name`, value: facts[index].name });
            if (/项目链接/.test(label) && facts[index]) plans.push({ fieldId: field.id, sourcePath: `projects.${index}.url`, value: facts[index].url });
          }
          return plans;
        },
        apply: plan => globalThis.__personalResumeBridge.apply(plan.map(({ fieldId, value }) => ({ fieldId, value })), false),
        settle: () => watch.waitForQuiet({ quietMs: 80, timeoutMs: 1000 }),
      }, { approvedSourcePaths, maxRounds: 5, timeoutMs: 5000 });
      check(session.rounds.some(round => round.applied > 0), "连续会话完成至少一轮真实填写");
      check([...records.querySelectorAll("[aria-label='项目名称']")].every(input => input.value), "两个项目名称均已填写");
      check([...records.querySelectorAll("[aria-label='项目链接']")].length === 2, "名称填写后识别两个动态联动字段");
      check([...records.querySelectorAll("[aria-label='项目链接']")].every(input => input.value), "新出现的项目链接在下一轮填写");
      check(globalThis.__personalResumeWorkflow.inspectNextStep().status === "ready", "只识别唯一安全的下一步按钮");
      check(nextClicks === 0 && submitClicks === 0, "观察和连续填写不会自动进入下一步或提交");
      result.textContent += `\n${checks.length} 项通过 · ${session.rounds.length} 轮`;
    } catch (error) {
      result.textContent += `\n错误：${error.message}`;
    } finally {
      watch.disconnect();
    }
  });
});
