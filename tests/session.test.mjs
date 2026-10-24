import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../extension/session.js", import.meta.url), "utf8");

function harness(url = "https://jobs.example/resume") {
  const location = { href: url };
  const context = vm.createContext({ location, AbortController, setTimeout, clearTimeout, Date });
  vm.runInContext(source, context);
  return { api: context.__personalResumeSession, location };
}

test("continuous session never reapplies an unchanged plan", async () => {
  const { api } = harness();
  let applied = 0;
  const item = { fieldId: "name", sourcePath: "personal.name", value: "虚构姓名" };
  const result = await api.run({
    scan: async () => ({ fields: ["name"] }),
    match: async () => [item],
    apply: async () => { applied += 1; return [{ ...item, status: "applied" }]; },
  }, { approvedSourcePaths: ["personal.name"], maxRounds: 5 });

  assert.equal(result.status, "stalled");
  assert.equal(result.reason, "repeated_plan");
  assert.equal(applied, 1);
});

test("failed field-value signatures are removed from later rounds", async () => {
  const { api } = harness();
  const first = { fieldId: "school", sourcePath: "education.0.school", value: "虚构大学" };
  const second = { fieldId: "major", sourcePath: "education.0.major", value: "人工智能" };
  const third = { fieldId: "degree", sourcePath: "education.0.degree", value: "硕士" };
  const appliedPlans = [];
  let round = 0;
  const result = await api.run({
    scan: async () => ({ round: ++round }),
    match: async () => round === 1 ? [first, second] : [first, third],
    apply: async (plan) => {
      appliedPlans.push(plan);
      return round === 1
        ? [{ fieldId: first.fieldId, status: "failed" }, { fieldId: second.fieldId, status: "applied" }]
        : [{ fieldId: third.fieldId, status: "failed" }];
    },
  }, { approvedSourcePaths: [first.sourcePath, second.sourcePath, third.sourcePath] });

  assert.equal(result.status, "stalled", "a failure without progress stops safely instead of looping");
  assert.equal(appliedPlans.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(appliedPlans[1])), [third]);
});

test("an unfinished AI match cannot trigger apply after the session timeout", async () => {
  const { api } = harness();
  let applyCalls = 0;
  const pending = api.run({
    scan: async () => ({ fields: [] }),
    match: async () => new Promise(resolve => setTimeout(() => resolve([{ fieldId: "late", sourcePath: "personal.name", value: "晚到结果" }]), 150)),
    apply: async () => { applyCalls += 1; return []; },
  }, { approvedSourcePaths: ["personal.name"], timeoutMs: 100 });

  await assert.rejects(pending, /匹配超时|60 秒上限/);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(applyCalls, 0);
});

test("URL changes pause before any cross-step apply", async () => {
  const { api, location } = harness();
  let applyCalls = 0;
  await assert.rejects(api.run({
    scan: async () => ({ fields: [] }),
    match: async () => {
      location.href = "https://jobs.example/next-step";
      return [{ fieldId: "x", sourcePath: "personal.name", value: "值" }];
    },
    apply: async () => { applyCalls += 1; return []; },
  }, { approvedSourcePaths: ["personal.name"] }), /页面地址已变化/);
  assert.equal(applyCalls, 0);
});

test("unknown dialogs stop the bounded session and require the user", async () => {
  const { api } = harness();
  const item = { fieldId: "project", sourcePath: "projects.0.name", value: "虚构项目" };
  const result = await api.run({
    scan: async () => ({ fields: ["project"] }),
    match: async () => [item],
    apply: async () => ({ status: "requires_dialog", failures: [] }),
  }, { approvedSourcePaths: [item.sourcePath] });
  assert.equal(result.status, "requires_user");
  assert.equal(result.rounds.length, 1);
});

test("cancel aborts a running session", async () => {
  const { api } = harness();
  const pending = api.run({
    scan: async () => new Promise(resolve => setTimeout(() => resolve({}), 100)),
    match: async () => [],
    apply: async () => [],
  }, { approvedSourcePaths: [] });
  setTimeout(() => api.cancel(), 10);
  await assert.rejects(pending, /连续填写已停止/);
});

test("continuous scope rejects missing paths and composites with an unapproved component",async()=>{
 const {api}=harness();let writes=0;
 const result=await api.run({scan:async()=>[],match:async()=>[
  {fieldId:'bad',value:'value'},
  {fieldId:'composite',sourcePath:'projects.0.name',sourcePaths:['projects.0.name','projects.0.description'],value:'composite'}
 ],apply:async()=>{writes++;return [];}},{approvedSourcePaths:['projects.0.name']});
 assert.equal(result.status,'complete');assert.equal(writes,0);
});
