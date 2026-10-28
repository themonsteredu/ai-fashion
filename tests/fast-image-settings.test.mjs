import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings, createSettingsStore, optimizeInputImage, SETTINGS_KEY } from '../js/realify.js';

const memory = () => { const data = new Map(); return { getItem: (k) => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: (k) => data.delete(k) }; };

test('faster portrait defaults respect the supported image sizes of each model', () => {
  assert.equal(DEFAULT_SETTINGS.model, 'gpt-image-2.5-flare');
  assert.equal(DEFAULT_SETTINGS.quality, 'low');
  assert.equal(DEFAULT_SETTINGS.size, '768x1024');
  const now = Date.parse('2026-11-01T00:00:00Z');
  assert.equal(normalizeSettings({ model: 'gpt-image-1-mini', size: '768x1024' }, now).size, '1024x1536');
  assert.equal(normalizeSettings({ model: 'gpt-image-1-mini', size: '1024x1024' }, now).size, '1024x1024');
});

test('previous default moves to fast size once while explicit higher quality remains intact', () => {
  const local = memory();
  local.setItem(SETTINGS_KEY, JSON.stringify({ model: 'gpt-image-2.5-flare', quality: 'low', style: 'real', size: '1024x1536' }));
  let store = createSettingsStore({ local });
  assert.equal(store.getSettings().size, '768x1024'); assert.equal(store.getSettings().style, 'real');
  store.save({ ...store.getSettings(), size: '1024x1536' }, '', false);
  store = createSettingsStore({ local }); assert.equal(store.getSettings().size, '1024x1536');
  const other = memory(); other.setItem(SETTINGS_KEY, JSON.stringify({ model: 'gpt-image-2.5-flare', quality: 'high', size: '1024x1536' }));
  assert.equal(createSettingsStore({ local: other }).getSettings().size, '1024x1536');
});

test('large PNG inputs are reduced without losing the image format; small inputs are not enlarged', async () => {
  const oldDocument = globalThis.document, oldBitmap = globalThis.createImageBitmap;
  let closed = 0, dimensions;
  globalThis.createImageBitmap = async () => ({ width: 4000, height: 3000, close: () => { closed++; } });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext() { return { drawImage: (...args) => { dimensions = args.slice(-2); } }; }, toBlob(done, type) { done(new Blob(['small'], { type })); } }) };
  const original = new File(['a'.repeat(500)], 'drawing.png', { type: 'image/png' });
  const reduced = await optimizeInputImage(original, 'image/png');
  assert.equal(reduced.type, 'image/png'); assert(reduced.size < original.size); assert.deepEqual(dimensions, [1536, 1152]); assert.equal(closed, 1);
  globalThis.createImageBitmap = async () => ({ width: 500, height: 500, close: () => { closed++; } });
  assert.equal(await optimizeInputImage(original, 'image/png'), original); assert.equal(closed, 2);
  globalThis.document = oldDocument; globalThis.createImageBitmap = oldBitmap;
});
