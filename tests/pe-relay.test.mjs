import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRelayStep, getRelayMissions, RelaySession, RELAY_HOLD_MS, RELAY_MISSIONS } from '../js/pe-relay-engine.js';
import { pose, rng, synthFrame } from './pe-synth.mjs';

const waistL = { eL: 50, fL: -92 };
const waistR = { eR: 50, fR: -92 };
const chestL = { eL: 1, fL: -112 };
const chestR = { eR: 1, fR: -112 };
const shoulders = { eL: 24, fL: 166, eR: 24, fR: 166 };
const waist = { ...waistL, ...waistR };
const tArms = { eL: 90, eR: 90 };
const vArms = { eL: 140, eR: 140 };
const targets = [
  [waistR], [chestL], [shoulders], [{ eR: 173 }], [{ eL: 90, fL: -46 }],
  [{ eR: 90 }], [{ eL: 90 }], [{ eR: 140 }], [{ eL: 48 }], [vArms],
  [{ tilt: -18 }], [{ lean: 16 }], [{ outL: 17 }], [{ sideR: 0.65 }], [{ squat: 0.11, outL: 10, outR: 10 }],
  [{ ...waistL, eR: 173 }], [{ eL: 140, eR: 48 }], [{ eL: 90, outR: 17 }],
  [waist, shoulders], [tArms, vArms],
];
const upperTargets = new Map([
  [13, [{ lean: -16 }]], [14, [{ eR: 90, fR: -46 }]], [15, [{ ...chestL, ...chestR }]], [18, [{ ...waistR, eL: 90 }]],
]);

function frame(overrides = {}) {
  return synthFrame(pose(overrides), rng(83), { noise: false, spikes: false });
}

function camera(session) {
  let now = 0;
  let frameId = 0;
  return {
    update({ snap, ov }, { ms = 50, fresh = true } = {}) {
      now += ms;
      if (fresh) frameId++;
      return session.update({ ...snap, frameId }, now, ov);
    },
  };
}

function hold(cam, input, ms = RELAY_HOLD_MS) {
  let state;
  for (let i = 0; i <= ms / 50; i++) state = cam.update(input);
  return state;
}

test('all 20 students can complete their own mission by camera in either framing mode', () => {
  for (const upperBodyOnly of [false, true]) {
    const session = new RelaySession({ upperBodyOnly });
    const cam = camera(session);
    const missions = getRelayMissions({ upperBodyOnly });
    assert.equal(missions.length, 20);
    assert.deepEqual(missions.filter((m) => m.requiresFullBody).map((m) => m.id), upperBodyOnly ? [] : [13, 14, 15, 18]);

    for (const [i, mission] of missions.entries()) {
      assert.equal(mission.id, i + 1);
      assert.equal(session.startTurn().turn, i + 1);
      const expected = (upperBodyOnly && upperTargets.get(mission.id)) || targets[i];
      for (const [index, overrides] of expected.entries()) {
        const sample = frame(overrides);
        const evaluated = evaluateRelayStep(sample.snap, mission.steps[index], sample.ov);
        assert.equal(evaluated.matched, true, `Mission ${mission.id}, step ${index + 1}: ${evaluated.hint}`);
        const state = hold(cam, sample);
        if (index < expected.length - 1) {
          assert.equal(state.phase, 'active');
          assert.equal(state.step, index + 1);
          assert.equal(state.progress, 0);
        } else {
          assert.equal(state.phase, i === 19 ? 'done' : 'handoff');
          assert.deepEqual(state.result, { method: 'camera', turn: i + 1 });
          assert.equal(state.completed, i + 1);
        }
      }
    }
    assert.equal(session.startTurn().phase, 'done');
    assert.equal(session.completeTurn().completed, 20);
    assert.equal(session.start().completed, 0);
  }
});

test('a teacher starts every turn and stale pose frames cannot complete the next student', () => {
  const session = new RelaySession();
  const cam = camera(session);
  const first = frame(waistR);
  const second = frame(chestL);
  assert.equal(hold(cam, first).phase, 'ready');
  session.startTurn();
  assert.equal(hold(cam, first).phase, 'handoff');
  assert.equal(hold(cam, second).completed, 1);
  assert.equal(session.retryTurn().phase, 'handoff');
  assert.equal(session.completeTurn().completed, 1);

  session.startTurn();
  for (let i = 0; i < 25; i++) cam.update(second, { fresh: false });
  assert.equal(session.getState().completed, 1);
  assert.equal(session.getState().progress, 0);
  assert.equal(hold(cam, second).completed, 2);
});

test('one second of fresh matching frames is required, with no time counted from a pause or camera gap', () => {
  const session = new RelaySession();
  const cam = camera(session);
  const target = frame(waistR);
  session.startTurn();
  assert.equal(hold(cam, target, 400).progress, 0.4);
  session.setPaused(true);
  assert.equal(hold(cam, target, 3000).progress, 0.4);
  session.setPaused(false);
  assert.equal(cam.update(target).progress, 0.4);
  assert.equal(cam.update(target, { ms: 800 }).progress, 0);

  assert.equal(hold(cam, target, 400).phase, 'active');
  assert.equal(cam.update(target, { ms: 300, fresh: false }).hintType, 'framing');
  assert.equal(session.getState().progress, 0);
  assert.equal(hold(cam, target, 950).phase, 'active');
  assert.equal(cam.update(target).phase, 'handoff');
});

test('retry resets the current attempt and manual completion is recorded once', () => {
  const session = new RelaySession();
  const cam = camera(session);
  session.startTurn();
  assert.equal(hold(cam, frame(waistR), 500).progress, 0.5);
  assert.equal(session.retryTurn().progress, 0);
  assert.equal(session.getState().turn, 1);
  assert.equal(session.getState().completed, 0);
  assert.deepEqual(session.completeTurn().result, { method: 'teacher', turn: 1 });
  assert.equal(session.completeTurn().completed, 1);
  assert.equal(session.startTurn().turn, 2);
  assert.equal(session.getState().result, null);
});

test('missions 19 and 20 only accept the second pose after the first', () => {
  const session = new RelaySession();
  const cam = camera(session);
  for (let i = 0; i < 18; i++) { session.startTurn(); session.completeTurn(); }
  for (const [turn, first, second] of [[19, waist, shoulders], [20, tArms, vArms]]) {
    session.startTurn();
    assert.equal(hold(cam, frame(second)).step, 0);
    assert.equal(session.getState().completed, turn - 1);
    assert.equal(hold(cam, frame(first)).step, 1);
    assert.equal(hold(cam, frame(first)).progress, 0);
    assert.equal(hold(cam, frame(second)).completed, turn);
  }
});

test('mirrored student directions keep each arm and foot on its anatomical side', () => {
  const [right, left, upperRight, lowerLeft] = RELAY_MISSIONS.slice(5, 9).map((m) => m.steps[0]);
  const poses = [
    [right, { eR: 90 }, { eL: 90 }, 'rightUpperArm'], [left, { eL: 90 }, { eR: 90 }, 'leftUpperArm'],
    [upperRight, { eR: 140 }, { eL: 140 }, 'rightUpperArm'], [lowerLeft, { eL: 48 }, { eR: 48 }, 'leftUpperArm'],
    [RELAY_MISSIONS[12].steps[0], { outL: 17 }, { outR: 17 }, 'leftUpperLeg'],
  ];
  for (const [target, correct, opposite, bone] of poses) {
    const good = frame(correct), wrong = frame(opposite);
    assert.equal(evaluateRelayStep(good.snap, target, good.ov).matched, true);
    assert.equal(evaluateRelayStep(wrong.snap, target, wrong.ov).hintType, 'posture');
    assert.ok(target.demo.some(([name]) => name === bone));
  }
});

test('camera framing feedback differs from pose hints and inferred cropped joints cannot pass', () => {
  const foot = RELAY_MISSIONS[12].steps[0];
  const { snap, ov } = frame({ outL: 17 });
  assert.equal(evaluateRelayStep(snap, foot, ov).matched, true);
  ov[27].y = 1.04;
  assert.match(evaluateRelayStep(snap, foot, ov).hint, /무릎과 두 발/);
  assert.equal(evaluateRelayStep(snap, foot, ov).hintType, 'framing');
  snap.vis.L_ANK = 0.1;
  assert.equal(evaluateRelayStep(snap, foot).hintType, 'framing');
  const neutral = frame();
  assert.equal(evaluateRelayStep(neutral.snap, foot, neutral.ov).hintType, 'posture');
  const bothFeetOut = frame({ outL: 17, outR: 17 });
  assert.equal(evaluateRelayStep(bothFeetOut.snap, foot, bothFeetOut.ov).matched, false);
});
