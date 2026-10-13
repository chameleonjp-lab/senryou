import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { BATTLEFIELD, terrainHeight, terrainNormal, walkableSurface } from '../src/battle/terrain';

test('road-height acceleration preserves the approved terrain, slopes and vehicle surfaces at blend boundaries', () => {
  const points: [number, number][] = [];
  for (let x = -1700; x <= 1700; x += 85) for (let z = -1250; z <= 1250; z += 100) points.push([x, z]);
  for (const road of BATTLEFIELD.roads) for (let index = 1; index < road.points.length; index++) {
    const a = road.points[index - 1], b = road.points[index], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    for (const offset of [11.999, 12, 12.001, 35.999, 36, 36.001]) for (const sign of [-1, 1])
      points.push([(a.x + b.x) / 2 - sign * dz / length * offset, (a.z + b.z) / 2 + sign * dx / length * offset]);
  }
  const rows = points.map(([x, z]) => ({ x, z, height: terrainHeight(x, z), normal: terrainNormal(x, z),
    infantry: walkableSurface(x, z, 'infantry'), tank: walkableSurface(x, z, 'tank') }));
  assert.equal(rows.length, 1570);
  // Captured from the approved ten-minute map before the acceleration change.
  // JSON represents either sign of zero as 0; every other number is preserved.
  assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    'd0818b92909cc3833c09e790ad0c73e08358104ad809f3e2ab33270e971a98c1');
});
