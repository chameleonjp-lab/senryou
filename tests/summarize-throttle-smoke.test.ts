import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// These reports are deliberately synthetic. No app, browser, HTTP or WebSocket is started.
const viewports = ['phone-portrait-393x648', 'phone-landscape-568x320', 'pc-1280x720'];
const summarizer = fileURLToPath(new URL('../scripts/summarize-throttle-smoke.mjs', import.meta.url));
const report = (failed = false) => ({
  fixture: 'synthetic report; not a real Playwright run',
  stats: { expected: failed ? 2 : 3, skipped: 0, unexpected: failed ? 1 : 0, flaky: 0 },
  errors: [] as unknown[],
  suites: [{ specs: viewports.map((viewport, index) => ({
    title: `smoke ${viewport}: play, pause/resume, settings, rules and result`, file: 'smoke.spec.ts',
    tests: [{ results: [{ status: failed && index === 0 ? 'failed' : 'passed' }] }],
  })) }],
});
type Report = ReturnType<typeof report>;
type Options = {
  version?: 'candidate' | 'baseline';
  evidence?: (value: Record<string, unknown>) => void;
  candidateReport?: (value: Report) => void;
  baselineFailed?: boolean;
  omitReport?: boolean;
  candidateOutcome?: string;
};
async function fixture(options: Options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'senryou-summary-fixture-'));
  const write = async (relative: string, value: unknown) => {
    const filename = path.join(directory, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, JSON.stringify(value), { flag: 'wx' });
  };
  for (const [version, prefix] of [['candidate', ''], ['baseline', 'throttle-baseline/']]) {
    for (const [index, viewport] of viewports.entries()) {
      const evidence: Record<string, unknown> = {
        fixture: 'synthetic evidence; no communication occurred',
        viewport: { id: viewport }, pageErrors: [], consoleErrors: [], blockedExternal: [], actions: [],
      };
      if (version === (options.version ?? 'candidate') && index === 0) options.evidence?.(evidence);
      await write(`${prefix}docs/evidence/smoke/${viewport}.json`, evidence);
    }
  }
  const candidateReport = report();
  options.candidateReport?.(candidateReport);
  if (!options.omitReport) await write('test-results/browser-results.json', candidateReport);
  await write('throttle-baseline/test-results/baseline-smoke-results.json', report(options.baselineFailed));
  const child = spawnSync(process.execPath, [summarizer], {
    cwd: directory, encoding: 'utf8', timeout: 10_000,
    // Do not inherit credentials, preload hooks or a real CI summary path.
    env: { CANDIDATE_BROWSER_OUTCOME: options.candidateOutcome ?? 'success', BASELINE_BROWSER_OUTCOME: options.baselineFailed ? 'failure' : 'success' },
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  const outcomes = JSON.parse(await readFile(path.join(directory, 'test-results/throttle-browser-outcomes.json'), 'utf8'));
  const rows = JSON.parse(await readFile(path.join(directory, 'test-results/throttle-baseline-smoke-comparison.json'), 'utf8'));
  return { child, outcomes, row: rows.find((row: any) => row.version === (options.version ?? 'candidate') && row.viewport === viewports[0]) };
}

test('clean empty network evidence passes and remains in the comparison artifact', async () => {
  const { child, outcomes, row } = await fixture();
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(outcomes.problems, []);
  assert.equal(row.blockedExternalPresent, true);
  assert.deepEqual(row.blockedExternal, []);
});

for (const version of ['candidate', 'baseline'] as const) {
  test(`${version}: missing blockedExternal fails closed instead of defaulting to empty`, async () => {
    const { child, outcomes, row } = await fixture({ version, evidence: value => { delete value.blockedExternal; } });
    assert.equal(child.status, 1);
    assert.match(outcomes.problems.join('\n'), /blockedExternal evidence is missing/);
    assert.equal(row.blockedExternalPresent, false);
    assert.equal(row.blockedExternal, null);
  });
  for (const malformed of [null, {}, '', '[]', false, 0]) {
    test(`${version}: malformed blockedExternal ${JSON.stringify(malformed)} fails and is preserved`, async () => {
      const { child, outcomes, row } = await fixture({ version, evidence: value => { value.blockedExternal = malformed; } });
      assert.equal(child.status, 1);
      assert.match(outcomes.problems.join('\n'), /blockedExternal must be an array/);
      assert.equal(row.blockedExternalPresent, true);
      assert.deepEqual(row.blockedExternal, malformed);
    });
  }
  test(`${version}: isolated forbidden attempt fails despite passed reports and empty pageErrors`, async () => {
    const attempts = ['GET https://network-probe.invalid/collect'];
    const { child, outcomes, row } = await fixture({ version, evidence: value => { value.blockedExternal = attempts; } });
    assert.equal(child.status, 1);
    assert.match(outcomes.problems.join('\n'), /attempted 1 forbidden request/);
    assert.deepEqual(row.pageErrors, []);
    assert.deepEqual(row.consoleErrors, []);
    assert.deepEqual(row.blockedExternal, attempts);
  });
}

test('a caught error cannot hide a forbidden request or erase its diagnostic evidence', async () => {
  const { child, row } = await fixture({ evidence: value => {
    value.blockedExternal = ['WEBSOCKET wss://network-probe.invalid/socket'];
    value.consoleErrors = ['synthetic caught error'];
    value.networkFailure = 'synthetic independent network assertion';
  } });
  assert.equal(child.status, 1);
  assert.deepEqual(row.pageErrors, []);
  assert.deepEqual(row.consoleErrors, ['synthetic caught error']);
  assert.equal(row.networkFailure, 'synthetic independent network assertion');
});

test('consistent failed historical baseline remains diagnostic', async () => {
  const { child, outcomes, row } = await fixture({ baselineFailed: true, version: 'baseline', evidence: value => { value.failure = 'synthetic historical failure'; } });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(outcomes.problems, []);
  assert.equal(outcomes.runs[1].outcome, 'failure');
  assert.equal(outcomes.runs[1].required, false);
  assert.equal(row.failure, 'synthetic historical failure');
});

for (const field of ['failure', 'networkFailure']) test(`candidate ${field} contradicting a passed report is rejected`, async () => {
  const { child, outcomes, row } = await fixture({ evidence: value => { value[field] = 'synthetic assertion failure'; } });
  assert.equal(child.status, 1);
  assert.match(outcomes.problems.join('\n'), /evidence records a smoke failure/);
  assert.equal(row[field], 'synthetic assertion failure');
  assert.deepEqual(row.blockedExternal, []);
});

test('candidate failed result cannot be hidden by passed counters or success outcome', async () => {
  const { child, outcomes } = await fixture({ candidateReport: value => { value.suites[0].specs[0].tests[0].results[0].status = 'failed'; } });
  assert.equal(child.status, 1);
  assert.match(outcomes.problems.join('\n'), /statuses disagree with report counts/);
  assert.match(outcomes.problems.join('\n'), /candidate browser checks failed/);
  assert.match(outcomes.problems.join('\n'), /step outcome success disagrees with report failure/);
  assert.equal(outcomes.runs[0].outcome, 'failure');
  assert.equal(outcomes.runs[0].stepOutcome, 'success');
});

test('three duplicate viewport cases cannot stand in for all intended smoke cases', async () => {
  const { child, outcomes } = await fixture({ candidateReport: value => {
    value.suites[0].specs[1].title = value.suites[0].specs[0].title;
  } });
  assert.equal(child.status, 1);
  assert.match(outcomes.problems.join('\n'), /each intended viewport/);
});

for (const [name, options] of [
  ['missing runner report', { omitReport: true }],
  ['skipped smoke case', { candidateReport: (value: Report) => { value.suites[0].specs[0].tests[0].results[0].status = 'skipped'; } }],
  ['empty result list', { candidateReport: (value: Report) => { value.suites[0].specs[0].tests[0].results = []; } }],
  ['global runner error', { candidateReport: (value: Report) => { value.errors = [{ message: 'synthetic error' }]; } }],
  ['step outcome mismatch', { candidateOutcome: 'failure' }],
  ['undercounted passes', { candidateReport: (value: Report) => { value.stats.expected = 0; } }],
] as const) test(`existing runner gate remains required: ${name}`, async () => {
  const { child, outcomes } = await fixture(options);
  assert.equal(child.status, 1);
  assert.ok(outcomes.problems.length);
});
