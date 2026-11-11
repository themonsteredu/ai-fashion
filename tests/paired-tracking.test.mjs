import test from 'node:test';
import assert from 'node:assert/strict';
import {PairAssociator,distributeHands} from '../js/paired-tracking.js';
const points=x=>Array.from({length:33},()=>({x,y:.5,z:0,visibility:1}));
const frame=(...xs)=>({landmarks:xs.map(points),worldLandmarks:xs.map(points)});
test('two identities survive reversed detector ordering and single-person dropout',()=>{
  const tracker=new PairAssociator();let people=tracker.update(frame(.2,.8),0);
  const ids=people.map(p=>p.generation);assert.deepEqual(people.map(p=>p.center.x),[.8,.2]);
  people=tracker.update(frame(.79,.21),40);assert.deepEqual(people.map(p=>p.generation),ids);
  people=tracker.update(frame(.22),80);assert.equal(people[0],null);assert.equal(people[1].generation,ids[1]);
  people=tracker.update(frame(.23,.77),120);assert.deepEqual(people.map(p=>p.generation),ids);
});
test('crossing with clear trajectories retains identities; overlap emits no borrowed pose',()=>{
  const tracker=new PairAssociator();const ids=tracker.update(frame(.2,.8),0).map(p=>p.generation);
  tracker.update(frame(.3,.7),100);tracker.update(frame(.4,.6),200);
  assert.deepEqual(tracker.update(frame(.49,.51),300),[null,null]);
  const after=tracker.update(frame(.6,.4),400);assert.deepEqual(after.map(p=>p.generation),ids);
  assert.ok(after[0].center.x<after[1].center.x);
});
test('empty and invalid frames do not duplicate people; expiry starts new identity',()=>{
  const tracker=new PairAssociator();const first=tracker.update(frame(.2,.8),0);
  assert.deepEqual(tracker.update(frame(),40),[null,null]);
  const invalid=frame(.2,.8);invalid.landmarks[0][11].visibility=.1;
  const result=tracker.update(invalid,80);assert.equal(result.filter(Boolean).length,1);
  const next=tracker.update(frame(.2,.8),2000);assert.notEqual(next[0].generation,first[0].generation);
});
test('each detected hand and wrist belongs to at most one person',()=>{
  const people=[{image:points(.3)},{image:points(.7)}];
  people[0].image[15].x=.25;people[0].image[16].x=.35;
  people[1].image[15].x=.65;people[1].image[16].x=.75;
  const hands={landmarks:[.25,.35,.65,.75,.5].map(points),worldLandmarks:[.25,.35,.65,.75,.5].map(points),handedness:[]};
  const assigned=distributeHands(people,hands);
  assert.deepEqual(assigned.map(x=>x.landmarks.map(h=>h[0].x)),[[.25,.35],[.65,.75]]);
  assert.equal(distributeHands([null,people[1]],hands)[0].landmarks.length,0);
});
