import { readFileSync } from 'node:fs';
export const EXPECTED_CASES = JSON.parse(readFileSync(new URL('./expected-cases.json', import.meta.url)));
const FAILURES = [null, 'context-lost', 'wait-failed', 'fence-unavailable', 'submission-pending', 'api-error', 'disposed'];
const FIELD_TYPES = {
  schema: [1], kind: ['first-explicit-stop-poll'], coverage: ['post-ready-armed-epoch'],
  captured: 'boolean', valid: 'boolean', invalidCode: ['none', 'unexpected-call', 'reentrant-call', 'observer-read', 'native-throw', 'counter-overflow', 'call-mismatch', 'invalid-data', 'ownership-changed', 'payload-bound', 'latch-ambiguous'],
  explicitPollOrdinal: 'number', priorImplicitStopCount: 'number', priorImplicitFailedCount: 'number', priorImplicitStalledCount: 'number',
  viewArgumentCount: 'nullable-number', viewNowMs: 'nullable-number', queueNowMs: 'nullable-number', previousExplicitNowMs: 'nullable-number', explicitPollIntervalMs: 'nullable-number',
  nativeViewReturn: [null, 'ready', 'pending', 'stalled', 'failed'], nativeQueueReturn: [null, 'ready', 'pending', 'stalled', 'failed'], queuePollCount: 'number',
  fencePresentBefore: 'boolean', submittedOrdinal: 'nullable-number', completedOrdinal: 'nullable-number', submittedAtMs: 'nullable-number', fenceAgeMs: 'nullable-number',
  failureBefore: FAILURES, failureAfter: FAILURES, failureOrigin: ['not-failed', 'this-poll', 'prelatched-origin-unobserved'],
  glResultSource: ['original-call-direct', 'not-called'], glCallCount: 'number', glReturn: 'nullable-number', glThrew: 'boolean', glFenceMatches: [null, true, false], glFlags: 'nullable-number', glTimeout: 'nullable-number',
  startDisabledBeforeConsumption: [null, true, false], startupErrorHiddenBeforeConsumption: [null, true, false], reloadHiddenBeforeConsumption: [null, true, false],
  priorDisplayedLatch: ['not-displayed', 'already-displayed', 'mixed-or-unobserved'], tick: 'nullable-number', phase: [null, 'running', 'paused', 'result'],
};
export function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['missing-record'];
  const problems = [];
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(Object.keys(FIELD_TYPES).sort())) problems.push('record-fields');
  for (const [key, type] of Object.entries(FIELD_TYPES)) {
    const value = record[key];
    if (Array.isArray(type) ? !type.includes(value) : type === 'boolean' ? typeof value !== 'boolean' : !(type === 'nullable-number' && value === null) && !(typeof value === 'number' && Number.isFinite(value))) problems.push(`record-type:${key}`);
  }
  const serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized, 'utf8') > 1424 || !/^[\x00-\x7f]*$/.test(serialized)) problems.push('record-bound');
  if (record.valid !== true || record.invalidCode !== 'none') problems.push('recorder-invalid');
  const counters = ['explicitPollOrdinal', 'priorImplicitStopCount', 'priorImplicitFailedCount', 'priorImplicitStalledCount', 'queuePollCount', 'glCallCount'];
  if (counters.some(key => !Number.isSafeInteger(record[key]) || record[key] < 0) || !(record.explicitPollOrdinal > 0)) problems.push('record-counters');
  if (record.priorImplicitStopCount !== record.priorImplicitFailedCount + record.priorImplicitStalledCount) problems.push('implicit-counter-sum');
  if (!record.captured) {
    const empty = { viewArgumentCount: null, viewNowMs: null, queueNowMs: null, previousExplicitNowMs: null, explicitPollIntervalMs: null,
      nativeViewReturn: null, nativeQueueReturn: null, queuePollCount: 0, fencePresentBefore: false, submittedOrdinal: null, completedOrdinal: null,
      submittedAtMs: null, fenceAgeMs: null, failureBefore: null, failureAfter: null, failureOrigin: 'not-failed', glResultSource: 'not-called', glCallCount: 0,
      glReturn: null, glThrew: false, glFenceMatches: null, glFlags: null, glTimeout: null, startDisabledBeforeConsumption: null,
      startupErrorHiddenBeforeConsumption: null, reloadHiddenBeforeConsumption: null, priorDisplayedLatch: 'mixed-or-unobserved', tick: null, phase: null };
    if (Object.entries(empty).some(([key, value]) => record[key] !== value)) problems.push('noncapture-fields-not-empty');
    return problems;
  }
  if (['submittedOrdinal', 'completedOrdinal', 'tick'].some(key => !Number.isSafeInteger(record[key]) || record[key] < 0) || record.completedOrdinal > record.submittedOrdinal) problems.push('native-ordinals');
  if (!(record.viewNowMs >= 0) || record.viewNowMs === null || record.viewNowMs !== record.queueNowMs || record.viewArgumentCount !== 1 || record.queuePollCount !== 1 || record.nativeViewReturn !== record.nativeQueueReturn || !['failed', 'stalled'].includes(record.nativeViewReturn)) problems.push('native-call-contradiction');
  if (record.previousExplicitNowMs === null ? record.explicitPollIntervalMs !== null || record.explicitPollOrdinal !== 1 : !(record.previousExplicitNowMs >= 0 && record.previousExplicitNowMs <= record.viewNowMs && record.explicitPollIntervalMs === record.viewNowMs - record.previousExplicitNowMs && record.explicitPollOrdinal > 1)) problems.push('native-interval-contradiction');
  if (record.fencePresentBefore ? !(record.submittedAtMs !== null && record.submittedAtMs >= 0 && record.submittedAtMs <= record.queueNowMs && record.fenceAgeMs === record.queueNowMs - record.submittedAtMs) : record.submittedAtMs !== null || record.fenceAgeMs !== null) problems.push('native-fence-time-contradiction');
  if (record.glCallCount === 0) {
    if (record.glResultSource !== 'not-called' || record.glReturn !== null || record.glThrew !== false || record.glFenceMatches !== null || record.glFlags !== null || record.glTimeout !== null) problems.push('uncalled-gl-fields');
  } else if (record.glCallCount !== 1 || record.glResultSource !== 'original-call-direct' || !record.fencePresentBefore || record.glFenceMatches !== true || record.glFlags !== 0 || record.glTimeout !== 0 || (record.glThrew ? record.glReturn !== null : record.glReturn === null)) problems.push('called-gl-fields');
  const latch = record.priorDisplayedLatch;
  if (latch === 'not-displayed' ? record.startDisabledBeforeConsumption !== false || record.startupErrorHiddenBeforeConsumption !== true || record.reloadHiddenBeforeConsumption !== true : latch === 'already-displayed' ? record.startDisabledBeforeConsumption !== true || record.startupErrorHiddenBeforeConsumption !== false || record.reloadHiddenBeforeConsumption !== false : true) problems.push('native-latch-flags');
  if (!['running', 'paused', 'result'].includes(record.phase)) problems.push('native-phase');
  if (record.nativeViewReturn === 'stalled') {
    if (record.failureBefore !== null || record.failureAfter !== null || record.failureOrigin !== 'not-failed' || record.glCallCount !== 1 || record.glReturn !== 37147 || record.glThrew || !(record.fenceAgeMs > 1000)) problems.push('stall-branch-contradiction');
  } else if (record.failureBefore !== null) {
    if (record.failureAfter !== record.failureBefore || record.failureOrigin !== 'prelatched-origin-unobserved' || record.glCallCount !== 0 || record.fencePresentBefore) problems.push('prelatched-branch-contradiction');
  } else {
    if (record.failureOrigin !== 'this-poll') problems.push('this-poll-origin');
    const unexpected = record.glCallCount === 1 && !record.glThrew && ![37146, 37147, 37148].includes(record.glReturn);
    if (record.failureAfter === 'wait-failed') { if (!unexpected) problems.push('wait-failed-branch-contradiction'); }
    else if (record.failureAfter === 'context-lost') { if (!(record.glCallCount === 0 || unexpected)) problems.push('context-lost-branch-contradiction'); }
    else if (record.failureAfter === 'api-error') { if (record.glCallCount === 1 && !record.glThrew && record.glReturn === 37147) problems.push('api-error-branch-contradiction'); }
    else problems.push('unsupported-this-poll-failure');
  }
  return problems;
}
export function flatten(report) {
  const records = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) records.push({ title: spec.title, projectName: test.projectName, expectedStatus: test.expectedStatus, status: test.status, results: test.results ?? [] });
    for (const next of suite.suites ?? []) visit(next);
  }
  visit(report);
  return records;
}
export function validateSuite(report, exitCode) {
  const problems = [], records = flatten(report);
  const identities = records.map(({ title, projectName, expectedStatus }) => ({ title, projectName, expectedStatus }));
  if (JSON.stringify(identities) !== JSON.stringify(EXPECTED_CASES)) problems.push('full-suite-identity-or-order');
  if (report.config?.workers !== 1 || report.config?.maxFailures !== 0 || report.config?.fullyParallel !== false) problems.push('runner-configuration');
  if (report.config?.projects?.some(p => p.retries !== 0) || report.errors?.length) problems.push('runner-retry-or-global-error');
  if (records.some(r => r.results.length !== 1 || r.results[0].retry !== 0 || !['passed', 'failed', 'timedOut', 'skipped'].includes(r.results[0].status))) problems.push('incomplete-or-retried-case');
  const skipped = records.filter(r => r.results[0]?.status === 'skipped').length;
  const passed = records.filter(r => r.results[0]?.status === 'passed').length;
  const failed = records.length - passed - skipped;
  if (skipped !== 10 || !report.stats || report.stats.expected !== passed || report.stats.skipped !== skipped || report.stats.unexpected !== failed || report.stats.flaky !== 0) problems.push('runner-counts');
  if ((exitCode === 0) !== (failed === 0 && !report.errors?.length)) problems.push('runner-exit');
  const pc = records.find(r => r.title.startsWith('smoke pc-1280x720:'));
  const pcStart = Date.parse(pc?.results[0]?.startTime);
  if (!Number.isFinite(pcStart)) problems.push('pc-start-missing');
  for (const preceding of records.filter(r => r !== pc)) {
    const actual = preceding.results[0];
    if (actual?.status !== preceding.expectedStatus) problems.push('preceding-workload-incomplete');
    if (actual?.status !== 'skipped' && !(Date.parse(actual?.startTime) + actual?.duration <= pcStart)) problems.push('preceding-workload-order');
  }
  let previousEnd = -Infinity;
  for (const record of records) {
    const actual = record.results[0];
    if (actual?.status === 'skipped') continue;
    const start = Date.parse(actual?.startTime), end = start + actual?.duration;
    if (!(start >= previousEnd && end >= start)) problems.push('realized-suite-order');
    previousEnd = end;
  }
  return { problems: [...new Set(problems)], records: records.map(({ results, ...r }) => ({ ...r, results: results.map(v => ({ status: v.status, retry: v.retry, startTime: v.startTime, duration: v.duration, error: v.error?.message })) })), pcPassed: pc?.results[0]?.status === 'passed' };
}
export function classify(record, metadata, pcPassed, otherProblems = []) {
  const problems = [...otherProblems, ...validateRecord(record)];
  if (!metadata || metadata.target !== 'pc-1280x720' || metadata.armAttempted !== true || metadata.armed !== true || metadata.observerCleanup !== true || metadata.handleDisposed !== true || metadata.contextClosed !== true || metadata.networkChecked !== true || !Array.isArray(metadata.problems) || metadata.problems.length) problems.push('capture-lifecycle-incomplete');
  if (problems.length) return { classification: 'invalid-evidence', problems: [...new Set(problems)] };
  if (!record.captured) return { classification: pcPassed ? 'not-reproduced-this-time' : 'no-poll-record-missing-failure-coverage', problems: [] };
  if (record.priorDisplayedLatch !== 'not-displayed') return { classification: 'prior-displayed-latch-origin-unobserved', problems: [] };
  if (record.viewArgumentCount !== 1 || record.queuePollCount !== 1 || record.viewNowMs !== record.queueNowMs || record.nativeViewReturn !== record.nativeQueueReturn || !(record.explicitPollOrdinal > 0) || !['failed', 'stalled'].includes(record.nativeViewReturn)) return { classification: 'invalid-evidence', problems: ['native-call-contradiction'] };
  if (record.nativeViewReturn === 'stalled') {
    if (record.glCallCount === 1 && record.glResultSource === 'original-call-direct' && record.glReturn === 37147 && record.glThrew === false && record.glFenceMatches === true && record.glFlags === 0 && record.glTimeout === 0 && record.fencePresentBefore && record.fenceAgeMs > 1000 && record.fenceAgeMs === record.queueNowMs - record.submittedAtMs && record.failureBefore === null && record.failureAfter === null) return { classification: 'existing-timeout-safety-rejection', problems: [] };
    return { classification: 'invalid-evidence', problems: ['stall-without-native-timeout-condition'] };
  }
  if (record.failureBefore !== null && record.glCallCount === 0 && record.glReturn === null && record.glResultSource === 'not-called' && record.failureOrigin === 'prelatched-origin-unobserved') return { classification: 'prelatched-queue-failure-origin-unobserved', failure: record.failureBefore, problems: [] };
  if (record.failureBefore !== null || record.failureOrigin !== 'this-poll') return { classification: 'invalid-evidence', problems: ['failure-origin-contradiction'] };
  if (record.failureAfter === 'context-lost') return { classification: 'native-context-loss-path', problems: [] };
  if (record.failureAfter === 'wait-failed' && record.glCallCount === 1 && record.glResultSource === 'original-call-direct' && record.glReturn !== null) return { classification: 'native-wait-failure', nativeReturn: record.glReturn, problems: [] };
  if (record.failureAfter === 'api-error') return { classification: record.glThrew ? 'native-clientWaitSync-threw' : 'native-api-error-specific-operation-unobserved', problems: [] };
  return { classification: 'invalid-evidence', problems: ['unclassified-native-failure'] };
}
