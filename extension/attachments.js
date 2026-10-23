import {loadState} from './lib/storage.js';
import {deleteAttachment, listAttachments, MAX_ATTACHMENT_TOTAL_BYTES, saveAttachmentFiles, saveAttachmentPath} from './lib/attachments.js';

const $ = id => document.getElementById(id);
const labels = {resume: '简历', transcript: '成绩单', certificate: '证书', other: '其他'};
let profiles = [];

function setStatus(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function formatBytes(bytes) {
  if (bytes == null) return '大小未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function render() {
  const resumeId = $('resume').value;
  const kind = $('filter').value;
  const items = await listAttachments({resumeId, kind});
  const all = await listAttachments({resumeId});
  const knownBytes = all.reduce((total, item) => total + (item.size || 0), 0);
  $('usage').textContent = `${all.length} 个附件 · 已知大小 ${formatBytes(knownBytes)} / ${formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)}`;
  $('list').replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '当前简历还没有保存附件。';
    $('list').append(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'item';
    const title = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = item.name;
    const source = document.createElement('small');
    source.textContent = item.source === 'blob' ? '已保存文件内容' : '本地路径记录（路径已隐藏）';
    title.append(strong, source);
    const kindText = document.createElement('span');
    kindText.className = 'meta';
    kindText.textContent = labels[item.kind] || item.kind;
    const size = document.createElement('span');
    size.className = 'meta';
    size.textContent = formatBytes(item.size);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.textContent = '删除';
    remove.addEventListener('click', async () => {
      if (!confirm(`确认从本地附件库删除“${item.name}”？`)) return;
      remove.disabled = true;
      try { await deleteAttachment(item.id); await render(); setStatus(`已删除 ${item.name}`); }
      catch (error) { setStatus(error.message, true); remove.disabled = false; }
    });
    row.append(title, kindText, size, remove);
    $('list').append(row);
  }
}

async function initialize() {
  try {
    const state = await loadState();
    profiles = state.resumes;
    $('resume').replaceChildren(...profiles.map(profile => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name || '未命名简历';
      option.selected = profile.id === state.activeId;
      return option;
    }));
    const requested = new URL(location.href).searchParams.get('resumeId');
    if (requested && profiles.some(profile => profile.id === requested)) $('resume').value = requested;
    await render();
    setStatus('附件只保存在当前浏览器。');
  } catch (error) {
    setStatus(error.message, true);
  }
}

$('fileForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const saved = await saveAttachmentFiles({resumeId: $('resume').value, kind: $('fileKind').value, files: $('files').files});
    $('files').value = '';
    await render();
    setStatus(`已保存 ${saved.length} 个附件。`);
  } catch (error) { setStatus(error.message, true); }
  finally { button.disabled = false; }
});

$('pathForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const saved = await saveAttachmentPath({resumeId: $('resume').value, kind: $('pathKind').value, path: $('path').value, name: $('pathName').value});
    $('path').value = '';
    $('pathName').value = '';
    await render();
    setStatus(`已保存路径记录 ${saved.name}；实际使用时会再次校验。`);
  } catch (error) { setStatus(error.message, true); }
  finally { button.disabled = false; }
});

$('resume').addEventListener('change', render);
$('filter').addEventListener('change', render);
initialize();
