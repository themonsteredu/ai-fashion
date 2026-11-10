import test from 'node:test';
import assert from 'node:assert/strict';
import { canStartRecording, prepareRecording } from '../js/group-recording-start.js';

function preparation(overrides = {}) {
  let elapsed = 0;
  const countdown = [], waiting = [];
  const state = { avatarReady: true, source: 'camera', cameraActive: true, status: 'noperson' };
  return {
    state, countdown, waiting,
    elapsed: () => elapsed,
    run: () => prepareRecording({
      getState: () => state,
      isCanceled: () => false,
      onCountdown: n => countdown.push(n),
      onWaiting: status => waiting.push(status),
      wait: async ms => { elapsed += ms; overrides.afterWait?.(elapsed, state); },
      ...overrides,
    }),
  };
}

test('a student can press record near the camera before stepping back or calibrating', () => {
  for (const status of ['noperson', 'calibrating', 'ok']) {
    assert.equal(canStartRecording({ avatarReady: true, source: 'camera', cameraActive: true, status }), true);
  }
  assert.equal(canStartRecording({ avatarReady: true, source: 'camera', cameraActive: false }), false);
  assert.equal(canStartRecording({ avatarReady: false, source: 'demo' }), false);
  assert.equal(canStartRecording({ avatarReady: true, source: 'idle' }), false);
  assert.equal(canStartRecording({ avatarReady: true, source: 'demo' }), true);
});

test('countdown allows stepping back, then waits for calibration without requiring feet', async () => {
  const p = preparation({ afterWait(ms, state) {
    state.status = ms >= 4200 ? 'ok' : ms >= 3200 ? 'calibrating' : 'noperson';
    state.fullBodyVisible = false;
  } });
  assert.equal(await p.run(), true);
  assert.deepEqual(p.countdown, [3, 2, 1, null]);
  assert.deepEqual([...new Set(p.waiting)], ['noperson', 'calibrating']);
  assert.equal(p.elapsed(), 4200);
});

test('an absent student times out instead of saving an unmoving avatar', async () => {
  const p = preparation();
  await assert.rejects(p.run(), /몸을 인식하지 못했어요/);
  assert.equal(p.elapsed(), 15000);
});

for (const cancelAt of [1000, 3600]) test(`cancel at ${cancelAt}ms never starts recording`, async () => {
  let canceled = false;
  const p = preparation({
    afterWait(ms, state) { if (ms >= cancelAt) { canceled = true; state.status = 'ok'; } },
    isCanceled: () => canceled,
  });
  assert.equal(await p.run(), false);
  assert.equal(p.elapsed(), cancelAt);
});

test('a disconnected camera aborts preparation even if the last pose was valid', async () => {
  const p = preparation({ afterWait(ms, state) {
    if (ms >= 3000) { state.cameraActive = false; state.status = 'ok'; }
  } });
  await assert.rejects(p.run(), /카메라 연결이 끊겼어요/);
});

test('demo recording keeps its three-second countdown and needs no camera', async () => {
  const p = preparation();
  Object.assign(p.state, { source: 'demo', cameraActive: false, status: 'idle' });
  assert.equal(await p.run(), true);
  assert.equal(p.elapsed(), 3000);
  assert.deepEqual(p.waiting, []);
});
