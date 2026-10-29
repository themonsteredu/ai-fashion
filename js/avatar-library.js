const DATABASE = 'fashion-avatar-library-v1';
const STORE = 'avatars';
const CHANGE_EVENT = 'fashion:avatar-library-change';
const $ = (id) => document.getElementById(id);
let dbPromise = null, initialized = false, handlers = null, renderVersion = 0, objectUrls = [];

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('storage-unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error || new Error('storage-open'));
    request.onblocked = () => reject(new Error('storage-blocked'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
  }).catch((error) => { dbPromise = null; throw error; });
  return dbPromise;
}

async function transact(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let result, settled = false;
    const transaction = db.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => { if (!settled) { settled = true; reject(request.error || new Error('storage-request')); } };
    transaction.oncomplete = () => { if (!settled) { settled = true; resolve(result); } };
    transaction.onabort = transaction.onerror = () => { if (!settled) { settled = true; reject(transaction.error || new Error('storage-transaction')); } };
  });
}

export async function saveAvatar(image, { source = 'generated', model = '', quality = '', style = '', name = '' } = {}) {
  if (!(image instanceof Blob) || !image.size || !/^image\/(png|jpeg|webp)$/.test(image.type)) throw new Error('invalid-avatar');
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const record = { id, image, source, model, quality, style, name: String(name || '').slice(0, 120), createdAt: Date.now() };
  await transact('readwrite', (store) => store.add(record));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
  return id;
}

export async function listAvatars() {
  const records = await transact('readonly', (store) => store.getAll());
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteAvatar(id) {
  await transact('readwrite', (store) => store.delete(id));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

export async function refreshCount() {
  try { const count = await transact('readonly', (store) => store.count()); $('saved-avatar-count').textContent = `(${count})`; }
  catch { $('saved-avatar-count').textContent = ''; }
}

export function init(options) {
  if (initialized) return;
  initialized = true; handlers = options;
  $('btn-saved-avatars').addEventListener('click', open);
  $('avatar-library-close').addEventListener('click', close);
  $('avatar-library').addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  window.addEventListener(CHANGE_EVENT, () => { void refreshCount(); });
  window.addEventListener('focus', () => { void refreshCount(); });
  window.addEventListener('keydown', (event) => {
    if (!isOpen() || handlers.isOtherDialogOpen?.() || event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation(); close();
  }, true);
  void refreshCount();
}

export function isOpen() { return initialized && $('avatar-library').open; }

async function open() {
  if (isOpen()) return;
  $('avatar-library-grid').replaceChildren();
  $('avatar-library-status').textContent = '저장한 아바타를 불러오는 중…';
  $('avatar-library').showModal();
  await render();
}

function clearUrls() { for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls = []; }
function close() {
  renderVersion++; clearUrls(); $('avatar-library-grid').replaceChildren();
  if ($('avatar-library').open) $('avatar-library').close();
}

async function render() {
  const version = ++renderVersion;
  try {
    const records = await listAvatars();
    if (!isOpen() || version !== renderVersion) return;
    clearUrls();
    $('avatar-library-status').textContent = records.length ? `${records.length}개의 아바타가 저장돼 있어요.` : '저장된 아바타가 아직 없어요. 그림을 변환하면 자동으로 저장돼요.';
    const tiles = records.map((record) => tile(record));
    $('avatar-library-grid').replaceChildren(...tiles);
  } catch {
    if (isOpen() && version === renderVersion) $('avatar-library-status').textContent = '이 브라우저에서 아바타 저장 공간을 열지 못했어요. 브라우저 저장 설정을 확인해 주세요.';
  }
}

function tile(record) {
  const url = URL.createObjectURL(record.image); objectUrls.push(url);
  const article = document.createElement('article'); article.className = 'saved-avatar';
  const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'saved-avatar-use';
  apply.setAttribute('aria-label', '이 저장된 아바타 사용');
  const image = document.createElement('img'); image.src = url; image.alt = '저장된 아바타'; image.loading = 'lazy';
  const caption = document.createElement('span');
  const date = new Date(record.createdAt).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  caption.textContent = `${record.source === 'generated' ? 'AI 변환' : '불러온 이미지'} · ${date}`;
  const callToAction = document.createElement('strong'); callToAction.textContent = '이 아바타 사용';
  apply.append(image, caption, callToAction);
  apply.addEventListener('click', () => { const blob = record.image; close(); void handlers.onChoose(blob); });
  const actions = document.createElement('div'); actions.className = 'saved-avatar-actions';
  const prepare = document.createElement('button'); prepare.type = 'button'; prepare.className = 'realify-link'; prepare.textContent = 'AI 자세 보완';
  prepare.setAttribute('aria-label', '이 아바타의 움직이는 자세를 AI로 보완하기. API 사용료가 발생합니다.');
  prepare.addEventListener('click', () => { const blob = record.image; close(); void handlers.onPrepare?.(blob); });
  const download = document.createElement('button'); download.type = 'button'; download.className = 'realify-link'; download.textContent = '다운로드';
  download.addEventListener('click', () => {
    const ext = record.image.type === 'image/jpeg' ? 'jpg' : record.image.type === 'image/webp' ? 'webp' : 'png';
    const link = document.createElement('a'); link.href = url; link.download = `avatar_${record.createdAt}.${ext}`;
    document.body.append(link); link.click(); link.remove();
  });
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'realify-link'; remove.textContent = '삭제';
  remove.addEventListener('click', async () => {
    if (!(await handlers.authorizeDelete()) || !isOpen()) return;
    if (!window.confirm('이 기기에 저장된 아바타를 삭제할까요?')) return;
    try { await deleteAvatar(record.id); await render(); }
    catch { $('avatar-library-status').textContent = '삭제하지 못했어요. 다시 시도해 주세요.'; }
  });
  actions.append(prepare, download, remove); article.append(apply, actions); return article;
}
