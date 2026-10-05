import type { Mission, Unit, Team, UnitKind, SpawnResolver } from './types';
import { TOTAL, INITIAL, CAP, WAVE, HP, KINDS, TEAMS } from './rules';
import { supplyConnections } from './capture';
export function initialRoster(): Unit[] { const units: Unit[] = []; for (const team of TEAMS)
    for (const kind of KINDS)
        for (let i = 0; i < TOTAL[kind]; i++) {
            const sign = team === 'A' ? -1 : 1;
            const active = i < INITIAL[kind];
            units.push({ id: `${team}-${kind}-${String(i).padStart(3, '0')}`, team, kind, state: active ? 'active' : 'reserve', role: 'ai', hp: HP[kind], hpFixed: HP[kind] * 1000, maxHpFixed: HP[kind] * 1000, position: { x: sign * (1600 + Math.floor(i / 12) * 12), y: kind === 'aircraft' ? 350 + i * 35 : 0, z: (i % 12 - 5.5) * 12 }, velocity: { x: 0, y: 0, z: 0 }, heading: team === 'A' ? -Math.PI / 2 : Math.PI / 2, squadId: kind === 'infantry' ? `${team}-squad-${Math.floor(i / 6)}` : undefined, ammo: kind === 'aircraft' ? 288 : kind === 'infantry' ? 12 : kind === 'tank' ? 4 : 16, cannonAmmo: 96, bombs: 2, reloadUntil: 0, bombReloadUntil: 0, lastFireTick: -10000, lastCannonTick: -10000, lastBombTick: -10000, retryNotBefore: 0 });
        } return units; }
export function rosterCounts(m: Mission, team: Team, kind: UnitKind) { const out = { reserve: 0, pending: 0, active: 0, lost: 0 }; for (const u of m.units)
    if (u.team === team && u.kind === kind)
        out[u.state]++; return out; }
export function assertRoster(m: Mission): void { for (const team of TEAMS)
    for (const kind of KINDS) {
        const n = rosterCounts(m, team, kind);
        if (n.reserve + n.pending + n.active + n.lost !== TOTAL[kind] || n.active + n.pending > CAP[kind])
            throw new Error(`Roster invariant: ${team}/${kind}`);
    } const players = m.units.filter(u => u.state === 'active' && u.role === 'player'); if (players.length > 1 || players.some(u => u.id !== m.controlledAircraftId))
    throw new Error('Controlled aircraft invariant'); }
function source(m: Mission, team: Team): string { return m.points.filter(p => p.owner === team && p.phase === 'stable' && supplyConnections(m.points)[team].has(p.id) && !p.contested && m.tick - p.stableSince >= 600).sort((a, b) => team === 'A' ? b.position.x - a.position.x : a.position.x - b.position.x)[0]?.id ?? (team === 'A' ? 'HA' : 'HB'); }
function reserve(m: Mission, u: Unit, player = false): void { u.state = 'pending'; u.reservation = { missionId: m.id, unitId: u.id, slot: u.id, sourcePoint: source(m, u.team), deadline: m.tick + 60, blockedSince: null, player }; }
export function updateRespawn(m: Mission): void { if (m.controlEnabled === false || m.controlledAircraftId)
    return; const air = m.units.filter(u => u.team === m.playerTeam && u.kind === 'aircraft'); let candidate = air.find(u => u.id === m.respawnCandidateId && ((u.state === 'pending' && u.reservation?.missionId === m.id) || u.state === 'active')); if (!candidate) {
    m.respawnCandidateId = null;
    const count = rosterCounts(m, m.playerTeam, 'aircraft');
    candidate = count.active + count.pending < CAP.aircraft ? air.find(u => u.state === 'reserve' && u.retryNotBefore <= m.tick) : undefined;
    if (candidate)
        reserve(m, candidate, true);
    else
        candidate = air.find(u => u.state === 'pending');
    if (candidate?.reservation)
        candidate.reservation.player = true;
    if (!candidate)
        candidate = air.find(u => u.state === 'active');
    if (candidate)
        m.respawnCandidateId = candidate.id;
} if (candidate) {
    m.playerStatus = 'waiting';
    m.waitingReason = candidate.state === 'pending' ? '安全な出撃回廊を確認中' : '操縦引継ぎ待ち';
    if (candidate.state === 'active' && m.tick >= (m.respawnReadyTick ?? 0)) {
        candidate.role = 'player';
        m.controlledAircraftId = candidate.id;
        m.respawnCandidateId = null;
        m.playerStatus = 'flying';
        m.waitingReason = '';
    }
}
else {
    m.playerStatus = air.every(u => u.state === 'lost') ? 'spectating' : 'waiting';
    m.waitingReason = m.playerStatus === 'spectating' ? '航空戦力なし・地上戦を観戦' : '出撃回廊の再検査待ち';
} }
const defaultSpawn: SpawnResolver = (u, _p, m) => m.points.find(p => p.id === _p) ? { ...m.points.find(p => p.id === _p)!.position, y: u.kind === 'aircraft' ? 400 : 0 } : null;
export function updateRoster(m: Mission, resolve: SpawnResolver = defaultSpawn): void { if (m.phase !== 'running')
    return; updateRespawn(m); if (m.tick >= m.nextWaveTick) {
    for (const team of TEAMS)
        for (const kind of KINDS) {
            const n = rosterCounts(m, team, kind);
            let count = Math.min(WAVE[kind], CAP[kind] - n.active - n.pending);
            const available = m.units.filter(u => u.team === team && u.kind === kind && u.state === 'reserve' && u.retryNotBefore <= m.tick);
            if (kind === 'infantry') {
                for (let i = 0; i < available.length && count >= 6; i += 6) {
                    const squad = available.slice(i, i + 6);
                    if (squad.length === 6 && squad.every(u => u.squadId === squad[0].squadId)) {
                        for (const u of squad)
                            reserve(m, u);
                        count -= 6;
                    }
                }
            }
            else
                for (const u of available.slice(0, count))
                    reserve(m, u);
        }
    m.nextWaveTick += 1200;
} const pending = m.units.filter(u => u.state === 'pending'); const bySquad = new Map<string, Unit[]>(); for (const u of pending) {
    const key = u.kind === 'infantry' ? u.squadId! : u.id;
    const group = bySquad.get(key) ?? [];
    group.push(u);
    bySquad.set(key, group);
} for (const group of bySquad.values()) {
    const r = group[0].reservation!;
    if (r.missionId !== m.id)
        continue;
    const ready = Math.max(r.deadline, r.player ? (m.respawnReadyTick ?? 0) : 0);
    if (m.tick < ready)
        continue;
    const positions = group.map(u => resolve(u, u.reservation!.sourcePoint, m));
    if (positions.every(Boolean)) {
        for (let i = 0; i < group.length; i++) {
            const u = group[i];
            u.state = 'active';
            u.position = positions[i]!;
            u.hp = HP[u.kind];
            u.hpFixed = u.maxHpFixed;
            u.ammo = u.kind === 'aircraft' ? 288 : u.kind === 'infantry' ? 12 : u.kind === 'tank' ? 4 : 16;
            u.cannonAmmo = 96;
            u.bombs = 2;
            u.reloadUntil = 0;
            u.bombReloadUntil = 0;
            u.lastFireTick = u.lastCannonTick = u.lastBombTick = -10000;
            u.lastFirePeriod = u.lastCannonPeriod = undefined;
            delete u.reservation;
            if (u.id === m.respawnCandidateId) {
                u.role = 'player';
                m.controlledAircraftId = u.id;
                m.respawnCandidateId = null;
                m.playerStatus = 'flying';
            }
        }
    }
    else {
        for (const u of group) {
            const rr = u.reservation!;
            rr.blockedSince ??= m.tick;
            if (m.tick - rr.blockedSince >= 3600) {
                u.state = 'reserve';
                u.retryNotBefore = (Math.floor(m.tick / 1200) + 1) * 1200;
                delete u.reservation;
            }
        }
    }
} assertRoster(m); }
