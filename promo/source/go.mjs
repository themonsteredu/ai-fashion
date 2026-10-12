// 실제 앱 화면 녹화 시나리오 (가상 시계 + 시연용 가상 카메라)
import { session, advance, vrecord, w } from './rec.mjs';
const which = process.argv[2];
const ALL = ['both_up','left_up','right_up','both_side','left_side','right_side','attention','hands_hip','lup_rside','rup_lside','both_diag_up','both_diag_down','point_left','point_right','point_up','airplane','superhero','cheer','lean_left','lean_right','robot','muscle','disco','trex','selfhug','dab','wide_stand','one_leg','squat','knee_left','knee_right','overhead_heart','v_left','v_right','v_both','hands_face','chin_rest','thumbsup_left','thumbsup_right','surprise','raise_both','wave_left','wave_right','wave_both','sway'];
// 영상에는 가상 카메라 모델이 안정적으로 할 수 있는 팔 포즈 3개만 출제되도록 운영자 설정과 같은 값을 미리 넣어 둠
const PICK = ['both_side', 'both_up', 'right_up'];
const enabled = Object.fromEntries(ALL.map(id => [id, PICK.includes(id)]));
const info = p => p.evaluate(() => ({ t: document.querySelector('#mm-title')?.textContent, ph: document.querySelector('#mm-card')?.dataset.phase, res: document.querySelector('#mm-result')?.style.display }));

if (which === 'mission') await session(async p => {
  await p.evaluate(() => window.__vc.start());
  await advance(p, 0.5);
  await vrecord(p, 'start', 4.2, [[2.6, () => p.click('#btn-mission')]]);
  // 카메라/인식 준비 대기 (녹화 안 함)
  for (let i = 0; i < 20; i++) { await advance(p, 0.2); const x = await info(p); console.log('wait', JSON.stringify(x)); if (x.t) break; }
  // 미션 3개 + 결과까지 이어서 녹화 (구간별 파일)
  let part = 0;
  for (;;) {
    await vrecord(p, `mission${part}`, 4, []); part++;
    const x = await info(p); console.log('after part', part, JSON.stringify(x));
    if (x.res === 'flex') { await vrecord(p, `mission${part}`, 3.5, []); break; }
    if (part > 14) break;
  }
  await vrecord(p, 'admin', 4.5, [[0.4, () => p.keyboard.press('Escape')]]);
}, { settings: { totalMissions: 3, passCount: 2, retries: 1 }, enabled });

if (which === 'free') await session(async p => {
  await p.evaluate(() => window.__vc.start());
  await p.click('#btn-done');
  await p.evaluate(() => { window.__standin.mode = 'script'; window.__standin.script = [[0, null]]; });
  for (let i = 0; i < 40; i++) { await advance(p, 0.2); const g = await p.evaluate(() => document.querySelector('#guide-msg').classList.contains('hidden') ? 'ok' : document.querySelector('#guide-msg').textContent); console.log('wait', g); if (g === 'ok') break; }
  await advance(p, 0.5);
  await p.evaluate(() => { const S = window.__standin; S.t0 = performance.now(); S.script = [[0.3, 'both_up'], [2.0, 'wave_right'], [4.2, 'airplane'], [6.0, 'cheer'], [7.8, 'hands_face']]; });
  await vrecord(p, 'free', 9, []);
  await p.evaluate(() => { const S = window.__standin; S.t0 = performance.now(); S.script = [[0, 'both_diag_up'], [2.2, 'wave_both'], [4.4, null]]; });
  await vrecord(p, 'bg', 5, [[0.6, () => p.click('#cambg-tabs .chip[data-cambg="replace"]')]]);
  await p.evaluate(() => { const S = window.__standin; S.t0 = performance.now(); S.script = [[0, 'v_both']]; });
  await vrecord(p, 'photo', 6.5, [[0.5, () => p.click('#btn-photo')]]);
  await p.click('#btn-photo-close'); await advance(p, 0.5);
  await vrecord(p, 'video', 2.5, [[0.4, () => p.click('#btn-video')]]);
});

if (which === 'upload') await session(async p => {
  await p.evaluate(() => window.__vc.start());
  await advance(p, 0.5);
  await vrecord(p, 'upload', 6, [[0.6, () => p.setInputFiles('#vrm-file', '/home/user/ai-fashion/sample_avatar.vrm')]]);
});

if (which === 'photo') await session(async p => {
  await p.evaluate(() => window.__vc.start());
  await p.click('#btn-done');
  await p.evaluate(() => { window.__standin.mode = 'script'; window.__standin.script = [[0, null]]; });
  for (let i = 0; i < 60; i++) { await advance(p, 0.2); const g = await p.evaluate(() => document.querySelector('#guide-msg').classList.contains('hidden') ? 'ok' : document.querySelector('#guide-msg').textContent); console.log('wait', g); if (g === 'ok') break; }
  await p.evaluate(() => { const S = window.__standin; S.t0 = performance.now(); S.script = [[0, 'both_diag_up']]; });
  await advance(p, 1.0);
  await vrecord(p, 'photo', 6.5, [[0.5, () => p.click('#btn-photo')]]);
  await p.click('#btn-photo-close'); await advance(p, 0.5);
  await vrecord(p, 'video', 2.5, [[0.4, () => p.click('#btn-video')]]);
});
