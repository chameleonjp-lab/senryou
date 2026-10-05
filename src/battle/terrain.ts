import type { CapturePoint, Mission, SpawnResolver, Team, Unit, UnitKind, Vec3 } from './types';
import { CONNECTIONS } from './rules';

/** Metres, x east / z south. These definitions belong to the simulation, not LOD. */
export interface BoxFeature { id: string; center: Vec3; size: Vec3; yaw: number }
export interface BridgeFeature { id: string; center: Vec3; length: number; width: number; thickness: number; yaw: number }
export interface RoadFeature { id: string; from: string; to: string; variant: number; width: number; points: Vec3[]; bridgeId?: string }
export interface HillFeature { id: string; x: number; z: number; radius: number; height: number }
export interface RiverFeature { id: string; minX: number; maxX: number; minZ: number; maxZ: number; waterY: number }
export interface TrenchFeature { id: string; minX: number; maxX: number; z: number; width: number; depth: number }
export interface TerrainHit { t: number; position: Vec3; normal: Vec3; colliderId: string }
export interface TerrainSweepOptions { ignoreColliderId?: string; ignoreInitialContact?: boolean }
export interface GroundSurface { height: number; walkable: boolean; road: boolean; waterDepth: number; slopeDegrees: number; colliderId: string }

const LAND_Y = 12;
const point = (x: number, z: number): Vec3 => ({ x, y: LAND_Y, z });
export const MAP_POINTS = [
  { id: 'HA', position: point(-2400, 0) }, { id: 'P1', position: point(-1400, 0) },
  { id: 'P2', position: point(0, -900) }, { id: 'P3', position: point(0, 0) },
  { id: 'P4', position: point(0, 900) }, { id: 'P5', position: point(1400, 0) },
  { id: 'HB', position: point(2400, 0) },
] as const;
const pointById = new Map<string, Vec3>(MAP_POINTS.map(p => [p.id, p.position]));
const roads: RoadFeature[] = [];
const bridges: BridgeFeature[] = [];

// Each central connection has its own pair of indestructible river crossings.
// A blocked crossing therefore never becomes the sole route to a front.
for (const [from, to] of CONNECTIONS) {
  const a = pointById.get(from)!;
  const b = pointById.get(to)!;
  const central = from !== 'HA' && to !== 'HB';
  for (let variant = 0; variant < 2; variant++) {
    const id = `${from}-${to}:${variant}`;
    if (!central) {
      roads.push({ id, from, to, variant, width: 24, points: variant === 0
        ? [{ ...a }, { ...b }]
        : [{ ...a }, point((a.x + b.x) / 2, 160), { ...b }] });
      continue;
    }
    const riverX = a.x < 0 ? -620 : 620;
    const f = (riverX - a.x) / (b.x - a.x);
    const baseZ = a.z + (b.z - a.z) * f;
    const lane = from === 'P1' ? to : from;
    const offset = variant === 0 ? 0 : lane === 'P2' ? -120 : lane === 'P4' ? 120 : 150;
    const yaw = Math.atan2(b.z - a.z, b.x - a.x);
    const length = 120 / Math.cos(yaw);
    const bridgeId = `bridge-${id}`;
    const center = point(riverX, baseZ + offset);
    bridges.push({ id: bridgeId, center, length, width: 18, thickness: 2, yaw });
    const approach = length / 2 + 25;
    const entry = point(center.x - Math.cos(yaw) * approach, center.z - Math.sin(yaw) * approach);
    const exit = point(center.x + Math.cos(yaw) * approach, center.z + Math.sin(yaw) * approach);
    roads.push({ id, from, to, variant, width: 24, bridgeId, points: [{ ...a }, entry, exit, { ...b }] });
  }
}

const hills: HillFeature[] = [
  { id: 'hill-nw', x: -2600, z: -1450, radius: 650, height: 95 },
  { id: 'hill-ne', x: 2600, z: -1450, radius: 650, height: 95 },
  { id: 'hill-sw', x: -2600, z: 1500, radius: 720, height: 115 },
  { id: 'hill-se', x: 2600, z: 1500, radius: 720, height: 115 },
  { id: 'hill-west', x: -1020, z: -1600, radius: 390, height: 58 },
  { id: 'hill-east', x: 1020, z: -1600, radius: 390, height: 58 },
  { id: 'hill-south', x: 0, z: 2080, radius: 570, height: 88 },
];
const rivers: RiverFeature[] = [
  { id: 'river-west', minX: -656, maxX: -584, minZ: -2200, maxZ: 2200, waterY: 0 },
  { id: 'river-east', minX: 584, maxX: 656, minZ: -2200, maxZ: 2200, waterY: 0 },
  { id: 'river-north', minX: -656, maxX: 656, minZ: -2236, maxZ: -2164, waterY: 0 },
];
const trenches: TrenchFeature[] = [
  { id: 'trench-west-north', minX: -2050, maxX: -1100, z: -370, width: 10, depth: 0.4 },
  { id: 'trench-east-north', minX: 1100, maxX: 2050, z: -370, width: 10, depth: 0.4 },
  { id: 'trench-west-south', minX: -2050, maxX: -1100, z: 370, width: 10, depth: 0.4 },
  { id: 'trench-east-south', minX: 1100, maxX: 2050, z: 370, width: 10, depth: 0.4 },
];
const buildings: BoxFeature[] = [];
for (const sign of [-1, 1]) {
  for (const [i, spec] of [
    [1810, 210, 30, 15, 20], [1910, -180, 44, 20, 26],
    [1080, 410, 26, 12, 32], [1050, -410, 32, 17, 24],
    [2340, 170, 36, 20, 30], [2460, -180, 48, 15, 24],
  ].entries()) {
    const [x, z, sx, sy, sz] = spec;
    buildings.push({ id: `building-${sign < 0 ? 'west' : 'east'}-${i}`,
      center: { x: x * sign, y: LAND_Y + sy / 2, z }, size: { x: sx, y: sy, z: sz }, yaw: 0 });
  }
}

export const BATTLEFIELD = {
  bounds: { minX: -4500, maxX: 4500, minZ: -3000, maxZ: 3000, maxY: 2500 },
  points: MAP_POINTS, roads, bridges, buildings, hills, rivers, trenches,
};

let pointDistances: Record<string, Record<string, number>> | undefined;
/** Shared physical route cost for strategic assignments and reinforcement source selection. */
export function pointRouteDistance(fromId: string, toId: string): number {
  if (!pointDistances) {
    const costs: Record<string, Record<string, number>> = {};
    for (const from of MAP_POINTS) {
      costs[from.id] = {};
      for (const to of MAP_POINTS) costs[from.id][to.id] = from.id === to.id ? 0 : Infinity;
    }
    for (const road of roads) {
      let length = 0;
      for (let i = 1; i < road.points.length; i++) length += Math.hypot(road.points[i].x - road.points[i - 1].x,
        road.points[i].y - road.points[i - 1].y, road.points[i].z - road.points[i - 1].z);
      costs[road.from][road.to] = Math.min(costs[road.from][road.to], length);
      costs[road.to][road.from] = Math.min(costs[road.to][road.from], length);
    }
    for (const via of MAP_POINTS) for (const from of MAP_POINTS) for (const to of MAP_POINTS) {
      costs[from.id][to.id] = Math.min(costs[from.id][to.id], costs[from.id][via.id] + costs[via.id][to.id]);
    }
    pointDistances = costs;
  }
  return pointDistances[fromId]?.[toId] ?? Infinity;
}

function distanceToSegment(x: number, z: number, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const f = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - dx * f, z - a.z - dz * f);
}

export function roadAt(x: number, z: number): RoadFeature | null {
  for (const road of roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], radius = road.width / 2;
    if (x < Math.min(a.x, b.x) - radius || x > Math.max(a.x, b.x) + radius
      || z < Math.min(a.z, b.z) - radius || z > Math.max(a.z, b.z) + radius) continue;
    if (distanceToSegment(x, z, a, b) <= radius) return road;
  }
  return null;
}

/** Ground underneath bridges, including the river bed. Bridge decks are separate closed solids. */
export function terrainHeight(x: number, z: number): number {
  for (const river of rivers) {
    if (x >= river.minX && x <= river.maxX && z >= river.minZ && z <= river.maxZ) {
      const bank = Math.min(x - river.minX, river.maxX - x, z - river.minZ, river.maxZ - z);
      return LAND_Y - 20 * Math.min(1, bank / 12);
    }
  }
  let height = LAND_Y;
  for (const hill of hills) {
    const r2 = ((x - hill.x) ** 2 + (z - hill.z) ** 2) / hill.radius ** 2;
    if (r2 < 1) height += hill.height * (1 - r2) ** 2;
  }
  for (const trench of trenches) if (x >= trench.minX && x <= trench.maxX) {
    const f = Math.abs(z - trench.z) / (trench.width / 2);
    if (f < 1) height -= trench.depth * (1 - f * f) ** 2;
  }
  if (height !== LAND_Y) {
    let distance = Infinity;
    for (const road of roads) for (let i = 1; i < road.points.length; i++) {
      distance = Math.min(distance, distanceToSegment(x, z, road.points[i - 1], road.points[i]));
    }
    // Flat 24m road, then a smooth embankment. It cannot flatten the deep river.
    const blend = Math.max(0, Math.min(1, (distance - 12) / 24));
    height = LAND_Y + (height - LAND_Y) * blend * blend * (3 - 2 * blend);
  }
  return height;
}

export function terrainNormal(x: number, z: number): Vec3 {
  const dx = (terrainHeight(x + 0.25, z) - terrainHeight(x - 0.25, z)) / 0.5;
  const dz = (terrainHeight(x, z + 0.25) - terrainHeight(x, z - 0.25)) / 0.5;
  const length = Math.hypot(dx, 1, dz);
  return { x: -dx / length, y: 1 / length, z: -dz / length };
}

function localHorizontal(p: Pick<Vec3, 'x' | 'z'>, center: Vec3, yaw: number): { x: number; z: number } {
  const x = p.x - center.x, z = p.z - center.z;
  return { x: x * Math.cos(yaw) + z * Math.sin(yaw), z: -x * Math.sin(yaw) + z * Math.cos(yaw) };
}

export function bridgeAt(x: number, z: number, margin = 0): BridgeFeature | null {
  for (const bridge of bridges) {
    const p = localHorizontal({ x, z }, bridge.center, bridge.yaw);
    if (Math.abs(p.x) <= bridge.length / 2 && Math.abs(p.z) <= bridge.width / 2 - margin) return bridge;
  }
  return null;
}

export const UNIT_RADIUS: Record<UnitKind, number> = { infantry: 0.45, tank: 3.4, aa: 2.8, aircraft: 6 };

export function walkableSurface(x: number, z: number, kind: UnitKind = 'infantry'): GroundSurface {
  const radius = UNIT_RADIUS[kind];
  const bridge = bridgeAt(x, z, radius);
  const height = bridge ? bridge.center.y : terrainHeight(x, z);
  const normal = bridge ? { x: 0, y: 1, z: 0 } : terrainNormal(x, z);
  const slopeDegrees = Math.acos(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI;
  let waterDepth = 0;
  if (!bridge) for (const river of rivers) if (x >= river.minX && x <= river.maxX && z >= river.minZ && z <= river.maxZ) {
    waterDepth = Math.max(waterDepth, river.waterY - height);
  }
  const bounds = BATTLEFIELD.bounds;
  let walkable = x >= bounds.minX + radius && x <= bounds.maxX - radius && z >= bounds.minZ + radius && z <= bounds.maxZ - radius
    && slopeDegrees <= (kind === 'infantry' ? 35 : 20) + 1e-7 && waterDepth <= (kind === 'infantry' ? 0.8 : 0.5);
  for (const building of buildings) {
    const p = localHorizontal({ x, z }, building.center, building.yaw);
    if (Math.abs(p.x) <= building.size.x / 2 + radius && Math.abs(p.z) <= building.size.z / 2 + radius) walkable = false;
  }
  return { height, walkable, road: Boolean(bridge || roadAt(x, z)), waterDepth, slopeDegrees, colliderId: bridge?.id ?? 'terrain' };
}

const solidBoxes: BoxFeature[] = [...buildings];
for (const bridge of bridges) {
  solidBoxes.push({ id: bridge.id, center: { ...bridge.center, y: bridge.center.y - bridge.thickness / 2 },
    size: { x: bridge.length, y: bridge.thickness, z: bridge.width }, yaw: bridge.yaw });
  for (const side of [-1, 1]) {
    const lateral = side * (bridge.width / 2 - 0.3);
    solidBoxes.push({ id: `${bridge.id}:rail:${side}`, center: {
      x: bridge.center.x - Math.sin(bridge.yaw) * lateral,
      y: bridge.center.y + 0.45, z: bridge.center.z + Math.cos(bridge.yaw) * lateral,
    }, size: { x: bridge.length, y: 0.9, z: 0.6 }, yaw: bridge.yaw });
  }
}
export const TERRAIN_SOLIDS: readonly BoxFeature[] = solidBoxes;

function sweepBox(from: Vec3, to: Vec3, box: BoxFeature, radius: number): TerrainHit | null {
  const a = localHorizontal(from, box.center, box.yaw), b = localHorizontal(to, box.center, box.yaw);
  const start = [a.x, from.y - box.center.y, a.z];
  const delta = [b.x - a.x, to.y - from.y, b.z - a.z];
  const half = [box.size.x / 2 + radius, box.size.y / 2 + radius, box.size.z / 2 + radius];
  let near = 0, far = 1, axis = -1, sign = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(delta[i]) < 1e-12) { if (Math.abs(start[i]) > half[i]) return null; continue; }
    let enter = (-half[i] - start[i]) / delta[i], leave = (half[i] - start[i]) / delta[i];
    const normalSign = delta[i] > 0 ? -1 : 1;
    if (enter > leave) [enter, leave] = [leave, enter];
    if (enter > near) { near = enter; axis = i; sign = normalSign; }
    far = Math.min(far, leave);
    if (near > far) return null;
  }
  if (far < 0 || near > 1) return null;
  const t = Math.max(0, near);
  if (axis < 0) {
    // Starting inside: choose the nearest face rather than an arbitrary upwards normal.
    axis = 0;
    for (let i = 1; i < 3; i++) if (half[i] - Math.abs(start[i]) < half[axis] - Math.abs(start[axis])) axis = i;
    sign = start[axis] >= 0 ? 1 : -1;
  }
  const local = [0, 0, 0]; local[axis] = sign;
  return { t, position: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t },
    normal: { x: local[0] * Math.cos(box.yaw) - local[2] * Math.sin(box.yaw), y: local[1],
      z: local[0] * Math.sin(box.yaw) + local[2] * Math.cos(box.yaw) }, colliderId: box.id };
}

function leavingInitialFace(from: Vec3, to: Vec3, box: BoxFeature, radius: number, normal: Vec3): boolean {
  const local = localHorizontal(from, box.center, box.yaw);
  const gaps = [box.size.x / 2 + radius - Math.abs(local.x), box.size.y / 2 + radius - Math.abs(from.y - box.center.y),
    box.size.z / 2 + radius - Math.abs(local.z)];
  // Ignoring a touching face is safe only at that face and moving outwards or tangent.
  // Starting inside, or moving into the wall, still blocks at t=0.
  return Math.min(...gaps) <= 1e-6 && (to.x - from.x) * normal.x + (to.y - from.y) * normal.y + (to.z - from.z) * normal.z >= -1e-10;
}

/** Earliest contact with ground or a closed building/bridge, including side and bottom faces. */
export function sweepTerrain(from: Vec3, to: Vec3, radius = 0, options: TerrainSweepOptions = {}): TerrainHit | null {
  let first: TerrainHit | null = null;
  for (const box of solidBoxes) {
    const extent = Math.hypot(box.size.x, box.size.z) / 2 + radius;
    if (Math.max(from.x, to.x) < box.center.x - extent || Math.min(from.x, to.x) > box.center.x + extent
      || Math.max(from.z, to.z) < box.center.z - extent || Math.min(from.z, to.z) > box.center.z + extent
      || Math.min(from.y, to.y) > box.center.y + box.size.y / 2 + radius
      || Math.max(from.y, to.y) < box.center.y - box.size.y / 2 - radius) continue;
    const hit = sweepBox(from, to, box, radius);
    if (!hit || (hit.t <= 1e-7 && options.ignoreInitialContact && (!options.ignoreColliderId || options.ignoreColliderId === hit.colliderId)
      && leavingInitialFace(from, to, box, radius, hit.normal))) continue;
    if (!first || hit.t < first.t - 1e-10 || (Math.abs(hit.t - first.t) <= 1e-10 && hit.colliderId < first.colliderId)) first = hit;
  }
  // No part of the heightfield reaches the air above 140m.
  if (Math.min(from.y, to.y) - radius > 140) return first;
  const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const steps = Math.max(1, Math.ceil(distance / 6));
  const gap = (t: number) => {
    const x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
    return from.y + (to.y - from.y) * t - radius - terrainHeight(x, z);
  };
  let previousT = 0, previousGap = gap(0);
  const leavingGround = previousGap >= -1e-6 && gap(Math.min(1, 0.001 / (distance || 1))) > previousGap + 1e-10;
  if (previousGap <= 1e-7 && !(options.ignoreInitialContact && leavingGround)) {
    const ground: TerrainHit = { t: 0, position: { ...from }, normal: terrainNormal(from.x, from.z), colliderId: 'terrain' };
    if (!first || first.t > 0 || ground.colliderId < first.colliderId) first = ground;
  } else for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (first && previousT > first.t) break;
    const currentGap = gap(t);
    if (currentGap <= 0) {
      let low = previousT, high = t;
      for (let j = 0; j < 20; j++) { const middle = (low + high) / 2; if (gap(middle) > 0) low = middle; else high = middle; }
      const p = { x: from.x + (to.x - from.x) * high, y: from.y + (to.y - from.y) * high, z: from.z + (to.z - from.z) * high };
      if (!first || high < first.t) first = { t: high, position: p, normal: terrainNormal(p.x, p.z), colliderId: 'terrain' };
      break;
    }
    previousT = t; previousGap = currentGap;
  }
  return first;
}

export function terrainLineOfSight(from: Vec3, to: Vec3, options: TerrainSweepOptions = {}): boolean {
  const hit = sweepTerrain(from, to, 0, { ignoreInitialContact: true, ...options });
  return !hit || hit.t >= 1 - 1e-7;
}

export const CAPTURE_TERRAIN = {
  heightAt: (x: number, z: number) => walkableSurface(x, z, 'infantry').height,
  walkable: (x: number, z: number) => walkableSurface(x, z, 'infantry').walkable,
};

export function applyFlightBounds(position: Vec3, velocity: Vec3): string[] {
  const b = BATTLEFIELD.bounds;
  const warnings: string[] = [];
  for (const [axis, min, max] of [['x', b.minX, b.maxX], ['z', b.minZ, b.maxZ], ['y', -Infinity, b.maxY]] as const) {
    if (position[axis] < min + 300 || position[axis] > max - 300) warnings.push(axis);
    if (position[axis] < min) { position[axis] = min; if (velocity[axis] < 0) velocity[axis] = 0; }
    if (position[axis] > max) { position[axis] = max; if (velocity[axis] > 0) velocity[axis] = 0; }
  }
  return warnings;
}

function slotInSquad(index: number): { lateral: number; longitudinal: number } {
  return { lateral: (index % 2 === 0 ? -1 : 1) * 2.4, longitudinal: Math.floor(index / 2) * 3.5 };
}

/** Initial forward 10 / rear 2 squads, 6 / 2 tanks, and 2 / 2 AA. Stable slots survive casualties. */
export function initialUnitPosition(team: Team, kind: UnitKind, index: number): Vec3 {
  const direction = team === 'A' ? 1 : -1;
  if (kind === 'aircraft') return { x: -direction * (2850 + Math.floor(index / 4) * 180), y: 600,
    z: [-720, -240, 240, 720][index % 4] };
  let x: number, z: number;
  if (kind === 'infantry') {
    const squad = Math.floor(index / 6), slot = slotInSquad(index % 6);
    const rear = squad >= 10;
    x = -direction * (1400 + (rear ? 280 : 110 + Math.floor(squad / 5) * 55) + slot.longitudinal);
    z = rear ? (squad === 10 ? -260 : 260) + slot.lateral : (squad % 5 - 2) * 65 + slot.lateral;
  } else if (kind === 'tank') {
    x = -direction * (1400 + (index >= 6 ? 290 : 190 + Math.floor(index / 3) * 35));
    z = index >= 6 ? (index === 6 ? -200 : 200) : (index % 3 - 1) * 85 + 18;
  } else {
    x = -direction * (1400 + (index >= 2 ? 270 : 150));
    z = index % 2 === 0 ? -305 : 305;
  }
  return { x, y: walkableSurface(x, z, kind).height, z };
}

export function initializeRosterPositions(mission: Mission): void {
  for (const team of ['A', 'B'] as const) for (const kind of ['infantry', 'tank', 'aa', 'aircraft'] as const) {
    const units = mission.units.filter(u => u.team === team && u.kind === kind && u.state === 'active').sort((a, b) => a.id.localeCompare(b.id));
    units.forEach((u, index) => {
      u.position = initialUnitPosition(team, kind, index);
      // Same yaw convention as the inherited aircraft: local forward is -Z.
      u.heading = team === 'A' ? -Math.PI / 2 : Math.PI / 2;
      u.velocity = kind === 'aircraft' ? { x: (team === 'A' ? 1 : -1) * 110, y: 0, z: 0 } : { x: 0, y: 0, z: 0 };
    });
  }
  for (const p of mission.points) p.position.y = walkableSurface(p.position.x, p.position.z, 'infantry').height;
}

function connectedPoints(points: readonly CapturePoint[], team: Team): Set<string> {
  const owners = new Map(points.map(p => [p.id, p.owner]));
  const home = team === 'A' ? 'HA' : 'HB';
  const connected = new Set<string>();
  if (owners.get(home) !== team) return connected;
  connected.add(home);
  const queue = [home];
  for (let i = 0; i < queue.length; i++) for (const [a, b] of CONNECTIONS) {
    const next = a === queue[i] ? b : b === queue[i] ? a : undefined;
    if (next && owners.get(next) === team && !connected.has(next)) { connected.add(next); queue.push(next); }
  }
  return connected;
}

function horizontalDistance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.z - b.z); }
function eyePosition(unit: Unit): Vec3 { return { ...unit.position, y: unit.position.y + (unit.kind === 'infantry' ? 1.4 : unit.kind === 'aa' ? 2 : 1.8) }; }

export function groundSpawnSafe(position: Vec3, unit: Unit, mission: Mission, squadPositions: readonly Vec3[] = [position]): boolean {
  const radius = UNIT_RADIUS[unit.kind];
  for (const spawn of squadPositions) {
    if (!walkableSurface(spawn.x, spawn.z, unit.kind).walkable) return false;
    for (const other of mission.units) {
      if (other.state !== 'active' || other.hp <= 0 || other.id === unit.id) continue;
      const distance = horizontalDistance(spawn, other.position);
      if (other.kind !== 'aircraft' && distance < radius + UNIT_RADIUS[other.kind] + 1) return false;
      if (other.kind === 'aircraft' && Math.hypot(spawn.x - other.position.x, spawn.y + 1 - other.position.y, spawn.z - other.position.z)
        < radius + UNIT_RADIUS.aircraft + 1) return false;
      if (other.team === unit.team || other.kind === 'aircraft') continue;
      if (distance < 100) return false;
      const range = other.kind === 'tank' ? 900 : other.kind === 'infantry' ? 250 : 0;
      if (distance <= range && (other.kind === 'tank' || unit.kind === 'infantry' || unit.kind === 'aa')
        && terrainLineOfSight(eyePosition(other), { ...spawn, y: spawn.y + 1.4 })) return false;
    }
  }
  return true;
}

export function groundSpawnCandidates(team: Team, source: CapturePoint, kind: UnitKind, slot = 0): Vec3[] {
  const direction = team === 'A' ? 1 : -1;
  const formation = kind === 'infantry' ? slotInSquad(slot % 6) : { lateral: 0, longitudinal: 0 };
  const candidates: Vec3[] = [];
  // Two mouth groups, with several separated rows to accommodate one atomic wave.
  for (const side of [-1, 1]) for (let row = 0; row < 4; row++) {
    const x = source.position.x - direction * (200 + row * 18 + formation.longitudinal);
    const z = source.position.z + side * 45 + formation.lateral;
    candidates.push({ x, y: walkableSurface(x, z, kind).height, z });
  }
  return candidates;
}

export function airSpawnCandidates(team: Team): Vec3[] {
  const direction = team === 'A' ? 1 : -1;
  return [-900, -300, 300, 900].map(z => ({ x: -direction * 2900, y: 600, z }));
}

export function airSpawnSafe(position: Vec3, unit: Unit, mission: Mission): boolean {
  if (sweepTerrain(position, position, UNIT_RADIUS.aircraft)) return false;
  for (const other of mission.units) {
    if (other.state !== 'active' || other.hp <= 0 || other.id === unit.id) continue;
    const distance = Math.hypot(position.x - other.position.x, position.y - other.position.y, position.z - other.position.z);
    if (other.kind === 'aircraft' && distance < UNIT_RADIUS.aircraft * 2 + 1) return false;
    if (other.team === unit.team) continue;
    if (other.kind === 'aircraft' && distance < 600) return false;
    if (other.kind === 'aa' && distance <= 1200 && terrainLineOfSight(eyePosition(other), position)) return false;
  }
  return true;
}

/** Called synchronously before movement/capture. The passed mission is the tick-start snapshot. */
export const resolveBattleSpawn: SpawnResolver = (unit, sourcePoint, mission) => {
  const blockedSince = unit.reservation?.blockedSince;
  if (blockedSince !== null && blockedSince !== undefined && (mission.tick - blockedSince) % 60 !== 0) return null;
  if (unit.kind === 'aircraft') {
    const enemies = mission.units.filter(u => u.state === 'active' && u.hp > 0 && u.team !== unit.team);
    const distance = (p: Vec3) => enemies.reduce((minimum, other) => Math.min(minimum,
      Math.hypot(p.x - other.position.x, p.y - other.position.y, p.z - other.position.z)), Infinity);
    const candidates = airSpawnCandidates(unit.team).map((position, index) => ({ position, index, distance: distance(position) }))
      .sort((a, b) => b.distance - a.distance || a.index - b.index);
    const position = candidates.find(c => airSpawnSafe(c.position, unit, mission))?.position ?? null;
    if (position) {
      unit.heading = unit.team === 'A' ? -Math.PI / 2 : Math.PI / 2;
      unit.velocity = { x: (unit.team === 'A' ? 1 : -1) * 110, y: 0, z: 0 };
      unit.pitch = 0; unit.bank = 0; unit.speed = 110; unit.loopProgress = -1; unit.loopCooldown = 0;
    }
    return position;
  }
  const connected = connectedPoints(mission.points, unit.team);
  const homeId = unit.team === 'A' ? 'HA' : 'HB';
  const goalId = mission.points.some(p => p.id === unit.targetPointId) ? unit.targetPointId! : unit.team === 'A' ? 'HB' : 'HA';
  const eligible = mission.points.filter(p => p.owner === unit.team && connected.has(p.id) && !p.contested
    && p.progressNumerator === 0 && p.progress === 0 && mission.tick - p.stableSince >= 600)
    .sort((a, b) => pointRouteDistance(a.id, goalId) - pointRouteDistance(b.id, goalId)
      || Number(b.id === sourcePoint) - Number(a.id === sourcePoint) || a.id.localeCompare(b.id));
  // A retained source wins equal-cost ties; every completion still rechecks safety.
  const home = eligible.find(p => p.id === homeId);
  if (home) { eligible.splice(eligible.indexOf(home), 1); eligible.push(home); }
  const squad = unit.kind === 'infantry' && unit.squadId
    ? mission.units.filter(u => u.squadId === unit.squadId && u.state === 'pending').sort((a, b) => a.id.localeCompare(b.id)) : [unit];
  const slot = Math.max(0, squad.findIndex(u => u.id === unit.id));
  for (const source of eligible) {
    const candidates = groundSpawnCandidates(unit.team, source, unit.kind, slot);
    for (let index = 0; index < candidates.length; index++) {
      // Check the whole squad before its first member is created, so a wave is not partial.
      const positions = squad.map((_, member) => groundSpawnCandidates(unit.team, source, unit.kind, member)[index]);
      if (!groundSpawnSafe(candidates[index], unit, mission, positions)) continue;
      if (unit.reservation) unit.reservation.sourcePoint = source.id;
      return candidates[index];
    }
  }
  return null;
};
