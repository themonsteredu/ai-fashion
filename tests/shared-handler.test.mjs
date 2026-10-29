import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/ai-fashion-api/handler.js';
import { buildPrompt } from '../js/realify.js';

const APP_KEY = 'public-test-app-key';
const OPENAI_KEY = ['sk', 'fixture'.repeat(8)].join('-');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5aUAAAAASUVORK5CYII=';
const endpoint = 'https://example.invalid/api';
const rpcCalls = [], upstreamCalls = [];
let configured = true, limited = false;
const handler = createHandler({ callerApiKey: APP_KEY, now: () => Date.parse('2026-10-28T00:00:00Z'),
  rpc: async (name, args) => {
    rpcCalls.push({ name, args });
    if (name === 'ai_fashion_status') return { configured, registered: true };
    if (name === 'ai_fashion_update_key') return args.p_current_key === OPENAI_KEY || args.p_setup_token === 'bootstrap' ? { ok: true } : { error: 'unauthorized' };
    if (name === 'ai_fashion_reserve_request') return !configured ? { error: 'not_configured' } : limited ? { error: 'rate_limit' } : { key: OPENAI_KEY };
  },
  upstreamFetch: async (url, request) => { upstreamCalls.push({ url, request }); return Response.json({ data: [{ b64_json: PNG }], secret: OPENAI_KEY }); },
});
function req(action, { method = 'GET', body, key = APP_KEY, origin = 'https://ai-fashion-cyan.vercel.app' } = {}) {
  return new Request(endpoint + '?action=' + action, { method, headers: { apikey: key, ...(origin ? { origin } : {}) }, ...(body ? { body } : {}) });
}
function form(changes = {}) {
  const body = new FormData();
  body.append('image', new Blob([Buffer.from(PNG, 'base64')], { type: 'image/png' }), 'drawing.png');
  for (const [key, value] of Object.entries({ model: 'gpt-image-2.5-flare', quality: 'low', size: '768x1024', style: 'semi', ...changes })) body.append(key, value);
  body.append('prompt', 'MALICIOUS OVERRIDE');
  return body;
}

test('public status and settings endpoints never return a saved key', async () => {
  const status = await handler(req('status'));
  assert.deepEqual(await status.json(), { configured: true, registered: true });
  const saved = await handler(req('save', { method: 'POST', body: JSON.stringify({ newKey: OPENAI_KEY, currentKey: OPENAI_KEY }) }));
  assert.deepEqual(await saved.json(), { ok: true, configured: true });
  const denied = await handler(req('save', { method: 'POST', body: JSON.stringify({ newKey: OPENAI_KEY, currentKey: 'wrong' }) }));
  assert.equal(denied.status, 403); assert.equal((await denied.text()).includes(OPENAI_KEY), false);
});

test('conversion sends a fixed prompt and stored server key upstream once and never returns that key', async () => {
  const before = upstreamCalls.length;
  const response = await handler(req('generate', { method: 'POST', body: form() }));
  const payload = await response.json();
  assert.equal(response.status, 200); assert.equal(payload.data[0].b64_json, PNG); assert.equal(JSON.stringify(payload).includes(OPENAI_KEY), false);
  assert.equal(upstreamCalls.length, before + 1);
  const call = upstreamCalls.at(-1); assert.equal(call.request.headers.Authorization, 'Bearer ' + OPENAI_KEY);
  assert.equal(call.request.body.get('model'), 'gpt-image-2.5-flare');
  assert.match(call.request.body.get('prompt'), /semi-realistic 3D animated avatar/);
  assert.doesNotMatch(call.request.body.get('prompt'), /MALICIOUS OVERRIDE/);
  assert.equal(call.request.body.get('prompt'), buildPrompt({ style: 'semi' }));
  assert.match(call.request.body.get('prompt'), /front-facing relaxed A-pose/i);
});

test('rejected and unconfigured requests never call the paid image API', async () => {
  const before = upstreamCalls.length;
  assert.equal((await handler(req('generate', { method: 'POST', body: form(), key: 'wrong' }))).status, 401);
  assert.equal((await handler(req('generate', { method: 'POST', body: form(), origin: 'https://evil.example' }))).status, 403);
  assert.equal((await handler(req('generate', { method: 'POST', body: form({ model: 'unapproved-model' }) }))).status, 400);
  configured = false; assert.equal((await handler(req('generate', { method: 'POST', body: form() }))).status, 409); configured = true;
  limited = true; assert.equal((await handler(req('generate', { method: 'POST', body: form() }))).status, 429); limited = false;
  assert.equal(upstreamCalls.length, before);
});

test('preparing a saved avatar preserves appearance and only accepts a fixed purpose', async () => {
  const before=upstreamCalls.length;
  const result=await handler(req('generate',{method:'POST',body:form({purpose:'prepare'})}));
  assert.equal(result.status,200);
  assert.equal(upstreamCalls.length,before+1);
  const body=upstreamCalls.at(-1).request.body;
  assert.equal(body.get('prompt'),buildPrompt({style:'semi'},{purpose:'prepare'}));
  assert.match(body.get('prompt'),/Do not redesign the character/);
  assert.doesNotMatch(body.get('prompt'),/semi-realistic 3D animated avatar/);
  assert.equal(body.has('purpose'),false);
  const invalid=await handler(req('generate',{method:'POST',body:form({purpose:'arbitrary-user-instruction'})}));
  assert.equal(invalid.status,400);
  assert.equal(upstreamCalls.length,before+1);
});
