import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { BLOBS, GUARD, MAIN, MARKER, gameplayBody, gitBlob, instrument, sha256 } from './paired-harness-source.mjs';

const root = process.cwd();
const out = path.join(root, 'paired-diagnostic-evidence');
const BASELINE = '71b0e5bc9ffbe2cbd1f295160b9e8e3c40ad6650';
const baselineDir = path.join(root, 'throttle-baseline');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const json = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const product = ['src', 'public', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'playwright.config.ts', 'playwright.throttle.config.ts'];
const guardHelpers = ['browser-tests/network-guard.ts', 'browser-tests/asset-manifest.mjs', 'browser-tests/optimizer-manifest.mjs'];
function tracked(ref, paths) { return git('ls-tree', '-r', '--name-only', ref, '--', ...paths).trim().split('\n').filter(Boolean).sort(); }
function verifyInputs() {
  const files = tracked(MAIN, product);
  assert.deepEqual(tracked('HEAD', product), files);
  return [...files, ...guardHelpers].map(file => {
    const ref = guardHelpers.includes(file) ? GUARD : MAIN;
    const source = Buffer.from(execFileSync('git', ['show', `${ref}:${file}`]));
    const actual = readFileSync(path.join(root, file));
    assert.ok(source.equals(actual), `Input differs from ${ref}: ${file}`);
    return { path: file, source: ref, gitBlob: gitBlob(source), sha256: sha256(actual), bytes: actual.length };
  });
}
function preserve(source, destination) {
  if (!existsSync(source)) return false;
  assert.ok(!existsSync(destination), `Refuse evidence overwrite: ${destination}`);
  mkdirSync(path.dirname(destination), { recursive: true });
  renameSync(source, destination);
  return true;
}
function walk(directory, relative = '') {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(relative, entry.name), target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target, name) : [{ path: name, sha256: sha256(readFileSync(target)) }];
  });
}
function resultsOf(report) {
  const result = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) result.push({ title: spec.title, projectName: test.projectName, status: test.status, results: test.results?.map(r => ({ status: r.status, retry: r.retry, error: r.error?.message })) });
    for (const nested of suite.suites ?? []) visit(nested);
  }
  for (const suite of report.suites ?? []) visit(suite);
  return result;
}
export function runOrderedPair(runArm) {
  const results = [];
  for (const arm of ['control', 'guard']) {
    // Ordinary test failure returns a result; it must never suppress arm two.
    results.push(runArm(arm));
  }
  return results;
}
export function validateArmRecords(records, report, observerFiles, exitCode) {
  const problems = [];
  const ids = ['phone-portrait-393x648', 'phone-landscape-568x320', 'pc-1280x720'];
  if (report.errors?.length) problems.push('Global runner errors');
  if (records.length !== 3 || records.some(r => r.results?.length !== 1 || r.results[0].retry !== 0)) problems.push('Expected exactly three once-only cases');
  const statuses = records.flatMap(r => r.results ?? []).map(r => r.status);
  if (statuses.some(status => !['passed', 'failed', 'timedOut'].includes(status))) problems.push('Skipped, incomplete or unknown smoke result');
  const passed = statuses.filter(status => status === 'passed').length;
  if (!report.stats || report.stats.skipped !== 0 || report.stats.flaky !== 0 || report.stats.expected !== passed || report.stats.unexpected !== statuses.length - passed) problems.push('Runner counts contradict exact once-only outcomes');
  if (exitCode !== undefined && ((exitCode === 0) !== (passed === 3 && !report.errors?.length))) problems.push('Exit code contradicts smoke outcomes');
  for (const id of ids) {
    if (records.filter(r => r.title.includes(`smoke ${id}:`)).length !== 1) problems.push(`Missing/duplicate smoke ${id}`);
    if (!observerFiles.includes(`${id}.json`)) problems.push(`Missing observer evidence ${id}`);
  }
  return problems;
}
export function validateObserver(observer, arm, id, passed) {
  const problems = [];
  if (observer.arm !== arm || observer.id !== id || observer.diagnosticOnly !== true || !(observer.preparedPages > 0)) problems.push('Observer identity/setup mismatch');
  for (const field of ['errors', 'outerForbidden', 'problems']) if (!Array.isArray(observer[field]) || observer[field].length) problems.push(`Invalid/nonempty ${field}`);
  if (!Array.isArray(observer.requests) || !Array.isArray(observer.captures)) problems.push('Missing request/capture arrays');
  if (!/^ws:\/\/127\.0\.0\.1:4178\/\?token=[a-zA-Z0-9_-]+$/.test(observer.hmr?.observed ?? '')) problems.push('Missing exact served token');
  if (arm === 'control' && (!(observer.hmr?.connectedMessages > 0) || !observer.hmr.attempts?.includes(observer.hmr.observed))) problems.push('Control live HMR unproven');
  if (arm === 'guard' && observer.hmr?.connectedMessages !== 0) problems.push('Guard unexpectedly live');
  for (const capture of observer.captures ?? []) {
    const q = capture.browser?.queue;
    if (capture.error || !Number.isFinite(capture.browser?.nowMs) || !q || !['ready', 'pending', 'stalled', 'failed'].includes(q.status) || !Number.isFinite(q.pendingMs)) problems.push('Malformed capture queue');
    if (capture.edge === 'after' && !(capture.screenshotElapsedMs >= 0)) problems.push('Missing capture duration');
  }
  if (passed) for (const state of ['home', 'hud-easy', 'pause', 'result']) for (const edge of ['before', 'after']) {
    if ((observer.captures ?? []).filter(c => c.id === id && c.state === state && c.edge === edge).length !== 1) problems.push(`Missing/duplicate ${state}/${edge}`);
  }
  return problems;
}

function main() {
  assert.equal(process.env.CI, 'true', 'This pair may run only in its authorized CI job');
  assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1', 'No pair reruns');
  assert.equal(git('show', '-s', '--format=%s', 'HEAD').trim(), MARKER, 'One-time commit marker mismatch');
  assert.equal(git('rev-parse', 'HEAD^').trim(), GUARD, 'Diagnostic must directly follow reviewed guard head');
  assert.ok(!existsSync(out), 'Refuse to repeat/overwrite a previous pair');
  mkdirSync(out);
  const sourceProof = verifyInputs();
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: baselineDir, encoding: 'utf8' }).trim(), BASELINE);
  assert.ok(readFileSync(path.join(baselineDir, 'package-lock.json')).equals(readFileSync('package-lock.json')), 'Idle baseline must use identical locked dependencies');
  const sources = { control: git('show', `${MAIN}:browser-tests/smoke.spec.ts`), guard: git('show', `${GUARD}:browser-tests/smoke.spec.ts`) };
  assert.equal(gameplayBody(sources.control), gameplayBody(sources.guard), 'Gameplay assertions differ between sources');
  const sourceRecords = {};
  for (const arm of ['control', 'guard']) {
    const generated = instrument(sources[arm], arm);
    const file = path.join(root, 'browser-tests', `paired-${arm}.smoke.spec.ts`);
    assert.ok(!existsSync(file), `Refuse generated-source overwrite: ${file}`);
    writeFileSync(file, generated);
    writeFileSync(path.join(out, `${arm}-source.ts`), sources[arm]);
    writeFileSync(path.join(out, `${arm}-instrumented.ts`), generated);
    sourceRecords[arm] = { sourceCommit: arm === 'control' ? MAIN : GUARD, originalBlob: BLOBS[arm], originalSha256: sha256(sources[arm]), instrumentedSha256: sha256(generated) };
  }
  const require = createRequire(import.meta.url);
  const executable = require('playwright-core/lib/coreBundle').registry.registry.findExecutable('chromium-headless-shell').executablePath();
  const browserBytes = sha256(readFileSync(executable));
  const manifest = { diagnosticOnly: true, communicationAcceptance: false, order: ['control', 'guard'], retries: 0,
    head: git('rev-parse', 'HEAD').trim(), main: MAIN, guard: GUARD, idleBaseline: { commit: BASELINE, directory: baselineDir, port: 4177, browserRuns: 0, purpose: 'Preserve original CI idle server topology only; not the product control' }, sources: sourceRecords, sourceProof,
    runner: { os: os.release(), architecture: os.arch(), cpus: os.cpus().map(c => c.model), node: process.version, runnerImage: process.env.ImageVersion, runnerName: process.env.RUNNER_NAME },
    browser: { executable, sha256: browserBytes, playwright: JSON.parse(readFileSync('node_modules/@playwright/test/package.json')).version },
    command: 'node node_modules/@playwright/test/cli.js test --config=playwright.throttle.config.ts browser-tests/paired-ARM.smoke.spec.ts --project=chromium-smoke',
    cachePreparation: 'One shared installed dependency tree; absent Vite cache at each arm start. Every prior cache is moved into evidence, never discarded. New Playwright process/browser and fresh contexts. Same viewport order warms optimizer identically within each arm.',
    commonSafetyAdditions: ['Browser-native exact4178 HTTP/WS exception plus wildcard deny fence before navigation and before an unprepared page request', 'Context outer route aborts external or frame-less requests; SW block unchanged', 'Observed exact-token control HMR only; current guard remains inert', 'Common served-client/token and request timing observer; pure queue reads around original screenshots'],
    caveats: ['Fixed order and shared-runner scheduling are not controlled away', 'Common instrumentation can affect scheduling', 'This compares the HTTP delivery/HMR bundle, not either cause alone', 'No outcome erases previous CI failures or substitutes for required CI'],
    inherited: {}, arms: [] };
  for (const [name, file] of Object.entries({ smoke: 'docs/evidence/smoke', observer: 'docs/evidence/paired-observer', results: 'test-results', cache: 'node_modules/.vite', idleBaselineCache: path.join(baselineDir, 'node_modules/.vite') })) {
    manifest.inherited[name] = preserve(file, path.join(out, 'inherited', name));
  }
  json(path.join(out, 'manifest.json'), manifest);
  const arms = runOrderedPair(arm => {
    const directory = path.join(out, arm); mkdirSync(directory);
    const inputs = verifyInputs(); assert.deepEqual(inputs, sourceProof);
    assert.equal(sha256(readFileSync(executable)), browserBytes);
    assert.ok(!existsSync('node_modules/.vite') && !existsSync(path.join(baselineDir, 'node_modules/.vite')), 'Each arm must begin without Vite optimizer cache');
    assert.ok(!existsSync('docs/evidence/smoke') && !existsSync('test-results'));
    const started = new Date().toISOString();
    const child = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.throttle.config.ts', `browser-tests/paired-${arm}.smoke.spec.ts`, '--project=chromium-smoke'],
      { cwd: root, env: { ...process.env, THROTTLE_BASELINE_DIR: baselineDir }, stdio: 'inherit' });
    const result = { arm, started, finished: new Date().toISOString(), exitCode: child.status, signal: child.signal, spawnError: child.error?.message, sourceProofSha256: sha256(JSON.stringify(inputs)), browserSha256: browserBytes, records: [], evidenceProblems: [] };
    for (const [name, file] of Object.entries({ smoke: 'docs/evidence/smoke', observer: 'docs/evidence/paired-observer', results: 'test-results', cache: 'node_modules/.vite', idleBaselineCache: path.join(baselineDir, 'node_modules/.vite') })) preserve(file, path.join(directory, name));
    try {
      const report = JSON.parse(readFileSync(path.join(directory, 'results/browser-results.json')));
      result.records = resultsOf(report);
      const observerFiles = existsSync(path.join(directory, 'observer')) ? readdirSync(path.join(directory, 'observer')) : [];
      result.evidenceProblems = validateArmRecords(result.records, report, observerFiles, child.status);
      for (const file of observerFiles.filter(f => f.endsWith('.json'))) {
        const observer = JSON.parse(readFileSync(path.join(directory, 'observer', file)));
        const id = file.replace(/\.json$/, '');
        const record = result.records.find(r => r.title.includes(`smoke ${id}:`));
        result.evidenceProblems.push(...validateObserver(observer, arm, id, record?.results?.[0]?.status === 'passed').map(problem => `${file}: ${problem}`));
      }
    } catch (error) { result.evidenceProblems.push(String(error)); }
    json(path.join(directory, 'result.json'), result);
    json(path.join(directory, 'file-hashes.json'), walk(directory));
    manifest.arms.push(result); json(path.join(out, 'manifest.json'), manifest);
    return result;
  });
  assert.equal(arms.length, 2);
  const versions = [];
  for (const arm of arms) for (const file of readdirSync(path.join(out, arm.arm, 'smoke')).filter(name => name.endsWith('.json'))) versions.push(JSON.parse(readFileSync(path.join(out, arm.arm, 'smoke', file))).browser);
  assert.equal(versions.length, 6, 'Expected actual browser evidence for six cases');
  assert.equal(new Set(versions).size, 1, 'Actual browser versions differed');
  manifest.actualBrowserVersion = versions[0]; json(path.join(out, 'manifest.json'), manifest);
  process.exitCode = arms.every(arm => arm.exitCode === 0 && arm.evidenceProblems.length === 0) ? 0 : 1;
  console.log(JSON.stringify({ diagnosticOnly: true, pairResults: arms }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (error) {
    if (existsSync(out)) json(path.join(out, 'incomplete-pair.json'), { diagnosticOnly: true, complete: false, error: String(error), stack: error?.stack });
    throw error;
  }
}
