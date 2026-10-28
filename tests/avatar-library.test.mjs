import test from 'node:test';
import assert from 'node:assert/strict';

// Model asynchronous IndexedDB events so the tests verify committed storage semantics.
const rows = new Map();
let created = false;
const db = {
  objectStoreNames: { contains: () => created },
  createObjectStore: () => { created = true; },
  close() {},
  transaction(_name, mode) {
    const transaction = {};
    transaction.objectStore = () => {
      const request = (operation) => {
        const result = {};
        queueMicrotask(() => {
          try { result.result = operation(); result.onsuccess?.(); queueMicrotask(() => transaction.oncomplete?.()); }
          catch (error) { result.error = error; result.onerror?.(); transaction.onabort?.(); }
        });
        return result;
      };
      return {
        add: (record) => request(() => { assert.equal(mode, 'readwrite'); if (rows.has(record.id)) throw Error('duplicate'); rows.set(record.id, structuredClone(record)); return record.id; }),
        getAll: () => request(() => [...rows.values()].map((record) => structuredClone(record))),
        delete: (id) => request(() => { assert.equal(mode, 'readwrite'); rows.delete(id); }),
        count: () => request(() => rows.size),
      };
    };
    return transaction;
  },
};
globalThis.indexedDB = { open() { const request = {}; queueMicrotask(() => { request.result = db; if (!created) request.onupgradeneeded?.(); request.onsuccess?.(); }); return request; } };
globalThis.window = new EventTarget();
const library = await import('../js/avatar-library.js');

test('converted images survive a fresh list, can be reused, and can be removed', async () => {
  const image = new File(['saved-image-bytes'], 'avatar.png', { type: 'image/png' });
  const first = await library.saveAvatar(image, { source: 'generated', model: 'test-model', quality: 'low' });
  const second = await library.saveAvatar(image, { source: 'imported', name: 'saved.png' });
  assert.notEqual(first, second);
  const saved = await library.listAvatars();
  assert.equal(saved.length, 2);
  const restored = saved.find((row) => row.id === first);
  assert.equal(restored.image.type, 'image/png');
  assert.equal(await restored.image.text(), 'saved-image-bytes');
  assert.equal(restored.model, 'test-model');
  await library.deleteAvatar(first);
  assert.deepEqual((await library.listAvatars()).map((row) => row.id), [second]);
});

test('unsupported or empty images are rejected before any storage write', async () => {
  const before = rows.size;
  await assert.rejects(library.saveAvatar(new Blob(['text'], { type: 'text/plain' })));
  await assert.rejects(library.saveAvatar(new Blob([], { type: 'image/png' })));
  assert.equal(rows.size, before);
});

test('storage failure is reported rather than claiming an avatar was saved', async () => {
  const old = globalThis.indexedDB; delete globalThis.indexedDB;
  await assert.rejects(library.saveAvatar(new Blob(['x'], { type: 'image/png' })));
  globalThis.indexedDB = old;
});
