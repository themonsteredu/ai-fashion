const $ = (id) => document.getElementById(id);
let initialized = false, pending = null;

// This four-digit gate is intended for the kiosk UI, not a server-side account login.
const OPERATOR_PIN = '3035';

export function init() {
  if (initialized) return;
  initialized = true;
  const input = $('operator-pin-value');
  $('operator-pin-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (input.value === OPERATOR_PIN) finish(true);
    else { input.value = ''; $('operator-pin-status').textContent = '비밀번호가 맞지 않아요. 다시 입력해 주세요.'; input.focus(); }
  });
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); $('operator-pin-status').textContent = ''; });
  for (const button of document.querySelectorAll('[data-pin-digit]')) button.addEventListener('click', () => {
    if (input.value.length < 4) input.value += button.dataset.pinDigit;
    $('operator-pin-status').textContent = '';
  });
  $('operator-pin-clear').addEventListener('click', () => { input.value = ''; $('operator-pin-status').textContent = ''; });
  $('operator-pin-backspace').addEventListener('click', () => { input.value = input.value.slice(0, -1); $('operator-pin-status').textContent = ''; });
  $('operator-pin-cancel').addEventListener('click', () => finish(false));
  $('operator-pin').addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
  $('operator-pin').addEventListener('close', () => { if (pending) finish(false); });
  // This listener is registered before other kiosk shortcuts and nested dialogs.
  window.addEventListener('keydown', (event) => {
    if (!isOpen() || event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation(); finish(false);
  }, true);
}

export function isOpen() { return initialized && $('operator-pin').open; }

export function request(context = '설정') {
  if (pending || isOpen()) return Promise.resolve(false);
  $('operator-pin-context').textContent = `${context}에 사용할 운영자 비밀번호 4자리를 입력해 주세요.`;
  $('operator-pin-value').value = '';
  $('operator-pin-status').textContent = '';
  $('operator-pin').showModal();
  $('operator-pin-value').focus();
  return new Promise((resolve) => { pending = resolve; });
}

function finish(allowed) {
  const resolve = pending; pending = null;
  $('operator-pin-value').value = '';
  if ($('operator-pin').open) $('operator-pin').close();
  resolve?.(allowed);
}
