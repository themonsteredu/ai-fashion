// This is a Supabase publishable key, not an OpenAI credential.
export const SHARED_API_URL = 'https://vypnobpmyadtcvxhtagn.supabase.co/functions/v1/ai-fashion-api';
export const SHARED_PUBLIC_KEY = 'sb_publishable_uBkR25cjlFr4apHPLzLefQ_WyV0US71';
const SETUP_TOKEN_KEY = 'fashion.realify.setup-token.v1';

export function takeSetupToken(location, history, session) {
  let token = '';
  try {
    const candidate = new URLSearchParams((location?.hash || '').replace(/^#/, '')).get('setup');
    if (/^[a-f0-9]{64}$/.test(candidate || '')) {
      token = candidate;
      try { session?.setItem(SETUP_TOKEN_KEY, token); } catch { /* memory for this tab */ }
      history?.replaceState(null, '', location.pathname + location.search);
    } else token = session?.getItem(SETUP_TOKEN_KEY) || '';
  } catch { /* unavailable browser storage */ }
  return token;
}

export function clearSetupToken(session) { try { session?.removeItem(SETUP_TOKEN_KEY); } catch { /* unavailable storage */ } }

async function request(action, data, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(SHARED_API_URL + '?action=' + action, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { apikey: SHARED_PUBLIC_KEY, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    });
  } catch { throw new Error('공유 설정 서버에 연결하지 못했어요. 인터넷을 확인해 주세요.'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('공유 설정 서버의 응답을 읽지 못했어요.'); }
  if (!response.ok) {
    if (result?.error?.code === 'unauthorized') throw new Error('설정 링크 또는 기존 API 키가 맞지 않아요. 다시 확인해 주세요.');
    if (result?.error?.code === 'invalid_key') throw new Error('sk-로 시작하는 OpenAI API 키 전체를 입력해 주세요.');
    throw new Error('공유 설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  return result;
}

export async function getSharedKeyStatus(fetchImpl) { return request('status', undefined, fetchImpl); }
export async function saveSharedKey(newKey, currentKey, setupToken, fetchImpl) { return request('save', { newKey, currentKey, setupToken }, fetchImpl); }
export async function deleteSharedKey(currentKey, fetchImpl) { return request('delete', { currentKey }, fetchImpl); }
