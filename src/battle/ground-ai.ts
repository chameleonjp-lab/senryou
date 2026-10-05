import type { CapturePoint, Mission, Team, Unit, Vec3 } from './types';
import { CONNECTIONS } from './rules';
import { BATTLEFIELD, bridgeAt, UNIT_RADIUS, terrainLineOfSight, walkableSurface } from './terrain';
import {
  createRecoveryState, createTrafficState, findGroundPath, formationOffset, groundRouteDistance, moveGroundUnit,
  requestCorridor, stableHash, teamDirection, updateRecovery, updateTraffic,
  type GroundPath, type RecoveryState, type TrafficState,
} from './ground-nav';

export interface GroundContact { id: string; position: Vec3; velocity: Vec3; lastSeenTick: number }
export interface SquadAI {
  id: string; team: Team; members: string[]; targetPointId: string;
  role: 'defend' | 'advance' | 'retake'; assignedTick: number; path: GroundPath | null; pathVersion: number;
}
export interface GroundUnitAI {
  waypointIndex: number; path: GroundPath | null; pathVersion: number; targetPointId: string;
  recovery: RecoveryState; contact: GroundContact | null; combatStopSince: number | null;
  lastPlanTick: number; escortSquadId: string | null; assignedTick: number;
}
export interface GroundAIState {
  missionId: string; lastStrategyTick: number; squads: Record<string, SquadAI>;
  units: Record<string, GroundUnitAI>; traffic: TrafficState;
  warnings: { unitId: string; reason: string; routeId?: string }[];
}
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
const homeId = (team: Team) => team === 'A' ? 'HA' : 'HB';
function living(unit: Unit): boolean { return unit.state === 'active' && unit.hp > 0; }
function eye(unit: Unit): Vec3 { return { ...unit.position, y: unit.position.y + (unit.kind === 'infantry' ? 1.4 : 2) }; }
// A derived ID index is never authoritative and contains no camera or random state.
const unitLookups = new WeakMap<readonly Unit[], { length: number; byId: Map<string, Unit> }>();

export function createGroundAI(mission?: Mission): GroundAIState {
  return { missionId: mission?.id ?? '', lastStrategyTick: -60, squads: {}, units: {}, traffic: createTrafficState(), warnings: [] };
}

function connectedOwned(points: readonly CapturePoint[], team: Team): Set<string> {
  const owners = new Map(points.map(p => [p.id, p.owner]));
  const home = homeId(team), result = new Set<string>();
  if (owners.get(home) !== team) return result;
  result.add(home); const queue = [home];
  for (let i = 0; i < queue.length; i++) for (const [a, b] of CONNECTIONS) {
    const next = a === queue[i] ? b : b === queue[i] ? a : null;
    if (next && owners.get(next) === team && !result.has(next)) { result.add(next); queue.push(next); }
  }
  return result;
}

function eligibleTargets(points: readonly CapturePoint[], team: Team): { point: CapturePoint; priority: number }[] {
  const owned = connectedOwned(points, team), home = points.find(p => p.id === homeId(team))!;
  // Home defence and neutral-home recapture explicitly do not require a supply chain.
  if (home.owner !== team || home.contested || home.progressNumerator > 0) return [{ point: home, priority: 0 }];
  const eligible = new Set<string>();
  for (const [a, b] of CONNECTIONS) {
    if (owned.has(a)) eligible.add(b);
    if (owned.has(b)) eligible.add(a);
  }
  const disconnected = new Set(points.filter(p => p.owner === team && !owned.has(p.id)).map(p => p.id));
  return points.filter(p => p.owner !== team && eligible.has(p.id)).map(point => ({ point,
    priority: CONNECTIONS.some(([a, b]) => (a === point.id && disconnected.has(b)) || (b === point.id && disconnected.has(a))) ? 1 : 2 }));
}

function squadMembers(squad: SquadAI, units: readonly Unit[]): Unit[] {
  let index = unitLookups.get(units);
  if (!index || index.length !== units.length) {
    index = { length: units.length, byId: new Map(units.map(u => [u.id, u])) }; unitLookups.set(units, index);
  }
  return squad.members.map(id => index!.byId.get(id)).filter((u): u is Unit => Boolean(u && living(u)));
}
function centerOf(units: readonly Unit[]): Vec3 {
  if (!units.length) return { x: 0, y: 12, z: 0 };
  let x = 0, y = 0, z = 0;
  for (const unit of units) { x += unit.position.x; y += unit.position.y; z += unit.position.z; }
  return { x: x / units.length, y: y / units.length, z: z / units.length };
}

function refreshSquads(mission: Mission, state: GroundAIState): void {
  const groups = new Map<string, Unit[]>();
  for (const unit of mission.units) if (unit.kind === 'infantry' && living(unit)) {
    const id = unit.squadId ?? unit.id;
    const members = groups.get(id) ?? []; members.push(unit); groups.set(id, members);
  }
  for (const [id, members] of groups) {
    members.sort((a, b) => a.id.localeCompare(b.id));
    const squad = state.squads[id] ??= { id, team: members[0].team, members: [], targetPointId: '', role: 'advance', assignedTick: -1800, path: null, pathVersion: 0 };
    squad.members = members.map(u => u.id);
  }
  for (const id of Object.keys(state.squads)) if (!groups.has(id)) delete state.squads[id];
}

function assignmentValid(squad: SquadAI, mission: Mission): boolean {
  const point = mission.points.find(p => p.id === squad.targetPointId);
  if (!point) return false;
  if (squad.role === 'defend') return point.id === homeId(squad.team);
  return eligibleTargets(mission.points, squad.team).some(candidate => candidate.point.id === point.id);
}

/** Sixty-tick strategy cadence, independent of distance, camera, and render LOD. */
export function updateGroundStrategy(mission: Mission, state: GroundAIState): void {
  refreshSquads(mission, state);
  for (const team of ['A', 'B'] as const) {
    const squads = Object.values(state.squads).filter(s => s.team === team);
    const home = mission.points.find(p => p.id === homeId(team))!;
    const centers = new Map(squads.map(s => [s.id, centerOf(squadMembers(s, mission.units))]));
    const people = squads.reduce((sum, squad) => sum + squad.members.length, 0);
    const defenceCount = people >= 12 ? Math.min(2, squads.length) : people > 0 ? 1 : 0;
    const defenders = new Set([...squads].sort((a, b) => {
      const aRetained = a.role === 'defend' && mission.tick - a.assignedTick < 1800;
      const bRetained = b.role === 'defend' && mission.tick - b.assignedTick < 1800;
      return Number(bRetained) - Number(aRetained) || distance(centers.get(a.id)!, home.position) - distance(centers.get(b.id)!, home.position) || a.id.localeCompare(b.id);
    }).slice(0, defenceCount).map(s => s.id));
    const candidates = eligibleTargets(mission.points, team);
    const homeEmergency = home.owner !== team || home.contested || home.progressNumerator > 0;
    const counts = new Map<string, number>();
    const work = [...squads].sort((a, b) => a.id.localeCompare(b.id));
    const precounted = new Set<string>();
    // Expiring assignments remain real front loads until their own reevaluation.
    for (const squad of work) if (!defenders.has(squad.id) && squad.role !== 'defend' && !homeEmergency && assignmentValid(squad, mission)) {
      counts.set(squad.targetPointId, (counts.get(squad.targetPointId) ?? 0) + 1);
      precounted.add(squad.id);
    }
    for (const squad of work) {
      let target: CapturePoint | undefined;
      let role: SquadAI['role'] = 'advance';
      if (defenders.has(squad.id)) { target = home; role = 'defend'; }
      else if (homeEmergency) { target = home; role = 'retake'; }
      else if (assignmentValid(squad, mission) && mission.tick - squad.assignedTick < 1800) {
        for (const member of squadMembers(squad, mission.units)) member.targetPointId = squad.targetPointId;
        continue;
      } else {
        if (precounted.has(squad.id)) counts.set(squad.targetPointId, Math.max(0, (counts.get(squad.targetPointId) ?? 0) - 1));
        const bestPriority = Math.min(...candidates.map(c => c.priority));
        const choices = candidates.filter(c => c.priority === bestPriority).sort((a, b) =>
          (counts.get(a.point.id) ?? 0) - (counts.get(b.point.id) ?? 0)
          || groundRouteDistance(centers.get(squad.id)!, a.point.id) - groundRouteDistance(centers.get(squad.id)!, b.point.id)
          || a.point.id.localeCompare(b.point.id));
        target = choices[0]?.point;
        if (choices[0]?.priority === 1) role = 'retake';
        if (!target) {
          // No capturable front: defend the furthest supplied friendly point.
          const owned = connectedOwned(mission.points, team);
          target = mission.points.filter(p => owned.has(p.id)).sort((a, b) =>
            teamDirection(team) * (b.position.x - a.position.x) || a.id.localeCompare(b.id))[0] ?? home;
          role = target.id === home.id ? 'defend' : 'advance';
        }
        counts.set(target.id, (counts.get(target.id) ?? 0) + 1);
      }
      if (target.id !== squad.targetPointId || role !== squad.role || !squad.path) {
        squad.targetPointId = target.id; squad.role = role;
        squad.path = findGroundPath('infantry', centers.get(squad.id)!, target.id, { seed: mission.seed, unitId: squad.id });
        squad.pathVersion++;
      }
      // An unchanged renewed assignment also starts a fresh thirty-second hold.
      squad.assignedTick = mission.tick;
      for (const member of squadMembers(squad, mission.units)) member.targetPointId = squad.targetPointId;
    }
  }
  assignTankEscorts(mission, state);
  state.lastStrategyTick = mission.tick;
}

function assignTankEscorts(mission: Mission, state: GroundAIState): void {
  for (const team of ['A', 'B'] as const) {
    const tanks = mission.units.filter(u => u.team === team && u.kind === 'tank' && living(u)).sort((a, b) => a.id.localeCompare(b.id));
    const advancing = Object.values(state.squads).filter(s => s.team === team && s.role !== 'defend');
    const escorts = new Map<string, number>();
    for (const tank of tanks) {
      const ai = unitState(state, tank, mission.tick);
      if (ai.escortSquadId && advancing.some(s => s.id === ai.escortSquadId) && mission.tick - ai.assignedTick < 1800) {
        escorts.set(ai.escortSquadId, (escorts.get(ai.escortSquadId) ?? 0) + 1); continue;
      }
      const selected = [...advancing].sort((a, b) => (escorts.get(a.id) ?? 0) - (escorts.get(b.id) ?? 0)
        || distance(tank.position, centerOf(squadMembers(a, mission.units))) - distance(tank.position, centerOf(squadMembers(b, mission.units)))
        || a.id.localeCompare(b.id))[0];
      ai.escortSquadId = selected?.id ?? null; ai.assignedTick = mission.tick;
      if (selected) escorts.set(selected.id, (escorts.get(selected.id) ?? 0) + 1);
    }
  }
}

function unitState(state: GroundAIState, unit: Unit, tick: number): GroundUnitAI {
  return state.units[unit.id] ??= { waypointIndex: 1, path: null, pathVersion: -1, targetPointId: '', recovery: createRecoveryState(unit.position, tick),
    contact: null, combatStopSince: null, lastPlanTick: -30, escortSquadId: null, assignedTick: -1800 };
}

/** Memory stores the last observed pose; an invisible unit's current pose never reaches a gun. */
export function selectGroundTarget(mission: Mission, unit: Unit, ai: GroundUnitAI, candidates: readonly Unit[] = mission.units): Unit | null {
  const range = unit.kind === 'infantry' ? 250 : unit.kind === 'tank' ? 900 : 0;
  if (!range) return null;
  const targets = candidates.filter(other => living(other) && other.team !== unit.team
    && (unit.kind === 'infantry' ? other.kind === 'infantry' || other.kind === 'aa' : other.kind !== 'aircraft')
    && (unit.position.x - other.position.x) ** 2 + (unit.position.z - other.position.z) ** 2 <= range * range).sort((a, b) => {
      const priority = (u: Unit) => unit.kind === 'infantry' ? u.kind === 'infantry' ? 0 : 1 : u.kind === 'tank' ? 0 : u.kind === 'aa' ? 1 : 2;
      return priority(a) - priority(b) || distance(unit.position, a.position) - distance(unit.position, b.position) || a.id.localeCompare(b.id);
    });
  const visible = targets.find(other => terrainLineOfSight(eye(unit), eye(other))) ?? null;
  if (visible) {
    if (unit.targetId !== visible.id) unit.targetSince = mission.tick;
    unit.targetId = visible.id;
    ai.contact = { id: visible.id, position: { ...visible.position }, velocity: { ...visible.velocity }, lastSeenTick: mission.tick };
  } else {
    delete unit.targetId;
    if (ai.contact && (mission.tick - ai.contact.lastSeenTick > 180 || !mission.units.some(u => u.id === ai.contact!.id && living(u)))) ai.contact = null;
  }
  return visible;
}

function squadGoal(squad: SquadAI, mission: Mission): Vec3 {
  const target = mission.points.find(p => p.id === squad.targetPointId)!;
  const index = Number(squad.id.match(/(\d+)$/)?.[1] ?? stableHash(mission.seed, squad.id));
  const angle = index % 8 * Math.PI / 4;
  const ring = 28 + Math.floor(index / 8) % 3 * 10;
  const x = target.position.x + teamDirection(squad.team) * Math.cos(angle) * ring, z = target.position.z + Math.sin(angle) * ring;
  return { x, y: walkableSurface(x, z, 'infantry').height, z };
}

function currentRoute(ai: GroundUnitAI): string | undefined {
  return ai.path?.routes.find(r => ai.waypointIndex > r.startIndex && ai.waypointIndex <= r.endIndex)?.routeId;
}

function occupyingBridge(unit: Unit): boolean {
  return BATTLEFIELD.bridges.some(b => {
    const dx = unit.position.x - b.center.x, dz = unit.position.z - b.center.z;
    return Math.abs(dx * Math.cos(b.yaw) + dz * Math.sin(b.yaw)) < b.length / 2 + 5
      && Math.abs(-dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw)) < b.width / 2;
  });
}

function ensurePath(mission: Mission, unit: Unit, ai: GroundUnitAI, targetPoint: string, shared?: SquadAI): void {
  if (occupyingBridge(unit) && ai.path && ai.targetPointId !== targetPoint) return;
  const needsPath = !ai.path || ai.targetPointId !== targetPoint || (shared && ai.pathVersion !== shared.pathVersion) || ai.recovery.mode === 'reroute';
  if (!needsPath || mission.tick - ai.lastPlanTick < 30 && ai.targetPointId === targetPoint) return;
  if (shared?.path && !ai.recovery.alternate && !Object.keys(ai.recovery.bannedUntil).length) ai.path = shared.path;
  else ai.path = findGroundPath(unit.kind, unit.position, targetPoint, { seed: mission.seed, unitId: shared?.id ?? unit.id,
    tick: mission.tick, bannedUntil: ai.recovery.bannedUntil, alternate: ai.recovery.alternate });
  ai.waypointIndex = 1; ai.pathVersion = shared?.pathVersion ?? ai.pathVersion + 1;
  ai.targetPointId = targetPoint; ai.lastPlanTick = mission.tick;
  ai.recovery.mode = ai.path ? 'moving' : 'waiting';
  if (!ai.path) ai.recovery.reason = '全経路閉塞・後方待避を待機';
}

function bridgePermission(mission: Mission, state: GroundAIState, unit: Unit, goal: Vec3): boolean {
  for (const bridge of BATTLEFIELD.bridges) {
    const dx = unit.position.x - bridge.center.x, dz = unit.position.z - bridge.center.z;
    const along = dx * Math.cos(bridge.yaw) + dz * Math.sin(bridge.yaw);
    const across = Math.abs(-dx * Math.sin(bridge.yaw) + dz * Math.cos(bridge.yaw));
    if (Math.abs(along) > bridge.length / 2 + 18 || across > bridge.width / 2 + 3) continue;
    const direction = (goal.x - unit.position.x) * Math.cos(bridge.yaw) + (goal.z - unit.position.z) * Math.sin(bridge.yaw) >= 0 ? 1 : -1;
    if (!requestCorridor(state.traffic, bridge.id, unit.id, direction, mission.tick)) return false;
  }
  return true;
}

function followPath(mission: Mission, state: GroundAIState, unit: Unit, ai: GroundUnitAI, finalGoal: Vec3, others: readonly Unit[]): void {
  const route = currentRoute(ai);
  const path = ai.path;
  if (!path) { unit.velocity = { x: 0, y: 0, z: 0 }; return; }
  const last = path.waypoints.length - 1;
  ai.waypointIndex = Math.min(ai.waypointIndex, last);
  let goal = path.waypoints[ai.waypointIndex] ?? finalGoal;
  const formation = formationOffset(unit);
  const lateral = formation.lateral * teamDirection(unit.team);
  const previous = path.waypoints[Math.max(0, ai.waypointIndex - 1)] ?? unit.position;
  const vx = goal.x - previous.x, vz = goal.z - previous.z, length = Math.hypot(vx, vz) || 1;
  if (ai.waypointIndex >= last) goal = { ...finalGoal };
  else goal = { x: goal.x - vz / length * lateral - vx / length * formation.longitudinal,
    y: goal.y, z: goal.z + vx / length * lateral - vz / length * formation.longitudinal };
  const bridge = bridgeAt(goal.x, goal.z);
  const arrivalRadius = Math.min(unit.kind === 'infantry' ? 5 : 9,
    bridge ? Math.max(1, bridge.width / 2 - UNIT_RADIUS[unit.kind] - 1) : Infinity);
  if (distance(unit.position, goal) < arrivalRadius && ai.waypointIndex < last) {
    ai.waypointIndex++; followPath(mission, state, unit, ai, finalGoal, others); return;
  }
  if (ai.waypointIndex >= last && distance(unit.position, goal) < 1) {
    unit.velocity = { x: 0, y: 0, z: 0 }; updateRecovery(ai.recovery, unit.position, mission.tick, false, route); return;
  }
  updateRecovery(ai.recovery, unit.position, mission.tick, true, route);
  if (ai.recovery.mode === 'reversing') {
    const behind = { x: unit.position.x + Math.sin(unit.heading) * 12, y: unit.position.y, z: unit.position.z + Math.cos(unit.heading) * 12 };
    moveGroundUnit(unit, behind, others, true); return;
  }
  if (!bridgePermission(mission, state, unit, goal)) { unit.velocity = { x: 0, y: 0, z: 0 }; return; }
  moveGroundUnit(unit, goal, others);
}

function stepInfantry(mission: Mission, state: GroundAIState, unit: Unit, ai: GroundUnitAI, others: readonly Unit[], targets: readonly Unit[]): void {
  const squad = state.squads[unit.squadId ?? unit.id];
  if (!squad) return;
  ensurePath(mission, unit, ai, squad.targetPointId, squad);
  const target = selectGroundTarget(mission, unit, ai, targets);
  const nearInfantry = target?.kind === 'infantry' && distance(unit.position, target.position) <= 80;
  if (nearInfantry) {
    ai.combatStopSince ??= mission.tick;
    if ((mission.tick - ai.combatStopSince) % 240 < 180) {
      unit.velocity = { x: 0, y: 0, z: 0 }; updateRecovery(ai.recovery, unit.position, mission.tick, false); return;
    }
  } else ai.combatStopSince = null;
  const goal = squadGoal(squad, mission), offset = formationOffset(unit);
  goal.x -= teamDirection(unit.team) * offset.longitudinal; goal.z += offset.lateral;
  followPath(mission, state, unit, ai, goal, others);
}

function tankGoal(mission: Mission, state: GroundAIState, unit: Unit, ai: GroundUnitAI): { pointId: string; position: Vec3 } {
  const squad = ai.escortSquadId ? state.squads[ai.escortSquadId] : undefined;
  const members = squad ? squadMembers(squad, mission.units) : [];
  if (members.length && squad) {
    const center = centerOf(members), index = Number(unit.id.match(/(\d+)$/)?.[1] ?? 0);
    const velocity = centerOf(members.map(member => ({ ...member, position: member.velocity })));
    const speed = Math.hypot(velocity.x, velocity.z);
    const direction = speed > 0.5 ? { x: velocity.x / speed, z: velocity.z / speed } : { x: teamDirection(unit.team), z: 0 };
    const lateral = occupyingBridge(unit) || occupyingBridge(members[0]) ? 0 : (index % 2 === 0 ? -1 : 1) * 13 * teamDirection(unit.team);
    const position = { x: center.x - direction.x * 35 - direction.z * lateral, y: center.y, z: center.z - direction.z * 35 + direction.x * lateral };
    return { pointId: squad.targetPointId, position };
  }
  const owned = connectedOwned(mission.points, unit.team);
  const point = mission.points.filter(p => owned.has(p.id)).sort((a, b) => teamDirection(unit.team) * (b.position.x - a.position.x) || a.id.localeCompare(b.id))[0]
    ?? mission.points.find(p => p.id === homeId(unit.team))!;
  return { pointId: point.id, position: { x: point.position.x - teamDirection(unit.team) * 60, y: point.position.y, z: point.position.z + (stableHash(0, unit.id) % 5 - 2) * 18 } };
}

function stepTank(mission: Mission, state: GroundAIState, unit: Unit, ai: GroundUnitAI, others: readonly Unit[], targets: readonly Unit[]): void {
  const goal = tankGoal(mission, state, unit, ai);
  unit.targetPointId = goal.pointId;
  selectGroundTarget(mission, unit, ai, targets);
  ensurePath(mission, unit, ai, goal.pointId);
  const escort = ai.escortSquadId ? state.squads[ai.escortSquadId] : undefined;
  const people = escort ? squadMembers(escort, mission.units) : [];
  if (people.length) {
    const center = centerOf(people);
    // A vehicle that gets ahead waits for its own infantry; it cannot capture a point.
    if (teamDirection(unit.team) * (unit.position.x - center.x) >= 295) {
      unit.velocity = { x: 0, y: 0, z: 0 }; updateRecovery(ai.recovery, unit.position, mission.tick, false); return;
    }
    if (distance(unit.position, center) < 85 && !occupyingBridge(unit)) {
      updateRecovery(ai.recovery, unit.position, mission.tick, distance(unit.position, goal.position) > 6, currentRoute(ai));
      if (distance(unit.position, goal.position) <= 6) unit.velocity = { x: 0, y: 0, z: 0 };
      else moveGroundUnit(unit, goal.position, others);
      return;
    }
  }
  followPath(mission, state, unit, ai, goal.position, others);
}

function aaGoal(mission: Mission, unit: Unit, ai: GroundUnitAI): { pointId: string; position: Vec3 } {
  const owned = connectedOwned(mission.points, unit.team);
  const candidates = mission.points.filter(p => owned.has(p.id)).sort((a, b) =>
    teamDirection(unit.team) * (b.position.x - a.position.x) || a.id.localeCompare(b.id));
  let front = candidates[0] ?? mission.points.find(p => p.id === homeId(unit.team))!;
  const assigned = mission.points.find(p => p.id === unit.targetPointId);
  const closeEnemy = mission.units.some(enemy => living(enemy) && enemy.team !== unit.team && enemy.kind === 'infantry'
    && distance(unit.position, enemy.position) < 150 && terrainLineOfSight(eye(unit), eye(enemy)));
  if (closeEnemy || assigned && !owned.has(assigned.id)) {
    const endangered = assigned ?? front;
    front = candidates.find(p => teamDirection(unit.team) * (p.position.x - endangered.position.x) < -100) ?? candidates.at(-1) ?? front;
    ai.assignedTick = mission.tick;
  } else if (assigned && owned.has(assigned.id) && mission.tick - ai.assignedTick < 1800) front = assigned;
  else if (unit.targetPointId !== front.id) ai.assignedTick = mission.tick;
  const index = Number(unit.id.match(/(\d+)$/)?.[1] ?? 0);
  const position = { x: front.position.x - teamDirection(unit.team) * (190 + Math.floor(index / 2) * 70), y: front.position.y,
    z: front.position.z + (index % 2 === 0 ? -1 : 1) * 105 };
  return { pointId: front.id, position };
}

/** Logical movement only. Weapons own AA aim slots, turret rotation, telegraphs and all damage. */
export function updateGroundAI(mission: Mission, state: GroundAIState): void {
  if (mission.phase !== 'running') return;
  if (state.missionId && state.missionId !== mission.id) return;
  state.missionId = mission.id;
  const invalid = Object.values(state.squads).some(squad => !assignmentValid(squad, mission));
  if (mission.tick - state.lastStrategyTick >= 60 || invalid || !Object.keys(state.squads).length) updateGroundStrategy(mission, state);
  const active = mission.units.filter(living).sort((a, b) => a.id.localeCompare(b.id));
  // A one-tick movement is below .2m. Inflated neighbouring cells preserve every
  // possible separation contact while removing the quadratic all-army scan.
  const cells = new Map<string, Unit[]>();
  for (const unit of active) if (unit.kind !== 'aircraft') {
    const key = `${Math.floor(unit.position.x / 24)},${Math.floor(unit.position.z / 24)}`;
    const occupants = cells.get(key) ?? []; occupants.push(unit); cells.set(key, occupants);
  }
  const neighbours = (unit: Unit): Unit[] => {
    const result: Unit[] = [], x = Math.floor(unit.position.x / 24), z = Math.floor(unit.position.z / 24);
    for (let ix = x - 1; ix <= x + 1; ix++) for (let iz = z - 1; iz <= z + 1; iz++) {
      const occupants = cells.get(`${ix},${iz}`); if (occupants) result.push(...occupants);
    }
    return result;
  };
  updateTraffic(state.traffic, mission.units, mission.tick);
  state.warnings = [];
  for (const unit of active) {
    if (unit.kind === 'aircraft') continue;
    const ai = unitState(state, unit, mission.tick);
    const near = neighbours(unit);
    if (unit.kind === 'infantry') stepInfantry(mission, state, unit, ai, near, active);
    else if (unit.kind === 'tank') stepTank(mission, state, unit, ai, near, active);
    else {
      const goal = aaGoal(mission, unit, ai); unit.targetPointId = goal.pointId;
      ensurePath(mission, unit, ai, goal.pointId);
      followPath(mission, state, unit, ai, goal.position, near);
    }
    if (ai.recovery.reason) state.warnings.push({ unitId: unit.id, reason: ai.recovery.reason, routeId: currentRoute(ai) });
  }
}
