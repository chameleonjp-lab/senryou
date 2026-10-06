import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RenderQueue } from '../../src/render-queue';
import { installFirstNativeStop } from './first-native-stop';
import { createNativeCapture, finishNativeCapture } from './transport';
import { EDITS, injectionSource, instrument, sha256, HELPER_SHA } from './source.mjs';
import { classify, EXPECTED_CASES, validateRecord, validateSuite } from './validate.mjs';

function input() {
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 37143, ALREADY_SIGNALED: 37146, TIMEOUT_EXPIRED: 37147, CONDITION_SATISFIED: 37148, WAIT_FAILED: 37149,
    result: 37147, isContextLost() { return false; }, fenceSync() { return {} as WebGLSync; }, flush() {}, deleteSync() {}, clientWaitSync() { return this.result; },
  };
  const queue = new RenderQueue(gl as any);
  const view = { prepared: true, queue, pollRender(now = 0) { return queue.poll(now); } };
  return { api: { view, mission: { tick: 12, phase: 'running' } }, start: { disabled: false }, startupError: { hidden: true, textContent: '' }, reload: { hidden: true } };
}
function record(captured = true) {
  const i = input();
  const handle = installFirstNativeStop(i);
  i.api.view.queue.submit(10);
  i.api.view.pollRender(captured ? 1011 : 11);
  assert.equal(handle.uninstall(), true);
  return handle.read();
}
function metadata() { return { target: 'pc-1280x720', armAttempted: true, armed: true, observerCleanup: true, handleDisposed: true, contextClosed: true, networkChecked: true, problems: [] }; }
function report() {
  return {
    config: { workers: 1, maxFailures: 0, fullyParallel: false, projects: [{ retries: 0 }] }, errors: [],
    stats: { expected: 35, skipped: 10, unexpected: 0, flaky: 0 },
    suites: [{ specs: EXPECTED_CASES.map((item: any, index: number) => ({ title: item.title, tests: [{ ...item, status: 'expected', results: [{ retry: 0, status: item.expectedStatus, startTime: new Date(10000 + index * 100).toISOString(), duration: 10 }] }] })) }],
  };
}
test('frozen helper compiles into import-free private closure and calls real queue once', () => {
  const helper = readFileSync(new URL('./first-native-stop.ts', import.meta.url), 'utf8');
  assert.equal(sha256(helper), HELPER_SHA);
  const i = input();
  const globals = { window: { __senryou: i.api }, document: { querySelector: (selector: string) => ({ '#start': i.start, '#startup-error': i.startupError, '#reload': i.reload } as any)[selector] } };
  const before = Object.keys(globals.window);
  const handle = vm.runInNewContext(injectionSource(helper), globals);
  i.api.view.queue.submit(10);
  assert.equal(i.api.view.pollRender(1011), 'stalled');
  assert.equal(handle.uninstall(), true);
  const r = handle.read();
  assert.equal(r.glCallCount, 1); assert.equal(r.glReturn, 37147); assert.equal(r.fenceAgeMs, 1001);
  assert.deepEqual(Object.keys(globals.window), before);
});
test('ephemeral source is exact reversible insertion around all original gameplay and cleanup', () => {
  const original = readFileSync(new URL('../../browser-tests/smoke.spec.ts', import.meta.url), 'utf8');
  let generated = instrument(original);
  assert.equal((generated.match(/await armNativeCapture\(/g) ?? []).length, 1);
  assert.equal((generated.match(/await screenshot\(page, vp.id,/g) ?? []).length, 4);
  for (const [before, after] of [...EDITS].reverse()) generated = generated.replace(after, before);
  assert.equal(generated, original);
  assert.throws(() => instrument(original + '\n'), /Smoke source drift/);
});
test('actual strict injection preserves null/wrong receivers, unexpected arity and exact native throws', () => {
  const helper = readFileSync(new URL('./first-native-stop.ts', import.meta.url), 'utf8');
  const injection = injectionSource(helper);
  assert.ok(injection.startsWith('(() => {\n"use strict";\n'));
  for (const receiver of [null, undefined, { foreign: true }]) for (const args of [[], [1], [undefined], [1, 2, 3, 4]]) {
    const run = (armed: boolean) => {
      const i = input(), trace: unknown[] = [], thrown = { native: 'identity' };
      let throwing = false;
      i.api.view.pollRender = function(this: unknown) { trace.push(this, [...arguments]); if (throwing) throw thrown; return 'ready'; };
      let handle: any;
      if (armed) handle = vm.runInNewContext(injection, { window: { __senryou: i.api }, document: { querySelector: (s: string) => ({ '#start': i.start, '#startup-error': i.startupError, '#reload': i.reload } as any)[s] } });
      const result = i.api.view.pollRender.apply(receiver, args as any);
      throwing = true;
      assert.throws(() => i.api.view.pollRender.apply(receiver, args as any), value => value === thrown);
      handle?.uninstall();
      return { result, trace };
    };
    assert.deepEqual(run(true), run(false));
  }
});
test('transport tears down before read, then disposes; context/network remain independently required', async () => {
  const state = createNativeCapture(), order: string[] = [];
  const payload = record();
  state.handle = { evaluate: async (fn: any) => fn({ uninstall() { order.push('uninstall'); return true; }, read() { order.push('read'); return payload; } }), dispose: async () => { order.push('dispose'); } } as any;
  await finishNativeCapture(state);
  assert.deepEqual(order, ['uninstall', 'read', 'dispose']);
  assert.equal(state.observerCleanup, true); assert.equal(state.handleDisposed, true);
  assert.equal(state.contextClosed, false); assert.equal(state.networkChecked, false);
  assert.equal(classify(state.record, state, false).classification, 'invalid-evidence');
});
test('transport suppresses oversized/nonASCII browser payload before crossing handle boundary', async () => {
  for (const bad of [{ arbitrary: 'x'.repeat(2000) }, { arbitrary: 'あ' }]) {
    const state = createNativeCapture(); let transferred: any;
    state.handle = { evaluate: async (fn: any) => { transferred = fn({ uninstall: () => true, read: () => bad }); return transferred; }, dispose: async () => {} } as any;
    await finishNativeCapture(state);
    assert.equal(transferred.payload, null);
    assert.equal(state.record, null);
    assert.ok(state.problems.includes('browser-record-bound-failed'));
  }
});
test('failed observer cleanup/read/transport/disposal cannot become complete or throw over gameplay error', async () => {
  for (const phase of ['cleanup', 'read', 'transport', 'dispose']) {
    const state = createNativeCapture();
    state.handle = { evaluate: async (fn: any) => { if (phase === 'transport') throw new Error('transport'); return fn({ uninstall: () => { if (phase === 'cleanup') throw new Error('cleanup'); return true; }, read: () => { if (phase === 'read') throw new Error('read'); return record(); } }); }, dispose: async () => { if (phase === 'dispose') throw new Error('dispose'); } } as any;
    await assert.doesNotReject(finishNativeCapture(state));
    assert.ok(state.problems.length);
    assert.equal(state.handle, null);
    assert.equal(classify(state.record, { ...metadata(), ...state }, false).classification, 'invalid-evidence');
  }
});
test('suite validation requires full45 realized sequential slots and original10 skips', () => {
  assert.deepEqual(validateSuite(report(), 0).problems, []);
  const r = report(); r.suites[0].specs.pop();
  assert.ok(validateSuite(r, 0).problems.includes('full-suite-identity-or-order'));
  const outOfOrder = report(); outOfOrder.suites[0].specs[42].tests[0].results[0].startTime = new Date(10000).toISOString();
  assert.ok(validateSuite(outOfOrder, 0).problems.includes('realized-suite-order'));
  const retry = report(); retry.suites[0].specs[0].tests[0].results[0].retry = 1;
  assert.ok(validateSuite(retry, 0).problems.includes('incomplete-or-retried-case'));
  const precedingFailure = report(); precedingFailure.suites[0].specs[0].tests[0].results[0].status = 'failed';
  assert.ok(validateSuite(precedingFailure, 1).problems.includes('preceding-workload-incomplete'));
});
test('native category remains safety rejection and invalid evidence cannot become timeout', () => {
  const r = record();
  assert.deepEqual(validateRecord(r), []);
  assert.equal(classify(r, metadata(), false).classification, 'existing-timeout-safety-rejection');
  for (const altered of [{ ...r, glReturn: 37149 }, { ...r, fenceAgeMs: 1000 }, { ...r, extra: true }, { ...r, valid: false }]) assert.equal(classify(altered, metadata(), false).classification, 'invalid-evidence');
  for (const flag of ['observerCleanup', 'handleDisposed', 'contextClosed', 'networkChecked']) assert.equal(classify(r, { ...metadata(), [flag]: false }, false).classification, 'invalid-evidence');
  assert.equal(classify({ ...r, priorDisplayedLatch: 'already-displayed', startDisabledBeforeConsumption: true, startupErrorHiddenBeforeConsumption: false, reloadHiddenBeforeConsumption: false }, metadata(), false).classification, 'prior-displayed-latch-origin-unobserved');
});
test('no record distinguishes clean non-reproduction from uncovered failure', () => {
  assert.equal(classify(record(false), metadata(), true).classification, 'not-reproduced-this-time');
  assert.equal(classify(record(false), metadata(), false).classification, 'no-poll-record-missing-failure-coverage');
  assert.equal(classify(null, metadata(), false).classification, 'invalid-evidence');
});
test('malformed counters, empty records, timestamps and failure branches fail closed', () => {
  const r = record();
  const noCapture = record(false);
  for (const changed of [
    { ...noCapture, explicitPollOrdinal: 0 }, { ...noCapture, explicitPollOrdinal: -1 }, { ...noCapture, explicitPollOrdinal: 1.5 },
    { ...noCapture, nativeViewReturn: 'failed' }, { ...noCapture, priorImplicitStopCount: 2 },
    { ...r, submittedOrdinal: -1 }, { ...r, queueNowMs: 1012 }, { ...r, fenceAgeMs: 1002 },
    { ...r, previousExplicitNowMs: 10, explicitPollIntervalMs: 1001 },
    { ...r, glThrew: true }, { ...r, glCallCount: 0 },
  ]) assert.equal(classify(changed, metadata(), true).classification, 'invalid-evidence');
  const failed = { ...r, nativeViewReturn: 'failed', nativeQueueReturn: 'failed', failureOrigin: 'this-poll', failureAfter: 'wait-failed' };
  for (const glReturn of [37146, 37147, 37148]) assert.equal(classify({ ...failed, glReturn }, metadata(), false).classification, 'invalid-evidence');
  for (const glReturn of [37149, 12345]) assert.equal(classify({ ...failed, glReturn }, metadata(), false).classification, 'native-wait-failure');
  assert.equal(classify({ ...failed, failureAfter: 'api-error', glReturn: null, glThrew: true }, metadata(), false).classification, 'native-clientWaitSync-threw');
  assert.equal(classify({ ...failed, failureAfter: 'api-error', glReturn: 37148 }, metadata(), false).classification, 'native-api-error-specific-operation-unobserved');
  assert.equal(classify({ ...failed, failureAfter: 'context-lost', glReturn: 37148 }, metadata(), false).classification, 'invalid-evidence');
  assert.equal(classify({ ...failed, failureAfter: 'context-lost', glReturn: 37149 }, metadata(), false).classification, 'native-context-loss-path');
});
test('workflow appends one independently gated job and preserves old paired marker', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/paired-harness-diagnostic.yml', import.meta.url), 'utf8');
  assert.equal((workflow.match(/run: node diagnostics\/native-stop\/run.mjs/g) ?? []).length, 1);
  assert.equal((workflow.match(/run: node scripts\/run-paired-harness.mjs/g) ?? []).length, 1);
  assert.match(workflow, /diagnostic: senryou paired harness 20261006-0905 once/);
  assert.match(workflow, /diagnostic: senryou first native stop 20261006-1115 once/);
  assert.match(workflow.slice(workflow.indexOf('  native-capture:')), /github\.run_attempt == 1/);
});
