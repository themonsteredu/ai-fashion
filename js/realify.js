// User-provided keys are sent only to the fixed OpenAI endpoint, never to app hosting.
// API contract: https://developers.openai.com/api/reference/resources/images/methods/edit
export const API_URL = 'https://api.openai.com/v1/images/edits';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const SETTINGS_KEY = 'fashion.realify.settings.v1';
export const SESSION_KEY = 'fashion.realify.key.v1';
const MINI_END = Date.parse('2026-12-01T00:00:00Z');

export const MODELS = [
  { id: 'gpt-image-2.5-flare', label: '빠른 변환 · GPT Image 2.5 Flare', hint: '가볍게 먼저 확인할 때. 낮은 화질부터 시작해 보세요.' },
  { id: 'gpt-image-2.5-sunburst', label: '정교한 변환 · GPT Image 2.5 Sunburst', hint: '얼굴과 의상 표현을 더 정교하게 비교할 때. 실제 비용은 사용량에 따라 달라져요.' },
  { id: 'gpt-image-1-mini', label: '저비용 시험 · GPT Image 1 Mini', hint: '세부 묘사는 단순할 수 있어요. 2026년 12월 1일 서비스 종료 예정.', endsAt: MINI_END },
];
export const STYLES = [
  { id: 'semi', label: '애니메이션 반실사', prompt: 'A semi-realistic 3D animated avatar, balancing believable skin, hair and fabric with softly stylized animated-feature proportions. Keep a subtle animation aesthetic rather than making an ordinary live-action photograph. Not flat 2D, not chibi, not a plastic toy.' },
  { id: 'real', label: '실사에 가까운 아바타', prompt: 'A realistic human avatar with natural skin, individually defined hair and convincing fabric, retaining just a gentle 3D animation aesthetic and the distinctive character design.' },
  { id: 'animated', label: '3D 애니메이션', prompt: 'A polished 3D animated feature character with expressive but restrained stylization, tactile fabric and soft natural lighting. Not flat 2D, not chibi, not a plastic toy.' },
];
export const QUALITIES = [{ id: 'low', label: '초안 · 비용 절약' }, { id: 'medium', label: '표준 · 균형' }, { id: 'high', label: '정밀 · 세부 표현' }];
export const SIZES = [{ id: '1024x1024', label: '정사각 · 1024 × 1024' }, { id: '1024x1536', label: '전신 세로 · 1024 × 1536' }];
export const DEFAULT_SETTINGS = Object.freeze({ model: 'gpt-image-2.5-flare', style: 'semi', quality: 'low', size: '1024x1536' });

export class RealifyError extends Error {
  constructor(code, message) { super(message); this.name = 'RealifyError'; this.code = code; this.userMessage = message; }
}

export function availableModels(now = Date.now()) { return MODELS.filter((m) => !m.endsAt || now < m.endsAt); }
export function normalizeSettings(value = {}, now = Date.now()) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  for (const [key, choices] of Object.entries({ model: availableModels(now), style: STYLES, quality: QUALITIES, size: SIZES })) {
    result[key] = choices.some((item) => item.id === source[key]) ? source[key] : DEFAULT_SETTINGS[key];
  }
  return result;
}

export function createSettingsStore({ local = null, session = null } = {}) {
  let settings = { ...DEFAULT_SETTINGS }, apiKey = '', remembered = false;
  try { settings = normalizeSettings(JSON.parse(local?.getItem(SETTINGS_KEY) || '{}')); } catch { /* unavailable storage */ }
  try { apiKey = session?.getItem(SESSION_KEY) || ''; remembered = !!apiKey; } catch { /* private browsing */ }
  return {
    getSettings: () => normalizeSettings(settings),
    getKey: () => apiKey,
    hasKey: () => !!apiKey,
    isRemembered: () => remembered,
    save(next, key, remember) {
      const candidate = String(key || '').trim();
      if (candidate && !/^sk-[A-Za-z0-9_-]{20,}$/.test(candidate)) {
        throw new RealifyError('key', 'OpenAI API 키 형식을 확인해 주세요. sk-로 시작하는 키 전체를 입력해 주세요.');
      }
      settings = normalizeSettings(next);
      if (candidate) apiKey = candidate;
      try { local?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* settings still work in memory */ }
      remembered = false;
      try {
        if (remember && apiKey && session) { session.setItem(SESSION_KEY, apiKey); remembered = true; }
        else session?.removeItem(SESSION_KEY);
      } catch { /* key stays in memory only */ }
      return { remembered, hasKey: !!apiKey };
    },
    clearKey() { apiKey = ''; remembered = false; try { session?.removeItem(SESSION_KEY); } catch { /* no storage */ } },
  };
}

export async function validateImage(file) {
  if (!file || !file.size) throw new RealifyError('file', '빈 파일이에요. PNG·JPG·WebP 그림을 선택해 주세요.');
  if (file.size > MAX_UPLOAD_BYTES) throw new RealifyError('size', '10MB 이하의 그림을 선택해 주세요.');
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  throw new RealifyError('format', 'PNG·JPG·WebP 파일만 변환할 수 있어요. 다른 형식은 PNG나 JPG로 저장해 주세요.');
}

export function buildPrompt(settings) {
  const style = STYLES.find((s) => s.id === settings.style) || STYLES[0];
  return [
    'Transform the character in the supplied drawing into a high-quality rendered avatar.',
    style.prompt,
    'Treat the uploaded image as the visual reference: preserve its recognizable facial features, apparent age, hairstyle, hair color, clothing design, clothing colors, accessories and overall silhouette. Do not age up or sexualize the character. Keep the same outfit and its coverage.',
    'Keep the original pose and camera angle. If the input is full-body, include the entire head, hands and feet with a little margin; do not crop any limbs. Preserve separation between arms and torso where present, for a pose-driven 2D puppet.',
    'Use soft studio lighting and a clear, clean silhouette. Isolate the single character on a genuinely transparent background. No backdrop, checkerboard pattern, text, labels, watermark, additional people or cast shadow.',
  ].join('\n');
}

function apiError(status, code) {
  if (status === 401) return new RealifyError('auth', 'API 키를 사용할 수 없어요. AI 설정에서 키를 확인해 주세요.');
  if (status === 403) return new RealifyError('access', '이 계정에서 선택한 이미지 모델을 사용할 수 없어요. 모델 권한과 계정 인증을 확인해 주세요.');
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return new RealifyError('quota', 'API 잔액이나 사용 한도에 도달했어요. OpenAI 결제 설정을 확인해 주세요.');
  if (status === 429) return new RealifyError('rate', '요청이 잠시 몰렸어요. 잠깐 기다린 뒤 다시 시도해 주세요.');
  if (code === 'content_policy_violation' || code === 'moderation_blocked') return new RealifyError('content', '이 그림은 변환할 수 없어요. 다른 그림으로 시도해 주세요.');
  if (status === 404 || code === 'model_not_found') return new RealifyError('model', '선택한 모델을 사용할 수 없어요. AI 설정에서 다른 모델을 선택해 주세요.');
  if (status >= 500) return new RealifyError('server', '이미지 서비스가 잠시 응답하지 않아요. 잠시 후 다시 시도해 주세요.');
  return new RealifyError('request', '변환 요청이 처리되지 않았어요. 그림이나 모델 설정을 바꿔 다시 시도해 주세요.');
}

// Exactly one paid request per explicit attempt. Never auto-retry or silently upgrade.
export async function transformImage(file, { apiKey, settings, signal, fetchImpl = globalThis.fetch, timeoutMs = 180000 } = {}) {
  if (!apiKey) throw new RealifyError('key', 'AI 설정에서 OpenAI API 키를 먼저 입력해 주세요.');
  const type = await validateImage(file);
  const config = normalizeSettings(settings);
  const body = new FormData();
  body.append('image', new Blob([file], { type }), `drawing.${type === 'image/jpeg' ? 'jpg' : type.split('/')[1]}`);
  body.append('model', config.model);
  body.append('prompt', buildPrompt(config));
  body.append('n', '1');
  body.append('size', config.size);
  body.append('quality', config.quality);
  body.append('background', 'transparent');
  body.append('output_format', 'png');
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await fetchImpl(API_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body, signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
    let payload;
    try { payload = await response.json(); } catch {
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      throw new RealifyError('response', '이미지 응답을 읽지 못했어요. 자동으로 재요청하지 않았어요.');
    }
    if (!response.ok) throw apiError(response.status, payload?.error?.code);
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const encoded = payload?.data?.[0]?.b64_json;
    if (typeof encoded !== 'string' || !encoded.length || encoded.length > 48 * 1024 * 1024) throw new RealifyError('response', '변환 결과에 이미지가 없거나 너무 커요. 화질을 낮춰 다시 시도해 주세요.');
    let bytes;
    try { bytes = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0)); } catch { throw new RealifyError('response', '이미지 데이터가 올바르지 않아요. 자동으로 재요청하지 않았어요.'); }
    const output = new File([bytes], 'avatar-realified.png', { type: 'image/png' });
    if (await validateImage(output) !== 'image/png') throw new RealifyError('response', '변환 결과가 PNG 이미지가 아니에요.');
    return { file: output, settings: config };
  } catch (error) {
    if (timedOut) throw new RealifyError('timeout', '변환 대기시간을 넘겼어요. 서버에서 처리가 계속될 수 있으며 비용이 발생할 수 있어요. 자동 재요청은 하지 않았어요.');
    if (controller.signal.aborted) throw new RealifyError('cancelled', '변환을 중지했어요. 이미 시작된 서버 처리에는 비용이 발생할 수 있어요.');
    if (error instanceof RealifyError) throw error;
    throw new RealifyError('network', '인터넷 연결 또는 브라우저의 API 연결을 확인해 주세요. 자동 재요청은 하지 않았어요.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
