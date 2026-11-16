import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript' };
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
  export const FilesetResolver = { forVisionTasks: async () => ({}) };
  export const PoseLandmarker = { createFromOptions: async () => ({
    detectForVideo: video => {
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
  await page.route('**/lib/mediapipe/vision_bundle.mjs', route => route.fulfill({ contentType: 'text/javascript', body: poseModel }));
  await page.addInitScript(() => {
    window.clockInputHour = 9;
    window.clockFramesRecorded = 0;
    window.savedClockVideo = 0;
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

  await page.setViewportSize({ width: 1100, height: 768 });
  await page.getByRole('link', { name: '모둠 영상 찍기' }).click();
  await page.getByRole('heading', { name: '시계 모둠 영상 찍기' }).waitFor();
  assert.equal(await page.locator('#people-choice').isVisible(), false);
  await page.locator('#room-code').fill('123456');
  await page.locator('.group-picker label').first().click();
  await page.locator('#join-submit').click();
  await page.waitForFunction(() => document.querySelector('#group-clock-time').textContent === '9시');
  assert.equal(await page.locator('#group-topic').inputValue(), '몸으로 시계 나타내기');
  await page.locator('#format-avatar').click();
  await page.locator('#record').click();
  await page.waitForFunction(() => window.clockFramesRecorded > 0 && document.querySelector('#timer').textContent !== '0:00');
  await page.locator('#record').click();
  await page.locator('#review').click();
  await page.waitForFunction(() => document.querySelector('#pending-video').videoWidth > 0);
  const dimensions = await page.locator('#pending-video').evaluate(async video => {
    await video.play();
    return [video.videoWidth, video.videoHeight];
  });
  assert.deepEqual(dimensions, [960, 768]);
  await page.locator('#retry-upload').click();
  await page.waitForFunction(() => window.savedClockVideo > 0 && document.querySelector('#pending').hidden);

  assert.deepEqual(pageErrors, []);
  console.log('Body clock browser checks passed: compact menus, phone layout, pose feedback, group recording, preview and submission.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
