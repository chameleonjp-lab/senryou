import type { Team, Unit, UnitKind, Vec3 } from './types';
import { CONNECTIONS } from './rules';
import { BATTLEFIELD, MAP_POINTS, UNIT_RADIUS, pointRouteDistance, walkableSurface, type RoadFeature } from './terrain';

export interface RouteValidation { valid: boolean; errors: string[]; routeLengths: Record<string, number> }
export interface GroundPath {
  waypoints: Vec3[];
  routes: { routeId: string; startIndex: number; endIndex: number }[];
  distance: number;
  targetPointId: string;
}
export interface PathOptions { seed?: number; unitId?: string; fromPointId?: string; bannedUntil?: Record<string, number>; tick?: number; alternate?: boolean }
export const GROUND_MOVEMENT = {
  infantry: { roadSpeed: 5, offroadSpeed: 5, acceleration: 6, turnSpeed: Math.PI },
  tank: { roadSpeed: 12, offroadSpeed: 8, acceleration: 3, turnSpeed: Math.PI / 6 },
  aa: { roadSpeed: 8, offroadSpeed: 5, acceleration: 2, turnSpeed: 25 * Math.PI / 180 },
} as const;

function horizontalDistance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.z - b.z); }
export function routeLength(points: readonly Vec3[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z);
  return length;
}

/** Start is refused unless all eight supply links have two independently usable vehicle routes. */
export function validateGroundRoutes(routes: readonly RoadFeature[] = BATTLEFIELD.roads): RouteValidation {
  const errors: string[] = [], routeLengths: Record<string, number> = {};
  const validRoutes = new Set<string>();
  for (const route of routes) {
    const problems: string[] = [];
    const from = MAP_POINTS.find(p => p.id === route.from), to = MAP_POINTS.find(p => p.id === route.to);
    if (!from || !to || !CONNECTIONS.some(([a, b]) => (a === route.from && b === route.to) || (b === route.from && a === route.to))) problems.push('unknown connection');
    if (route.width < 18) problems.push('road narrower than 18m');
    if (route.points.length < 2 || !from || !to || horizontalDistance(route.points[0], from.position) > 1e-6
      || horizontalDistance(route.points.at(-1)!, to.position) > 1e-6) problems.push('endpoint mismatch');
    if (route.bridgeId) {
      const bridge = BATTLEFIELD.bridges.find(b => b.id === route.bridgeId);
      if (!bridge || bridge.width < 12) problems.push('bridge missing or narrower than 12m');
    }
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      const samples = Math.max(1, Math.ceil(horizontalDistance(a, b) / 4));
      for (let sample = 0; sample <= samples; sample++) {
        const f = sample / samples, x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
        for (const kind of ['infantry', 'tank', 'aa'] as const) {
          const surface = walkableSurface(x, z, kind);
          if (!surface.walkable) problems.push(`${kind} cannot pass ${x.toFixed(1)},${z.toFixed(1)}`);
        }
        if (problems.length > 8) break;
      }
      if (problems.length > 8) break;
    }
    routeLengths[route.id] = routeLength(route.points);
    if (problems.length) errors.push(`${route.id}: ${[...new Set(problems)].join('; ')}`); else validRoutes.add(route.id);
  }
  for (const [a, b] of CONNECTIONS) {
    const alternatives = routes.filter(r => ((r.from === a && r.to === b) || (r.from === b && r.to === a)) && validRoutes.has(r.id));
    if (alternatives.length < 2) errors.push(`${a}-${b}: fewer than two valid vehicle routes`);
    if (alternatives.length >= 2 && alternatives[0].bridgeId && alternatives.every(r => r.bridgeId === alternatives[0].bridgeId)) errors.push(`${a}-${b}: alternatives depend on one bridge`);
  }
  return { valid: errors.length === 0, errors, routeLengths };
}

/** Team prefix is excluded: corresponding mirrored soldiers make the same lane choice. */
export function stableHash(seed: number, id: string): number {
  let hash = (seed ^ 2166136261) >>> 0;
  const neutralId = id.replace(/^[AB][:-]/, '');
  for (let i = 0; i < neutralId.length; i++) hash = Math.imul(hash ^ neutralId.charCodeAt(i), 16777619) >>> 0;
  return hash;
}

function chooseRoute(from: string, to: string, options: PathOptions): RoadFeature | undefined {
  const variants = BATTLEFIELD.roads.filter(r => ((r.from === from && r.to === to) || (r.from === to && r.to === from))
    && (options.bannedUntil?.[r.id] ?? 0) <= (options.tick ?? 0));
  const lane = [from, to].find(id => ['P2', 'P3', 'P4'].includes(id)) ?? 'home';
  const preferred = (stableHash(options.seed ?? 1, `${options.unitId ?? ''}:${lane}`) & 1) ^ (options.alternate ? 1 : 0);
  return variants.sort((a, b) => Number(a.variant !== preferred) - Number(b.variant !== preferred) || routeLength(a.points) - routeLength(b.points) || a.id.localeCompare(b.id))[0];
}

export function nearestPoint(position: Vec3): string {
  return [...MAP_POINTS].sort((a, b) => horizontalDistance(position, a.position) - horizontalDistance(position, b.position) || a.id.localeCompare(b.id))[0].id;
}

/** Strategic distance follows legal graph links; central points have no direct cross-link. */
export function groundRouteDistance(position: Vec3, targetPointId: string): number {
  const nearest = nearestPoint(position), node = MAP_POINTS.find(p => p.id === nearest)!;
  return horizontalDistance(position, node.position) + pointRouteDistance(nearest, targetPointId);
}

function clearConnector(kind: UnitKind, a: Vec3, b: Vec3): boolean {
  const samples = Math.max(1, Math.ceil(horizontalDistance(a, b) / 3));
  for (let i = 0; i <= samples; i++) {
    const f = i / samples;
    if (!walkableSurface(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, kind).walkable) return false;
  }
  return true;
}

interface RouteAttachment { pointId: string; waypoints: Vec3[]; routeId?: string }
function attachToRoute(kind: UnitKind, from: Vec3, options: PathOptions): RouteAttachment[] {
  if (options.fromPointId) {
    const node = MAP_POINTS.find(p => p.id === options.fromPointId);
    return node && clearConnector(kind, from, node.position) ? [{ pointId: node.id, waypoints: [{ ...from }, { ...node.position }] }] : [];
  }
  const projections: { route: RoadFeature; segment: number; projected: Vec3; distance: number }[] = [];
  for (const route of BATTLEFIELD.roads) for (let segment = 1; segment < route.points.length; segment++) {
    const a = route.points[segment - 1], b = route.points[segment];
    const dx = b.x - a.x, dz = b.z - a.z;
    const f = Math.max(0, Math.min(1, ((from.x - a.x) * dx + (from.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const projected = { x: a.x + dx * f, y: a.y + (b.y - a.y) * f, z: a.z + dz * f };
    projections.push({ route, segment, projected, distance: horizontalDistance(from, projected) });
  }
  projections.sort((a, b) => a.distance - b.distance || a.route.id.localeCompare(b.route.id) || a.segment - b.segment);
  // Retrace a real road from its nearest reachable projection. Never reconnect
  // across the river or through a building merely because a graph node is near.
  for (const { route, segment, projected } of projections) {
    if (!clearConnector(kind, from, projected)) continue;
    return [
      { pointId: route.from, routeId: route.id, waypoints: [{ ...from }, projected, ...route.points.slice(0, segment).reverse().map(p => ({ ...p }))] },
      { pointId: route.to, routeId: route.id, waypoints: [{ ...from }, projected, ...route.points.slice(segment).map(p => ({ ...p }))] },
    ];
  }
  return [];
}

/** Dijkstra over the exact supply graph; physical routes and their bans remain independent. */
export function findGroundPath(kind: UnitKind, from: Vec3, targetPointId: string, options: PathOptions = {}): GroundPath | null {
  if (kind === 'aircraft' || !MAP_POINTS.some(p => p.id === targetPointId)) return null;
  const attachments = attachToRoute(kind, from, options);
  if (!attachments.length) return null;
  const starts = new Map(attachments.map(a => [a.pointId, a]));
  const distances = new Map<string, number>(attachments.map(a => [a.pointId, routeLength(a.waypoints)]));
  const predecessors = new Map<string, { pointId: string; route: RoadFeature }>();
  const open = new Set<string>(attachments.map(a => a.pointId));
  while (open.size) {
    const current = [...open].sort((a, b) => distances.get(a)! - distances.get(b)! || a.localeCompare(b))[0];
    open.delete(current);
    if (current === targetPointId) break;
    for (const [a, b] of CONNECTIONS) {
      const next = a === current ? b : b === current ? a : null;
      if (!next) continue;
      const route = chooseRoute(current, next, options);
      if (!route) continue;
      const distance = distances.get(current)! + routeLength(route.points);
      if (distance < (distances.get(next) ?? Infinity) - 1e-6) {
        distances.set(next, distance); predecessors.set(next, { pointId: current, route }); open.add(next);
      }
    }
  }
  if (!distances.has(targetPointId)) return null;
  const steps: { pointId: string; route: RoadFeature }[] = [];
  let root = targetPointId;
  for (let current = targetPointId; predecessors.has(current);) {
    const previous = predecessors.get(current);
    if (!previous) return null;
    steps.unshift(previous); current = previous.pointId; root = current;
  }
  const start = starts.get(root);
  if (!start) return null;
  const waypoints: Vec3[] = [];
  for (const waypoint of start.waypoints) if (!waypoints.length || horizontalDistance(waypoints.at(-1)!, waypoint) > 0.1) waypoints.push({ ...waypoint });
  const routeSteps: GroundPath['routes'] = [];
  if (start.routeId && waypoints.length > 1) routeSteps.push({ routeId: start.routeId, startIndex: 0, endIndex: waypoints.length - 1 });
  for (const step of steps) {
    const forward = step.route.from === step.pointId;
    const vertices = forward ? step.route.points : [...step.route.points].reverse();
    const startIndex = waypoints.length - 1;
    for (let i = 1; i < vertices.length; i++) waypoints.push({ ...vertices[i] });
    routeSteps.push({ routeId: step.route.id, startIndex, endIndex: waypoints.length - 1 });
  }
  return { waypoints, routes: routeSteps, targetPointId, distance: routeLength(waypoints) };
}

export interface TrafficRequest { unitId: string; direction: -1 | 1; requestedTick: number; lastRequestedTick?: number }
export interface CorridorOccupant { unitId: string; direction: -1 | 1; grantedTick: number; entered: boolean; lostTick?: number }
export interface CorridorState { direction: -1 | 0 | 1; lastDirection: -1 | 1; admitted: number; occupants: Record<string, CorridorOccupant>; queue: TrafficRequest[] }
export interface TrafficState { corridors: Record<string, CorridorState> }
export function createTrafficState(): TrafficState { return { corridors: {} }; }

/** Entered traffic keeps precedence. Once a convoy clears, queued directions alternate. */
export function requestCorridor(state: TrafficState, corridorId: string, unitId: string, direction: -1 | 1, tick: number): boolean {
  const corridor = state.corridors[corridorId] ??= { direction: 0, lastDirection: -1, admitted: 0, occupants: {}, queue: [] };
  if (corridor.occupants[unitId]) return true;
  const queued = corridor.queue.find(r => r.unitId === unitId);
  if (queued) {
    if (queued.direction !== direction) { queued.direction = direction; queued.requestedTick = tick; }
    queued.lastRequestedTick = tick;
  } else corridor.queue.push({ unitId, direction, requestedTick: tick, lastRequestedTick: tick });
  corridor.queue.sort((a, b) => a.requestedTick - b.requestedTick || a.unitId.localeCompare(b.unitId));
  if (!Object.keys(corridor.occupants).length) {
    const alternate = corridor.queue.find(r => r.direction !== corridor.lastDirection);
    const first = alternate ?? corridor.queue[0];
    if (!first) return false;
    corridor.direction = first.direction; corridor.admitted = 0;
  }
  if (corridor.direction !== direction || (corridor.admitted >= 4 && corridor.queue.some(r => r.direction !== direction))) return false;
  const next = corridor.queue.find(r => r.direction === direction);
  if (next?.unitId !== unitId) return false;
  corridor.occupants[unitId] = { unitId, direction, grantedTick: tick, entered: false };
  corridor.queue = corridor.queue.filter(r => r.unitId !== unitId); corridor.admitted++;
  return true;
}

export function enterCorridor(state: TrafficState, corridorId: string, unitId: string): void {
  const occupant = state.corridors[corridorId]?.occupants[unitId];
  if (occupant) occupant.entered = true;
}
export function leaveCorridor(state: TrafficState, corridorId: string, unitId: string): void {
  const corridor = state.corridors[corridorId];
  if (!corridor) return;
  delete corridor.occupants[unitId]; corridor.queue = corridor.queue.filter(r => r.unitId !== unitId);
  if (!Object.keys(corridor.occupants).length) { if (corridor.direction) corridor.lastDirection = corridor.direction; corridor.direction = 0; }
}

export function updateTraffic(state: TrafficState, units: readonly Unit[], tick: number): void {
  const lookup = new Map(units.map(u => [u.id, u]));
  for (const [id, corridor] of Object.entries(state.corridors)) {
    const bridge = BATTLEFIELD.bridges.find(b => b.id === id);
    for (const [unitId, occupant] of Object.entries(corridor.occupants)) {
      const unit = lookup.get(unitId);
      if (!unit || unit.state !== 'active' || unit.hp <= 0) {
        occupant.lostTick ??= tick;
        if (tick - occupant.lostTick >= 180) leaveCorridor(state, id, unitId);
        continue;
      }
      if (bridge) {
        const dx = unit.position.x - bridge.center.x, dz = unit.position.z - bridge.center.z;
        const along = dx * Math.cos(bridge.yaw) + dz * Math.sin(bridge.yaw);
        const across = -dx * Math.sin(bridge.yaw) + dz * Math.cos(bridge.yaw);
        const radius = UNIT_RADIUS[unit.kind];
        if (Math.abs(along) < bridge.length / 2 + radius && Math.abs(across) < bridge.width / 2 + radius) occupant.entered = true;
        // A retreat through the entrance clears the bridge as surely as an exit.
        if (occupant.entered && (Math.abs(along) > bridge.length / 2 + radius + 4 || Math.abs(across) > bridge.width / 2 + radius + 4)) leaveCorridor(state, id, unitId);
        // A reservation that cannot reach the mouth must not lock a whole front forever.
        else if (!occupant.entered && tick - occupant.grantedTick > 300) leaveCorridor(state, id, unitId);
      }
    }
    corridor.queue = corridor.queue.filter(r => {
      const u = lookup.get(r.unitId); return u?.state === 'active' && u.hp > 0 && tick - (r.lastRequestedTick ?? r.requestedTick) < 180;
    });
  }
}

export interface RecoveryState {
  checkpoint: Vec3; checkpointTick: number; stuckSince: number | null;
  mode: 'moving' | 'reversing' | 'reroute' | 'waiting'; modeUntil: number;
  bannedUntil: Record<string, number>; alternate: boolean; reason: string;
}
export function createRecoveryState(position: Vec3, tick: number): RecoveryState {
  return { checkpoint: { ...position }, checkpointTick: tick, stuckSince: null, mode: 'moving', modeUntil: 0, bannedUntil: {}, alternate: false, reason: '' };
}

/** Intentional combat/capture waits never accumulate a false stuck timer. */
export function updateRecovery(state: RecoveryState, position: Vec3, tick: number, shouldMove: boolean, routeId?: string): void {
  for (const [id, until] of Object.entries(state.bannedUntil)) if (until <= tick) delete state.bannedUntil[id];
  if (!shouldMove) {
    state.checkpoint = { ...position }; state.checkpointTick = tick; state.stuckSince = null;
    state.mode = 'moving'; state.reason = ''; return;
  }
  if (horizontalDistance(position, state.checkpoint) >= 10) {
    state.checkpoint = { ...position }; state.checkpointTick = tick; state.stuckSince = null;
    state.mode = 'moving'; state.reason = ''; return;
  }
  if (tick - state.checkpointTick >= 300 && state.stuckSince === null) {
    state.stuckSince = state.checkpointTick; state.mode = 'reversing'; state.modeUntil = tick + 120;
    state.reason = '経路閉塞・後退';
  }
  if (state.mode === 'reversing' && tick >= state.modeUntil) {
    state.mode = 'reroute'; state.alternate = !state.alternate; state.reason = '迂回路を再探索';
  }
  if (state.stuckSince !== null && tick - state.stuckSince >= 1200) {
    if (routeId) state.bannedUntil[routeId] = tick + 1800;
    state.mode = 'reroute'; state.reason = '閉塞辺を30秒回避';
    state.stuckSince = null; state.checkpoint = { ...position }; state.checkpointTick = tick;
  }
}

export function angleDelta(to: number, from: number): number {
  let angle = (to - from) % (Math.PI * 2);
  if (angle > Math.PI) angle -= Math.PI * 2;
  if (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

/** Individual formation slots come from immutable IDs, not the number of survivors. */
export function formationOffset(unit: Unit): { lateral: number; longitudinal: number } {
  if (unit.kind !== 'infantry') return { lateral: 0, longitudinal: 0 };
  const tail = unit.id.match(/(\d+)$/)?.[1];
  const slot = tail ? Number(tail) % 6 : stableHash(0, unit.id) % 6;
  return { lateral: slot % 2 === 0 ? -2.4 : 2.4, longitudinal: Math.floor(slot / 2) * 3.5 };
}

/** Vehicles slow and separate; no contact damage, pushing, trampling, or warping. */
export function moveGroundUnit(unit: Unit, goal: Vec3, others: readonly Unit[], reverse = false): boolean {
  if (unit.kind === 'aircraft') return false;
  const movement = GROUND_MOVEMENT[unit.kind], dt = 1 / 60;
  const dx = goal.x - unit.position.x, dz = goal.z - unit.position.z, distance = Math.hypot(dx, dz);
  const oldSpeed = Math.hypot(unit.velocity.x, unit.velocity.z);
  if (distance < 0.25) { unit.velocity = { x: 0, y: 0, z: 0 }; return false; }
  let steerX = dx / distance, steerZ = dz / distance;
  if (!reverse) {
    const leftX = -steerZ, leftZ = steerX;
    let avoidance = 0;
    for (const other of others) {
      if (other === unit || other.state !== 'active' || other.hp <= 0 || other.kind === 'aircraft') continue;
      const ox = other.position.x - unit.position.x, oz = other.position.z - unit.position.z;
      const separation = UNIT_RADIUS[unit.kind] + UNIT_RADIUS[other.kind] + 0.8;
      if (ox * ox + oz * oz > (separation + 9) ** 2) continue;
      const along = ox * steerX + oz * steerZ, across = ox * leftX + oz * leftZ;
      if (along <= 0 || Math.abs(across) >= separation + 1) continue;
      let side = Math.abs(across) > 0.1 ? -Math.sign(across) : (stableHash(0, unit.id) & 1 ? 1 : -1) * teamDirection(unit.team);
      const lateral = separation + 1.5;
      const clear = (s: number) => walkableSurface(unit.position.x + leftX * s * lateral,
        unit.position.z + leftZ * s * lateral, unit.kind).walkable;
      if (!clear(side)) { if (!clear(-side)) continue; side = -side; }
      const force = side * (1 - Math.abs(across) / (separation + 1)) * Math.max(0, 1 - Math.max(0, along - separation) / 9) * 1.8;
      if (Math.abs(force) > Math.abs(avoidance)) avoidance = force;
    }
    steerX += leftX * avoidance; steerZ += leftZ * avoidance;
  }
  let wantedHeading = Math.atan2(-steerX, -steerZ);
  if (reverse) wantedHeading += Math.PI;
  const turn = angleDelta(wantedHeading, unit.heading);
  unit.heading += Math.max(-movement.turnSpeed * dt, Math.min(movement.turnSpeed * dt, turn));
  const surface = walkableSurface(unit.position.x, unit.position.z, unit.kind);
  const maximum = (surface.road ? movement.roadSpeed : movement.offroadSpeed) * (reverse ? 0.45 : 1);
  const turning = Math.max(0, Math.cos(angleDelta(wantedHeading, unit.heading)));
  let speed = Math.min(maximum * turning, oldSpeed + movement.acceleration * dt, distance / dt);
  const sign = reverse ? -1 : 1;
  const vx = -Math.sin(unit.heading) * sign, vz = -Math.cos(unit.heading) * sign;
  const clearance = UNIT_RADIUS[unit.kind];
  for (const other of others) {
    if (other === unit || other.state !== 'active' || other.hp <= 0 || other.kind === 'aircraft') continue;
    const ox = other.position.x - unit.position.x, oz = other.position.z - unit.position.z;
    const separation = clearance + UNIT_RADIUS[other.kind] + 0.35;
    if (ox * ox + oz * oz >= (separation + 6) ** 2) continue;
    const along = ox * vx + oz * vz, across = Math.abs(ox * vz - oz * vx);
    if (along > 0 && across < separation) {
      const near = along - Math.sqrt(Math.max(0, separation * separation - across * across));
      speed = Math.min(speed, Math.max(0, near * 1.8));
    }
  }
  const next = { x: unit.position.x + vx * speed * dt, y: unit.position.y, z: unit.position.z + vz * speed * dt };
  const nextSurface = walkableSurface(next.x, next.z, unit.kind);
  if (!nextSurface.walkable) { unit.velocity = { x: 0, y: 0, z: 0 }; return false; }
  for (const other of others) {
    if (other === unit || other.state !== 'active' || other.hp <= 0 || other.kind === 'aircraft') continue;
    const min = clearance + UNIT_RADIUS[other.kind] + 0.05;
    const after = (next.x - other.position.x) ** 2 + (next.z - other.position.z) ** 2;
    if (after >= min * min) continue;
    const before = (unit.position.x - other.position.x) ** 2 + (unit.position.z - other.position.z) ** 2;
    if (after < before - 1e-7) { unit.velocity = { x: 0, y: 0, z: 0 }; return false; }
  }
  const oldY = unit.position.y;
  next.y = nextSurface.height;
  unit.position = next; unit.velocity = { x: vx * speed, y: (next.y - oldY) / dt, z: vz * speed };
  return speed > 0.01;
}

export function teamDirection(team: Team): number { return team === 'A' ? 1 : -1; }
