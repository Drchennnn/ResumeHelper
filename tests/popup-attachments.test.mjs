import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const html=await readFile(new URL('../extension/popup.html',import.meta.url),'utf8');
const source=await readFile(new URL('../extension/popup.js',import.meta.url),'utf8');

test('popup exposes explicit local attachment management and page selection controls',()=>{
 assert.match(html,/id="attachments-manage"[^>]*>管理本地附件库/);
 assert.match(html,/id="attachment"/);
 assert.match(html,/id="attachment-target"/);
 assert.match(html,/id="attachment-apply"[^>]*>选择附件到此页面/);
 assert.match(html,/可能立即开始上传/);
});

test('popup attachment flow uses only the bounded background protocol and review wording',()=>{
 assert.match(source,/type:'ATTACHMENTS_LIST',resumeId:\$\('resume'\)\.value/);
 assert.match(source,/type:'ATTACHMENT_TARGETS',tabId:tab\.id/);
 assert.match(source,/type:'ATTACHMENT_APPLY',tabId:tab\.id,targetId:target\.id,attachmentId:attachment\.id/);
 assert.match(source,/attachments\.html\?resumeId=/);
 assert.match(source,/已选择附件.*请在页面复核/);
 assert.match(source,/网站是否接收成功仍以页面显示为准/);
 assert.doesNotMatch(source,/上传成功/);
});

test('popup scans attachment targets only for the current ordinary HTTP page',()=>{
 assert.match(source,/\^https\?:\\\/\\\//);
 assert.match(source,/tab\.id!==attachmentTabId\|\|tab\.url!==attachmentTabUrl/);
});

test('popup presents unknown attachment sizes as unknown instead of zero bytes',()=>{
 assert.match(source,/bytes===null\|\|bytes===undefined\|\|bytes===''/);
 assert.match(source,/return '大小未知'/);
});
