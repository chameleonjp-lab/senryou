import assert from 'node:assert/strict';
import test from 'node:test';
import { serialize } from 'node:v8';
import { Quaternion, Vector3 } from 'three';
import { BattlePresentation } from '../src/battle-presentation';
import { createBattle, stepBattle, type BattleGame } from '../src/battle/simulation';
import { createFlightAircraft, targetsForFlight } from '../src/battle-flight';
import { getFlightCameraPose } from '../src/flight-view';
import { projectGunSight } from '../src/gun-sight';
import { MAX_TICKS } from '../src/battle/rules';

/** Preserve every enumerable authoritative field, Map/Set entry, undefined value
 * and alias. Only the unique per-run mission nonce is normalized. */
function authoritativeSnapshot(game: BattleGame): Buffer {
  const copy = structuredClone(game), nonce = game.mission.id, seen = new WeakSet<object>();
  function normalize(value: any): any {
    if (value === nonce) return 'frequency-fixture-mission';
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    if (value instanceof Map) {
      const entries = [...value]; value.clear();
      for (const [key, item] of entries) value.set(normalize(key), normalize(item));
    } else if (value instanceof Set) {
      const entries = [...value]; value.clear();
      for (const item of entries) value.add(normalize(item));
    } else for (const key of Object.keys(value)) value[key] = normalize(value[key]);
    return value;
  }
  return serialize(normalize(copy));
}

for (const mode of ['easy', 'normal'] as const) test(`${mode}: 30/60/120Hz presentation preserves real shot, hit, kill, score and completed result`, () => {
  let expected: Buffer[] | undefined;
  for (const hz of [30, 60, 120]) {
    const game = createBattle(73, mode), mission = game.mission;
    const player = mission.units.find(unit => unit.id === mission.controlledAircraftId)!;
    const enemy = mission.units.find(unit => unit.kind === 'aircraft' && unit.team !== player.team)!;
    // Keep the full finite roster, with one active opponent and no reinforcement
    // wave before the actual deadline. The opponent is killed by real rounds.
    for (const unit of mission.units) if (unit !== player && unit !== enemy) unit.state = 'reserve';
    Object.assign(player, {position:{x:0,y:1500,z:0},velocity:{x:0,y:0,z:-110},heading:0,pitch:0,bank:0,speed:110});
    Object.assign(enemy, {state:'active',position:{x:0,y:1500,z:-120},velocity:{x:0,y:0,z:65},heading:Math.PI,pitch:0,bank:0,speed:65,hp:1,hpFixed:1000,ammo:0,cannonAmmo:0});
    mission.tick = MAX_TICKS - 90; mission.nextWaveTick = MAX_TICKS + 1200;
    const presentation = new BattlePresentation(), trace: Buffer[] = [];
    let calls = 0, shots = 0, impacts = 0;
    for (let frame = 1; frame <= hz * 2; frame++) {
      const time = frame * 60 / hz;
      while (calls < Math.floor(time)) {
        presentation.capture(mission);
        stepBattle(game, {turn:0,climb:0,fire:calls<20,loop:false,steeringActive:true,viewAspect:402/874});
        shots += game.combat.events.filter(event => event.type === 'shot' && event.ownerId === player.id).length;
        impacts += game.combat.events.filter(event => event.type === 'impact' && event.targetId === enemy.id && (event.amount ?? 0) > 0).length;
        const state = authoritativeSnapshot(game);
        if (expected) assert.ok(state.equals(expected[calls]), `${mode}/${hz}Hz authoritative call ${calls+1}`);
        trace.push(state); calls++;
      }
      const before = authoritativeSnapshot(game), alpha = time - Math.floor(time);
      const displayed = presentation.sample(mission, alpha);
      presentation.sampleProjectiles(game.combat.projectiles, alpha);
      const plane = createFlightAircraft(displayed.units.find(unit => unit.id === player.id)!, displayed.playerTeam);
      getFlightCameraPose(plane, mode, new Vector3(), new Quaternion());
      projectGunSight(plane, targetsForFlight(displayed, plane), 402, 874);
      assert.ok(authoritativeSnapshot(game).equals(before), `${mode}/${hz}Hz sampling/camera/sight mutated authoritative state at frame ${frame}`);
    }
    assert.equal(calls, 120);
    assert.ok(shots >= 4); assert.ok(impacts > 0);
    assert.equal(enemy.state, 'lost'); assert.equal(enemy.hp, 0);
    assert.ok(mission.score.deaths.has(enemy.id));
    assert.ok(mission.score.kill > 0); assert.ok(mission.score.support > 0);
    assert.equal(mission.phase, 'result'); assert.equal(mission.tick, MAX_TICKS);
    assert.equal(mission.result?.outcome, 'draw'); assert.equal(mission.result?.reason, '時間切れ');
    assert.ok(mission.result!.score.kill > 0); assert.ok(mission.result!.score.support > 0);
    assert.ok(mission.result!.damage.some(event => event.targetId === enemy.id && event.sourceRole === 'player' && event.amount > 0));
    assert.ok(trace[89].equals(trace[119]), 'completed result and combat remain frozen through later fixed calls');
    expected ??= trace;
  }
});
