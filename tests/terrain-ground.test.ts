import test from 'node:test';
import assert from 'node:assert/strict';
import { createMission } from '../src/battle/mission';
import { updateRoster, assertRoster } from '../src/battle/roster';
import { updateCapture } from '../src/battle/capture';
import { CONNECTIONS } from '../src/battle/rules';
import {
  BATTLEFIELD, CAPTURE_TERRAIN, UNIT_RADIUS, airSpawnCandidates, airSpawnSafe, applyFlightBounds,
  groundSpawnSafe, initializeRosterPositions, resolveBattleSpawn, sweepTerrain, terrainHeight,
  terrainLineOfSight, walkableSurface,
} from '../src/battle/terrain';
import {
  createRecoveryState, createTrafficState, enterCorridor, findGroundPath, formationOffset,
  leaveCorridor, requestCorridor, updateRecovery, updateTraffic, validateGroundRoutes,
} from '../src/battle/ground-nav';
import { createGroundAI, selectGroundTarget, updateGroundAI, updateGroundStrategy } from '../src/battle/ground-ai';
import type { Mission, Unit, Vec3 } from '../src/battle/types';

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function battlefield(seed = 1): Mission { const m = createMission(seed); initializeRosterPositions(m); return m; }
function pending(m: Mission, kind: Unit['kind'] = 'infantry'): Unit {
  const unit = m.units.find(u => u.team === 'A' && u.kind === kind && u.state === 'reserve')!;
  unit.state = 'pending'; unit.reservation = { missionId: m.id, unitId: unit.id, slot: unit.id, sourcePoint: 'P1', deadline: m.tick, blockedSince: null, player: false };
  return unit;
}

test('exact seven-point graph has two independently passable vehicle routes per connection', () => {
  const validation = validateGroundRoutes();
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.deepEqual(BATTLEFIELD.points.map(p => [p.id, p.position.x, p.position.z]), [
    ['HA', -2400, 0], ['P1', -1400, 0], ['P2', 0, -900], ['P3', 0, 0], ['P4', 0, 900], ['P5', 1400, 0], ['HB', 2400, 0],
  ]);
  for (const [from, to] of CONNECTIONS) {
    const routes = BATTLEFIELD.roads.filter(r => r.from === from && r.to === to);
    assert.equal(routes.length, 2); assert.notEqual(routes[0].bridgeId || routes[0].id, routes[1].bridgeId || routes[1].id);
  }
  const straight = validation.routeLengths['P1-P3:0'] + validation.routeLengths['P3-P5:0'] + validation.routeLengths['P5-HB:0'];
  const side = validation.routeLengths['P1-P2:1'] + validation.routeLengths['P2-P5:1'] + validation.routeLengths['P5-HB:1'];
  assert.equal(straight, 3800); assert.equal(straight / 5, 760);
  assert.ok(side / 5 + 105 + 60 < 1200, `side route travel + capture + initial advance = ${side / 5 + 165}`);
  const narrowed = BATTLEFIELD.roads.map(r => ({ ...r, width: r.from === 'HA' ? 10 : r.width }));
  assert.equal(validateGroundRoutes(narrowed).valid, false);
});

test('terrain sweep hits closed walls, bridge bottoms and sides in both directions', () => {
  const building = BATTLEFIELD.buildings[0];
  const a = { ...building.center, x: building.center.x - 100 }, b = { ...building.center, x: building.center.x + 100 };
  const east = sweepTerrain(a, b)!, west = sweepTerrain(b, a)!;
  assert.equal(east.colliderId, building.id); assert.equal(west.colliderId, building.id);
  assert.equal(east.normal.x, -1); assert.equal(west.normal.x, 1);
  assert.equal(terrainLineOfSight(a, b), false);
  const face = { ...building.center, x: building.center.x - building.size.x / 2 };
  assert.equal(sweepTerrain(face, building.center, 0, { ignoreInitialContact: true })?.t, 0, 'an inward wall contact is not ignored');
  assert.equal(sweepTerrain(face, a, 0, { ignoreInitialContact: true }), null, 'an outward face contact is ignored');
  const bridge = BATTLEFIELD.bridges.find(b => b.yaw === 0)!;
  const top = sweepTerrain({ ...bridge.center, y: 40 }, { ...bridge.center, y: -3 })!;
  const bottom = sweepTerrain({ ...bridge.center, y: 2 }, { ...bridge.center, y: 20 })!;
  const side = sweepTerrain({ ...bridge.center, y: 11, z: bridge.center.z - 30 }, { ...bridge.center, y: 11, z: bridge.center.z + 30 })!;
  assert.equal(top.colliderId, bridge.id); assert.equal(top.normal.y, 1);
  assert.equal(bottom.colliderId, bridge.id); assert.equal(bottom.normal.y, -1);
  assert.equal(side.colliderId, bridge.id); assert.equal(side.normal.z, -1);
  assert.ok(Math.abs(top.position.y - bridge.center.y) < 1e-6);
});

test('deep river remains impassable while real decks provide a walkable surface', () => {
  assert.equal(terrainHeight(620, 1500), -8);
  for (const kind of ['infantry', 'tank', 'aa'] as const) assert.equal(walkableSurface(620, 1500, kind).walkable, false);
  const bridge = BATTLEFIELD.bridges.find(b => b.yaw === 0)!;
  assert.equal(terrainHeight(bridge.center.x, bridge.center.z), -8);
  for (const kind of ['infantry', 'tank', 'aa'] as const) {
    const surface = walkableSurface(bridge.center.x, bridge.center.z, kind);
    assert.equal(surface.walkable, true); assert.equal(surface.height, 12); assert.equal(surface.waterDepth, 0);
  }
});

test('initial columns obey their formation counts, spacing, surfaces and air safety', () => {
  const m = battlefield();
  const ground = m.units.filter(u => u.state === 'active' && u.kind !== 'aircraft');
  for (const unit of ground) {
    const rearDistance = Math.abs(unit.position.x) - 1400;
    assert.ok(rearDistance >= 100 && rearDistance <= 300);
    assert.equal(groundSpawnSafe(unit.position, unit, m), true, unit.id);
    assert.equal(unit.position.y, CAPTURE_TERRAIN.heightAt(unit.position.x, unit.position.z));
  }
  for (let i = 0; i < ground.length; i++) for (let j = i + 1; j < ground.length; j++) {
    assert.ok(distance(ground[i].position, ground[j].position) > UNIT_RADIUS[ground[i].kind] + UNIT_RADIUS[ground[j].kind]);
  }
  for (const unit of m.units.filter(u => u.kind === 'aircraft' && u.state === 'active')) {
    assert.equal(airSpawnSafe(unit.position, unit, m), true);
    assert.equal(unit.heading, unit.team === 'A' ? -Math.PI / 2 : Math.PI / 2);
    assert.equal(unit.velocity.x, unit.team === 'A' ? 110 : -110);
  }
});

test('new front requires 600 stable ticks and loss/contest changes apply to the next spawn snapshot', () => {
  const m = battlefield(), unit = pending(m), front = m.points.find(p => p.id === 'P3')!;
  m.tick = 1000; front.owner = 'A'; front.stableSince = 401;
  assert.ok(resolveBattleSpawn(unit, 'P3', m)); assert.equal(unit.reservation!.sourcePoint, 'P1');
  m.tick = 1001;
  const spawned = resolveBattleSpawn(unit, 'P3', m)!;
  assert.equal(unit.reservation!.sourcePoint, 'P3'); assert.ok(spawned.x > -300);
  front.contested = true;
  assert.ok(resolveBattleSpawn(unit, 'P3', m)); assert.equal(unit.reservation!.sourcePoint, 'P1');
  assert.equal(unit.state, 'pending'); assert.equal(unit.hp, 40);
});

test('all ground mouths and all four air corridors may be blocked without creating a unit', () => {
  const m = battlefield(), ground = pending(m), air = pending(m, 'aircraft');
  const tanks = m.units.filter(u => u.team === 'B' && u.kind === 'tank' && u.state === 'active');
  tanks[0].position = { x: -1600, y: 12, z: 0 }; tanks[1].position = { x: -2600, y: 12, z: 0 };
  const aa = m.units.find(u => u.team === 'B' && u.kind === 'aa' && u.state === 'active')!;
  aa.position = { x: -2900, y: 12, z: 0 };
  assert.equal(resolveBattleSpawn(ground, 'P1', m), null);
  assert.equal(airSpawnCandidates('A').length, 4); assert.equal(resolveBattleSpawn(air, 'HA', m), null);
  assert.equal(ground.state, 'pending'); assert.equal(air.state, 'pending');
  tanks[0].state = tanks[1].state = aa.state = 'lost';
  assert.ok(resolveBattleSpawn(ground, 'P1', m)); assert.ok(resolveBattleSpawn(air, 'HA', m));
  assert.equal(air.speed, 110); assert.equal(air.heading, -Math.PI / 2);
});

test('a full reinforcement wave creates only whole, nonoverlapping six-person squads', () => {
  const m = battlefield(); m.tick = 1200; updateRoster(m, resolveBattleSpawn);
  assert.equal(m.units.filter(u => u.team === 'A' && u.kind === 'infantry' && u.state === 'pending').length, 18);
  m.tick = 1260; updateRoster(m, resolveBattleSpawn); assertRoster(m);
  const added = m.units.filter(u => u.team === 'A' && u.kind === 'infantry' && u.state === 'active' && Number(u.id.split('-').at(-1)) >= 72);
  assert.equal(added.length, 18);
  for (let i = 0; i < added.length; i++) for (let j = i + 1; j < added.length; j++) assert.ok(distance(added[i].position, added[j].position) > 0.9);
});

test('bridge queues preserve entered precedence, alternate directions, and remove a wreck within three seconds', () => {
  const traffic = createTrafficState(), bridge = BATTLEFIELD.bridges[0], m = battlefield();
  const a = m.units.find(u => u.id === 'A-tank-000')!, b = m.units.find(u => u.id === 'B-tank-000')!;
  assert.equal(requestCorridor(traffic, bridge.id, a.id, 1, 0), true); enterCorridor(traffic, bridge.id, a.id);
  assert.equal(requestCorridor(traffic, bridge.id, b.id, -1, 1), false);
  leaveCorridor(traffic, bridge.id, a.id);
  assert.equal(requestCorridor(traffic, bridge.id, b.id, -1, 2), true);
  enterCorridor(traffic, bridge.id, b.id); b.state = 'lost';
  updateTraffic(traffic, m.units, 3); updateTraffic(traffic, m.units, 182);
  assert.ok(traffic.corridors[bridge.id].occupants[b.id]);
  updateTraffic(traffic, m.units, 183); assert.equal(traffic.corridors[bridge.id].occupants[b.id], undefined);
});

test('stuck recovery backs up, reroutes, then bans the blocked route for thirty seconds; combat wait does not count', () => {
  const position = { x: -1000, y: 12, z: 0 }, state = createRecoveryState(position, 0);
  updateRecovery(state, position, 299, true, 'P1-P3:0'); assert.equal(state.mode, 'moving');
  updateRecovery(state, position, 300, true, 'P1-P3:0'); assert.equal(state.mode, 'reversing');
  updateRecovery(state, position, 420, true, 'P1-P3:0'); assert.equal(state.mode, 'reroute');
  updateRecovery(state, position, 1200, true, 'P1-P3:0'); assert.equal(state.bannedUntil['P1-P3:0'], 3000);
  updateRecovery(state, position, 1300, false); assert.equal(state.stuckSince, null); assert.equal(state.reason, '');
});

test('retreating or leaving sideways clears a bridge reservation, and an abandoned request expires', () => {
  const m = battlefield(), traffic = createTrafficState(), bridge = BATTLEFIELD.bridges[0];
  const a = m.units.find(u => u.id === 'A-infantry-000')!, b = m.units.find(u => u.id === 'B-infantry-000')!;
  a.position = { ...bridge.center };
  assert.equal(requestCorridor(traffic, bridge.id, a.id, 1, 0), true);
  updateTraffic(traffic, m.units, 1);
  assert.equal(traffic.corridors[bridge.id].occupants[a.id].entered, true);
  assert.equal(requestCorridor(traffic, bridge.id, b.id, -1, 2), false);
  a.position.x -= Math.cos(bridge.yaw) * (bridge.length / 2 + 20);
  a.position.z -= Math.sin(bridge.yaw) * (bridge.length / 2 + 20);
  updateTraffic(traffic, m.units, 3);
  assert.equal(traffic.corridors[bridge.id].occupants[a.id], undefined);
  assert.equal(requestCorridor(traffic, bridge.id, b.id, -1, 4), true);
  b.position = { ...bridge.center };
  updateTraffic(traffic, m.units, 5);
  b.position.x -= Math.sin(bridge.yaw) * 40; b.position.z += Math.cos(bridge.yaw) * 40;
  updateTraffic(traffic, m.units, 6);
  assert.equal(traffic.corridors[bridge.id].occupants[b.id], undefined);
  a.position = { ...bridge.center };
  requestCorridor(traffic, bridge.id, a.id, 1, 7);
  requestCorridor(traffic, bridge.id, b.id, -1, 8);
  updateTraffic(traffic, m.units, 188);
  assert.equal(traffic.corridors[bridge.id].queue.some(r => r.unitId === b.id), false);
});

test('a queued turn-around updates direction and a unit beside the bridge never becomes an entered occupant', () => {
  const m = battlefield(), traffic = createTrafficState(), bridge = BATTLEFIELD.bridges[0];
  const a = m.units.find(u => u.id === 'A-infantry-000')!, b = m.units.find(u => u.id === 'B-infantry-000')!;
  requestCorridor(traffic, bridge.id, a.id, 1, 0);
  assert.equal(requestCorridor(traffic, bridge.id, b.id, -1, 1), false);
  assert.equal(requestCorridor(traffic, bridge.id, b.id, 1, 2), true);
  a.position = { ...bridge.center, x: bridge.center.x - Math.sin(bridge.yaw) * 100,
    z: bridge.center.z + Math.cos(bridge.yaw) * 100 };
  updateTraffic(traffic, m.units, 3);
  assert.equal(traffic.corridors[bridge.id].occupants[a.id].entered, false);
});

test('a tank aligns with a narrow bridge before advancing its projected waypoint', () => {
  const m = battlefield(), state = createGroundAI(m), tank = m.units.find(u => u.id === 'A-tank-001')!;
  for (const u of m.units) {
    const escort = u.team === 'A' && u.kind === 'infantry' && Number(u.id.split('-').at(-1)) < 18;
    if (u !== tank && !escort) { u.state = 'lost'; u.hp = u.hpFixed = 0; }
    if (escort && Number(u.id.split('-').at(-1)) >= 12) u.position = { x: -400 + Number(u.id.split('-').at(-1)) * 3, y: 12, z: 150 };
  }
  tank.position = { x: -656.141, y: 12, z: 142 };
  const path = { targetPointId: 'P3', distance: 700,
    waypoints: [{ ...tank.position }, { x: tank.position.x, y: 12, z: 150 }, { x: -535, y: 12, z: 150 }, { x: 0, y: 12, z: 0 }],
    routes: [{ routeId: 'P1-P3:1', startIndex: 0, endIndex: 3 }] };
  state.units[tank.id] = { waypointIndex: 1, path, pathVersion: 0, targetPointId: 'P3', recovery: createRecoveryState(tank.position, 0),
    contact: null, combatStopSince: null, lastPlanTick: 0, escortSquadId: null, assignedTick: 0 };
  m.tick = 1; updateGroundAI(m, state);
  assert.equal(state.units[tank.id].waypointIndex, 1);
  let furthestX = tank.position.x;
  for (m.tick = 2; m.tick <= 900; m.tick++) {
    updateGroundAI(m, state); furthestX = Math.max(furthestX, tank.position.x);
    assert.equal(walkableSurface(tank.position.x, tank.position.z, 'tank').walkable, true);
  }
  assert.ok(furthestX > -650, `tank stayed at the bank: ${JSON.stringify({position:tank.position, heading:tank.heading, ai:state.units[tank.id]})}`);
});

test('rerouting from a bridge retraces a legal road instead of cutting through deep water', () => {
  const bridge = BATTLEFIELD.bridges.find(b => b.id === 'bridge-P1-P2:1')!;
  const path = findGroundPath('tank', bridge.center, 'HA', { seed: 4, unitId: 'A-tank-000' })!;
  assert.ok(path); assert.ok(path.waypoints.length >= 3);
  for (let i = 1; i < path.waypoints.length; i++) {
    const a = path.waypoints[i - 1], b = path.waypoints[i], samples = Math.ceil(distance(a, b) / 3);
    for (let sample = 0; sample <= samples; sample++) {
      const f = sample / samples;
      assert.equal(walkableSurface(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, 'tank').walkable, true);
    }
  }
});

test('strategy gives two rear squads home defence, keeps valid assignments, and recaptures a neutral disconnected home', () => {
  const m = battlefield(), state = createGroundAI(m); updateGroundStrategy(m, state);
  assert.equal(state.squads['A-squad-10'].role, 'defend'); assert.equal(state.squads['A-squad-11'].role, 'defend');
  const previous = state.squads['A-squad-0'].targetPointId;
  m.tick = 60; updateGroundStrategy(m, state); assert.equal(state.squads['A-squad-0'].targetPointId, previous);
  m.points.find(p => p.id === 'HA')!.owner = 'N'; m.points.find(p => p.id === 'P1')!.owner = 'B';
  m.tick = 61; updateGroundStrategy(m, state);
  assert.ok(Object.values(state.squads).filter(s => s.team === 'A').every(s => s.targetPointId === 'HA'));
  const survivor = m.units.find(u => u.id === 'A-infantry-001')!, originalSlot = formationOffset(survivor);
  m.units.find(u => u.id === 'A-infantry-000')!.state = 'lost';
  m.tick = 120; updateGroundStrategy(m, state); assert.deepEqual(formationOffset(survivor), originalSlot);
  assert.equal(state.squads['A-squad-0'].members.length, 5);
});

test('invisible and nonactive individual positions never become ground firing targets; memory lasts three seconds', () => {
  const m = battlefield(), state = createGroundAI(m); m.tick = 1; updateGroundAI(m, state);
  const soldier = m.units.find(u => u.id === 'A-infantry-000')!, enemy = m.units.find(u => u.id === 'B-infantry-000')!;
  soldier.position = { x: -2000, y: 12, z: 0 }; enemy.position = { x: -1900, y: 12, z: 0 };
  const ai = state.units[soldier.id];
  assert.equal(selectGroundTarget(m, soldier, ai)?.id, enemy.id);
  const remembered = { ...ai.contact!.position };
  enemy.position = { x: 1000, y: 12, z: 0 }; m.tick = 180;
  assert.equal(selectGroundTarget(m, soldier, ai), null); assert.equal(soldier.targetId, undefined);
  assert.deepEqual(ai.contact!.position, remembered);
  m.tick = 182; selectGroundTarget(m, soldier, ai); assert.equal(ai.contact, null);
  enemy.position = { x: -1900, y: 12, z: 0 }; enemy.state = 'pending';
  assert.equal(selectGroundTarget(m, soldier, ai), null);
});

test('thirty-second renewal retains balanced nearby fronts and new squads fill the least-loaded front', () => {
  const m = battlefield(), state = createGroundAI(m); updateGroundStrategy(m, state);
  const advancing = Object.values(state.squads).filter(s => s.team === 'A' && s.role !== 'defend');
  const previous = new Map(advancing.map(s => [s.id, { target: s.targetPointId, pathVersion: s.pathVersion }]));
  const rows = new Map<string, number>();
  for (const squad of advancing) {
    const p = m.points.find(p => p.id === squad.targetPointId)!, row = rows.get(p.id) ?? 0;
    rows.set(p.id, row + 1);
    squad.members.forEach((id, i) => {
      m.units.find(u => u.id === id)!.position = { x: p.position.x - 80 - row * 2, y: 12, z: p.position.z + (i - 2.5) * 2 };
    });
  }
  m.tick = 1800; updateGroundStrategy(m, state);
  for (const squad of advancing) {
    assert.equal(squad.targetPointId, previous.get(squad.id)!.target, squad.id);
    assert.equal(squad.pathVersion, previous.get(squad.id)!.pathVersion, squad.id);
    assert.equal(squad.assignedTick, 1800);
  }
  for (const unit of m.units.filter(u => u.team === 'A' && u.kind === 'infantry' && Number(u.id.split('-').at(-1)) >= 72 && Number(u.id.split('-').at(-1)) < 90)) {
    unit.state = 'active'; unit.position = { x: -1500, y: 12, z: Number(unit.id.split('-').at(-1)) * 2 - 162 };
  }
  m.tick = 1860; updateGroundStrategy(m, state);
  const counts = ['P2', 'P3', 'P4'].map(id => Object.values(state.squads).filter(s => s.team === 'A' && s.targetPointId === id).length);
  assert.equal(counts.reduce((a, b) => a + b, 0), 13);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, JSON.stringify(counts));
});

test('ground movement and strategic assignments are mirrors for corresponding individual IDs', () => {
  const m = battlefield(73), state = createGroundAI(m);
  for (let tick = 1; tick <= 600; tick++) { m.tick = tick; updateGroundAI(m, state); }
  for (const a of m.units.filter(u => u.team === 'A' && u.kind !== 'aircraft' && u.state === 'active')) {
    const b = m.units.find(u => u.id === a.id.replace(/^A-/, 'B-'))!;
    assert.ok(Math.abs(a.position.x + b.position.x) < 1e-6, `${a.id} x: ${a.position.x} / ${b.position.x}`);
    assert.ok(Math.abs(a.position.z - b.position.z) < 1e-6, `${a.id} z: ${a.position.z} / ${b.position.z}`);
  }
});

test('a surviving assault squad traverses the physical supply graph and captures the enemy home before the time limit', () => {
  const m = battlefield(4), state = createGroundAI(m);
  // Isolated navigation/capture fixture: eighteen surviving A soldiers, no combat
  // or reinforcement. Two squads still defend home; the third must do the journey.
  for (const unit of m.units) if (unit.team !== 'A' || unit.kind !== 'infantry' || Number(unit.id.split('-').at(-1)) >= 18) {
    unit.state = 'lost'; unit.hp = 0; unit.hpFixed = 0;
  }
  const ownedAt: Record<string, number> = {};
  for (let tick = 1; tick <= 72000; tick++) {
    m.tick = tick; updateGroundAI(m, state);
    m.points = updateCapture(m.points, m.units, tick, CAPTURE_TERRAIN);
    for (const p of m.points) if (p.owner === 'A' && ownedAt[p.id] === undefined) ownedAt[p.id] = tick;
    if (ownedAt.HB) break;
  }
  assert.ok(ownedAt.HB && ownedAt.HB < 72000, `final points ${JSON.stringify(m.points.map(p => [p.id, p.owner, p.progress]))}`);
  assert.ok(ownedAt.P5 < ownedAt.HB);
  assert.ok(['P2', 'P3', 'P4'].some(id => ownedAt[id] && ownedAt[id] < ownedAt.P5));
  assert.equal(Object.values(state.squads).filter(s => s.role === 'defend').length, 2);
});

test('aircraft boundaries retain inward velocity and remove only outward components', () => {
  const position = { x: 4510, y: 2510, z: -3010 }, velocity = { x: 100, y: 10, z: 60 };
  const warning = applyFlightBounds(position, velocity);
  assert.deepEqual(position, { x: 4500, y: 2500, z: -3000 });
  assert.deepEqual(velocity, { x: 0, y: 0, z: 60 }); assert.equal(warning.length, 3);
});
