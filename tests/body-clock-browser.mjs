import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.webp': 'image/webp', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + '/')) throw Error('File outside test site');
    response.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const poseModel = `
  import { bodyClockPose } from '/tests/fixtures/body-clock-pose.mjs';
  import { movementPose } from '/tests/fixtures/movement-poses.mjs';
  export const FilesetResolver = { forVisionTasks: async () => ({}) };
  export const PoseLandmarker = { createFromOptions: async (_files, options) => ({
    detectForVideo: (video, timestamp) => {
      if (options.numPoses === 2) {
        window.pairFrames = (window.pairFrames || 0) + 1;
        const { image, world } = movementPose('stand');
        const people = (window.pairInput || [0, 1]).map(index => ({
          image: image.map(point => ({ ...point, x: (point.x - .5) * .4 + .25 + index * .5 })),
          world,
        }));
        return { landmarks: people.map(person => person.image), worldLandmarks: people.map(person => person.world) };
      }
      if (window.movementMissing) return { landmarks: [], worldLandmarks: [] };
      if (window.movementInput) {
        // Drop a frame about once a second, as happens when a wrist briefly disappears.
        const bucket = Math.floor(timestamp / 1000);
        if (window.movementBucket !== bucket) {
          window.movementBucket = bucket;
          return { landmarks: [], worldLandmarks: [] };
        }
        const { image, world } = window.guidePoses[window.movementInput];
        return { landmarks: [image], worldLandmarks: [world] };
      }
      const image = bodyClockPose(window.clockInputHour, video.videoWidth / video.videoHeight);
      const world = image.map(p => ({ ...p, x: (p.x - .5) * 2, y: (p.y - .6) * 2 }));
      return { landmarks: [image], worldLandmarks: [world] };
    },
    close() {},
  }) };
  const empty = { createFromOptions: async () => ({
    detectForVideo: () => ({ landmarks: [], worldLandmarks: [], faceBlendshapes: [] }), close() {}
  }) };
  export const FaceLandmarker = empty;
  export const HandLandmarker = empty;
  export const ImageSegmenter = empty;
  export const ImageSegmenterResult = {};
`;

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, permissions: ['camera'] });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.setDefaultTimeout(30_000);
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.goto(origin + '/movement-practice.html');
  // Get real observations of the nine teaching illustrations before replaying them as camera frames.
  const guidePoses = await page.evaluate(async () => {
    const { MOVEMENTS, matchesMovement } = await import('/js/movement-practice.js');
    const { PoseLandmarker, FilesetResolver } = await import('/lib/mediapipe/vision_bundle.mjs');
    const model = await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks('/lib/mediapipe/wasm'), {
      baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'CPU' },
      runningMode: 'IMAGE', numPoses: 1,
    });
    const frame = document.createElement('canvas');
    frame.width = 960;
    frame.height = 720;
    const context = frame.getContext('2d');
    const observations = {};
    try {
      for (const { id, art, crop } of MOVEMENTS) {
        const image = new Image();
        image.src = '/assets/movement/' + art + '.webp';
        await image.decode();
        const scale = Math.min(frame.width * .84 / crop[2], frame.height * .80 / crop[3]);
        const width = crop[2] * scale, height = crop[3] * scale;
        context.fillStyle = '#f7f4ee';
        context.fillRect(0, 0, frame.width, frame.height);
        context.drawImage(image, ...crop, (frame.width - width) / 2, (frame.height - height) / 2, width, height);
        const result = model.detect(frame);
        const points = result.landmarks[0], world = result.worldLandmarks[0];
        if (!matchesMovement(id, points, world, frame.width / frame.height)) throw Error('Guide did not match: ' + id);
        observations[id] = { image: points, world };
      }
    } finally {
      model.close();
    }
    return observations;
  });
  await page.route('**/lib/mediapipe/vision_bundle.mjs', route => route.fulfill({ contentType: 'text/javascript', body: poseModel }));
  await page.addInitScript(() => {
    window.clockInputHour = 9;
    window.clockFramesRecorded = 0;
    window.savedClockVideo = 0;
    // Use Chromium's native VP8 encoder consistently across CI runners.
    const supportedMime = MediaRecorder.isTypeSupported.bind(MediaRecorder);
    MediaRecorder.isTypeSupported = type => type.startsWith('video/webm') && supportedMime(type);
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
      if (source.id === 'group-clock-dial') window.clockFramesRecorded++;
      return drawImage.call(this, source, ...args);
    };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(String(input), location.href);
      let data;
      if (url.pathname.endsWith('/fashion-rooms')) {
        const request = JSON.parse(options.body);
        if (request.action === 'join') {
          data = { room: { id: 'clock-fixture', title: '모션 AI 수업', code: '123456' }, group: request.group, token: 'test-session' };
        } else if (request.action === 'clips') data = { clips: [] };
        else if (request.action === 'upload') data = { id: 'test-clip', uploadUrl: location.origin + '/test-clock-upload' };
        else if (request.action === 'complete') data = {};
      } else if (url.pathname === '/test-clock-upload') {
        window.savedClockVideo = options.body.size;
        return Promise.resolve(new Response(null, { status: 200 }));
      } else if (url.pathname.endsWith('/ai-fashion-api')) {
        data = { configured: false, registered: false };
      } else return nativeFetch(input, options);
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
    };
  });

  await page.goto(origin);
  const activities = page.locator('.start-activities a');
  assert.equal(await activities.count(), 2);
  assert.equal(await page.locator('#btn-mission').isVisible(), false);
  await page.locator('#start-explore').click();
  assert.equal(await page.locator('#btn-pe').isVisible(), true);
  await page.locator('#start-avatars').click();
  assert.equal(await page.locator('#btn-mission').isVisible(), false);
  assert.equal(await page.locator('#btn-upload-direct').isVisible(), true);
  await page.locator('#start-avatars').click();

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await activities.last().isVisible(), true);
  assert.ok(await page.locator('#screen-start').evaluate(el => el.scrollWidth === el.clientWidth));
  await activities.last().click();
  assert.equal(await page.locator('#clock-time').textContent(), '예시 9시');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));

  await page.locator('#clock-camera-toggle').click();
  await page.waitForFunction(() => document.querySelector('#clock-feedback').dataset.correct === 'true');
  assert.equal(await page.locator('#clock-time').textContent(), '9시');
  await page.locator('[data-hour="3"]').click();
  assert.equal(await page.locator('#clock-feedback').getAttribute('data-correct'), 'false');
  await page.evaluate(() => { window.clockInputHour = 3; });
  await page.waitForFunction(() => document.querySelector('#clock-feedback').dataset.correct === 'true');
  assert.equal(await page.locator('#clock-time').textContent(), '3시');
  await page.locator('#clock-camera-toggle').click();
  assert.equal(await page.locator('#clock-video').evaluate(video => video.srcObject), null);

  await page.goto(origin);
  assert.equal(await page.getByRole('link', { name: '다양한 움직임' }).isVisible(), false);
  await page.locator('#start-explore').click();
  await page.getByRole('link', { name: '다양한 움직임' }).click();
  await page.locator('#move-list button').last().waitFor();
  assert.equal(await page.locator('#move-list button').count(), 9);
  await page.waitForFunction(() => document.querySelector('#move-example').getContext('2d').getImageData(290, 270, 1, 1).data[3] > 0);
  const moveButtons = page.locator('#move-list button');
  const poseIds = await moveButtons.evaluateAll(buttons => buttons.map(button => button.dataset.pose));
  const selectedMove = page.locator('#move-list button[aria-pressed="true"]');
  const setPose = id => page.evaluate(id => { window.movementInput = id; }, id);
  await page.evaluate(poses => { window.guidePoses = poses; }, guidePoses);
  await setPose(poseIds[0]);
  await page.locator('#move-camera').click();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#move-pose');
    return !canvas.hidden && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
      .data.some((value, index) => index % 4 === 3 && value > 0);
  });
  await page.evaluate(() => { window.movementMissing = true; });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#move-pose');
    return !canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0);
  });
  await page.evaluate(() => { window.movementMissing = false; });
  for (const [index, id] of poseIds.entries()) {
    // Only supply the landmark fixture. The lesson itself must select the next guide.
    await page.locator(`[data-pose="${id}"][aria-pressed="true"]`).waitFor();
    await setPose(id);
    await page.waitForFunction(count => document.querySelector('#move-progress').textContent ===
      count + ' / 9 동작 완료', index + 1);
  }
  assert.equal(await selectedMove.getAttribute('data-pose'), poseIds.at(-1));
  assert.equal(await page.locator('.move-done').count(), 9);
  assert.equal(await page.locator('#move-next').textContent(), '다시 시작하기');
  await page.locator('#move-next').click();
  assert.equal(await page.locator('#move-progress').textContent(), '0 / 9 동작 완료');
  assert.equal(await selectedMove.getAttribute('data-pose'), poseIds[0]);
  assert.equal(await page.locator('.move-done').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.locator('#move-camera').click();
  assert.equal(await page.locator('#move-video').evaluate(video => video.srcObject), null);
  assert.equal(await page.locator('#move-pose').isVisible(), false);
  assert.equal(await page.locator('#move-pose').evaluate(canvas => canvas.getContext('2d')
    .getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0)), false);
  console.log('Movement lesson camera and progress verified.');
  await page.goto(origin + '/body-clock.html');
  await page.setViewportSize({ width: 1100, height: 768 });
  await page.getByRole('link', { name: '모둠 영상 찍기' }).click();
  await page.getByRole('heading', { name: '시계 모둠 영상 찍기' }).waitFor();
  assert.equal(await page.locator('#people-choice').isVisible(), false);
  await page.locator('#room-code').fill('123456');
  await page.locator('.group-picker label').first().click();
  await page.locator('#join-submit').click();
  await page.waitForFunction(() => document.querySelector('#group-clock-time').textContent === '9시');
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#group-pose');
    return !canvas.hidden && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0);
  });
  assert.equal(await page.locator('#group-topic').inputValue(), '몸으로 시계 나타내기');
  await page.locator('#format-avatar').click();
  await page.locator('#record').click();
  await page.waitForFunction(() => window.clockFramesRecorded >= 8 && document.querySelector('#timer').textContent !== '0:00');
  await page.locator('#record').click();
  await page.locator('#review').click();
  await page.locator('#pending-video').waitFor();
  await page.locator('#pending-video').evaluate(video => video.load());
  await page.waitForFunction(() => {
    const video = document.querySelector('#pending-video');
    return video.videoWidth > 0 || video.error;
  });
  const dimensions = await page.locator('#pending-video').evaluate(async video => {
    await video.play();
    return [video.videoWidth, video.videoHeight];
  });
  assert.deepEqual(dimensions, [960, 768]);
  await page.locator('#retry-upload').click();
  await page.waitForFunction(() => window.savedClockVideo > 0 && document.querySelector('#pending').hidden);

  await page.goto(origin + '/group-motion.html');
  await page.locator('#room-code').fill('123456');
  await page.locator('.group-picker label').first().click();
  await page.locator('#people-count').selectOption('2');
  await page.locator('#join-submit').click();
  await page.waitForFunction(() => document.querySelector('#pair-status').textContent.includes('2명 인식')
    || document.querySelector('#pair-status').textContent.includes('두 사람'));
  const overlayColors = () => {
    const canvas = document.querySelector('#group-pose');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let green = 0, blue = 0, greenX = 0, blueX = 0;
    for (let i = 0; i < data.length; i += 4) {
      const x = (i / 4) % canvas.width;
      if (data[i] === 113 && data[i + 1] === 240 && data[i + 2] === 186) { green++; greenX += x; }
      if (data[i] === 141 && data[i + 1] === 200 && data[i + 2] === 255) { blue++; blueX += x; }
    }
    return { green, blue, greenX: greenX / green, blueX: blueX / blue };
  };
  let colors = await page.evaluate(overlayColors);
  assert.ok(colors.green > 0 && colors.blue > 0, 'both tracked students have an overlay');
  assert.ok(colors.greenX < colors.blueX, 'student colors follow mirrored avatar order');
  const pairFrame = await page.evaluate(() => { window.pairInput = [1, 0]; return window.pairFrames; });
  await page.waitForFunction(frame => window.pairFrames > frame + 3, pairFrame);
  colors = await page.evaluate(overlayColors);
  assert.ok(colors.greenX < colors.blueX, 'changing detector order keeps student colors stable');
  await page.evaluate(() => { window.pairInput = [0]; });
  await page.waitForFunction(() => document.querySelector('#pair-status').textContent.includes('1명 인식'));
  colors = await page.evaluate(overlayColors);
  assert.equal(colors.green, 0, 'missing student overlay is cleared');
  assert.ok(colors.blue > 0, 'remaining student retains the second identity');
  await page.evaluate(() => { window.pairInput = []; });
  await page.waitForFunction(() => document.querySelector('#pair-status').textContent.includes('0명 인식'));
  assert.equal(await page.locator('#group-pose').evaluate(canvas => canvas.getContext('2d')
    .getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0)), false);

  assert.deepEqual(pageErrors, []);
  console.log('Body clock and movement lesson browser checks passed, including group recording and submission.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
