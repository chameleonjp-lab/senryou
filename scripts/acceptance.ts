import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createBattle, stepBattle, NEUTRAL_INPUT } from "../src/battle/simulation";
import { MAX_TICKS } from "../src/battle/rules";
import type { GameMode } from "../src/types";
import type { Team } from "../src/battle/types";

const ROOT = process.cwd();
const EVIDENCE_DIR = path.join(ROOT, "docs/evidence/campaign");
const FULL_SEEDS = 30;
const MODES: GameMode[] = ["easy", "normal"];
const TEAMS: Team[] = ["A", "B"];
const PROGRESS_TICKS = 6000;
const MAX_WALL_MS = 20 * 60 * 1000;

type CaseRow = {
  seed: number;
  mode: GameMode;
  playerTeam: Team;
  status: "complete" | "wall-timeout" | "error";
  ticks: number;
  wallMs: number;
  outcome: string | null;
  reason: string | null;
  resultScore: unknown;
  relativeOwners: Record<string, string>;
  relativeRemaining: unknown;
  damageEvents: number;
  damageByRelativeTeam: { self: number; enemy: number; unassigned: number };
  deathsByRelativeTeam: { self: number; enemy: number };
  firstDamageTick: number | null;
  lastDamageTick: number | null;
  longestNoDamageTicks: number;
  attackerInfantryWithin100mOfEnemyHome: boolean;
  aiOnlyProof: {
    controlEnabledFalseAtStart: boolean;
    controlledAircraftNullAtStart: boolean;
    noPlayerRolesAtStart: boolean;
    noPlayerRolesAtProgressChecks: boolean;
    noControlledAircraftAtProgressChecks: boolean;
    activeAiAircraftMoved: boolean;
  };
  progress: Array<{ tick: number; damageEvents: number; deaths: number; activeUnits: number }>;
  mirrorComparable?: unknown;
  error?: string;
};

function parseArgs(args: string[]) {
  let seedCount = 0;
  let runChecks = false;
  let runBrowser = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--full") seedCount = FULL_SEEDS;
    else if (args[i] === "--sample") {
      seedCount = Number(args[++i]);
      if (!Number.isInteger(seedCount) || seedCount < 1 || seedCount > FULL_SEEDS) throw new Error("--sample needs an integer from 1 to 30");
    } else if (args[i] === "--checks") runChecks = true;
    else if (args[i] === "--skip-browser") runBrowser = false;
    else if (args[i] === "--help") {
      console.log("Usage: node --import tsx scripts/acceptance.ts --sample <1..30> [--checks] [--skip-browser]\n       node --import tsx scripts/acceptance.ts --full [--checks] [--skip-browser]\n\n--sample N runs N seeds × 2 modes × both player-team perspectives (not a physical team-swapped replay). --full runs all 30 seeds (120 cases). The campaign is never run implicitly.");
      process.exit(0);
    } else throw new Error(`Unknown option: ${args[i]}`);
  }
  if (!seedCount) throw new Error("Choose --sample N or --full. Use --help for details.");
  return { seedCount, runChecks, runBrowser };
}

function runCheck(label: string, cmd: string, args: string[]) {
  console.log(`\n[acceptance] ${label}: ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit ${result.status}`);
}

function canonicalMirror(row: CaseRow) {
  return {
    outcome: row.outcome,
    ticks: row.ticks,
    score: row.resultScore,
    owners: row.relativeOwners,
    remaining: row.relativeRemaining,
    damageEvents: row.damageEvents,
    damageByRelativeTeam: row.damageByRelativeTeam,
    deathsByRelativeTeam: row.deathsByRelativeTeam,
    attackerInfantryWithin100mOfEnemyHome: row.attackerInfantryWithin100mOfEnemyHome,
  };
}

function runCase(seed: number, mode: GameMode, playerTeam: Team): CaseRow {
  const started = performance.now();
  const game = createBattle(seed, mode, playerTeam, true);
  const mission = game.mission;
  const aiOnlyProof = {
    controlEnabledFalseAtStart: mission.controlEnabled === false,
    controlledAircraftNullAtStart: mission.controlledAircraftId === null,
    noPlayerRolesAtStart: mission.units.every(unit => unit.role === "ai"),
    noPlayerRolesAtProgressChecks: true,
    noControlledAircraftAtProgressChecks: true,
    activeAiAircraftMoved: false,
  };
  const aircraftPositions = new Map(mission.units.filter(unit => unit.kind === "aircraft").map(unit => [unit.id, { ...unit.position }]));
  const enemyHome = mission.points.find(point => point.homeTeam && point.homeTeam !== playerTeam)!;
  let lastDamageCount = mission.score.damage.length;
  let lastActivityTick = 0;
  let longestNoDamageTicks = 0;
  let firstDamageTick: number | null = null;
  let lastDamageTick: number | null = null;
  let attackerInfantryWithin100mOfEnemyHome = false;
  const progress: CaseRow["progress"] = [];

  try {
    if (!aiOnlyProof.controlEnabledFalseAtStart || !aiOnlyProof.controlledAircraftNullAtStart || !aiOnlyProof.noPlayerRolesAtStart || game.pilot !== null) {
      throw new Error("AI-only precondition failed: control must be disabled, no pilot assigned, and every unit role must be AI");
    }
    for (let tick = 0; tick < MAX_TICKS && !mission.result; tick++) {
      stepBattle(game, NEUTRAL_INPUT);
      if (mission.score.damage.length > lastDamageCount) {
        lastDamageCount = mission.score.damage.length;
        lastActivityTick = mission.tick;
        if (firstDamageTick === null) firstDamageTick = mission.tick;
        lastDamageTick = mission.tick;
      } else {
        longestNoDamageTicks = Math.max(longestNoDamageTicks, mission.tick - lastActivityTick);
      }
      if (mission.tick % 60 === 0 && !attackerInfantryWithin100mOfEnemyHome) {
        attackerInfantryWithin100mOfEnemyHome = mission.units.some(unit => unit.team === playerTeam && unit.kind === "infantry" && unit.state === "active"
          && Math.hypot(unit.position.x - enemyHome.position.x, unit.position.y - enemyHome.position.y, unit.position.z - enemyHome.position.z) <= 100);
      }
      if (mission.tick % PROGRESS_TICKS === 0) {
        aiOnlyProof.noPlayerRolesAtProgressChecks &&= mission.units.every(unit => unit.role === "ai");
        aiOnlyProof.noControlledAircraftAtProgressChecks &&= mission.controlledAircraftId === null && game.pilot === null;
        aiOnlyProof.activeAiAircraftMoved ||= mission.units.some(unit => {
          if (unit.kind !== "aircraft" || unit.role !== "ai") return false;
          const initial = aircraftPositions.get(unit.id);
          return !!initial && Math.hypot(unit.position.x - initial.x, unit.position.y - initial.y, unit.position.z - initial.z) > 1;
        });
        progress.push({ tick: mission.tick, damageEvents: mission.score.damage.length, deaths: mission.score.deaths.size,
          activeUnits: mission.units.filter(unit => unit.state === "active").length });
        console.log(`[campaign] seed=${seed} mode=${mode} team=${playerTeam} tick=${mission.tick}/${MAX_TICKS} damage=${mission.score.damage.length} deaths=${mission.score.deaths.size}`);
      }
      if (performance.now() - started > MAX_WALL_MS) break;
    }
    longestNoDamageTicks = Math.max(longestNoDamageTicks, mission.tick - lastActivityTick);
    const enemy = playerTeam === "A" ? "B" : "A";
    const result = mission.result;
    const damageByRelativeTeam = { self: 0, enemy: 0, unassigned: 0 };
    for (const damage of mission.score.damage) {
      if (damage.sourceTeam === playerTeam) damageByRelativeTeam.self += damage.amount;
      else if (damage.sourceTeam === enemy) damageByRelativeTeam.enemy += damage.amount;
      else damageByRelativeTeam.unassigned += damage.amount;
    }
    const deathsByRelativeTeam = {
      self: mission.units.filter(unit => unit.team === playerTeam && mission.score.deaths.has(unit.id)).length,
      enemy: mission.units.filter(unit => unit.team === enemy && mission.score.deaths.has(unit.id)).length,
    };
    const relativePointIds = playerTeam === 'A'
      ? ['HA', 'P1', 'P2', 'P3', 'P4', 'P5', 'HB']
      : ['HB', 'P5', 'P2', 'P3', 'P4', 'P1', 'HA'];
    const relativePointNames = ['selfHome', 'selfRelay', 'north', 'center', 'south', 'enemyRelay', 'enemyHome'];
    const relativeOwners = Object.fromEntries(relativePointIds.map((id, index) => {
      const owner = mission.points.find(point => point.id === id)!.owner;
      return [relativePointNames[index], owner === 'N' ? 'N' : owner === playerTeam ? 'self' : 'enemy'];
    }));
    const relativeRemaining = result ? { self: result.remaining[playerTeam], enemy: result.remaining[enemy] } : null;
    const wallMs = Math.round(performance.now() - started);
    const status = wallMs > MAX_WALL_MS ? "wall-timeout" as const : result ? "complete" as const : "wall-timeout" as const;
    return {
      seed, mode, playerTeam, status, ticks: mission.tick, wallMs,
      outcome: result?.outcome ?? null, reason: result?.reason ?? null, resultScore: result?.score ?? null,
      relativeOwners, relativeRemaining, damageEvents: mission.score.damage.length, damageByRelativeTeam, deathsByRelativeTeam,
      firstDamageTick, lastDamageTick, longestNoDamageTicks, attackerInfantryWithin100mOfEnemyHome,
      aiOnlyProof, progress,
    };
  } catch (error) {
    return {
      seed, mode, playerTeam, status: "error", ticks: mission.tick, wallMs: Math.round(performance.now() - started),
      outcome: mission.result?.outcome ?? null, reason: mission.result?.reason ?? null, resultScore: mission.result?.score ?? null,
      relativeOwners: {}, relativeRemaining: null, damageEvents: mission.score.damage.length,
      damageByRelativeTeam: { self: 0, enemy: 0, unassigned: 0 }, deathsByRelativeTeam: { self: 0, enemy: 0 },
      firstDamageTick, lastDamageTick, longestNoDamageTicks, attackerInfantryWithin100mOfEnemyHome,
      aiOnlyProof, progress, error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const { seedCount, runChecks, runBrowser } = parseArgs(process.argv.slice(2));
  if (runChecks) {
    runCheck("unit tests", "npm", ["test"]);
    runCheck("typecheck and production build", "npm", ["run", "build"]);
    if (runBrowser) runCheck("Chromium browser tests", "npx", ["playwright", "test", "--project=chromium"]);
  }
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const output = path.join(EVIDENCE_DIR, seedCount === FULL_SEEDS ? "ai-only-30-seeds.json" : `ai-only-sample-${seedCount}-seeds.json`);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const record = {
    startedAt: new Date().toISOString(), candidateHead: head,
    fixedSourceHeads: { kaisen: "3d751051dc6212482a129e8da596ddd349b2f9f5", fightflight: "c2b313d37875b93458032d98636fcf5b5d30a138" },
    rules: { campaignSeeds: seedCount, modes: MODES, playerTeams: TEAMS, casesExpected: seedCount * MODES.length * TEAMS.length,
      maxSimulationTicks: MAX_TICKS, progressIntervalTicks: PROGRESS_TICKS, aiOnly: "createBattle(seed, mode, team, true); all roles AI; mission.controlEnabled=false; controlledAircraftId=null; game.pilot=null; stepBattle(NEUTRAL_INPUT)" },
    environment: { runtime: process.version, platform: process.platform, arch: process.arch, nodeArgs: process.execArgv },
    mirrorCoverage: "perspective-only: physical team-swapped replay is not implemented; A21 remains unaccepted",
    cases: [] as CaseRow[], mirrorComparisons: [] as Array<Record<string, unknown>>,
    gate: "not evaluated until the full 30-seed campaign is complete; sample runs are diagnostic only",
  };
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`);
  let failures = 0;
  for (let seed = 1; seed <= seedCount; seed++) {
    for (const mode of MODES) {
      const pair: CaseRow[] = [];
      for (const team of TEAMS) {
        const row = runCase(seed, mode, team);
        pair.push(row);
        record.cases.push(row);
        if (row.status !== "complete" || row.longestNoDamageTicks > 3600 || !row.aiOnlyProof.activeAiAircraftMoved
          || !row.aiOnlyProof.noPlayerRolesAtProgressChecks || !row.aiOnlyProof.noControlledAircraftAtProgressChecks) failures++;
        await writeFile(output, `${JSON.stringify(record, null, 2)}\n`);
      }
      if (pair.length === 2) {
        const a = canonicalMirror(pair[0]);
        const b = canonicalMirror(pair[1]);
        const equal = JSON.stringify(a) === JSON.stringify(b);
        const comparison = { seed, mode, equal, teamA: a, teamB: b };
        pair[0].mirrorComparable = a;
        pair[1].mirrorComparable = b;
        record.mirrorComparisons.push(comparison);
        if (!equal) failures++;
        await writeFile(output, `${JSON.stringify(record, null, 2)}\n`);
      }
    }
  }
  const complete = record.cases.length === record.rules.casesExpected && record.cases.every(row => row.status === "complete");
  record.gate = complete && seedCount === FULL_SEEDS && failures === 0
    ? "perspective campaign measured; A21 not passed: physical team-swapped replay is missing; interpret A23 separately"
    : `not passed: ${failures} case/mirror/AI-proof/no-damage checks; ${seedCount}/${FULL_SEEDS} seeds measured`;
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`[acceptance] wrote ${path.relative(ROOT, output)}; cases=${record.cases.length}/${record.rules.casesExpected}; failures=${failures}; gate=${record.gate}`);
  if (failures) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
