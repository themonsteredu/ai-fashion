// Camera-free relay regression through the normal home screen and real avatar renderer.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'test-results');
await mkdir(output, { recursive: true });

const mime = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + '/')) throw Error('invalid path');
    response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const relay = '#pe-relay-root';
const action = name => `${relay} [data-relay-action="${name}"]`;
const ref = name => `${relay} [data-ref="${name}"]`;
const phase = (page, name) => page.locator(`${relay}[data-phase="${name}"]`).waitFor({ state: 'visible' });
const click = (page, name) => page.locator(action(name)).click();
const screenshot = (page, name) => {
  const { width, height } = page.viewportSize();
  return page.screenshot({ path: resolve(output, `pe-relay-${name}-${width}x${height}.png`) });
};

// This replaces the video/tracker boundary only. A snapshot is reused across reads until a
// detector frame arrives, just like motion.js, so stale and missing input remain distinguishable.
const tracker = `
import { pose, rng, synthFrame } from '../tests/pe-synth.mjs';

const random = rng(38);
const input = window.__relayInput;
let frame = { snap: { present: false, calibrated: false, frameId: 0 }, ov: null };
let lastFrameAt = -Infinity;
let frameId = 0;
let camera = false;

export async function startCamera() {
  input.starts++;
  if (input.rejectCamera) throw new DOMException('Test camera denied', 'NotAllowedError');
  camera = true;
}
export function stopCamera() { camera = false; input.stops++; }
export function resetForNextStudent() {
  input.resets++;
  frame = { snap: { present: false, calibrated: false, frameId }, ov: null };
  lastFrameAt = -Infinity;
}
export function detect(now) {
  if (!camera || input.stale || now - lastFrameAt < 28) return;
  lastFrameAt = now;
  frameId++;
  frame = input.pose === null
    ? { snap: { present: false, calibrated: true }, ov: null }
    : synthFrame(pose(input.pose), random, { noise: false });
  frame.snap.frameId = frameId;
  input.frames = frameId;
}
export const getPoseSnapshot = () => frame.snap;
export const getPoseOverlay = () => frame.ov;
export const getStatus = () => !camera ? 'idle' : frame.snap.present ? 'ok' : 'noperson';
export const getCalibProgress = () => 1;
export const getHeadHint = () => null;
export const getDebugInfo = () => ({});
export const initTrackers = async () => {};
export const setAvatar = () => {};
export const applyToVRM = () => {};
`;

async function openRelay(browser, viewport, rejectCamera = false) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(reject => {
    window.__relayInput = { pose: {}, stale: false, rejectCamera: reject, starts: 0, stops: 0, resets: 0, frames: 0 };
  }, rejectCamera);
  await page.route('**/js/motion.js', route => route.fulfill({ body: tracker, contentType: 'text/javascript' }));
  await page.route('**/js/cambg.js', async route => {
    const source = await readFile(resolve(root, 'js/cambg.js'), 'utf8');
    assert(source.includes('export async function init() {'));
    return route.fulfill({
      body: source.replace('export async function init() {', 'export async function init() {}\nasync function unusedInit() {'),
      contentType: 'text/javascript',
    });
  });
  await page.route('https://cdn.jsdelivr.net/**', async route => {
    if (!process.env.FONT_DIR) return route.abort();
    const filename = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({ body: await readFile(resolve(process.env.FONT_DIR, filename)), contentType: 'font/woff' });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 60_000 });
  await page.locator('#btn-pe').click();
  await phase(page, 'setup');
  await page.locator('#screen-motion.active').waitFor({ state: 'visible' });
  await page.evaluate(async () => { await document.fonts.ready; });
  return { page, errors };
}

async function setPose(page, pose, stale = false) {
  await page.evaluate(async ({ pose, stale }) => {
    const input = window.__relayInput;
    const frame = input.frames;
    input.pose = pose;
    input.stale = false;
    // Freeze immediately after the next snapshot if requested.
    const deadline = performance.now() + 5000;
    while (input.frames === frame) {
      if (performance.now() > deadline) throw Error('The test tracker did not produce a frame');
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    input.stale = stale;
  }, { pose, stale });
}

const hint = (page, type) => page.locator(`${ref('status')}[data-hint="${type}"]`).waitFor({ state: 'visible' });
const completed = page => page.locator(`${relay} .relay-progress .is-complete`).count();
const turn = async page => Number(await page.locator(ref('turn')).innerText());

async function beginTurn(page, name, student, captureDemo = false) {
  await click(page, name);
  await phase(page, 'watch');
  assert.equal(await turn(page), student);
  assert.match(await page.locator(ref('status')).innerText(), /시범/);
  assert.equal(await page.locator(action('complete')).isVisible(), false);
  if (captureDemo) await screenshot(page, 'demo');
  if (student >= 19) {
    const watchFocus = page.locator(`${relay}[data-phase="watch"] [data-ref="focus"]`);
    await watchFocus.filter({ hasText: '1/2' }).waitFor({ state: 'visible' });
    await watchFocus.filter({ hasText: '2/2' }).waitFor({ state: 'visible' });
  }
  await phase(page, 'active');
  assert.equal(await turn(page), student);
  if (student >= 19) assert.match(await page.locator(ref('focus')).innerText(), /1\/2/);
}

async function checkLayout(page) {
  const layout = await page.evaluate(async () => {
    const [Avatar, Puppet, Three] = await Promise.all([
      import('/js/avatar.js'), import('/js/puppet.js'), import('/lib/three.module.min.js'),
    ]);
    const bounds = selector => {
      const { left, right, top, bottom } = document.querySelector(selector).getBoundingClientRect();
      return { left, right, top, bottom };
    };
    const joints = Puppet.jointWorld() || Object.fromEntries(
      ['hips', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
        'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg',
        'rightLowerLeg', 'leftFoot', 'rightFoot'].map(name => {
        const bone = Avatar.state.vrm.humanoid.getRawBoneNode(name);
        if (!bone) throw Error(`Missing 3D joint: ${name}`);
        return [name, bone.getWorldPosition(new Three.Vector3())];
      }));
    const points = Object.values(joints).map(({ x, y, z }) => {
      const position = new Three.Vector3(x, y, z).project(Avatar.state.camera);
      return { x: (position.x + 1) * innerWidth / 2, y: (1 - position.y) * innerHeight / 2 };
    });
    return {
      width: innerWidth, height: innerHeight,
      stage: bounds('.relay-stage'), fit: bounds('.relay-stage-fit'),
      panel: bounds('.relay-play'), header: bounds('.relay-header'),
      camera: document.body.classList.contains('relay-cam-on') ? bounds('#cam-wrap') : null,
      avatar: {
        left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
        top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)),
      },
    };
  });
  const { stage, fit, panel, header, camera, avatar, width, height } = layout;
  const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  const inside = (a, b, margin = 1) => a.left >= b.left - margin && a.right <= b.right + margin
    && a.top >= b.top - margin && a.bottom <= b.bottom + margin;
  const viewport = { left: 0, top: 0, right: width, bottom: height };
  for (const bounds of [stage, panel, header]) assert(inside(bounds, viewport), JSON.stringify(layout));
  assert(inside(avatar, fit, 3), `Avatar joints leave the stage ${JSON.stringify(layout)}`);
  assert(!overlap(stage, panel) && !overlap(stage, header) && !overlap(panel, header), JSON.stringify(layout));
  if (camera) {
    assert(inside(camera, stage), JSON.stringify(layout));
    assert(!overlap(avatar, camera), `Avatar overlaps camera ${JSON.stringify(layout)}`);
  }
  return layout;
}

async function automaticThenManual(page) {
  await page.locator('#relay-upper-body').check();
  await screenshot(page, 'setup');
  await click(page, 'start');
  await phase(page, 'ready');
  await beginTurn(page, 'student', 1, true);
  await hint(page, 'posture');
  const layout = await checkLayout(page);
  await screenshot(page, 'active');

  assert.equal(await completed(page), 0);
  assert.equal(await page.locator(ref('hold')).evaluate(el => el.value), 0);
  const waist = { eR: 50, fR: -100 };
  await setPose(page, waist);
  await page.waitForFunction(selector => document.querySelector(selector).value > 0, ref('hold'));
  await setPose(page, null);
  await hint(page, 'framing');
  assert.equal(await completed(page), 0, 'A brief correct pose cannot complete a turn');
  assert.equal(await page.locator(ref('hold')).evaluate(el => el.value), 0, 'Lost tracking resets the hold');

  await setPose(page, waist, true);
  await page.waitForTimeout(1100);
  await hint(page, 'framing');
  assert.match(await page.locator(ref('status')).innerText(), /영상이 다시 들어오면/);
  assert.equal(await completed(page), 0, 'One stale tracker frame cannot complete a turn');
  await setPose(page, waist);
  await phase(page, 'handoff');
  assert.match(await page.locator(ref('status')).innerText(), /미션 성공/);
  assert.equal(await page.locator(action('complete')).isVisible(), false);
  assert.equal(await completed(page), 1);
  await screenshot(page, 'handoff');

  await setPose(page, null);
  for (let student = 2; student <= 20; student++) {
    await beginTurn(page, 'next', student);
    assert.equal(await completed(page), student - 1);
    if (student === 13) {
      assert.match(await page.locator(ref('title')).innerText(), /몸통을 왼쪽/,
        'Upper-body setup replaces the original left-foot task');
    }
    await click(page, 'complete');
    await phase(page, student < 20 ? 'handoff' : 'done');
  }

  assert.equal(await completed(page), 20);
  assert.match(await page.locator(`${relay} [data-relay-view="done"] h2`).innerText(), /20명 모두/);
  assert.equal(await page.locator(ref('automatic')).innerText(), '1명');
  assert.equal(await page.locator(ref('manual')).innerText(), '19명');
  assert.deepEqual(await page.evaluate(() => {
    const { starts, resets } = window.__relayInput;
    return { starts, resets };
  }), { starts: 1, resets: 20 }, 'Student handoffs reset tracking without reopening the camera');
  await screenshot(page, 'done');
  await click(page, 'restart');
  await phase(page, 'setup');
  await click(page, 'start');
  await phase(page, 'ready');
  assert.equal(await turn(page), 1);
  assert.equal(await completed(page), 0);
  return layout;
}

async function firstTurn(page, cameraDenied) {
  if (cameraDenied) {
    const note = page.locator(ref('camera')).filter({ hasText: '카메라 없이' });
    await note.waitFor({ state: 'visible' });
  }
  await screenshot(page, 'setup');
  await click(page, 'start');
  await phase(page, 'ready');
  await beginTurn(page, 'student', 1);
  if (cameraDenied) {
    assert.match(await page.locator(ref('status')).innerText(), /카메라 없이/);
    assert.equal(await page.locator(ref('hold')).isVisible(), false);
  } else {
    await hint(page, 'posture');
  }
  const layout = await checkLayout(page);
  await screenshot(page, cameraDenied ? 'camera-denied' : 'active');
  await click(page, 'complete');
  await phase(page, 'handoff');
  assert.match(await page.locator(ref('status')).innerText(), /교사가 자세를 확인/);
  assert.equal(await completed(page), 1);
  return layout;
}

const results = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  for (const [width, height] of [[1366, 768], [1024, 768], [390, 844]]) {
    const cameraDenied = width === 1024;
    const { page, errors } = await openRelay(browser, { width, height }, cameraDenied);
    try {
      const layout = width === 1366 ? await automaticThenManual(page) : await firstTurn(page, cameraDenied);
      assert.equal(!!layout.camera, !cameraDenied);
      await click(page, 'exit');
      await page.locator('#screen-start.active #btn-pe').waitFor({ state: 'visible' });
      assert.equal(await page.locator(relay).isVisible(), false);
      assert.equal(await page.evaluate(() => window.__relayInput.stops), 1);
      assert.deepEqual(errors, []);
      results.push({ width, height, cameraDenied, layout, pageErrors: errors });
    } catch (error) {
      await screenshot(page, 'failure').catch(() => {});
      throw error;
    } finally {
      await page.close();
    }
  }
  await writeFile(resolve(output, 'pe-relay-browser.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
