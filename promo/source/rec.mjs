// 녹화 도구: 로컬 앱(http://localhost:8017)을 가상 시계로 한 프레임씩 진행하며 캡처
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
export const FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2';
export const BASE = 'http://localhost:8017';
const FONT = `*{font-family:"Pretendard",sans-serif !important}`;
export const w = ms => new Promise(r => setTimeout(r, ms));
export async function session(fn, { settings, enabled } = {}) {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript({ path: new URL('./vclock.js', import.meta.url).pathname });
  await ctx.addInitScript({ path: new URL('./standin.js', import.meta.url).pathname });
  await ctx.addInitScript(([css, settings, enabled]) => {
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); });
    if (settings) localStorage.setItem('fas_mission_settings_v1', JSON.stringify(settings));
    if (enabled) localStorage.setItem('fas_mission_enabled_v1', JSON.stringify(enabled));
  }, [FONT, settings || null, enabled || null]);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('pageerror:', e.message));
  try {
    await page.goto(BASE + '/');
    for (let i = 0; i < 120; i++) { await w(1000); if (await page.locator('#loading.hidden').count()) break; }
    await w(3000);
    await fn(page);
  } finally { await b.close(); }
}
// 가상 시계로 진행 (녹화 없이)
export async function advance(page, sec) {
  const n = Math.round(sec * 30);
  for (let i = 0; i < n; i++) { await page.evaluate(() => window.__vc.step()); await w(15); }
}
// 녹화: 초 단위 길이, events: [[초, async fn], ...]
export async function vrecord(page, name, sec, events = []) {
  const dir = `clips/${name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const n = Math.round(sec * 30); const ev = [...events].sort((a, b) => a[0] - b[0]); let k = 0;
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    while (k < ev.length && ev[k][0] * 30 <= i) { await ev[k][1](); k++; }
    await page.evaluate(() => window.__vc.step());
    await w(25);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
    fs.writeFileSync(`${dir}/${String(i + 1).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64'));
    if (i % 60 === 0) console.log(name, i, '/', n, ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  execFileSync(FF, ['-y', '-loglevel', 'error', '-framerate', '30', '-i', `${dir}/%05d.jpg`, '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', `clips/${name}.mp4`]);
  console.log(name, 'done', n, 'frames', ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
