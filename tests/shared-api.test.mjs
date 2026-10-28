import test from 'node:test';
import assert from 'node:assert/strict';
import { takeSetupToken, clearSetupToken, getSharedKeyStatus, saveSharedKey, SHARED_PUBLIC_KEY, SHARED_API_URL } from '../js/shared-api.js';

const KEY = ['sk', 'test'.repeat(12)].join('-');
const TOKEN = 'a'.repeat(64);
const memory = () => { const map = new Map(); return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) }; };

test('single-use setup link is removed from the address and retained only in this tab', () => {
  const session = memory(), calls = [];
  const token = takeSetupToken({ hash: '#setup=' + TOKEN, pathname: '/', search: '' }, { replaceState: (...args) => calls.push(args) }, session);
  assert.equal(token, TOKEN); assert.equal(calls[0][2], '/');
  assert.equal(takeSetupToken({ hash: '' }, null, session), TOKEN);
  clearSetupToken(session); assert.equal(takeSetupToken({ hash: '' }, null, session), '');
});

test('shared settings use only the publishable app key and never retrieve the stored OpenAI key', async () => {
  const calls = [];
  const mock = async (url, request) => { calls.push({ url, request }); return Response.json(url.endsWith('status') ? { configured: true, registered: true } : { ok: true }); };
  assert.deepEqual(await getSharedKeyStatus(mock), { configured: true, registered: true });
  await saveSharedKey(KEY, '', TOKEN, mock);
  assert.equal(calls[0].url, SHARED_API_URL + '?action=status');
  assert.equal(calls[0].request.headers.apikey, SHARED_PUBLIC_KEY);
  assert.equal(calls[0].request.headers.Authorization, undefined);
  assert.equal(JSON.parse(calls[1].request.body).newKey, KEY);
  assert.equal(calls[1].request.credentials, 'omit');
});

test('shared settings never display a raw backend error or credential', async () => {
  await assert.rejects(saveSharedKey(KEY, '', TOKEN, async () => Response.json({ error: { code: 'unauthorized', message: KEY } }, { status: 403 })), (error) => !error.message.includes(KEY) && /기존 API 키/.test(error.message));
});
