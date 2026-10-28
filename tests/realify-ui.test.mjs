// Workflow tests using a lightweight DOM double; visual layout still needs a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate as nextTick } from 'node:timers/promises';

class Element extends EventTarget {
  constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.value = ''; this.open = false; this.disabled = false; this.checked = false; this.hidden = false; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; if (this.tagName === 'SELECT') this.value = children[0]?.value || ''; }
  setAttribute(k, v) { this.attributes[k] = v; }
  removeAttribute(k) { delete this.attributes[k]; delete this[k]; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  remove() {}
  click() { if (!this.disabled) this.dispatchEvent(new Event('click', { cancelable: true })); }
}
const memory = () => { const map = new Map(); return { getItem: (k) => map.get(k) || null, setItem: (k,v) => map.set(k,String(v)), removeItem: (k) => map.delete(k), map }; };
const markup = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const elements = new Map([...markup.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/gi)].map((match) => [match[2], new Element(match[1])]));
const element = (id) => { assert(elements.has(id), `HTML must contain #${id}`); return elements.get(id); };
globalThis.document = { getElementById: element, createElement: (tag) => new Element(tag), body: new Element('body') };
globalThis.window = new EventTarget(); window.localStorage = memory(); window.sessionStorage = memory();
globalThis.createImageBitmap = async () => ({ width: 256, height: 384, close() {} });
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5aUAAAAASUVORK5CYII=';
const source = new File([Buffer.from(PNG, 'base64')], 'drawing.png', { type: 'image/png' });
const KEY = ['sk', 'fixture'.repeat(8)].join('-');
let mode = 'ok', requests = [], pending;
globalThis.fetch = async (url, request) => {
  requests.push({ url, request });
  if (mode === 'wait') return new Promise((resolve) => { pending = resolve; });
  if (mode === 'auth') return Response.json({ error: { code: 'invalid_api_key', message: KEY } }, { status: 401 });
  return Response.json({ data: [{ b64_json: PNG }] });
};
const UI = await import('../js/realify-ui.js'); UI.init();
const settle = async () => { for (let i=0; i<8; i++) await nextTick(); };
function submit() { element('realify-settings-form').dispatchEvent(new Event('submit', { cancelable: true })); }

test('settings save clears the key field and keeps credentials out of ordinary preferences', async () => {
  element('btn-ai-settings').click();
  assert.equal(element('realify-settings').open, true);
  element('realify-api-key').value = KEY;
  element('realify-remember-key').checked = true;
  submit(); await settle();
  assert.equal(UI.isOpen(), false);
  assert.equal(element('realify-api-key').value, '');
  assert.equal([...window.localStorage.map.values()].join('').includes(KEY), false);
});

test('converts once per attempt, keeps the original for comparisons, and applies the chosen result', async () => {
  const completion = UI.convert(source); await settle();
  assert.equal(requests.length, 1); assert.equal(element('realify-apply').disabled, false);
  assert.equal(element('realify-result').hidden, false);
  element('realify-retry').click(); await settle();
  element('realify-model').value = 'gpt-image-2.5-sunburst'; element('realify-quality').value = 'high';
  submit(); await settle();
  assert.equal(requests.length, 2); assert.equal(element('realify-history').children.length, 2);
  assert.equal(requests[1].request.body.get('quality'), 'high');
  assert.deepEqual(await requests[1].request.body.get('image').arrayBuffer(), await source.arrayBuffer());
  element('realify-history').children[0].click();
  assert.equal(element('realify-history').children[0].attributes['aria-pressed'], 'true');
  element('realify-apply').click();
  const chosen = await completion; assert.equal(chosen.type, 'image/png');
  assert.equal(UI.isOpen(), false); assert.equal(element('realify-history').children.length, 0);
});

test('missing key offers setup and original-image fallback without a request', async () => {
  element('btn-ai-settings').click(); element('realify-key-clear').click(); element('realify-settings-close').click();
  const before = requests.length, completion = UI.convert(source); await settle();
  assert.equal(element('realify-settings').open, true);
  element('realify-settings-close').click(); await settle();
  element('realify-use-original').click();
  assert.equal(await completion, source); assert.equal(requests.length, before); assert.equal(UI.isOpen(), false);
});

test('closing during a request discards its late response and releases the dialog', async () => {
  element('btn-ai-settings').click(); element('realify-api-key').value = KEY; submit();
  mode = 'wait';
  const completion = UI.convert(source); await settle();
  const last = requests.at(-1); assert.equal(element('realify-cancel').hidden, false);
  element('realify-close').click(); assert.equal(await completion, null);
  assert.equal(last.request.signal.aborted, true);
  pending(Response.json({ data: [{ b64_json: PNG }] })); await settle();
  assert.equal(UI.isOpen(), false); assert.equal(element('realify-history').children.length, 0);
});

test('authentication error stays recoverable without exposing upstream text or silently retrying', async () => {
  mode = 'auth'; const before = requests.length;
  const completion = UI.convert(source); await settle();
  assert.equal(requests.length, before + 1);
  assert.match(element('realify-status').textContent, /API 키/);
  assert.equal(element('realify-status').textContent.includes(KEY), false);
  assert.equal(element('realify-apply').disabled, true); assert.equal(element('realify-retry').disabled, false);
  element('realify-use-original').click(); assert.equal(await completion, source);
});
