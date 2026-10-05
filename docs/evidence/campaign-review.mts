import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createBattle } from '../../src/battle/simulation.ts';
import { markLost } from '../../src/battle/scoring.ts';
import { stepMission } from '../../src/battle/mission.ts';

// Exercise the exact checked-in summary expressions without running a campaign.
const text = readFileSync('scripts/acceptance.ts', 'utf8');
const source = ts.createSourceFile('acceptance.ts', text, ts.ScriptTarget.Latest, true);
const selected = new Set(['deathsByRelativeTeam', 'relativePointIds', 'relativePointNames', 'relativeOwners']);
const expressions: string[] = [];
function visit(node: ts.Node) {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && selected.has(declaration.name.text))) expressions.push(node.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(expressions.length, 4);
const code = ts.transpileModule(expressions.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const summarize = new Function('mission', 'playerTeam', 'enemy', `${code}\nreturn { relativeOwners, deathsByRelativeTeam };`);
const summaries = [];
for (const team of ['A', 'B'] as const) {
  const mission = createBattle(1, 'normal', team, true).mission;
  const enemy = team === 'A' ? 'B' : 'A';
  mission.points.find(point => point.id === 'P2')!.owner = team;
  markLost(mission, `${team}-infantry-000`);
  markLost(mission, `${team}-infantry-001`);
  markLost(mission, `${enemy}-infantry-000`);
  stepMission(mission);
  assert.equal(mission.deaths.length, 0, 'fixture deliberately has no deaths in the summary tick');
  const summary = summarize(mission, team, enemy);
  assert.deepEqual(summary.deathsByRelativeTeam, { self: 2, enemy: 1 });
  assert.deepEqual(Object.keys(summary.relativeOwners), ['selfHome', 'selfRelay', 'north', 'center', 'south', 'enemyRelay', 'enemyHome']);
  assert.equal(summary.relativeOwners.north, 'self');
  assert.equal(summary.relativeOwners.selfHome, 'self');
  assert.equal(summary.relativeOwners.enemyHome, 'enemy');
  summaries.push(summary);
}
assert.equal(JSON.stringify(summaries[0]), JSON.stringify(summaries[1]));
console.log('PASS: exact acceptance script summary expressions normalize x-mirrored points with stable property order and retain prior-tick cumulative deaths (self2/enemy1). Campaign not run.');
