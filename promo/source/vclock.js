// 녹화용 가상 시계: 브라우저 시간을 1/30초씩 직접 진행시켜 느린 PC에서도 끊김 없는 프레임을 얻는다.
(() => {
  const R = { now: performance.now.bind(performance), dnow: Date.now, raf: window.requestAnimationFrame.bind(window), caf: window.cancelAnimationFrame.bind(window), st: window.setTimeout.bind(window), ct: window.clearTimeout.bind(window), si: window.setInterval.bind(window), ci: window.clearInterval.bind(window) };
  const V = window.__vc = { on: false, t: 0, dateBase: 0, rafQ: new Map(), timers: new Map(), seq: 1, anims: new WeakMap() };
  V.eps = 0;
  // 가상 시간 중에도 호출할 때마다 아주 조금씩 증가 (바쁜 대기 루프가 멈추지 않게)
  performance.now = () => V.on ? V.t + Math.min(30, (V.eps += 0.002)) : R.now();
  Date.now = () => V.on ? Math.floor(V.dateBase + V.t + Math.min(30, (V.eps += 0.002))) : R.dnow();
  window.requestAnimationFrame = (cb) => { if (!V.on) return R.raf(cb); const id = 1e7 + V.seq++; V.rafQ.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { if (V.rafQ.has(id)) V.rafQ.delete(id); else R.caf(id); };
  const addTimer = (fn, ms, args, rep) => { const id = 1e7 + V.seq++; V.timers.set(id, { fn, at: V.t + Math.max(0, ms || 0), ms: Math.max(1, ms || 0), args, rep, seq: id }); return id; };
  window.setTimeout = (fn, ms, ...a) => V.on ? addTimer(fn, ms, a, false) : R.st(fn, ms, ...a);
  window.setInterval = (fn, ms, ...a) => V.on ? addTimer(fn, ms, a, true) : R.si(fn, ms, ...a);
  window.clearTimeout = (id) => { if (V.timers.has(id)) V.timers.delete(id); else R.ct(id); };
  window.clearInterval = (id) => { if (V.timers.has(id)) V.timers.delete(id); else R.ci(id); };
  V.start = () => { V.t = R.now(); V.dateBase = R.dnow() - V.t; V.on = true; };
  const syncAnims = () => {
    for (const a of document.getAnimations()) {
      let st = V.anims.get(a);
      if (st === undefined) { st = V.t - (a.currentTime || 0); V.anims.set(a, st); try { a.pause(); } catch (e) {} }
      try { a.currentTime = V.t - st; } catch (e) {}
    }
  };
  V.step = (ms = 1000 / 30) => {
    const end = V.t + ms;
    // 이번 스텝 시작 시점에 있던 타이머만 시간 순서대로 실행 (새로 생긴 0ms 타이머는 다음 스텝)
    const due = [...V.timers.entries()].filter(([, v]) => v.at <= end).sort((x, y) => x[1].at - y[1].at || x[1].seq - y[1].seq);
    for (const [id, tm] of due) {
      if (V.timers.get(id) !== tm) continue;
      V.t = Math.max(V.t, tm.at);
      if (tm.rep) tm.at = Math.max(tm.at + tm.ms, V.t + 1); else V.timers.delete(id);
      try { typeof tm.fn === 'function' ? tm.fn(...(tm.args || [])) : eval(tm.fn); } catch (e) { console.error(e); }
    }
    V.t = end; V.eps = 0;
    syncAnims();
    const q = [...V.rafQ.values()]; V.rafQ.clear();
    for (const cb of q) { try { cb(V.t); } catch (e) { console.error(e); } }
    syncAnims();
    return V.t;
  };
})();
