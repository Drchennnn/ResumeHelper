import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFrameItems,
  cancelFrameOperations,
  clearFrameCache,
  scanAllFrames,
} from "../extension/lib/frame-router.js";

test("scanAllFrames installs both worlds and decorates IDs with trusted frame metadata", async () => {
  const calls = [];
  globalThis.chrome = {
    scripting: {
      async executeScript(details) {
        calls.push(details);
        if (details.func) return [
          {
            frameId: 0,
            documentId: "doc-top",
            result: {
              url: "https://jobs.example.test/apply",
              title: "申请",
              fields: [{ id: "top-field", label: "姓名", type: "text", value: "" }],
              childFrames: [{ url: "https://jobs.example.test/child" }, { url: "https://other.test/embed" }],
            },
          },
          {
            frameId: 7,
            documentId: "doc-child",
            result: {
              url: "https://jobs.example.test/child",
              title: "经历",
              fields: [{ id: "child-field", label: "项目", type: "text", value: "" }],
              childFrames: [],
            },
          },
        ];
        return [];
      },
    },
    tabs: { async sendMessage() { throw new Error("unused"); } },
  };

  const result = await scanAllFrames(55);
  assert.deepEqual(result.fields.map((field) => field.id), ["f0:top-field", "f7:child-field"]);
  assert.equal(result.fields[1].documentId, "doc-child");
  assert.equal(result.fields[1].frameUrl, "https://jobs.example.test/child");
  assert.equal(result.warnings[0].code, "cross_origin_frame_unavailable");
  assert.deepEqual(calls.slice(0, 2).map((call) => [call.files[0], call.world]), [
    ["editor-bridge.js", "MAIN"],
    ["site-adapters.js", "ISOLATED"],
  ]);
  assert.equal(calls[2].target.allFrames, true);
  clearFrameCache(55);
});

test("applyFrameItems trusts scan cache, validates the document, and restores local IDs", async () => {
  const messages = [];
  globalThis.chrome = {
    scripting: {
      async executeScript(details) {
        if (!details.func) return [];
        return [{
          frameId: 4,
          documentId: "doc-four",
          result: {
            url: "https://jobs.example.test/frame",
            title: "frame",
            fields: [{ id: "local-1", label: "简介", type: "textarea", value: "" }],
            childFrames: [],
          },
        }];
      },
    },
    tabs: {
      async sendMessage(tabId, message, options) {
        messages.push({ tabId, message, options });
        if (message.type === "SCAN") return { url: "https://jobs.example.test/frame", fields: [] };
        if (message.type === "APPLY") {
          assert.equal(message.items[0].fieldId, "local-1");
          assert.equal(message.options.browserControl, false);
          return { results: [{ fieldId: "local-1", status: "applied" }] };
        }
        return {};
      },
    },
  };
  await scanAllFrames(56);
  const result = await applyFrameItems(56, [
    { fieldId: "f4:local-1", value: "内容", sourcePath: "projects[0].description" },
    { fieldId: "f999:forged", value: "越权" },
  ], { browserControl: true });

  assert.deepEqual(result.results, [
    { fieldId: "f999:forged", status: "skipped", reason: "unknown_frame_field" },
    { fieldId: "f4:local-1", status: "applied" },
  ]);
  assert.equal(messages[0].options.documentId, "doc-four");
  assert.equal(messages[1].options.frameId, 4);
  clearFrameCache(56);
});

test("applyFrameItems stops when a cached frame navigated and cancellation targets every scanned document", async () => {
  const cancellations = [];
  globalThis.chrome = {
    scripting: {
      async executeScript(details) {
        if (!details.func) return [];
        return [0, 2].map((frameId) => ({
          frameId,
          documentId: `doc-${frameId}`,
          result: {
            url: `https://jobs.example.test/${frameId}`,
            fields: [{ id: `local-${frameId}`, label: "字段", type: "text", value: "" }],
            childFrames: [],
          },
        }));
      },
    },
    tabs: {
      async sendMessage(tabId, message, options) {
        if (message.type === "SCAN") return { url: "https://jobs.example.test/navigated" };
        if (message.type === "CANCEL") {
          cancellations.push(options.documentId);
          return { cancelled: true };
        }
        throw new Error("APPLY must not run after navigation");
      },
    },
  };
  await scanAllFrames(57);
  const applied = await applyFrameItems(57, [{ fieldId: "f2:local-2", value: "x" }]);
  assert.equal(applied.results[0].reason, "frame_document_changed");
  const cancelled = await cancelFrameOperations(57);
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(cancellations, ["doc-0", "doc-2"]);
  clearFrameCache(57);
});

test('cancellation between frame groups prevents a later document from receiving APPLY',async()=>{
 let firstApplyResolve;
 const applied=[];
 globalThis.chrome={scripting:{executeScript:async details=>details.func?[0,2].map(frameId=>({frameId,documentId:`epoch-${frameId}`,result:{url:`https://jobs.example/${frameId}`,fields:[{id:'name',label:'姓名'}]}})):[]},tabs:{sendMessage:async(_tab,message,options)=>{
  if(message.type==='SCAN')return {url:`https://jobs.example/${options.frameId}`};
  if(message.type==='CANCEL')return {cancelled:true};
  if(message.type==='APPLY'){
   applied.push(options.frameId);
   if(options.frameId===0)await new Promise(resolve=>{firstApplyResolve=resolve;});
   return {results:[{fieldId:'name',status:'applied'}]};
  }
 }}};
 await scanAllFrames(99);
 const pending=applyFrameItems(99,[{fieldId:'f0:name',value:'虚构'},{fieldId:'f2:name',value:'虚构'}]);
 while(!firstApplyResolve)await new Promise(resolve=>setTimeout(resolve,0));
 await cancelFrameOperations(99);firstApplyResolve();
 const result=await pending;
 assert.deepEqual(applied,[0]);assert.equal(result.results.at(-1).reason,'cancelled');clearFrameCache(99);
});
