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
