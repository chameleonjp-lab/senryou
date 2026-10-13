import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Group, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { BattleView, PENDING_VIEW_EVENT_CAPACITY } from '../src/battle-view';
import { createBattle, stepBattle } from '../src/battle/simulation';
import { clearUnusedCombatCaches, RUNTIME_CLEANUP_TICKS } from '../src/battle/runtime-maintenance';
import { applyDamage, markLost, scoreSnapshot } from '../src/battle/scoring';
import { updateAirAI } from '../src/battle/air-ai';
import { updateAA } from '../src/battle/combat';
import type { CombatEvent } from '../src/battle/weapons';

test('periodic cleanup removes lost-unit caches and preserves live clocks, scoring and duplicate-hit protection', () => {
  const game = createBattle(12, 'normal', 'A', true), m = game.mission, c = game.combat;
  updateAirAI(m, c.air); updateAA(m, c);
  const dead = m.units.find(unit => c.air.units.has(unit.id))!;
  const live = m.units.find(unit => c.air.units.has(unit.id) && unit.id !== dead.id)!;
  const liveMemory = c.air.units.get(live.id)!;
  c.turrets.set(dead.id, { x: 0, y: 1, z: 0 }); c.turrets.set(live.id, { x: 1, y: 0, z: 0 });
  c.previousPositions.set(dead.id, { ...dead.position }); c.previousPositions.set(live.id, { ...live.position });
  const target = m.units.find(unit => unit.team === 'B' && unit.kind === 'tank' && unit.state === 'active')!;
  const hit = { id: 'cleanup-hit', sourceTeam: 'A' as const, sourceRole: 'player' as const };
  assert.equal(applyDamage(m, target.id, 4, hit), 4);
  markLost(m, dead.id);
  const before = JSON.stringify({ units: m.units, score: scoreSnapshot(m), damage: m.score.damage });
  const ledger = m.score.damageIds;
  clearUnusedCombatCaches(m, c);
  assert.equal(c.air.units.has(dead.id), false);
  assert.equal(c.turrets.has(dead.id), false);
  assert.equal(c.previousPositions.has(dead.id), false);
  assert.equal(c.air.units.get(live.id), liveMemory);
  assert.equal(c.turrets.has(live.id), true);
  assert.equal(c.previousPositions.has(live.id), true);
  assert.equal(JSON.stringify({ units: m.units, score: scoreSnapshot(m), damage: m.score.damage }), before);
  assert.equal(m.score.damageIds, ledger);
  assert.equal(applyDamage(m, target.id, 4, hit), 0);
});

test('the simulation runs cleanup at thirty seconds, freezes it when paused, and starts a fresh cache on replay', () => {
  const game = createBattle(13, 'normal', 'A', true), m = game.mission;
  const dead = m.units.find(unit => unit.kind === 'tank' && unit.state === 'active')!;
  markLost(m, dead.id);
  game.combat.turrets.set(dead.id, { x: 1, y: 0, z: 0 });
  m.tick = RUNTIME_CLEANUP_TICKS - 2;
  stepBattle(game);
  assert.equal(game.combat.turrets.has(dead.id), true);
  m.phase = 'paused'; stepBattle(game);
  assert.equal(m.tick, RUNTIME_CLEANUP_TICKS - 1);
  assert.equal(game.combat.turrets.has(dead.id), true);
  m.phase = 'running'; stepBattle(game);
  assert.equal(game.combat.turrets.has(dead.id), false);
  const replay = createBattle(13, 'normal');
  assert.equal(replay.mission.tick, 0);
  assert.equal(replay.combat.turrets.size, 0);
  assert.notEqual(replay.combat, game.combat);
});

test('view cleanup releases only long-unused roots and render references, retaining shared live geometry', () => {
  const view = Object.create(BattleView.prototype) as any;
  let releases = 0, geometryDisposals = 0, materialDisposals = 0;
  const scene = new Group(), geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  geometry.addEventListener('dispose', () => geometryDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  const slot = (id: string | null, lastUsedTick: number) => {
    const root = new Group(); root.add(new Mesh(geometry, material)); scene.add(root);
    return { id, lastUsedTick, root, key: 'tank:A' };
  };
  const old = slot(null, 0), recent = slot(null, RUNTIME_CLEANUP_TICKS - 1), live = slot('A-tank', 0);
  view.detailSlots = [old, recent, live];
  view.renderer = { renderLists: { dispose: () => releases++ } }; view.cacheCleanups = 0;
  view.clearUnusedCaches(RUNTIME_CLEANUP_TICKS);
  assert.deepEqual(view.detailSlots, [recent, live]);
  assert.equal(old.root.parent, null);
  assert.equal(live.root.parent, scene);
  assert.equal(releases, 1);
  assert.equal(geometryDisposals, 0); assert.equal(materialDisposals, 0);
  view.clearUnusedCaches(2 * RUNTIME_CLEANUP_TICKS);
  assert.deepEqual(view.detailSlots, [live]);
  assert.equal(view.cacheCleanups, 2);
  geometry.dispose(); material.dispose();
});

test('an undrawn view queue stays bounded and cannot carry events into the next mission', () => {
  const view = Object.create(BattleView.prototype) as any;
  Object.assign(view, { disposed: false, pendingMissionId: '', pendingEvents: [], viewRevision: 0 });
  const events = Array.from({ length: PENDING_VIEW_EVENT_CAPACITY + 400 }, (_, index): CombatEvent => ({
    type: 'shot', tick: index, shotId: index, ownerId: 'A-aircraft', weapon: 'mg', position: { x: 0, y: 0, z: 0 },
  }));
  view.queueEvents(events, 'old');
  assert.equal(view.pendingEvents.length, PENDING_VIEW_EVENT_CAPACITY);
  assert.equal(view.pendingEvents[0], events[400]);
  assert.equal(view.pendingEvents.at(-1), events.at(-1));
  view.queueEvents([events[0]], 'new');
  assert.deepEqual(view.pendingEvents, [events[0]]);
});

test('replaying resets old view-cache clocks so unused roots are released in the next thirty seconds', () => {
  const view = Object.create(BattleView.prototype) as any, root = new Group(), scene = new Group();
  scene.add(root);
  const slot = { id: 'last-unit', root, key: 'tank:A', lastUsedTick: 35000 };
  Object.assign(view, { detailSlots: [slot], assigned: new Map([['last-unit', slot]]), particles: [],
    pendingMissionId: 'old', pendingEvents: [{}], seenEvents: new Set(['old']), seenDeaths: new Set(['old']),
    renderer: { renderLists: { dispose: () => {} } }, cacheCleanups: 0 });
  const mission = createBattle().mission;
  view.resetMission(mission);
  assert.equal(view.assigned.size, 0); assert.equal(view.pendingEvents.length, 0);
  view.clearUnusedCaches(RUNTIME_CLEANUP_TICKS);
  assert.equal(view.detailSlots.length, 0); assert.equal(root.parent, null);
});

test('published entry records no input or timing history; development diagnostics stay bounded', () => {
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.equal((source.match(/game\.recordInputs=import\.meta\.env\.DEV;/g) ?? []).length, 2);
  const start = source.indexOf('function recordSample('), end = source.indexOf('\nconst buttons=', start);
  const body = source.slice(start, end).replace('samples:number[],value:number', 'samples,value')
    .replace(':void{', '{').replace('RECORD_DIAGNOSTICS', 'isDev');
  const record = new Function('isDev', 'DIAGNOSTIC_SAMPLE_CAPACITY', `${body}; return recordSample;`);
  const production: number[] = [], diagnostic: number[] = [];
  for (const [dev, samples] of [[false, production], [true, diagnostic]] as const) {
    const append = record(dev, 1800);
    for (let sample = 0; sample < 4000; sample++) append(samples, sample);
  }
  assert.equal(production.length, 0);
  assert.equal(diagnostic.length, 1800);
  assert.equal(diagnostic[0], 2200); assert.equal(diagnostic.at(-1), 3999);
});
