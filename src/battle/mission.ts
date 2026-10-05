import type { Mission, MissionResult, Team, SpawnResolver } from './types';
import { RULES_VERSION, MAX_TICKS, KINDS, TEAMS, opposite } from './rules';
import { createPoints, updateCapture, type CaptureSurface } from './capture';
import { initialRoster, rosterCounts, updateRoster, updateRespawn } from './roster';
import { createScore, scoreCaptures, scoreSnapshot } from './scoring';
let sequence = 0;
export function createMission(seed = 1, playerTeam: Team = 'A'): Mission { const points = createPoints(); const units = initialRoster(); const player = units.find(u => u.team === playerTeam && u.kind === 'aircraft' && u.state === 'active')!; player.role = 'player'; const id = `mission-${seed}-${++sequence}`; return { id, missionId: id, rulesVersion: RULES_VERSION, seed, tick: 0, phase: 'running', playerTeam, units, points, controlledAircraftId: player.id, respawnCandidateId: null, respawnReadyTick: null, playerStatus: 'flying', waitingReason: '', nextWaveTick: 1200, score: createScore(points.filter(p => !p.homeTeam && p.owner === playerTeam).map(p => p.id)), result: null, deaths: [] }; }
export function finalizeMission(m: Mission, abort = false): MissionResult | null { if (m.result)
    return m.result; const enemy = opposite(m.playerTeam); const home = m.points.find(p => p.homeTeam === m.playerTeam)!, other = m.points.find(p => p.homeTeam === enemy)!; const fallen = home.owner === enemy, taken = other.owner === m.playerTeam; const infantryGone = TEAMS.every(t => { const n = rosterCounts(m, t, 'infantry'); return n.reserve + n.pending + n.active === 0; }); let outcome: MissionResult['outcome'], reason: string; if (fallen && taken) {
    outcome = 'draw';
    reason = '同時本拠地占領';
}
else if (taken) {
    outcome = 'victory';
    reason = '敵本拠地占領';
}
else if (fallen) {
    outcome = 'defeat';
    reason = '味方本拠地占領';
}
else if (infantryGone) {
    outcome = 'draw';
    reason = '占領戦力枯渇';
}
else if (m.tick >= MAX_TICKS) {
    outcome = 'draw';
    reason = '時間切れ';
}
else if (abort) {
    outcome = 'aborted';
    reason = '作戦終了';
}
else
    return null; scoreCaptures(m); if (outcome === 'victory') {
    m.score.capture += 5000;
    m.score.time = 5000 * Math.max(0, 1 - m.tick / MAX_TICKS) * Math.min(1, m.score.support / 2000);
} const remaining = {} as MissionResult['remaining']; for (const team of TEAMS) {
    remaining[team] = {} as MissionResult['remaining']['A'];
    for (const kind of KINDS) {
        const n = rosterCounts(m, team, kind);
        remaining[team][kind] = n.reserve + n.pending + n.active;
    }
} const result: MissionResult = { rulesVersion: m.rulesVersion, seed: m.seed, outcome, reason, tick: m.tick, score: scoreSnapshot(m), owners: Object.fromEntries(m.points.map(p => [p.id, p.owner])), remaining, damage: m.score.damage.map(e => Object.freeze({ ...e })) }; Object.freeze(result.score); Object.freeze(result.owners); for (const team of TEAMS)
    Object.freeze(result.remaining[team]); Object.freeze(result.remaining); Object.freeze(result.damage); m.result = Object.freeze(result); m.phase = 'result'; return m.result; }
export interface TickHooks {
    spawn?: SpawnResolver;
    move?: (m: Mission) => void;
    combat?: (m: Mission) => void;
    surface?: CaptureSurface;
    abort?: boolean;
}
export function stepMission(m: Mission, hooks: TickHooks = {}): void { if (m.phase !== 'running' || m.result)
    return; const ownerSnapshot = m.points.map(p => ({ ...p, position: { ...p.position } })); m.tick++; m.deaths = []; updateRoster(m, hooks.spawn); hooks.move?.(m); hooks.combat?.(m); m.points = updateCapture(ownerSnapshot, m.units, m.tick, hooks.surface); scoreCaptures(m); if (!finalizeMission(m, hooks.abort))
    updateRespawn(m); }
/** Include all authoritative forward state; normalize only the mission nonce. */
export function logicalHash(m: Mission): string {
    const { id: _id, missionId: _missionId, ...state } = m;
    const text = JSON.stringify(state, (key, value) => key === 'missionId' ? 'current' : value instanceof Map ? [...value] : value instanceof Set ? [...value] : value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
