// The only public credential is the Supabase publishable key. OpenAI keys stay in Vault.
const MAX_BODY = 10 * 1024 * 1024 + 128 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set(['https://ai-fashion-cyan.vercel.app', 'http://localhost:3000', 'http://127.0.0.1:3000']);
const MODELS = new Set(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-1-mini']);
const STYLES = {
  semi: 'A semi-realistic 3D animated avatar, balancing believable skin, hair and fabric with softly stylized animated-feature proportions. Keep a subtle animation aesthetic rather than making an ordinary live-action photograph. Not flat 2D, not chibi, not a plastic toy.',
  real: 'A realistic human avatar with natural skin, individually defined hair and convincing fabric, retaining just a gentle 3D animation aesthetic and the distinctive character design.',
  animated: 'A polished 3D animated feature character with expressive but restrained stylization, tactile fabric and soft natural lighting. Not flat 2D, not chibi, not a plastic toy.',
};

function prompt(style) {
  return [
    'Transform the character in the supplied drawing into a high-quality rendered avatar.', STYLES[style],
    'Treat the uploaded image as the visual reference: preserve its recognizable facial features, apparent age, hairstyle, hair color, clothing design, clothing colors, accessories and overall silhouette. Do not age up or sexualize the character. Keep the same outfit and its coverage.',
    'Keep the original pose and camera angle. If the input is full-body, include the entire head, hands and feet with a little margin; do not crop any limbs. Preserve separation between arms and torso where present, for a pose-driven 2D puppet.',
    'Use soft studio lighting and a clear, clean silhouette. Isolate the single character on a genuinely transparent background. No backdrop, checkerboard pattern, text, labels, watermark, additional people or cast shadow.',
  ].join('\n');
}

function cors(origin) {
  return { ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
}
function json(value, status, headers) { return new Response(JSON.stringify(value), { status, headers: { ...headers, 'Content-Type': 'application/json' } }); }
function fail(code, status, headers) { return json({ error: { code } }, status, headers); }
function keyFormat(value) { return typeof value === 'string' && /^sk-[A-Za-z0-9_-]{20,256}$/.test(value); }

async function sameValue(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const encoder = new TextEncoder();
  const left = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(a)));
  const right = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(b)));
  let diff = 0; for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function readLimited(request, limit) {
  const length = Number(request.headers.get('content-length'));
  if (length > limit) throw new Error('too_large');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks = []; let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); throw new Error('too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

async function imageType(file) {
  if (!(file instanceof Blob) || !file.size || file.size > MAX_IMAGE) return null;
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

// rpc() uses a server-only Supabase credential; callerApiKey is only a publishable key.
export function createHandler({ callerApiKey, rpc, upstreamFetch = fetch, now = () => Date.now() }) {
  return async function handle(request) {
    const origin = request.headers.get('origin') || '', headers = cors(origin);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return fail('origin', 403, headers);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const action = new URL(request.url).searchParams.get('action');
    if (!callerApiKey) return fail('server_configuration', 500, headers);
    if (!(action === 'status' && request.method === 'GET') && !(await sameValue(request.headers.get('apikey'), callerApiKey))) return fail('access', 401, headers);
    try {
      if (action === 'status' && request.method === 'GET') {
        const state = await rpc('ai_fashion_status', {});
        return json({ configured: !!state?.configured, registered: !!state?.registered }, 200, headers);
      }
      if ((action === 'save' || action === 'delete') && request.method === 'POST') {
        const data = JSON.parse(new TextDecoder().decode(await readLimited(request, 8192)));
        const next = action === 'delete' ? null : data.newKey;
        const previous = typeof data.currentKey === 'string' ? data.currentKey : '';
        const setup = typeof data.setupToken === 'string' ? data.setupToken : '';
        if ((next !== null && !keyFormat(next)) || previous.length > 300 || setup.length > 128) return fail('invalid_key', 400, headers);
        const result = await rpc('ai_fashion_update_key', { p_new_key: next, p_current_key: previous, p_setup_token: setup });
        if (result?.error === 'unauthorized') return fail('unauthorized', 403, headers);
        if (!result?.ok) return fail('storage', 500, headers);
        return json({ ok: true, configured: next !== null }, 200, headers);
      }
      if (action !== 'generate' || request.method !== 'POST') return fail('not_found', 404, headers);
      const bytes = await readLimited(request, MAX_BODY);
      const form = await new Request('https://local.invalid/', { method: 'POST', headers: { 'Content-Type': request.headers.get('content-type') || '' }, body: bytes }).formData();
      const image = form.get('image'), type = await imageType(image);
      const model = form.get('model'), quality = form.get('quality'), size = form.get('size'), style = form.get('style');
      if (!type || !MODELS.has(model) || !['low', 'medium', 'high'].includes(quality) || !Object.hasOwn(STYLES, style) ||
          !['768x1024', '1024x1024', '1024x1536'].includes(size) ||
          (model === 'gpt-image-1-mini' && (size === '768x1024' || now() >= Date.parse('2026-12-01T00:00:00Z')))) return fail('invalid_input', 400, headers);
      const reservation = await rpc('ai_fashion_reserve_request', {});
      if (reservation?.error === 'not_configured') return fail('not_configured', 409, headers);
      if (reservation?.error === 'rate_limit') return fail('app_rate_limit', 429, headers);
      if (!keyFormat(reservation?.key)) return fail('storage', 500, headers);
      const upstreamBody = new FormData();
      upstreamBody.append('image', new Blob([image], { type }), `drawing.${type === 'image/jpeg' ? 'jpg' : type.split('/')[1]}`);
      for (const [name, value] of Object.entries({ model, quality, size, prompt: prompt(style), n: '1', background: 'transparent', output_format: 'png' })) upstreamBody.append(name, value);
      let response;
      try {
        response = await upstreamFetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${reservation.key}` }, body: upstreamBody, signal: AbortSignal.timeout(140000), redirect: 'error' });
      } catch { return fail('upstream_unavailable', 504, headers); }
      let payload;
      try { payload = await response.json(); } catch { return fail('invalid_response', 502, headers); }
      if (!response.ok) {
        const known = new Set(['invalid_api_key', 'permission_denied', 'insufficient_quota', 'billing_hard_limit_reached', 'rate_limit_exceeded', 'content_policy_violation', 'moderation_blocked', 'model_not_found']);
        const code = known.has(payload?.error?.code) ? payload.error.code : 'upstream_error';
        return fail(code, response.status >= 400 && response.status <= 599 ? response.status : 502, headers);
      }
      const encoded = payload?.data?.[0]?.b64_json;
      if (typeof encoded !== 'string' || !encoded.length || encoded.length > 48 * 1024 * 1024) return fail('invalid_response', 502, headers);
      return json({ data: [{ b64_json: encoded }] }, 200, headers);
    } catch (error) {
      return fail(error?.message === 'too_large' ? 'too_large' : 'server_error', error?.message === 'too_large' ? 413 : 500, headers);
    }
  };
}
