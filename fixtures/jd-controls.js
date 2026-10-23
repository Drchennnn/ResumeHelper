// Standalone regression fixture. It never replaces APIs inside the production extension.
globalThis.chrome = {runtime: {id: "jd-controls-fixture", onMessage: {addListener() {}}}};

const byId = (id) => document.getElementById(id);
const majorInput = byId("major");
const majorMenus = byId("major-menus");
const majorLabel = majorInput.closest(".ant-cascader-picker").querySelector(".ant-cascader-picker-label");

const majorTree = {
  文学: ["中国语言文学相关类", "外国语言文学相关类"],
  理学: ["数学相关类", "物理学相关类"],
  工学: ["计算机相关类", "电子信息相关类"],
};

function renderMajorLevel(parent) {
  majorMenus.replaceChildren();
  const choices = parent ? majorTree[parent] : Object.keys(majorTree);
  const list = document.createElement("ul");
  list.className = "ant-cascader-menu";
  for (const choice of choices) {
    const item = document.createElement("li");
    item.className = "ant-cascader-menu-item";
    item.setAttribute("role", "menuitem");
    item.title = choice;
    item.textContent = choice;
    item.addEventListener("click", () => {
      if (!parent) renderMajorLevel(choice);
      else {
        majorLabel.textContent = `${parent} / ${choice}`;
        majorInput.dataset.value = majorLabel.textContent;
        majorMenus.hidden = true;
        majorInput.dispatchEvent(new Event("change", {bubbles: true}));
        renderResult();
      }
    });
    list.append(item);
  }
  majorMenus.append(list);
}
majorInput.addEventListener("click", () => { renderMajorLevel(); majorMenus.hidden = false; });

function calendar(input, panel, year, month, days) {
  panel.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = `${year}-${String(month).padStart(2, "0")}（必须选择具体日期）`;
  panel.append(title);
  const body = document.createElement("div");
  body.className = "ant-calendar-body";
  for (const day of days) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "ant-calendar-date";
    cell.textContent = `${day}日`;
    cell.title = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cell.dataset.value = cell.title;
    cell.addEventListener("click", () => {
      input.value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      input.dataset.committed = input.value;
      panel.hidden = true;
      input.dispatchEvent(new Event("change", {bubbles: true}));
      renderResult();
    });
    body.append(cell);
  }
  panel.append(body);
  input.addEventListener("click", () => { panel.hidden = false; });
}
calendar(byId("education-start"), byId("start-calendar"), 2024, 9, [1, 15, 30]);
calendar(byId("education-end"), byId("end-calendar"), 2027, 10, [1, 15, 31]);

function fieldSummary() {
  const fields = globalThis.__personalResumeBridge?.scan?.().fields || [];
  return fields.map(({label, section, type, value}) => ({label, section, type, value}));
}

function renderResult(extra = {}) {
  const selectedHighest = document.querySelector(".ant-radio-input:checked");
  byId("result").textContent = JSON.stringify({
    major: majorLabel.textContent,
    highestDegree: selectedHighest?.value === "1" ? "是" : selectedHighest?.value === "0" ? "否" : "",
    startDate: byId("education-start").value,
    endDate: byId("education-end").value,
    endDateStatus: byId("education-end").value ? "confirmed" : "pending_exact_day",
    program: byId("program-description").value,
    campus: byId("campus-description").value,
    scannedFields: fieldSummary(),
    ...extra,
  }, null, 2);
}

byId("run").addEventListener("click", async () => {
  const bridge = globalThis.__personalResumeBridge;
  const fields = bridge.scan().fields;
  const find = (label) => fields.find((field) => field.label === label);
  const items = [
    {fieldId: find("专业类别")?.id, value: "本科（普通教育） / 工学 / 计算机类"},
    {fieldId: find("是否最高学历：是")?.id, value: true},
    {fieldId: find("起止时间（开始）")?.id, value: "2024-09-01"},
    {fieldId: find("起止时间（结束）")?.id, value: "2027-10"},
    {fieldId: find("项目经历描述")?.id, value: "虚构项目：实现本地表单回归工具。"},
    {fieldId: find("校园经历描述")?.id, value: "虚构校园经历：参与技术社团活动。"},
  ].filter((item) => item.fieldId);
  const results = await bridge.apply(items, false);
  renderResult({
    productionApplyResults: results,
    result: "production bridge applied exact controls; month-only end date remains pending",
  });
});

byId("choose-end").addEventListener("click", () => {
  byId("education-end").click();
  [...byId("end-calendar").querySelectorAll(".ant-calendar-date")].find((item) => item.textContent === "1日")?.click();
});

for (const control of document.querySelectorAll("input,textarea")) control.addEventListener("change", () => renderResult());
setTimeout(renderResult, 0);
