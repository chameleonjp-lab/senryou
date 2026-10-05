import test from 'node:test';
import assert from 'node:assert/strict';
import { createMission, finalizeMission, stepMission, logicalHash } from '../src/battle/mission';
import { assertRoster, rosterCounts, updateRoster, updateRespawn } from '../src/battle/roster';
import { createPoints, updateCapture, supplyConnections } from '../src/battle/capture';
import { applyDamage, markLost, scoreCaptures } from '../src/battle/scoring';
import type { Unit } from '../src/battle/types';
function troops(count: number, team: 'A' | 'B', point = 'P2'): Unit[] { const m = createMission(); const p = m.points.find(p => p.id === point)!; return m.units.filter(u => u.team === team && u.kind === 'infantry').slice(0, count).map(u => ({ ...u, state: 'active', position: { ...p.position } })); }
test('frontline stability restarts after supply reconnection and after neutralization decay', () => {
    let points = createPoints();
    points.find(p => p.id === 'HB')!.owner = 'N';
    for (let tick = 1; tick <= 700; tick++)
        points = updateCapture(points, [], tick);
    assert.equal(points.find(p => p.id === 'P5')!.stableSince, 700);
    points.find(p => p.id === 'HB')!.owner = 'B';
    for (let tick = 701; tick <= 1299; tick++)
        points = updateCapture(points, [], tick);
    assert.equal(1299 - points.find(p => p.id === 'P5')!.stableSince, 599);
    const p = points.find(p => p.id === 'P5')!;
    p.progressNumerator = 6;
    p.progress = 6 / 5400;
    p.progressTeam = 'A';
    p.phase = 'neutralizing';
    p.idleTicks = 300;
    points = updateCapture(points, [], 1300);
    assert.equal(points.find(p => p.id === 'P5')!.progress, 0);
    assert.equal(points.find(p => p.id === 'P5')!.stableSince, 1300);
});
test('592 IDs, 180 initial active, finite reserves and upper caps', () => { const m = createMission(); assert.equal(m.units.length, 592); assert.equal(new Set(m.units.map(u => u.id)).size, 592); assert.equal(m.units.filter(u => u.state === 'active').length, 180); assertRoster(m); m.tick = 1200; updateRoster(m); assert.equal(rosterCounts(m, 'A', 'infantry').pending, 18); assertRoster(m); });
test('six infantry capture relay in precisely 900 ticks; one takes 5400', () => { for (const [count, ticks] of [[6, 900], [1, 5400]]) {
    let points = createPoints();
    const units = troops(count, 'A');
    for (let i = 1; i < ticks; i++)
        points = updateCapture(points, units, i);
    assert.equal(points.find(p => p.id === 'P2')!.owner, 'N');
    points = updateCapture(points, units, ticks);
    assert.equal(points.find(p => p.id === 'P2')!.owner, 'A');
} });
test('contested freezes progress and idle clock; decay normalizes', () => { let points = createPoints(); for (let i = 0; i < 450; i++)
    points = updateCapture(points, troops(6, 'A'), i); const before = points.find(p => p.id === 'P2')!; const frozen = updateCapture(points, [...troops(6, 'A'), ...troops(1, 'B')], 451).find(p => p.id === 'P2')!; assert.equal(frozen.progress, before.progress); assert.equal(frozen.idleTicks, before.idleTicks); for (let i = 452; i < 452 + 300 + 450; i++)
    points = updateCapture(points, [], i); assert.equal(points.find(p => p.id === 'P2')!.progress, 0); assert.equal(points.find(p => p.id === 'P2')!.progressTeam, null); });
test('supply graph prevents downstream same-tick chain; own neutral HQ exception', () => { const points = createPoints(); assert(!supplyConnections(points).A.has('P5')); points.find(p => p.id === 'HA')!.owner = 'N'; assert(supplyConnections(points).A.has('HA')); assert(!supplyConnections(points).A.has('P2')); });
test('only live infantry on walkable surface within 3m can capture', () => { let points = createPoints(); const units = troops(6, 'A'); units[0].position.y = 4; units[1].state = 'lost'; units[2].kind = 'tank'; points = updateCapture(points, units, 1); assert.equal(points.find(p => p.id === 'P2')!.progressNumerator, 3); });
test('overkill clamps support, kill once, repeated explosion zero', () => { const m = createMission(); const target = m.units.find(u => u.team === 'B' && u.kind === 'infantry')!; assert.equal(applyDamage(m, target.id, 20, { id: 'player', sourceTeam: 'A', sourceRole: 'player' }), 20); assert.equal(applyDamage(m, target.id, 30, { id: 'AI', sourceTeam: 'A', sourceRole: 'ai' }), 20); assert.equal(m.score.support, 20); assert.equal(m.score.kill, 20); assert.equal(applyDamage(m, target.id, 240, { id: 'bomb', sourceTeam: 'A', sourceRole: 'player' }), 0); });
test('initial relay recapture zero and enemy relay first capture only once', () => { const m = createMission(); const p = m.points.find(p => p.id === 'P5')!; p.owner = 'A'; scoreCaptures(m); p.owner = 'B'; scoreCaptures(m); p.owner = 'A'; scoreCaptures(m); assert.equal(m.score.capture, 1000); });
test('respawn preserves survivor HP/ammunition, waits 300 ticks, no aircraft generation', () => { const m = createMission(); for (const u of m.units)
    if (u.team === 'A' && u.kind === 'aircraft' && u.state === 'reserve')
        u.state = 'lost'; const id = m.controlledAircraftId!; markLost(m, id); const survivor = m.units.find(u => u.team === 'A' && u.kind === 'aircraft' && u.state === 'active')!; survivor.hp = 2; survivor.hpFixed = 2000; survivor.ammo = 0; survivor.reloadUntil = 500; updateRespawn(m); assert.equal(m.respawnCandidateId, survivor.id); m.tick = 299; updateRespawn(m); assert.equal(m.controlledAircraftId, null); m.tick = 300; updateRespawn(m); assert.equal(m.controlledAircraftId, survivor.id); assert.equal(survivor.hp, 2); assert.equal(survivor.ammo, 0); assert.equal(survivor.reloadUntil, 500); });
test('blocked reservations return finite reserves and retry only next wave', () => { const m = createMission(); markLost(m, m.controlledAircraftId!); updateRoster(m, () => null); m.tick = 300; updateRoster(m, () => null); m.tick = 3900; updateRoster(m, () => null); const cancelled = m.units.filter(u => u.kind === 'aircraft' && u.retryNotBefore === 4800); assert(cancelled.length > 0); assertRoster(m); });
test('simultaneous HQ fall draw; capture priority over time; frozen result', () => { const m = createMission(); m.points.find(p => p.id === 'HA')!.owner = 'B'; m.points.find(p => p.id === 'HB')!.owner = 'A'; assert.equal(finalizeMission(m)!.reason, '同時本拠地占領'); assert.equal(m.result!.score.capture, 0); const win = createMission(); win.score.support = 1000; win.tick = 36000; win.points.find(p => p.id === 'HB')!.owner = 'A'; const result = finalizeMission(win)!; assert.equal(result.score.time, 1250); assert(Object.isFrozen(result)); win.points.find(p => p.id === 'HB')!.owner = 'B'; assert.equal(finalizeMission(win), result); const late = createMission(); late.tick = 72000; late.points.find(p => p.id === 'HB')!.owner = 'A'; assert.equal(finalizeMission(late)!.outcome, 'victory'); });
test('same seed logical replay hashes match; paused ticks do not advance', () => { const a = createMission(42), b = createMission(42); for (let i = 0; i < 1200; i++) {
    stepMission(a);
    stepMission(b);
} assert.equal(logicalHash(a), logicalHash(b)); a.phase = 'paused'; stepMission(a); assert.equal(a.tick, 1200); });
test('existing pending aircraft keeps earlier preparation deadline while player waits five seconds', () => { const m = createMission(); for (const u of m.units)
    if (u.team === 'A' && u.kind === 'aircraft' && u.state === 'reserve')
        u.state = 'lost'; const candidate = m.units.find(u => u.team === 'A' && u.kind === 'aircraft' && u.role === 'ai' && u.state === 'active')!; candidate.state = 'pending'; candidate.reservation = { missionId: m.id, unitId: candidate.id, slot: candidate.id, sourcePoint: 'HA', deadline: 100, blockedSince: null, player: false }; markLost(m, m.controlledAircraftId!); updateRespawn(m); assert.equal(m.respawnCandidateId, candidate.id); assert.equal(candidate.reservation.deadline, 100); m.tick = 100; updateRoster(m); assert.equal(candidate.state, 'pending'); m.tick = 300; updateRoster(m); assert.equal(candidate.state, 'active'); assert.equal(m.controlledAircraftId, candidate.id); });
test('no air remaining means spectating, but aircraft absence never finalizes battle', () => { const m = createMission(); for (const u of m.units)
    if (u.team === 'A' && u.kind === 'aircraft') {
        if (u.state === 'active')
            markLost(m, u.id);
        else
            u.state = 'lost';
    } updateRespawn(m); assert.equal(m.playerStatus, 'spectating'); assert.equal(finalizeMission(m), null); });
test('death-time player role adds loss once; old AI-fired shot gives no player support', () => { const m = createMission(); const id = m.controlledAircraftId!; markLost(m, id); markLost(m, id); assert.equal(m.score.loss, 500); const target = m.units.find(u => u.team === 'B' && u.kind === 'infantry')!; applyDamage(m, target.id, 10, { id: 'oldAI', sourceTeam: 'A', sourceRole: 'ai' }); assert.equal(m.score.support, 0); });
test('one side infantry depleted continues; reserve infantry prevents draw', () => { const m = createMission(); for (const u of m.units)
    if (u.kind === 'infantry' && u.team === 'A')
        u.state = 'lost'; assert.equal(finalizeMission(m), null); for (const u of m.units)
    if (u.kind === 'infantry' && u.team === 'B' && u.state === 'active')
        u.state = 'lost'; assert.equal(finalizeMission(m), null); for (const u of m.units)
    if (u.kind === 'infantry')
        u.state = 'lost'; assert.equal(finalizeMission(m)!.reason, '占領戦力枯渇'); });
