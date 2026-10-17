import assert from 'node:assert/strict';
import test from 'node:test';
import { Euler, Quaternion, Vector3 } from 'three';
import { createFlightAircraft, readFlightAircraft, targetsForFlight, writeFlightAircraft } from '../src/battle-flight';
import { selectDetailedUnitIds } from '../src/battle-view';
import { createBattle } from '../src/battle/simulation';
import { CAP } from '../src/battle/rules';
import { advanceThrottle, createFlightController, MAX_SPEED, STALL_SPEED, updateAircraftMotion, updatePlayerLoop } from '../src/flight';
import { FLIGHT_CAMERA_BANK_FACTOR, FLIGHT_FOV, getFlightCameraPose, projectFlightTarget } from '../src/flight-view';
import { targetAimPoint } from '../src/flight-assist';

const neutral = { turn: 0, climb: 0, fire: false, loop: false };
const dt = 1 / 60;

/** Independent reference equations from the fixed Kaisen motion acceptance
 * fixture. No renderer/controller calls participate in this calculation.
 */
function referenceStep(p: { pitch: number; yaw: number; bank: number; speed: number; position: Vector3 }, turn: number, climb: number, trim: number): void {
  const limit = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const authority = (p.speed <= 85 ? .92 + ((p.speed - 65) / 20) * .23 : p.speed <= 110 ? 1.15 - ((p.speed - 85) / 25) * .15 : 1)
    * limit(1 - Math.max(0, p.speed - 115) * .008, .78, 1);
  p.pitch += (climb * .95 - p.pitch) * (1 - Math.exp(-dt * 4.2));
  p.yaw = ((p.yaw - turn * .82 * authority * dt + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  p.bank += (turn * .72 - p.bank) * (1 - Math.exp(-dt * 5.5));
  p.speed = limit(p.speed + ((trim - p.speed) * .72 - Math.abs(turn) * 2.7 - Math.max(0, climb) * 2.1 - Math.sin(p.pitch) * 2.6) * dt, 65, 141);
  p.position.addScaledVector(new Vector3(0, 0, -1).applyEuler(new Euler(p.pitch, p.yaw, -p.bank, 'YXZ')), p.speed * dt);
}

test('fixed-source flight motion stays equal to the independent reference for slow/cruise/fast traces', () => {
  const game = createBattle(71, 'normal');
  const unit = game.mission.units.find(unit => unit.id === game.mission.controlledAircraftId)!;
  for (const speed of [65, 85, 110, 141]) {
    const actual = createFlightAircraft(unit, 'A'); actual.speed = speed;
    const expected = { pitch: actual.pitch, yaw: actual.yaw, bank: actual.bank, speed, position: actual.position.clone() };
    for (let tick = 0; tick < 600; tick++) {
      const turn = Math.sin(tick / 73) * .8, climb = Math.cos(tick / 110) * .6, preferred = tick < 300 ? 141 : 65;
      updateAircraftMotion(actual, turn, climb, dt, preferred, false, 141, .95);
      referenceStep(expected, turn, climb, preferred);
    }
    assert.ok(actual.position.distanceTo(expected.position) < 1e-8);
    for (const key of ['pitch', 'yaw', 'bank', 'speed'] as const) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-10, key);
  }
});

test('source loop lasts five seconds, restores the attitude, cancels on a new steering revision, and keeps mode throttle', () => {
  const game = createBattle(14, 'normal');
  const unit = game.mission.units.find(unit => unit.id === game.mission.controlledAircraftId)!;
  const plane = createFlightAircraft(unit, 'A'); plane.yaw = .3; plane.pitch = .12;
  const control = createFlightController(plane); let completed = 0;
  for (let i = 0; i < 300; i++) completed += Number(updatePlayerLoop(plane, control, neutral, neutral, i === 0, dt, 110, 141, 1));
  assert.equal(completed, 1); assert.equal(plane.loopProgress, 0); assert.equal(plane.loopCooldown, 2);
  assert.equal(plane.yaw, .3); assert.equal(plane.pitch, .12);
  plane.loopCooldown = 0;
  const input = { ...neutral, steeringRevision: 1 };
  for (let i = 0; i < 90; i++) updatePlayerLoop(plane, control, input, input, i === 0, dt, 110, 141, 1);
  const before = plane.position.clone(), steering = { ...neutral, turn: .5, steeringRevision: 2 };
  updatePlayerLoop(plane, control, steering, steering, false, dt, 110, 141, 1);
  assert.equal(plane.loopProgress, 0); assert.equal(plane.loopCooldown, 2); assert.ok(plane.position.distanceTo(before) < 3);
  for (let i = 0; i < 600; i++) advanceThrottle(control, { ...neutral, accelerate: true }, 'easy', dt);
  assert.equal(control.playerTargetSpeed, 110);
  for (let i = 0; i < 600; i++) advanceThrottle(control, { ...neutral, accelerate: true }, 'normal', dt);
  assert.equal(control.playerTargetSpeed, MAX_SPEED);
  for (let i = 0; i < 600; i++) advanceThrottle(control, { ...neutral, brake: true }, 'normal', dt);
  assert.equal(control.playerTargetSpeed, STALL_SPEED);
});

test('fixed camera keeps its FOV, follow offset, banking factor and projection in both modes', () => {
  const game = createBattle(3), unit = game.mission.units.find(unit => unit.id === game.mission.controlledAircraftId)!;
  const plane = createFlightAircraft(unit, 'A');
  plane.position.set(0, 500, 0); plane.yaw = 0; plane.pitch = 0; plane.bank = 0; plane.quaternion.identity();
  for (const mode of ['normal', 'easy'] as const) {
    const position = new Vector3(), rotation = new Quaternion();
    getFlightCameraPose(plane, mode, position, rotation);
    assert.deepEqual(position.toArray(), [0, 511, 29]);
    assert.equal(FLIGHT_FOV, 64); assert.equal(FLIGHT_CAMERA_BANK_FACTOR, .45);
    const target = position.clone().add(new Vector3(0, 0, -500).applyQuaternion(rotation));
    const projection = projectFlightTarget(plane, target, 16 / 9, mode);
    assert.ok(Math.abs(projection.x) < 1e-12 && Math.abs(projection.y) < 1e-12);
    assert.equal(projection.visible, true); assert.equal(projection.inCircle, true);
  }
});

test('flight handoff adapter preserves loops, attitude, HP and magazines without implicit simulation writes', () => {
  const game = createBattle(9), unit = game.mission.units.find(unit => unit.id === game.mission.controlledAircraftId)!;
  unit.hp = 23; unit.hpFixed = 23000; unit.ammo = 0; unit.cannonAmmo = 7; unit.bombs = 1;
  unit.reloadUntil = 360; unit.pitch = .4; unit.bank = -.3; unit.speed = 92; unit.loopProgress = .32; unit.loopCooldown = 1.2;
  const before = JSON.stringify(unit), adapter = createFlightAircraft(unit, 'A');
  assert.equal(JSON.stringify(unit), before);
  readFlightAircraft(adapter, unit, 'A');
  assert.equal(JSON.stringify(unit), before);
  assert.equal(adapter.loopProgress, .32); assert.equal(adapter.loopCooldown, 1.2);
  adapter.position.x += 2; adapter.pitch = .41;
  assert.equal(JSON.stringify(unit), before);
  writeFlightAircraft(unit, adapter);
  assert.equal(unit.pitch, .41); assert.equal(unit.hp, 23); assert.equal(unit.hpFixed, 23000);
  assert.equal(unit.ammo, 0); assert.equal(unit.cannonAmmo, 7); assert.equal(unit.bombs, 1); assert.equal(unit.reloadUntil, 360);
});

test('284 active units retain identity and logical state across every visual detail mode', () => {
  const game = createBattle(17), mission = game.mission;
  for (const team of ['A', 'B'] as const) for (const kind of ['infantry', 'tank', 'aa', 'aircraft'] as const) {
    const roster = mission.units.filter(unit => unit.team === team && unit.kind === kind);
    roster.forEach((unit, index) => { unit.state = index < CAP[kind] ? 'active' : 'reserve'; });
  }
  assert.equal(mission.units.filter(unit => unit.state === 'active').length, 284);
  const before = JSON.stringify(mission.units);
  for (const lod of ['normal', 'low', 'high'] as const) for (const camera of [{ x: -2800, y: 620, z: -720 }, { x: 4200, y: 2400, z: 2700 }]) {
    const selected = selectDetailedUnitIds(mission.units, mission.controlledAircraftId, camera, lod);
    assert.ok(selected.size <= 96);
    for (const unit of mission.units.filter(unit => unit.kind === 'aircraft' && unit.state === 'active')) assert.equal(selected.has(unit.id), true);
    assert.equal(JSON.stringify(mission.units), before);
  }
});

test('ground targeting uses the authoritative collider aim offsets, with no ledger mutation', () => {
  const game = createBattle(32), mission = game.mission;
  const before = JSON.stringify(mission.units);
  const targets = targetsForFlight(mission);
  for (const kind of ['infantry', 'tank', 'aa'] as const) {
    const target = targets.find(target => target.kind === kind)!;
    assert.ok(target);
    const unit = mission.units.find(unit => unit.id === target.id)!;
    assert.equal(targetAimPoint(target).y, unit.position.y + (kind === 'infantry' ? .9 : 1.2));
  }
  assert.equal(JSON.stringify(mission.units), before);
});

// Camera rollout contract: kaisen@67ac107 plus the approved total-angle pilot.
// These assertions use the actual before/after optical axis, without subtracting
// a neutral-leveling baseline. The fixed-source absolute-motion test stays above.
import { PerspectiveCamera } from 'three';
import { updateQuaternion } from '../src/flight';
import { FLIGHT_FAR } from '../src/flight-view';
import { projectGunSight } from '../src/gun-sight';
import type { Aircraft, FlightInput, GameMode } from '../src/types';

const cameraFixture=createBattle(42);
const cameraUnit=cameraFixture.mission.units.find(u=>u.id===cameraFixture.mission.controlledAircraftId)!;
function cameraPlane(pitch=0, bank=0, yaw=0, speed=110): Aircraft {
  const p=createFlightAircraft(cameraUnit,'A');p.position.set(0,2400,0);p.pitch=pitch;p.bank=bank;p.yaw=yaw;p.speed=speed;updateQuaternion(p);return p;
}
function cameraPose(p:Aircraft, mode:GameMode) {
  const position=new Vector3(), rotation=new Quaternion();getFlightCameraPose(p,mode,position,rotation);
  return {position,rotation,forward:new Vector3(0,0,-1).applyQuaternion(rotation).normalize()};
}
const opticalAngle=(a:Vector3,b:Vector3)=>Math.atan2(new Vector3().crossVectors(a,b).length(),a.dot(b));
const cameraAuthority=(s:number)=>(s<=85?.92+(s-65)/20*.23:s<=110?1.15-(s-85)/25*.15:1)*Math.max(.78,Math.min(1,1-Math.max(0,s-115)*.008));
function cameraStep(p:Aircraft,i:FlightInput,m:GameMode,response=1,control=createFlightController(p)) {
  updatePlayerLoop(p,control,i,i,false,dt,110,141,response,m);
}

test('manual total camera-forward angle matches all eight directions, modes, speeds and attitude branches',()=>{
  // A removed rate branch, wrong mode, bank-dependent view, or horizontal
  // leveling must each fail this matrix (5,184 cases).
  for(const mode of ['easy','normal'] as const)for(const speed of [65,85,110,141])for(const pitch of [-.9,0,.9])for(const bank of [-.72,0,.72])for(const yaw of [-3.14,0,3.14])for(let direction=0;direction<8;direction++)for(const strength of [.25,.45,.6]){
    const theta=direction*Math.PI/4,p=cameraPlane(pitch,bank,yaw,speed),before=cameraPose(p,mode).forward;
    cameraStep(p,{...neutral,turn:Math.cos(theta)*strength,climb:Math.sin(theta)*strength,steeringActive:true},mode);
    const measured=opticalAngle(before,cameraPose(p,mode).forward),expected=.82*cameraAuthority(speed)*dt*strength;
    assert.ok(Math.abs(measured-expected)<=1e-12,JSON.stringify({mode,speed,pitch,bank,yaw,direction,strength,measured,expected}));
  }
});

test('offscreen response changes horizontal rate only; keyboard diagonals and neutral recovery stay bounded',()=>{
  for(const mode of ['easy','normal'] as const)for(const speed of [65,85,110,141])for(const pitch of [-.9,0,.9])for(const sign of [-1,1]){
    const step=.82*cameraAuthority(speed)*dt;
    for(const axis of ['turn','climb'] as const){const p=cameraPlane(pitch,0,0,speed),before=cameraPose(p,mode).forward;cameraStep(p,{...neutral,[axis]:sign*.45,steeringActive:true},mode,1.65);assert.ok(Math.abs(opticalAngle(before,cameraPose(p,mode).forward)-step*.45*(axis==='turn'?1.65:1))<1e-12);}
    const diagonal=cameraPlane(pitch,0,0,speed),before=cameraPose(diagonal,mode).forward;cameraStep(diagonal,{...neutral,turn:sign,climb:sign,steeringActive:true},mode);assert.ok(Math.abs(opticalAngle(before,cameraPose(diagonal,mode).forward)-step)<1e-12);
    const p=cameraPlane(pitch,0,0,speed);cameraStep(p,{...neutral,turn:sign*.6,steeringActive:true},mode);assert.equal(p.pitch,pitch);
    const neutralStep=.82*cameraAuthority(p.speed)*dt;cameraStep(p,{...neutral,steeringActive:true},mode);assert.ok(Math.abs(p.pitch-pitch)<=neutralStep+1e-12);
  }
  for(const sign of [-1,1]){const p=cameraPlane(sign*.95);cameraStep(p,{...neutral,climb:sign,steeringActive:true},'normal');assert.equal(p.pitch,sign*.95);cameraStep(p,{...neutral,climb:-sign,steeringActive:true},'normal');assert.ok(Math.abs(p.pitch)<.95);}
});

test('bank is optical-axis roll; legacy offset, real projection and 500m bore sight agree',()=>{
  for(const mode of ['easy','normal'] as const)for(const pitch of [-Math.PI*2,-Math.PI,-Math.PI/2,-.9,0,.9,Math.PI/2,Math.PI,Math.PI*2])for(const yaw of [-3.14,0,3.14])for(const bank of [-.72,0,.72]){
    const p=cameraPlane(pitch,bank,yaw),pose=cameraPose(p,mode),unbanked=cameraPose(cameraPlane(pitch,0,yaw),mode);
    const expected=new Vector3(0,11,29).applyQuaternion(p.quaternion.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),bank*.55))).add(p.position);
    assert.equal(pose.position.distanceTo(expected),0);assert.ok(opticalAngle(pose.forward,unbanked.forward)<1e-12);
    // A renderer can interpolate quaternion independently of current scalar Euler.
    p.quaternion.slerp(new Quaternion().setFromEuler(new Euler(.25,-.8,.2,'YXZ')),.37);
    const interpolated=cameraPose(p,mode);
    for(const [width,height]of [[393,852],[393,648],[568,320],[852,393],[1280,720]]){
      const c=new PerspectiveCamera(FLIGHT_FOV,width/height,.1,FLIGHT_FAR);c.position.copy(interpolated.position);c.quaternion.copy(interpolated.rotation);c.updateMatrixWorld(true);
      const point=new Vector3(0,0,-504.5).applyQuaternion(p.quaternion).add(p.position),a=point.clone().project(c),b=projectFlightTarget(p,point,width/height,mode);
      assert.ok(Math.abs(a.x-b.x)<1e-12&&Math.abs(a.y-b.y)<1e-12);
      if(mode==='normal'){const sight=projectGunSight(p,[],width,height);assert.ok(Math.abs(sight.x-(.5+.5*a.x)*width)<1e-9&&Math.abs(sight.y-(.5-.5*a.y)*height)<1e-9);}
    }
    const expectedRotation=p.quaternion.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),bank)).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),mode==='easy'?-Math.atan2(11,479):-.19)).multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-bank*.45));
    assert.ok(1-Math.abs(interpolated.rotation.dot(expectedRotation))<1e-12);
  }
});

test('loop cancellation obeys independent pre-step bounds across bank, speed and response',()=>{
  const stepDt=1/60, tolerance=1e-12;
  const wrapped=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle));
  let cases=0,maxQuaternionStep=0,maxForwardStep=0,maxRetainedRollStep=0,maxPoseError=0;
  for(const mode of ['easy','normal'] as const)
  for(const startPitch of [-.95,0,.95])for(const startBank of [-.72,0,.72])
  for(const startSpeed of [65,85,110,141])for(const response of [1,1.65])
  for(const ticks of [1,25,50,75,90,100,125,150,175,200,225,250,275,299])
  for(const turn of [-1,0,1])for(const climb of [-1,0,1]){
    const p=cameraPlane(startPitch,startBank,0,startSpeed),control=createFlightController(p);
    const zero={...neutral,steeringRevision:1};
    for(let i=0;i<ticks;i++)updatePlayerLoop(p,control,zero,zero,i===0,stepDt,110,141,response,mode);
    const before={...cameraPose(p,mode),pitch:p.pitch,yaw:p.yaw,bank:p.bank,speed:p.speed};

    // Derive every allowance BEFORE cancellation. Circular input has length <= 1,
    // so its requested angular distance is <= angularStep * max(1,response).
    // In the finite-yaw branch both pitch endpoints lie within +/-0.95, giving
    // cos(pitch+look) >= cos(0.95+abs(look)). Dropping the nonnegative pitch term
    // in sin(total/2)^2 - sin(pitchDelta/2)^2 gives a conservative yaw bound.
    // The fallback yaw rate is smaller; bank's target is always within +/-0.72.
    const angularStep=.82*cameraAuthority(before.speed)*stepDt;
    const look=mode==='easy'?-Math.atan2(11,479):-.19;
    const yawBound=turn===0?0:2*Math.asin(Math.min(1,
      Math.sin(angularStep*Math.max(1,response)/2)/Math.cos(.95+Math.abs(look))));
    const bankBound=(Math.abs(before.bank)+.72)*(1-Math.exp(-5.5*stepDt));
    // Rotations compose as yaw * (pitch+look) * retained optical roll. The
    // geodesic triangle inequality bounds their total independently of deltas.
    const quaternionBound=angularStep+yawBound+.45*bankBound;
    assert.ok(quaternionBound<Math.PI/2,'a branch jump cannot enlarge its own allowance');

    const input={...neutral,turn,climb,steeringActive:true,steeringRevision:2};
    cameraStep(p,input,mode,response,control);
    const after=cameraPose(p,mode);
    const relative=before.rotation.clone().invert().multiply(after.rotation);
    const quaternionStep=2*Math.atan2(Math.hypot(relative.x,relative.y,relative.z),Math.abs(relative.w));
    const pitchStep=Math.abs(wrapped(p.pitch-before.pitch));
    const yawStep=Math.abs(wrapped(p.yaw-before.yaw));
    const bankStep=Math.abs(wrapped(p.bank-before.bank));
    const forwardStep=opticalAngle(before.forward,after.forward);
    const context=JSON.stringify({mode,startPitch,startBank,startSpeed,response,ticks,turn,climb,
      pitchStep,yawStep,bankStep,quaternionStep,angularStep,yawBound,bankBound,quaternionBound});
    assert.equal(p.loopProgress,0);assert.equal(p.loopCooldown,2);
    assert.ok(pitchStep<=angularStep+tolerance,`pitch: ${context}`);
    assert.ok(yawStep<=yawBound+tolerance,`yaw: ${context}`);
    assert.ok(bankStep<=bankBound+tolerance,`bank: ${context}`);
    assert.ok(quaternionStep<=quaternionBound+tolerance,`camera quaternion: ${context}`);
    assert.ok(forwardStep<=angularStep+yawBound+tolerance,`camera forward: ${context}`);

    // Independently reconstruct the optical pose; bounded Euler changes alone
    // must not hide an erroneous camera composition or a canonical branch flip.
    const expected=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),p.yaw)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),p.pitch+look))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-.45*p.bank));
    const actualComponents=after.rotation.toArray(),expectedComponents=expected.toArray();
    const poseError=Math.min(...[1,-1].map(sign=>Math.max(...actualComponents.map(
      (value,index)=>Math.abs(value-sign*expectedComponents[index])))));
    assert.ok(poseError<=tolerance,`independent camera pose: ${context}`);
    cases++;maxQuaternionStep=Math.max(maxQuaternionStep,quaternionStep);
    maxForwardStep=Math.max(maxForwardStep,forwardStep);maxRetainedRollStep=Math.max(maxRetainedRollStep,.45*bankStep);
    maxPoseError=Math.max(maxPoseError,poseError);
  }
  assert.equal(cases,18144);
  console.log(JSON.stringify({contract:'loop-cancel-pre-step-bounds',cases,maxQuaternionStep,maxForwardStep,maxRetainedRollStep,maxPoseError}));
});

import { stepBattle } from '../src/battle/simulation';
test('Normal live battle fire changes only combat output, not twelve ticks of manual camera or flight',()=>{
  for(const turn of [-.6,0,.6])for(const climb of [-.6,0,.6]){
    const a=createBattle(77,'normal'),b=createBattle(77,'normal');
    for(const game of [a,b]){const unit=game.mission.units.find(u=>u.id===game.mission.controlledAircraftId)!;unit.position={x:0,y:2000,z:0};unit.pitch=.3;unit.bank=.2;unit.heading=.8;}
    for(let tick=0;tick<12;tick++){
      stepBattle(a,{...neutral,turn,climb,steeringActive:true});stepBattle(b,{...neutral,turn,climb,fire:true,steeringActive:true});
      assert.ok(a.pilot&&b.pilot);const fields=(p:Aircraft)=>[...p.position.toArray(),...p.quaternion.toArray(),p.speed,...cameraPose(p,'normal').forward.toArray()];assert.deepEqual(fields(a.pilot),fields(b.pilot));
    }
    assert.notEqual(a.combat.nextShotId,b.combat.nextShotId);
  }
});
