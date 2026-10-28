import test from 'node:test';
import assert from 'node:assert/strict';

class Element extends EventTarget {
  constructor() { super(); this.value = ''; this.textContent = ''; this.open = false; this.dataset = {}; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
  focus() {}
  click() { this.dispatchEvent(new Event('click')); }
}
const ids = ['operator-pin', 'operator-pin-form', 'operator-pin-value', 'operator-pin-status', 'operator-pin-clear', 'operator-pin-backspace', 'operator-pin-cancel', 'operator-pin-context'];
const nodes = new Map(ids.map((id) => [id, new Element()]));
const digits = Array.from({ length: 10 }, (_, n) => { const button = new Element(); button.dataset.pinDigit = String(n); return button; });
globalThis.document = { getElementById: (id) => nodes.get(id), querySelectorAll: () => digits };
globalThis.window = new EventTarget();
const pin = await import('../js/operator-pin.js'); pin.init();
const submit = () => nodes.get('operator-pin-form').dispatchEvent(new Event('submit', { cancelable: true }));

test('wrong PIN keeps settings locked; keypad unlocks with the requested PIN', async () => {
  const access = pin.request('AI 설정');
  assert.equal(pin.isOpen(), true);
  for (const n of [1, 1, 1, 1]) digits[n].click();
  submit();
  assert.equal(pin.isOpen(), true);
  assert.match(nodes.get('operator-pin-status').textContent, /맞지/);
  assert.equal(nodes.get('operator-pin-value').value, '');
  for (const n of [3, 0, 3, 5]) digits[n].click();
  submit();
  assert.equal(await access, true);
  assert.equal(pin.isOpen(), false);
  assert.equal(nodes.get('operator-pin-value').value, '');
});

test('cancelling and Escape do not grant access and clear typed digits', async () => {
  let access = pin.request('운영자 설정');
  digits[3].click(); nodes.get('operator-pin-cancel').click();
  assert.equal(await access, false);
  assert.equal(nodes.get('operator-pin-value').value, '');
  access = pin.request('설정');
  const event = new Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value: 'Escape' });
  window.dispatchEvent(event);
  assert.equal(await access, false); assert.equal(pin.isOpen(), false);
});

test('only one password request can be open at a time', async () => {
  const first = pin.request('설정');
  assert.equal(await pin.request('다른 설정'), false);
  nodes.get('operator-pin-cancel').click(); assert.equal(await first, false);
});
