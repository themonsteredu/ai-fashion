import test from 'node:test';
import assert from 'node:assert/strict';
import { POSE_BY_ID } from '../js/poses.js';
import { MissionJudge, DEFAULT_SETTINGS } from '../js/mission.js';

import { snapshot } from './fixtures/pose-snapshots.mjs';

for (const id of ['both_up','left_up','right_up','lean_left','lean_right']) {
  test(`${id}: correct hold succeeds, wrong/occluded poses never succeed`, () => {
    for (const input of [id,'neutral', ...(id==='both_up'?['left_up','right_up']:id.startsWith('lean')?[id==='lean_left'?'lean_right':'lean_left']:[])]) {
      const judge=new MissionJudge(POSE_BY_ID[id],DEFAULT_SETTINGS);
      let r; for(let t=0;t<1000;t+=20) r=judge.update(snapshot(input),20,t);
      assert.equal(r.state==='success',input===id,`${id} vs ${input}`);
    }
    const judge=new MissionJudge(POSE_BY_ID[id],DEFAULT_SETTINGS);
    for(let t=0;t<1000;t+=20) assert.notEqual(judge.update(snapshot(id,.1),20,t).state,'success');
  });
}
test('400ms hold excludes entry stabilization and preserves progress through a brief slip',()=>{
  const j=new MissionJudge(POSE_BY_ID.both_up,DEFAULT_SETTINGS); let t=0,r;
  const run=(id,n)=>{for(let i=0;i<n;i++){r=j.update(snapshot(id),20,t);t+=20;}return r;};
  assert.notEqual(run('both_up',14).state,'success'); const held=j.holdMs;
  assert.notEqual(run('neutral',10).state,'success'); assert.equal(j.holdMs,held);
  assert.equal(run('both_up',10).state,'success');
  j.reset();t=0;run('both_up',14);run('neutral',50);assert.equal(j.holdMs,0);
  assert.notEqual(run('both_up',5).state,'success');
});
test('wrong pose times out without awarding success',()=>{
 const j=new MissionJudge(POSE_BY_ID.both_up,DEFAULT_SETTINGS);let r;
 for(let t=0;t<=8000;t+=20) r=j.update(snapshot(),20,t);
 assert.equal(r.state,'timeout');
});
