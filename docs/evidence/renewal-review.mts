import { execFileSync } from 'node:child_process';
import { createBattle } from '../../src/battle/simulation.ts';
import { createGroundAI, updateGroundStrategy } from '../../src/battle/ground-ai.ts';
const m = createBattle(1, 'easy', 'A', true).mission, state = createGroundAI(m);
m.tick = 0; updateGroundStrategy(m, state);
const squads = Object.values(state.squads).filter(s => s.team === 'A').sort((a, b) => a.id.localeCompare(b.id));
for (let index = 0; index < squads.length; index++) {
  const s = squads[index], target = index < 2 ? 'HA' : index < 5 ? 'P2' : index < 8 ? 'P3' : 'P4';
  s.targetPointId = target; s.role = index < 2 ? 'defend' : 'advance'; s.assignedTick = 0;
  const p = m.points.find(p => p.id === target)!;
  for (const id of s.members) {
    const u = m.units.find(u => u.id === id)!;
    u.position = { x: p.position.x - (target === 'HA' ? 0 : 100), y: p.position.y, z: p.position.z };
  }
}
const before = squads.map(s => [s.id, s.targetPointId]);
m.tick = 1800; updateGroundStrategy(m, state);
const after = squads.map(s => [s.id, s.targetPointId]);
console.log(JSON.stringify({ sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceChanges: execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim(), before, after, changed: after.filter((row, i) => row[1] !== before[i][1]) }, null, 2));
