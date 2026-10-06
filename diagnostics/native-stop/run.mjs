import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { BASELINE, HELPER_SHA, MAIN, MARKER, PARENT, injectionSource, instrument, sha256 } from './source.mjs';
import { classify, validateSuite } from './validate.mjs';

const root = process.cwd(), out = path.join(root, 'native-stop-evidence');
const baseline = path.join(root, 'throttle-baseline');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const json = (file, value) => writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const head = () => git('rev-parse', 'HEAD').trim();
function sourceProof() {
  const names = git('ls-tree', '-r', '--name-only', PARENT, '--', 'src', 'public', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'playwright.config.ts', 'playwright.throttle.config.ts', 'playwright.baseline-smoke.config.ts', 'browser-tests', 'tests', 'scripts', '.github/workflows/throttle-lever.yml').trim().split('\n');
  return names.map(file => {
    const expected = execFileSync('git', ['show', `${PARENT}:${file}`]);
    const actual = readFileSync(file);
    assert.ok(expected.equals(actual), `Required input changed: ${file}`);
    return { file, sha256: sha256(actual), bytes: actual.length };
  });
}
function main() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1', 'No rerun');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  assert.equal(event.pull_request?.number, 5);
  assert.equal(event.pull_request?.head?.sha, head());
  assert.equal(event.pull_request?.base?.sha, MAIN);
  assert.equal(git('show', '-s', '--format=%s', 'HEAD').trim(), MARKER);
  assert.equal(git('show', '-s', '--format=%P', 'HEAD').trim(), PARENT, 'Exactly one reviewed parent');
  assert.ok(!existsSync(out), 'No repeated or overwritten diagnostic');
  mkdirSync(out);
  const proof = sourceProof();
  const changes = git('diff', '--name-status', PARENT, 'HEAD').trim().split('\n');
  assert.ok(changes.every(line => line === 'M\t.github/workflows/paired-harness-diagnostic.yml' || /^A\tdiagnostics\/native-stop\/[a-z0-9.-]+$/.test(line)), 'Only reviewed diagnostic files may differ');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: baseline, encoding: 'utf8' }).trim(), BASELINE);
  assert.ok(readFileSync(path.join(baseline, 'package-lock.json')).equals(readFileSync('package-lock.json')));
  assert.equal(process.env.THROTTLE_BASELINE_DIR, baseline);
  assert.ok(!existsSync('docs/evidence/smoke') && !existsSync('test-results'), 'Require fresh original evidence paths');
  assert.ok(existsSync(path.join(process.env.RUNNER_TEMP, 'senryou-inherited-smoke')), 'Original inherited-evidence move missing');
  const smokePath = 'browser-tests/smoke.spec.ts';
  const original = readFileSync(smokePath, 'utf8');
  const generated = instrument(original);
  const helper = readFileSync('diagnostics/native-stop/first-native-stop.ts', 'utf8');
  const injection = injectionSource(helper);
  writeFileSync(path.join(out, 'smoke-original.ts'), original, { flag: 'wx' });
  writeFileSync(path.join(out, 'smoke-instrumented.ts'), generated, { flag: 'wx' });
  writeFileSync(path.join(out, 'injection.js.txt'), injection, { flag: 'wx' });
  const require = createRequire(import.meta.url);
  const registry = require('playwright-core/lib/coreBundle').registry.registry;
  const browserRevisions = JSON.parse(readFileSync('node_modules/playwright-core/browsers.json', 'utf8'));
  const browsers = ['chromium-headless-shell', 'webkit'].map(name => {
    const engine = registry.findExecutable(name), executable = engine.executablePath();
    return { name, executable, sha256: sha256(readFileSync(executable)), kind: name === 'webkit' ? 'launcher-only-not-engine' : 'actual-target-headless-binary', pinnedRevision: browserRevisions.browsers.find(b => b.name === name) };
  });
  const manifest = {
    diagnosticOnly: true, head: head(), parent: PARENT, productMain: MAIN, idleBaseline: BASELINE,
    requiredWorkflowUnchanged: true, retries: 0, browserRuns: 1, globalArmCap: 1, recordByteCap: 1424,
    command: 'npm run test:browser -- --config=playwright.throttle.config.ts',
    sourceProof: proof, changes, helperSha256: HELPER_SHA, originalSha256: sha256(original), generatedSha256: sha256(generated), injectionSha256: sha256(injection), browsers,
    runner: { node: process.version, os: os.release(), architecture: os.arch(), cpus: os.cpus().map(c => c.model), image: process.env.ImageVersion },
    playwright: JSON.parse(readFileSync('node_modules/@playwright/test/package.json')).version,
    baselineDir: baseline, optimizerCacheBefore: { candidate: existsSync('node_modules/.vite'), baseline: existsSync(path.join(baseline, 'node_modules/.vite')) },
    precedingWorkload: 'Unchanged required npm test, npm run build and browser install; all 45 original browser cases, original order, original expected skip pattern. No cache deletion or warmup.',
    caveats: ['Recorder and one arming protocol round trip can perturb scheduling', 'Explicit poll intervals are not direct rAF backlog or GPU execution duration', 'A valid timeout proves the existing safety rejection condition only', 'Required CI remains independent; no result rewrites earlier failure'],
  };
  json('manifest.json', manifest);
  json('suite-claim.json', { runs: 1, command: manifest.command });
  writeFileSync(smokePath, generated);
  let child;
  let sourceRestored = false;
  try {
    // No filters, alternate config, project selection, retry, or second invocation.
    child = spawnSync('npm', ['run', 'test:browser', '--', '--config=playwright.throttle.config.ts'], { cwd: root, env: process.env, stdio: 'inherit' });
  } finally {
    if (readFileSync(smokePath, 'utf8') === generated) { writeFileSync(smokePath, original); sourceRestored = true; }
  }
  const problems = [];
  if (!sourceRestored) problems.push('ephemeral-source-restoration-failed');
  try { assert.deepEqual(sourceProof(), proof); } catch { problems.push('source-provenance-changed'); }
  for (const browser of browsers) {
    try {
      const actualSha256 = sha256(readFileSync(browser.executable));
      json(`browser-${browser.name}-after.json`, { kind: browser.kind, executable: browser.executable, sha256: actualSha256, same: actualSha256 === browser.sha256 });
      if (actualSha256 !== browser.sha256) problems.push(`browser-executable-changed:${browser.name}`);
    } catch { problems.push(`browser-runtime-unverified:${browser.name}`); }
  }
  if (JSON.parse(readFileSync('node_modules/@playwright/test/package.json')).version !== manifest.playwright) problems.push('playwright-version-changed');
  if (child.error || child.signal || child.status === null) problems.push('browser-process-incomplete');
  let suite = { problems: ['missing-browser-report'], records: [], pcPassed: false }, metadata = null, record = null;
  try { suite = validateSuite(JSON.parse(readFileSync('test-results/browser-results.json', 'utf8')), child.status); } catch { problems.push('browser-report-invalid'); }
  try { metadata = JSON.parse(readFileSync(path.join(out, 'capture-metadata.json'), 'utf8')); } catch { problems.push('capture-metadata-missing'); }
  try {
    const bytes = readFileSync(path.join(out, 'first-native-stop.json'));
    if (bytes.length > 1424) problems.push('actual-native-record-byte-bound');
    record = JSON.parse(bytes);
    if (metadata?.recordBytes !== bytes.length) problems.push('native-record-byte-count');
  } catch { problems.push('native-record-missing'); }
  if (!existsSync(path.join(out, 'arm-claim.json'))) problems.push('global-arm-claim-missing');
  if (existsSync(path.join(out, 'capture-write-failed.txt'))) problems.push('capture-write-failed');
  for (const id of ['phone-portrait-393x648', 'phone-landscape-568x320', 'pc-1280x720']) {
    try {
      const smoke = JSON.parse(readFileSync(`docs/evidence/smoke/${id}.json`, 'utf8'));
      for (const key of ['blockedExternal', 'pageErrors', 'consoleErrors']) if (!Array.isArray(smoke[key]) || smoke[key].length) problems.push(`${id}:${key}`);
      if (smoke.networkFailure) problems.push(`${id}:networkFailure`);
      if (id === 'pc-1280x720' && metadata?.fixtureFailure !== (smoke.failure ?? null)) problems.push('original-fixture-error-mismatch');
    } catch { problems.push(`${id}:missing-evidence`); }
  }
  const outcome = classify(record, metadata, suite.pcPassed, [...problems, ...suite.problems]);
  const final = { diagnosticOnly: true, head: head(), browserExitCode: child.status, signal: child.signal, spawnError: child.error?.message, sourceRestored, suite, outcome };
  json('result.json', final);
  console.log(JSON.stringify({ nativeDiagnostic: outcome, browserExitCode: child.status }, null, 2));
  process.exitCode = child.status === 0 && outcome.classification === 'not-reproduced-this-time' ? 0 : 1;
}
try { main(); }
catch (error) {
  if (existsSync(out) && !existsSync(path.join(out, 'incomplete.json'))) json('incomplete.json', { diagnosticOnly: true, classification: 'invalid-evidence', error: String(error) });
  throw error;
}
