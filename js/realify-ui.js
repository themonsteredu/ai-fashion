import { availableModels, MODELS, STYLES, QUALITIES, sizesForModel, createSettingsStore, transformImage, validateImage, RealifyError } from './realify.js';
import { getSharedKeyStatus, saveSharedKey, deleteSharedKey, takeSetupToken, clearSetupToken } from './shared-api.js';

const $ = (id) => document.getElementById(id);
let store, initialized = false, original = null, originalUrl = null;
let results = [], selected = -1, sequence = 0, controller = null, resolveConversion = null;
let settingsResolve = null, busy = false, elapsedTimer = null;
let callbacks = {};
let sharedState = { configured: false, registered: false, loaded: false }, setupToken = '', settingsBusy = false;
let sharedStatusRevision = 0;

function storage(name) { try { return window[name]; } catch { return null; } }
function options(id, items) {
  $(id).replaceChildren(...items.map((item) => {
    const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; return option;
  }));
}
function label(items, id) { return items.find((item) => item.id === id)?.label || id; }
function describe(settings) { return `${label(MODELS, settings.model)} / ${label(QUALITIES, settings.quality)} / ${label(STYLES, settings.style)}`; }
function status(id, message, error = false) { $(id).textContent = message; $(id).dataset.error = String(error); }
function updateSummary() {
  const settings = store.getSettings();
  $('ai-settings-summary').textContent = `${label(QUALITIES, settings.quality)} · ${label(STYLES, settings.style)}`;
  $('realify-key-state').textContent = !sharedState.loaded ? '공유 설정을 확인하고 있어요.' : sharedState.configured ? '모든 기기에서 사용할 키가 저장되어 있어요.' : '공유 키가 아직 저장되지 않았어요.';
  $('realify-key-clear').disabled = !sharedState.configured || settingsBusy;
  $('realify-current-key-label').hidden = !sharedState.registered;
  $('realify-api-key').placeholder = sharedState.configured ? '변경할 때만 새 키 입력' : 'sk-로 시작하는 API 키';
}
async function refreshSharedStatus() {
  const revision = ++sharedStatusRevision;
  try {
    const result = await getSharedKeyStatus();
    if (revision !== sharedStatusRevision) return sharedState.loaded;
    sharedState = { configured: !!result.configured, registered: !!result.registered, loaded: true };
    updateSummary(); return true;
  } catch (error) {
    if (revision !== sharedStatusRevision) return sharedState.loaded;
    sharedState.loaded = false; updateSummary();
    if ($('realify-settings').open) status('realify-settings-status', error.message, true);
    return false;
  }
}
function selectedSettings() { return { model: $('realify-model').value, quality: $('realify-quality').value, style: $('realify-style').value, size: $('realify-size').value }; }
function updateSizeOptions(preferred) {
  const sizes = sizesForModel($('realify-model').value);
  options('realify-size', sizes);
  $('realify-size').value = sizes.some((item) => item.id === preferred) ? preferred : ($('realify-model').value === 'gpt-image-1-mini' ? '1024x1536' : '768x1024');
}
function updateModelHint() {
  const settings = selectedSettings();
  $('realify-model-hint').textContent = MODELS.find((m) => m.id === settings.model)?.hint || '';
  if (settings.model === 'gpt-image-1-mini') {
    const prices = settings.size === '1024x1024' ? { low: '.005', medium: '.011', high: '.036' } : { low: '.006', medium: '.015', high: '.052' };
    $('realify-cost-hint').textContent = `이미지 출력 1장 약 $0${prices[settings.quality]} + 입력 비용. 2026년 10월 확인한 요금이며 실제 청구액은 달라질 수 있어요.`;
  } else {
    $('realify-cost-hint').textContent = '실제 요금은 모델·화질·크기·입력 그림에 따라 달라져요. 두 모델의 같은 화질도 장당 비용은 다를 수 있어요.';
  }
}

export function init(optionsForApp = {}) {
  if (initialized) return;
  initialized = true;
  callbacks = optionsForApp;
  store = createSettingsStore({ local: storage('localStorage'), session: storage('sessionStorage') });
  setupToken = takeSetupToken(window.location, window.history, storage('sessionStorage'));
  options('realify-quality', QUALITIES); options('realify-style', STYLES);
  $('btn-ai-settings').addEventListener('click', () => openSettings());
  $('realify-settings-close').addEventListener('click', () => closeSettings(false));
  $('realify-settings').addEventListener('cancel', (event) => { event.preventDefault(); closeSettings(false); });
  $('realify-settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (settingsBusy) return;
    settingsBusy = true; $('realify-settings-save').disabled = true; updateSummary();
    try {
      if (!sharedState.loaded && !(await refreshSharedStatus())) return;
      const key = $('realify-api-key').value.trim();
      const currentKey = $('realify-current-key').value.trim();
      if (key) {
        if (!/^sk-[A-Za-z0-9_-]{20,256}$/.test(key)) throw new RealifyError('key', 'sk-로 시작하는 OpenAI API 키 전체를 입력해 주세요.');
        if (sharedState.registered && !currentKey) throw new RealifyError('key', '키를 바꾸려면 기존 API 키를 입력해 주세요.');
        if (!sharedState.registered && !setupToken) throw new RealifyError('key', '처음 저장할 때는 전달받은 일회용 설정 링크로 열어 주세요.');
        status('realify-settings-status', '모든 기기에서 사용할 키를 저장하고 있어요.');
        await saveSharedKey(key, currentKey, setupToken);
        sharedStatusRevision++;
        sharedState = { configured: true, registered: true, loaded: true };
        setupToken = ''; clearSetupToken(storage('sessionStorage')); store.clearKey();
      }
      if (original && !sharedState.configured) {
        status('realify-settings-status', 'API 키를 입력하거나 원본 그림으로 사용해 주세요.', true);
        $('realify-api-key').focus(); return;
      }
      store.save(selectedSettings(), '', store.isRemembered());
      $('realify-api-key').value = ''; $('realify-current-key').value = '';
      updateSummary();
      closeSettings(true);
    } catch (error) { status('realify-settings-status', error.userMessage || error.message || '설정을 저장하지 못했어요.', true); }
    finally { settingsBusy = false; $('realify-settings-save').disabled = false; updateSummary(); }
  });
  $('realify-model').addEventListener('change', () => { updateSizeOptions($('realify-size').value); updateModelHint(); });
  for (const id of ['realify-quality', 'realify-size']) $(id).addEventListener('change', updateModelHint);
  $('realify-key-clear').addEventListener('click', async () => {
    if (settingsBusy || !sharedState.configured) return;
    const currentKey = $('realify-current-key').value.trim();
    if (!currentKey) { status('realify-settings-status', '삭제하려면 기존 API 키를 입력해 주세요.', true); $('realify-current-key').focus(); return; }
    if (!window.confirm('공통 API 키를 삭제하면 모든 기기의 변환이 중지돼요. 삭제할까요?')) return;
    settingsBusy = true; $('realify-settings-save').disabled = true; updateSummary();
    try {
      await deleteSharedKey(currentKey);
      sharedStatusRevision++;
      sharedState = { configured: false, registered: true, loaded: true };
      $('realify-api-key').value = ''; $('realify-current-key').value = '';
      status('realify-settings-status', '공통 API 키를 삭제했어요. 다시 등록할 때 삭제한 키를 확인해 주세요.');
    } catch (error) { status('realify-settings-status', error.message || '키를 삭제하지 못했어요.', true); }
    finally { settingsBusy = false; $('realify-settings-save').disabled = false; updateSummary(); }
  });
  $('realify-close').addEventListener('click', () => finish(null));
  $('realify-dialog').addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
  $('realify-cancel').addEventListener('click', () => controller?.abort());
  $('realify-use-original').addEventListener('click', () => finish(original));
  $('realify-apply').addEventListener('click', () => { if (!busy && results[selected]) finish(results[selected].file); });
  $('realify-download').addEventListener('click', download);
  $('realify-retry').addEventListener('click', async () => {
    if (busy) return;
    if (await openSettings(true)) await run();
  });
  // Native dialog focus trapping + prevent kiosk shortcuts from opening a second panel.
  window.addEventListener('keydown', (event) => {
    if (!isOpen() || callbacks.isOtherDialogOpen?.() || event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if ($('realify-settings').open) closeSettings(false); else finish(null);
  }, true);
  updateSummary(); void refreshSharedStatus();
}

export function isOpen() { return initialized && ($('realify-settings').open || $('realify-dialog').open || busy); }

export async function openSettings(forConversion = false) {
  if ($('realify-settings').open) return false;
  if (callbacks.requestSettingsAccess && !(await callbacks.requestSettingsAccess())) return false;
  if ($('realify-settings').open) return false;
  const settings = store.getSettings();
  options('realify-model', availableModels());
  for (const key of ['model', 'quality', 'style']) $(`realify-${key}`).value = settings[key];
  updateSizeOptions(settings.size);
  $('realify-api-key').value = ''; $('realify-current-key').value = '';
  $('realify-settings-save').textContent = forConversion ? '이 설정으로 변환' : '설정 저장';
  status('realify-settings-status', ''); updateSummary(); updateModelHint();
  $('realify-settings').showModal();
  const result = new Promise((resolve) => { settingsResolve = resolve; });
  void refreshSharedStatus();
  return result;
}
function closeSettings(saved) {
  $('realify-api-key').value = ''; $('realify-current-key').value = '';
  $('realify-settings').close();
  const resolve = settingsResolve; settingsResolve = null; resolve?.(saved);
}

export async function convert(file) {
  if (resolveConversion) return null;
  await validateImage(file);
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new RealifyError('decode', '그림을 열지 못했어요. PNG·JPG·WebP 이미지인지 확인해 주세요.'); }
  const tooSmall = Math.max(bitmap.width, bitmap.height) < 200;
  bitmap.close();
  if (tooSmall) {
    throw new RealifyError('small', '그림이 너무 작아요. 200픽셀 이상의 그림을 선택해 주세요.');
  }
  original = file; originalUrl = URL.createObjectURL(file);
  $('realify-original').src = originalUrl;
  $('realify-result').hidden = true; $('realify-result').removeAttribute('src');
  $('realify-placeholder').hidden = false;
  $('realify-placeholder').textContent = '선택한 설정으로 변환을 준비하고 있어요.';
  $('realify-result-caption').textContent = '변환 결과';
  $('realify-history').replaceChildren(); results = []; selected = -1;
  status('realify-status', ''); setBusy(false);
  $('realify-dialog').showModal();
  const completion = new Promise((resolve) => { resolveConversion = resolve; });
  const canCheck = await refreshSharedStatus();
  if (!canCheck) {
    status('realify-status', '공유 설정 서버에 연결하지 못했어요. 인터넷을 확인하거나 원본 그림을 사용해 주세요.', true);
    $('realify-placeholder').textContent = '연결을 확인한 뒤 다시 시도해 주세요.';
  } else if (!sharedState.configured) {
    status('realify-status', 'AI 설정에서 API 키를 입력하면 변환을 시작해요.');
    const saved = await openSettings(true);
    if (saved && original) void run();
    else if (original) { status('realify-status', '설정에서 API 키를 입력하거나, 원본 그림으로 사용할 수 있어요.'); $('realify-placeholder').textContent = 'API 키를 입력하면 이곳에 결과가 나타나요.'; }
  } else { void run(); }
  return completion;
}

function setBusy(value) {
  busy = value;
  $('realify-dialog').setAttribute('aria-busy', String(value));
  $('realify-retry').disabled = value;
  $('realify-apply').disabled = value || selected < 0;
  $('realify-download').disabled = value || selected < 0;
  $('realify-cancel').hidden = !value;
  $('realify-use-original').disabled = value;
  $('realify-timing').hidden = !value;
  for (const button of $('realify-history').children) button.disabled = value;
  clearInterval(elapsedTimer); elapsedTimer = null;
  if (value) {
    const start = Date.now();
    const tick = () => { $('realify-timing').textContent = `${Math.floor((Date.now() - start) / 1000)}초 경과 · 그림에 따라 몇 분 정도 걸릴 수 있어요. 중지해도 이미 시작된 처리에는 비용이 발생할 수 있어요.`; };
    tick(); elapsedTimer = setInterval(tick, 1000);
  }
}

async function run() {
  if (busy || !original || !$('realify-dialog').open) return;
  const job = ++sequence;
  controller = new AbortController();
  const settings = store.getSettings();
  setBusy(true); status('realify-status', `${describe(settings)} — 변환 중이에요.`);
  if (selected < 0) $('realify-placeholder').textContent = '원본의 얼굴과 옷을 살려 입체감을 더하고 있어요.';
  try {
    const result = await transformImage(original, { shared: true, settings, signal: controller.signal });
    if (job !== sequence || !original) return;
    // Decode before offering a download or replacing a working avatar.
    const decoded = await createImageBitmap(result.file); decoded.close();
    if (job !== sequence || !original) return;
    if (controller.signal.aborted) throw new RealifyError('cancelled', '변환을 중지했어요. 이미 시작된 서버 처리에는 비용이 발생할 수 있어요.');
    let saved = false;
    if (callbacks.saveResult) {
      try { await callbacks.saveResult(result.file, result.settings); saved = true; }
      catch { /* The result remains usable and downloadable even if local storage is full. */ }
    }
    if (job !== sequence || !original) return;
    result.url = URL.createObjectURL(result.file);
    results.push(result);
    if (results.length > 3) URL.revokeObjectURL(results.shift().url);
    selectResult(results.length - 1);
    status('realify-status', saved ? '완성한 아바타를 이 기기에 저장했어요. 원본과 비교해 보세요.'
      : callbacks.saveResult ? '완성했어요. 기기에 자동 저장하지 못했으니 PNG 저장을 눌러 보관해 주세요.'
      : '완성했어요. 원본과 비교하고 아바타로 사용해 보세요.');
  } catch (error) {
    if (job !== sequence) return;
    status('realify-status', error.userMessage || '변환된 이미지를 열지 못했어요. 다른 설정으로 다시 시도해 주세요.', true);
    if (selected < 0) $('realify-placeholder').textContent = '아직 변환된 이미지가 없어요.';
  } finally {
    if (job === sequence) { controller = null; setBusy(false); }
  }
}

function selectResult(index) {
  selected = index;
  const result = results[index];
  $('realify-result').src = result.url; $('realify-result').hidden = false;
  $('realify-placeholder').hidden = true;
  $('realify-result-caption').textContent = label(STYLES, result.settings.style);
  const buttons = results.map((entry, i) => {
    const button = document.createElement('button'); button.type = 'button';
    button.setAttribute('aria-pressed', String(i === index)); button.disabled = busy;
    const thumbnail = document.createElement('img'); thumbnail.src = entry.url; thumbnail.alt = '';
    const text = document.createElement('span'); text.textContent = `${i + 1}. ${describe(entry.settings)}`;
    button.append(thumbnail, text); button.addEventListener('click', () => selectResult(i)); return button;
  });
  $('realify-history').replaceChildren(...buttons);
  $('realify-apply').disabled = busy; $('realify-download').disabled = busy;
}

function download() {
  const result = results[selected];
  if (!result || busy) return;
  const link = document.createElement('a');
  link.href = result.url; link.download = `avatar_${result.settings.model}_${result.settings.quality}_${Date.now()}.png`;
  document.body.append(link); link.click(); link.remove();
}

function finish(file) {
  sequence++;
  controller?.abort(); controller = null;
  if ($('realify-settings').open) closeSettings(false);
  setBusy(false);
  $('realify-dialog').close();
  $('realify-original').removeAttribute('src'); $('realify-result').removeAttribute('src');
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  for (const result of results) URL.revokeObjectURL(result.url);
  $('realify-history').replaceChildren();
  original = null; originalUrl = null; results = []; selected = -1;
  const resolve = resolveConversion; resolveConversion = null; resolve?.(file);
}
