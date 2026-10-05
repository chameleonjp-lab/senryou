import type { Mission, ScoreLedger, DamageEvent, DeathEvent, MissionResult } from './types';
import { KILL, LOSS } from './rules';
export function createScore(initialPoints: string[]): ScoreLedger { return { kill: 0, support: 0, supportFixed: 0, capture: 0, time: 0, loss: 0, deaths: new Set(), captures: new Set(initialPoints), damageIds: new Set(), damage: [] }; }
export function applyDamage(m: Mission, targetId: string, amount: number, source: {
    id: string;
    sourceTeam?: DamageEvent['sourceTeam'];
    sourceRole?: DamageEvent['sourceRole'];
}): number { if (m.phase !== 'running' || m.score.damageIds.has(source.id + ':' + targetId))
    return 0; const unit = m.units.find(u => u.id === targetId); if (!unit || unit.state !== 'active' || amount <= 0 || unit.team === source.sourceTeam)
    return 0; const fixed = Math.min(unit.hpFixed, Math.max(0, Math.round(amount * 1000))); if (!fixed)
    return 0; m.score.damageIds.add(source.id + ':' + targetId); unit.hpFixed -= fixed; unit.hp = unit.hpFixed / 1000; const event: DamageEvent = { id: source.id, targetId, amount: fixed / 1000, sourceTeam: source.sourceTeam, sourceRole: source.sourceRole, tick: m.tick }; m.score.damage.push(event); if (source.sourceTeam === m.playerTeam && source.sourceRole === 'player' && unit.team !== m.playerTeam) {
    m.score.supportFixed = (m.score.supportFixed ?? Math.round(m.score.support * 1000)) + fixed;
    m.score.support = m.score.supportFixed / 1000;
} if (!unit.hpFixed)
    markLost(m, unit.id); return event.amount; }
export function markLost(m: Mission, id: string): DeathEvent | null { const unit = m.units.find(u => u.id === id); if (m.phase !== 'running' || !unit || unit.state !== 'active' || m.score.deaths.has(id))
    return null; const death: DeathEvent = { unitId: id, team: unit.team, kind: unit.kind, player: unit.role === 'player', tick: m.tick }; m.score.deaths.add(id); m.deaths.push(death); if (unit.team === m.playerTeam)
    m.score.loss += LOSS[unit.kind] + (death.player && unit.kind === 'aircraft' ? 200 : 0);
else
    m.score.kill += KILL[unit.kind]; unit.state = 'lost'; unit.hp = 0; unit.hpFixed = 0; delete unit.reservation; if (m.controlledAircraftId === id) {
    m.controlledAircraftId = null;
    m.respawnReadyTick = m.tick + 300;
    m.playerStatus = 'waiting';
} return death; }
export function scoreCaptures(m: Mission): void { for (const p of m.points)
    if (!p.homeTeam && p.owner === m.playerTeam && !m.score.captures.has(p.id)) {
        m.score.captures.add(p.id);
        m.score.capture += 1000;
    } }
export function scoreSnapshot(m: Mission): MissionResult['score'] { const { kill, support, capture, time, loss } = m.score; return { kill, support, capture, time, loss, total: Math.round(kill + support + capture + time - loss) }; }
