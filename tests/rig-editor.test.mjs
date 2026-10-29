import test from 'node:test';
import assert from 'node:assert/strict';
import {seedJoints,validJoints} from '../js/rig-editor.js';
test('correction preserves reliable detections, replaces unreliable ones and bounds points',()=>{
 const j=seedJoints({joints:{NOSE:[120,50],L_WR:[999,400],R_WR:[0,0]},vis:{NOSE:1,L_WR:1,R_WR:.1}},600,1000);
 assert.deepEqual(j.NOSE,[120,50]); assert.deepEqual(j.L_WR,[600,400]);
 assert.deepEqual(j.R_WR,[108,520]); assert(validJoints(j,600,1000));
});
test('coincident, incomplete and nonfinite joints cannot be applied',()=>{
 const j=seedJoints(null,600,1000);assert(validJoints(j,600,1000));
 j.L_EL=[...j.L_SH];assert(!validJoints(j,600,1000));
 j.L_EL=[NaN,1];assert(!validJoints(j,600,1000));delete j.L_EL;assert(!validJoints(j,600,1000));
});
