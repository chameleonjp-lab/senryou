import type { CapturePoint, Unit, Team } from './types';
import { CONNECTIONS, TEAMS } from './rules';
export function createPoints(): CapturePoint[] { return [['HA', -2400, 0, 'A'], ['P1', -1400, 0, 'A'], ['P2', 0, -900, 'N'], ['P3', 0, 0, 'N'], ['P4', 0, 900, 'N'], ['P5', 1400, 0, 'B'], ['HB', 2400, 0, 'B']].map(([id, x, z, owner]) => ({ id: String(id), position: { x: Number(x), y: 0, z: Number(z) }, owner: owner as CapturePoint['owner'], homeTeam: id === 'HA' ? 'A' : id === 'HB' ? 'B' : undefined, phase: 'stable', progressTeam: null, progress: 0, progressNumerator: 0, remainder: 0, lastEligibleTick: 0, idleTicks: 0, contested: false, stableSince: -600 })); }
export function supplyConnections(points: readonly CapturePoint[]): Record<Team, Set<string>> { const out = { A: new Set<string>(), B: new Set<string>() }; for (const team of TEAMS) {
    const home = points.find(p => p.homeTeam === team);
    if (!home)
        continue;
    if (home.owner === 'N') {
        out[team].add(home.id);
        continue;
    }
    if (home.owner !== team)
        continue;
    const owned = new Set([home.id]);
    const queue = [home.id];
    while (queue.length) {
        const id = queue.shift()!;
        for (const [a, b] of CONNECTIONS) {
            const next = a === id ? b : b === id ? a : null;
            if (!next)
                continue;
            out[team].add(next);
            if (!owned.has(next) && points.find(p => p.id === next)?.owner === team) {
                owned.add(next);
                queue.push(next);
            }
        }
    }
    out[team].add(home.id);
} return out; }
export interface CaptureSurface {
    heightAt(x: number, z: number): number;
    walkable?(x: number, z: number): boolean;
}
export function updateCapture(points: readonly CapturePoint[], units: readonly Unit[], tick: number, surface?: CaptureSurface): CapturePoint[] { const supplied = supplyConnections(points); return points.map(old => { const p = { ...old, position: { ...old.position } }; const counts = { A: 0, B: 0 }; for (const u of units) {
    if (u.kind !== 'infantry' || u.state !== 'active' || u.hp <= 0)
        continue;
    const dx = u.position.x - p.position.x, dz = u.position.z - p.position.z;
    if (dx * dx + dz * dz > 6400)
        continue;
    const h = surface?.heightAt(u.position.x, u.position.z) ?? 0;
    if (Math.abs(u.position.y - h) > 3 || surface?.walkable?.(u.position.x, u.position.z) === false)
        continue;
    counts[u.team]++;
} if (old.owner === 'N' || old.progressNumerator > 0 || !supplied[old.owner].has(old.id))
    p.stableSince = tick; p.contested = counts.A > 0 && counts.B > 0; if (p.contested) {
    p.stableSince = tick;
    return p;
} const team: Team | null = counts.A ? 'A' : counts.B ? 'B' : null; if (team && team !== p.owner)
    p.stableSince = tick; const duration = p.homeTeam ? 1800 : 900; const denominator = duration * 6; const normalize = () => { p.progressNumerator = 0; p.progress = 0; p.remainder = 0; p.phase = 'stable'; p.progressTeam = null; p.idleTicks = 0; }; const adjust = (amount: number) => { p.progressNumerator = Math.max(0, Math.min(denominator, p.progressNumerator + amount)); p.progress = p.progressNumerator / denominator; }; if (team === p.owner) {
    p.lastEligibleTick = tick;
    p.idleTicks = 0;
    adjust(-12);
    if (!p.progressNumerator)
        normalize();
}
else if (team && supplied[team].has(p.id)) {
    p.lastEligibleTick = tick;
    p.idleTicks = 0;
    const amount = Math.min(counts[team], 6);
    if (p.owner === 'N' && p.progressNumerator > 0 && p.progressTeam !== team) {
        adjust(-amount);
        if (!p.progressNumerator)
            normalize();
    }
    else {
        p.progressTeam = team;
        p.phase = p.owner === 'N' ? 'capturing' : 'neutralizing';
        adjust(amount);
        if (p.progressNumerator === denominator) {
            p.owner = p.owner === 'N' ? team : 'N';
            p.stableSince = tick;
            normalize();
        }
    }
}
else {
    p.idleTicks++;
    if (p.idleTicks > 300) {
        adjust(-6);
        if (!p.progressNumerator)
            normalize();
    }
} return p; }); }
