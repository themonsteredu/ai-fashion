import test from 'node:test';
import assert from 'node:assert/strict';
import { API_URL, SETTINGS_KEY, SESSION_KEY, DEFAULT_SETTINGS, availableModels, normalizeSettings, createSettingsStore, validateImage, buildPrompt, transformImage } from '../js/realify.js';

const KEY = ['sk', 'test'.repeat(12)].join('-'); // synthetic fixture, never a real credential
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5aUAAAAASUVORK5CYII=';
const drawing = () => new File([Buffer.from(PNG, 'base64')], 'private-drawing.png', { type: 'image/png' });
const memory = () => { const data = new Map(); return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) }; };
const rejectCode = (code) => (error) => error.code === code && !error.message.includes(KEY);

test('key is memory-only unless tab retention is explicitly selected; ordinary settings never contain it', () => {
  const local = memory(), session = memory();
  const store = createSettingsStore({ local, session });
  store.save({ quality: 'medium', apiKey: KEY }, KEY, false);
  assert.equal(store.getKey(), KEY); assert.equal(session.getItem(SESSION_KEY), null);
  assert.equal(local.getItem(SETTINGS_KEY).includes(KEY), false);
  assert.equal(createSettingsStore({ local, session }).hasKey(), false);
  store.save(store.getSettings(), '', true);
  assert.equal(createSettingsStore({ local, session }).getKey(), KEY);
  store.clearKey(); assert.equal(store.hasKey(), false); assert.equal(session.getItem(SESSION_KEY), null);
});

test('blocked storage still supports memory-only use', () => {
  const blocked = { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } };
  const store = createSettingsStore({ local: blocked, session: blocked });
  assert.equal(store.save({}, KEY, true).remembered, false);
  assert.equal(store.getKey(), KEY); store.clearKey(); assert.equal(store.hasKey(), false);
});

test('malformed key does not overwrite an existing credential or settings', () => {
  const store = createSettingsStore(); store.save({}, KEY, false);
  assert.throws(() => store.save({ quality: 'high' }, 'invalid', false), rejectCode('key'));
  assert.equal(store.getKey(), KEY); assert.equal(store.getSettings().quality, 'low');
});

test('retired Mini is removed and stale settings migrate to a supported model', () => {
  const before = Date.parse('2026-11-30T12:00:00Z'), after = Date.parse('2026-12-01T00:00:00Z');
  assert(availableModels(before).some((m) => m.id === 'gpt-image-1-mini'));
  assert(!availableModels(after).some((m) => m.id === 'gpt-image-1-mini'));
  assert.equal(normalizeSettings({ model: 'gpt-image-1-mini' }, after).model, DEFAULT_SETTINGS.model);
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
});

test('rejects disguised and oversized inputs before a paid request', async () => {
  let calls = 0;
  const fetchImpl = () => { calls++; throw Error('must not be called'); };
  await assert.rejects(transformImage(new File(['not an image'], 'fake.png', { type: 'image/png' }), { apiKey: KEY, fetchImpl }), rejectCode('format'));
  await assert.rejects(transformImage(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.png'), { apiKey: KEY, fetchImpl }), rejectCode('size'));
  await assert.rejects(transformImage(drawing(), { fetchImpl }), rejectCode('key'));
  assert.equal(calls, 0);
});

test('signature detection accepts supported files even when the browser omits MIME', async () => {
  assert.equal(await validateImage(new File([Buffer.from(PNG, 'base64')], 'drawing')), 'image/png');
  assert.equal(await validateImage(new File([new Uint8Array([255,216,255,0])], 'drawing')), 'image/jpeg');
  assert.equal(await validateImage(new File(['RIFF0000WEBP'], 'drawing')), 'image/webp');
});

test('sends one original image with chosen model, quality and transparent output to OpenAI only', async () => {
  let calls = 0;
  const input = drawing();
  const settings = { model: 'gpt-image-2.5-sunburst', quality: 'medium', style: 'semi', size: '1024x1024' };
  const result = await transformImage(input, { apiKey: KEY, settings, fetchImpl: async (url, req) => {
    calls++; assert.equal(url, API_URL); assert.equal(req.method, 'POST');
    assert.equal(req.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(req.credentials, 'omit'); assert.equal(req.redirect, 'error');
    assert.equal(req.body.get('model'), settings.model); assert.equal(req.body.get('quality'), 'medium');
    assert.equal(req.body.get('n'), '1'); assert.equal(req.body.get('background'), 'transparent');
    assert.equal(req.body.get('output_format'), 'png'); assert.equal(req.body.has('response_format'), false);
    assert.equal(req.body.has('input_fidelity'), false);
    assert.equal(req.body.getAll('image').length, 1);
    assert.deepEqual(await req.body.get('image').arrayBuffer(), await input.arrayBuffer());
    assert.equal(req.body.get('image').name, 'drawing.png');
    return Response.json({ data: [{ b64_json: PNG }] });
  } });
  assert.equal(calls, 1); assert.equal(result.file.type, 'image/png'); assert.deepEqual(result.settings, settings);
});

test('default prompt asks for a stylized realistic avatar while preserving the drawing and apparent age', () => {
  const prompt = buildPrompt(DEFAULT_SETTINGS);
  assert.match(prompt, /semi-realistic 3D animated avatar/i);
  assert.match(prompt, /apparent age/); assert.match(prompt, /same outfit/);
  assert.match(prompt, /transparent background/); assert.match(prompt, /do not crop/i);
  assert.match(prompt, /front-facing relaxed A-pose/i);
  assert.match(prompt, /hands and entire sleeves clearly separated from the torso/i);
  assert.match(prompt, /skirt or long dress, preserve the original garment intact/i);
  assert.match(prompt, /both legs are already visible.*slightly apart/i);
  assert.match(prompt, /legs hidden by it covered/i);
  assert.doesNotMatch(prompt, /keep the original pose/i);
  assert.notEqual(prompt, buildPrompt({ style: 'real' }));
});

for (const [status, code, expected] of [[401, 'invalid_api_key', 'auth'], [403, 'permission_denied', 'access'], [429, 'insufficient_quota', 'quota'], [429, 'rate_limit_exceeded', 'rate'], [400, 'content_policy_violation', 'content'], [404, 'model_not_found', 'model'], [503, 'overloaded', 'server']]) {
  test(`API ${status}/${code}: useful error, no raw secret, no automatic retry`, async () => {
    let calls = 0;
    await assert.rejects(transformImage(drawing(), { apiKey: KEY, fetchImpl: async () => { calls++; return Response.json({ error: { code, message: KEY } }, { status }); } }), rejectCode(expected));
    assert.equal(calls, 1);
  });
}

test('aborted attempts never send a new request', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(transformImage(drawing(), { apiKey: KEY, signal: controller.signal, fetchImpl: () => { calls++; } }), rejectCode('cancelled'));
  assert.equal(calls, 0);
});

test('timeout aborts the request without paid retry', async () => {
  let calls = 0;
  await assert.rejects(transformImage(drawing(), { apiKey: KEY, timeoutMs: 10, fetchImpl: (_url, { signal }) => {
    calls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  } }), rejectCode('timeout'));
  assert.equal(calls, 1);
});

test('missing or invalid generated image is not accepted as success', async () => {
  for (const payload of [{ data: [] }, { data: [{ b64_json: 'not base64!' }] }, { data: [{ b64_json: Buffer.from('not an image').toString('base64') }] }]) {
    await assert.rejects(transformImage(drawing(), { apiKey: KEY, fetchImpl: async () => Response.json(payload) }));
  }
});
