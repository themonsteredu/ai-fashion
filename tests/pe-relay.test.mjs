import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRelayStep, getRelayMissions, RelaySession, RELAY_HOLD_MS, RELAY_MISSIONS } from '../js/pe-relay-engine.js';
import { pose, rng, synthFrame } from './pe-synth.mjs';

const tArms = { eL: 90, eR: 90 };
const folded = { eL: 24, fL: 166, eR: 24, fR: 166 };
const vArms = { eL: 140, eR: 140 };
const downArms = { eL: 48, eR: 48 };
const upArms = { eL: 173, eR: 173 };
const crouch = { squat: 0.11, outL: 10, outR: 10 };
const targets = new Map([
  [1, [tArms]], [2, [folded]], [14, [folded, vArms]], [15, [crouch]], [16, [upArms]], [20, [crouch, upArms]],
]);
const upperTargets = new Map([
  [8, [downArms, upArms]], [15, [downArms]], [20, [downArms, upArms]],
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

test('all 20 textbook missions complete by the intended assessment in both framing modes', () => {
  for (const upperBodyOnly of [false, true]) {
    const session = new RelaySession({ upperBodyOnly });
    const cam = camera(session);
    const missions = getRelayMissions({ upperBodyOnly });
    assert.equal(missions.length, 20);
    assert.deepEqual(missions.filter((m) => m.requiresFullBody).map((m) => m.id), upperBodyOnly ? [] : [4, 7, 8, 9, 10, 11, 12, 13, 15, 17, 18, 19, 20]);

    for (const [i, mission] of missions.entries()) {
      assert.equal(mission.id, i + 1);
      assert.equal(session.startTurn().turn, i + 1);
      const expected = (upperBodyOnly && upperTargets.get(mission.id)) || targets.get(mission.id);
      assert.equal(mission.assessment, expected ? 'camera' : 'teacher');
      if (mission.assessment === 'teacher') {
        assert(mission.demoFrames.length >= 2);
        assert.equal(hold(cam, frame(), RELAY_HOLD_MS * 2).phase, 'active');
        assert.deepEqual(session.completeTurn().result, { method: 'teacher', turn: i + 1 });
        assert.equal(session.getState().completed, i + 1);
        continue;
      }
      assert.equal(mission.steps.length, expected.length);
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
  const first = frame(tArms);
  const second = frame(folded);
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
  const target = frame(tArms);
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
  assert.equal(hold(cam, frame(tArms), 500).progress, 0.5);
  assert.equal(session.retryTurn().progress, 0);
  assert.equal(session.getState().turn, 1);
  assert.equal(session.getState().completed, 0);
  assert.deepEqual(session.completeTurn().result, { method: 'teacher', turn: 1 });
  assert.equal(session.completeTurn().completed, 1);
  assert.equal(session.startTurn().turn, 2);
  assert.equal(session.getState().result, null);
});

test('the balloon and piano missions require their postures in order', () => {
  for (const [turn, first, second] of [[14, folded, vArms], [20, crouch, upArms]]) {
    const session = new RelaySession();
    const cam = camera(session);
    for (let i = 1; i < turn; i++) { session.startTurn(); session.completeTurn(); }
    session.startTurn();
    assert.equal(hold(cam, frame(second)).step, 0);
    assert.equal(session.getState().completed, turn - 1);
    assert.equal(hold(cam, frame(first)).step, 1);
    assert.equal(hold(cam, frame(first)).progress, 0);
    assert.equal(hold(cam, frame(second)).completed, turn);
  }
});

test('the signpost needs both arms extended and the shell needs both elbows folded', () => {
  const [signpost, shell] = RELAY_MISSIONS.slice(0, 2).map((m) => m.steps[0]);
  for (const [target, good, wrong] of [[signpost, tArms, { eL: 90 }], [shell, folded, tArms]]) {
    const match = frame(good), miss = frame(wrong);
    assert.equal(evaluateRelayStep(match.snap, target, match.ov).matched, true);
    assert.equal(evaluateRelayStep(miss.snap, target, miss.ov).hintType, 'posture');
  }
});

test('camera framing feedback differs from pose hints and inferred cropped joints cannot pass', () => {
  const low = RELAY_MISSIONS[14].steps[0];
  const { snap, ov } = frame(crouch);
  assert.equal(evaluateRelayStep(snap, low, ov).matched, true);
  ov[27].y = 1.04;
  assert.match(evaluateRelayStep(snap, low, ov).hint, /무릎과 두 발/);
  assert.equal(evaluateRelayStep(snap, low, ov).hintType, 'framing');
  snap.vis.L_ANK = 0.1;
  assert.equal(evaluateRelayStep(snap, low).hintType, 'framing');
  const neutral = frame();
  assert.equal(evaluateRelayStep(neutral.snap, low, neutral.ov).hintType, 'posture');
});
