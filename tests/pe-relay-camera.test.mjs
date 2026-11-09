import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTrackZoom, canRequestTrackZoom, getTrackZoom, requestTrackZoomStream } from '../js/pe-relay-camera.js';

function zoomTrack() {
  let zoom = 1;
  let applied;
  return {
    readyState: 'live',
    getCapabilities: () => ({ zoom: { min: 1, max: 3, step: 0.1 } }),
    getSettings: () => ({ zoom, deviceId: 'camera-1', width: 1280, height: 960, aspectRatio: 4 / 3 }),
    getConstraints: () => ({ width: { ideal: 1280 }, zoom: true, advanced: [{ zoom: 1 }, { frameRate: 30, zoom: 1 }] }),
    async applyConstraints(constraints) {
      applied = constraints;
      zoom = constraints.advanced.at(-1).zoom;
    },
    get applied() { return applied; },
  };
}

test('only a live track with an available zoom range and setting has zoom controls', async () => {
  const track = zoomTrack();
  assert.deepEqual(getTrackZoom(track), { min: 1, max: 3, step: 0.1, value: 1 });
  assert.equal(getTrackZoom({ ...track, readyState: 'ended' }), null);
  assert.equal(getTrackZoom({ ...track, getCapabilities: () => ({ zoom: {} }) }), null);
  assert.equal(await applyTrackZoom(track, NaN), null);
  assert.equal(track.applied, undefined);
});

test('applies zoom to the camera track while preserving unrelated constraints', async () => {
  const track = zoomTrack();
  assert.equal((await applyTrackZoom(track, 4)).value, 3);
  assert.deepEqual(track.applied, { width: { ideal: 1280 }, advanced: [{ frameRate: 30 }, { zoom: 3 }] });
});

test('only an explicit zoom request opens the same camera with permission and no audio', async () => {
  const track = zoomTrack();
  const next = {};
  const requests = [];
  const mediaDevices = {
    getSupportedConstraints: () => ({ zoom: true }),
    getUserMedia: async (request) => { requests.push(request); return next; },
  };
  assert.equal(canRequestTrackZoom(track, mediaDevices), true);
  assert.deepEqual(requests, []);
  assert.equal(await requestTrackZoomStream(track, mediaDevices), next);
  assert.deepEqual(requests, [{
    video: { deviceId: { exact: 'camera-1' }, zoom: true, width: { ideal: 1280 }, height: { ideal: 960 }, aspectRatio: { ideal: 4 / 3 } },
    audio: false,
  }]);
  assert.equal(await requestTrackZoomStream(track, { ...mediaDevices, getSupportedConstraints: () => ({}) }), null);
  assert.equal(requests.length, 1);
});

test('camera permission denial propagates to the caller without affecting the original track', async () => {
  const track = zoomTrack();
  const denied = new Error('Denied');
  const mediaDevices = {
    getSupportedConstraints: () => ({ zoom: true }),
    getUserMedia: async () => { throw denied; },
  };
  await assert.rejects(requestTrackZoomStream(track, mediaDevices), error => error === denied);
  assert.equal(getTrackZoom(track).value, 1);
});
