/** Shared objective layout. Geographic coordinates are scaled by terrain.ts; gameplay radii remain in metres. */
export const MAP_HORIZONTAL_SCALE = 0.5;

export const MAP_POINT_LAYOUT = [
  { id: 'HA', x: -2400, z: 0, owner: 'A' },
  { id: 'P1', x: -1400, z: 0, owner: 'A' },
  { id: 'P2', x: 0, z: -900, owner: 'N' },
  { id: 'P3', x: 0, z: 0, owner: 'N' },
  { id: 'P4', x: 0, z: 900, owner: 'N' },
  { id: 'P5', x: 1400, z: 0, owner: 'B' },
  { id: 'HB', x: 2400, z: 0, owner: 'B' },
] as const;

export function scaleMapHorizontal(metres: number): number {
  return metres * MAP_HORIZONTAL_SCALE;
}
