import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RenderQueue } from '../../src/render-queue';
import { installFirstNativeStop, MAX_RECORD_JSON_BYTES, type ArmInput } from './first-native-stop';

class GLDouble {
  readonly SYNC_GPU_COMMANDS_COMPLETE = 37143;
  readonly ALREADY_SIGNALED = 37146; readonly TIMEOUT_EXPIRED = 37147;
  readonly CONDITION_SATISFIED = 37148; readonly WAIT_FAILED = 37149;
  result = this.TIMEOUT_EXPIRED; lost = false; unavailable = false;
  waitError: unknown = null; contextError: unknown = null; deleteError: unknown = null;
  serial = 0; trace: unknown[][] = [];
  isContextLost() { this.trace.push(['context', arguments.length]); if (this.contextError) throw this.contextError; return this.lost; }
  fenceSync(condition: number, flags: number) { this.trace.push(['fence', condition, flags, arguments.length]); return this.unavailable ? null : { serial: ++this.serial } as WebGLSync; }
  clientWaitSync(sync: WebGLSync, flags: number, timeout: number) {
    assert.equal(this instanceof GLDouble, true); this.trace.push(['wait', (sync as any).serial, flags, timeout, arguments.length]);
    if (this.waitError) throw this.waitError; return this.result;
  }
  deleteSync(sync: WebGLSync) { this.trace.push(['delete', (sync as any).serial, arguments.length]); if (this.deleteError) throw this.deleteError; }
  flush() { this.trace.push(['flush', arguments.length]); }
}
function fixture(arm = true) {
  const gl = new GLDouble(); const queue = new RenderQueue(gl);
  class View {
    prepared = true; queue = queue; implicitNow = 0; clockReads = 0; calls: number[] = [];
    clock() { this.clockReads++; return this.implicitNow; }
    pollRender(now = this.clock()) { this.calls.push(arguments.length); return this.queue.poll(now); }
  }
  const view = new View(); const mission = { tick: 120, phase: 'running' };
  const input = { api: { view, mission }, start: { disabled: false }, startupError: { hidden: true, textContent: '' }, reload: { hidden: true } };
  const handle = arm ? installFirstNativeStop(input) : null;
  return { gl, queue, view, mission, input, handle };
}

test('pinned-source identity and sole explicit call site are fixed, not live-head claims', () => {
  for (const [name, hash] of [
    ['main.ts', '9823637b3b9815106279f287fe652dbb73e133fa834a6d9ac9009538f2fb9a2a'],
    ['battle-view.ts', '0a21a6dc70b64778a0e3a2bec6b5b86b0fb358bd639a98263986b96b76bd6a12'],
    ['render-queue.ts', '8ec4611984beb7168ead1a7e758faf399b0cc0b73939502352be984ab35648f7'],
  ]) assert.equal(createHash('sha256').update(readFileSync(new URL(`../../src/${name}`, import.meta.url))).digest('hex'), hash);
  const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
  assert.equal((main.match(/view\?\.pollRender\(now\)/g) ?? []).length, 1);
  assert.match(main, /renderStatus==='failed'\|\|renderStatus==='stalled'[\s\S]*?graphicsFailure\(/);
});

test('1000ms boundary and first explicit original-call TIMEOUT_EXPIRED are recorded', () => {
  const f = fixture(); f.queue.submit(10);
  assert.equal(f.view.pollRender(1009.999), 'pending'); assert.equal(f.handle!.read().captured, false);
  assert.equal(f.view.pollRender(1010), 'pending'); assert.equal(f.handle!.read().captured, false);
  assert.equal(f.view.pollRender(1010.001), 'stalled');
  const r = f.handle!.read();
  assert.equal(r.valid, true); assert.equal(r.captured, true); assert.equal(r.explicitPollOrdinal, 3);
  assert.equal(r.nativeViewReturn, 'stalled'); assert.equal(r.nativeQueueReturn, 'stalled');
  assert.equal(r.queueNowMs, 1010.001); assert.equal(r.viewNowMs, 1010.001); assert.equal(r.previousExplicitNowMs, 1010);
  assert.equal(r.fenceAgeMs, 1000.001); assert.equal(r.submittedAtMs, 10); assert.equal(r.submittedOrdinal, 1); assert.equal(r.completedOrdinal, 0);
  assert.equal(r.glReturn, f.gl.TIMEOUT_EXPIRED); assert.equal(r.glCallCount, 1); assert.equal(r.glResultSource, 'original-call-direct');
  assert.equal(r.glFenceMatches, true); assert.equal(r.glFlags, 0); assert.equal(r.glTimeout, 0);
  assert.equal(r.priorDisplayedLatch, 'not-displayed'); assert.equal(r.tick, 120); assert.equal(r.phase, 'running');
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= MAX_RECORD_JSON_BYTES);
  assert.deepEqual(f.view.calls, [1, 1, 1]); assert.equal(f.view.clockReads, 0);
});

test('signalled fence beyond 1000ms does not produce a false timeout record', () => {
  for (const signal of [37146, 37148]) {
    const f = fixture(); f.queue.submit(0); f.gl.result = signal;
    assert.equal(f.view.pollRender(2000), 'ready'); assert.equal(f.handle!.read().captured, false);
    assert.equal(f.handle!.read().valid, true); assert.equal(f.queue.diagnostics(2000).lastCompletedPendingMs, 2000);
  }
});

test('no extra context/wait/fence/flush/delete calls or clocks across matching scripts', () => {
  function run(arm: boolean) {
    const f = fixture(arm); const results: unknown[] = [];
    results.push(f.view.pollRender(0)); f.queue.submit(0);
    results.push(f.view.pollRender(100)); f.view.implicitNow = 110; results.push(f.view.pollRender());
    f.gl.result = f.gl.CONDITION_SATISFIED; results.push(f.view.pollRender(1500));
    f.queue.submit(1500); f.gl.result = f.gl.TIMEOUT_EXPIRED; results.push(f.view.pollRender(2501));
    f.gl.result = f.gl.CONDITION_SATISFIED; results.push(f.view.pollRender(3000));
    return { trace: f.gl.trace, results, clocks: f.view.clockReads, args: f.view.calls, diagnostics: f.queue.diagnostics(3000) };
  }
  assert.deepEqual(run(true), run(false));
});

test('implicit render stall is not main consumption and can complete without a main stop', () => {
  const f = fixture(); f.queue.submit(0); f.view.implicitNow = 1001;
  assert.equal(f.view.pollRender(), 'stalled'); assert.equal(f.handle!.read().captured, false);
  f.gl.result = f.gl.ALREADY_SIGNALED; assert.equal(f.view.pollRender(1010), 'ready'); assert.equal(f.handle!.read().captured, false);
  f.queue.submit(1100); f.gl.result = f.gl.TIMEOUT_EXPIRED;
  assert.equal(f.view.pollRender(2101), 'stalled');
  const r = f.handle!.read(); assert.equal(r.valid, true); assert.equal(r.priorImplicitStopCount, 1); assert.equal(r.submittedOrdinal, 2);
  assert.deepEqual(f.view.calls, [0, 1, 1]); assert.equal(f.view.clockReads, 1);
});

test('implicit wait failure then explicit consumption is labelled prelatched, not a current GL return', () => {
  const f = fixture(); f.queue.submit(0); f.gl.result = f.gl.WAIT_FAILED; f.view.implicitNow = 50;
  assert.equal(f.view.pollRender(), 'failed'); assert.equal(f.handle!.read().captured, false);
  assert.equal(f.view.pollRender(100), 'failed'); const r = f.handle!.read();
  assert.equal(r.valid, true); assert.equal(r.failureOrigin, 'prelatched-origin-unobserved'); assert.equal(r.priorImplicitStopCount, 1);
  assert.equal(r.failureBefore, 'wait-failed'); assert.equal(r.failureAfter, 'wait-failed'); assert.equal(r.glCallCount, 0);
  assert.equal(r.glReturn, null); assert.equal(r.glResultSource, 'not-called'); assert.equal(r.fencePresentBefore, false); assert.equal(r.fenceAgeMs, null);
});

test('submit-origin prelatched failure is labelled unobserved without invented GL outcome', () => {
  const f = fixture(); f.gl.unavailable = true; f.queue.submit(0); assert.equal(f.view.pollRender(10), 'failed');
  const r = f.handle!.read(); assert.equal(r.valid, true); assert.equal(r.failureBefore, 'fence-unavailable');
  assert.equal(r.failureOrigin, 'prelatched-origin-unobserved'); assert.equal(r.priorImplicitStopCount, 0); assert.equal(r.glCallCount, 0);
});

test('direct WAIT_FAILED and unexpected numeric wait results are preserved', () => {
  for (const result of [37149, 12345]) {
    const f = fixture(); f.queue.submit(0); f.gl.result = result;
    assert.equal(f.view.pollRender(50), 'failed'); const r = f.handle!.read();
    assert.equal(r.valid, true); assert.equal(r.glReturn, result); assert.equal(r.failureOrigin, 'this-poll'); assert.equal(r.failureAfter, 'wait-failed');
    assert.equal(r.fencePresentBefore, true); assert.equal(r.fenceAgeMs, 50); assert.equal((f.queue as any).fence, null);
  }
});

test('existing GL throw is observed and unchanged queue catches it as api-error', () => {
  const f = fixture(); const sentinel = new Error('SECRET_DO_NOT_COPY'); f.queue.submit(0); f.gl.waitError = sentinel;
  assert.equal(f.view.pollRender(20), 'failed'); const r = f.handle!.read();
  assert.equal(r.valid, true); assert.equal(r.glThrew, true); assert.equal(r.glReturn, null); assert.equal(r.failureAfter, 'api-error');
  assert.equal(JSON.stringify(r).includes('SECRET'), false);
  assert.throws(() => f.gl.clientWaitSync({} as WebGLSync, 0, 0), e => e === sentinel);
});

test('context loss and isContextLost throw never add context queries or infer direct wait results', () => {
  for (const throwing of [false, true]) {
    const f = fixture(); f.queue.submit(0); f.gl.trace.length = 0;
    f.gl.lost = !throwing; if (throwing) f.gl.contextError = new Error('context');
    assert.equal(f.view.pollRender(20), 'failed'); const r = f.handle!.read();
    assert.equal(r.valid, true); assert.equal(r.failureAfter, throwing ? 'api-error' : 'context-lost'); assert.equal(r.glCallCount, 0);
    assert.deepEqual(f.gl.trace.map(x => x[0]), ['context', 'delete']);
  }
});

test('release failure preserves direct signal result and API-failure classification', () => {
  const f = fixture(); f.queue.submit(0); f.gl.result = f.gl.ALREADY_SIGNALED; f.gl.deleteError = new Error('delete');
  assert.equal(f.view.pollRender(2000), 'failed'); const r = f.handle!.read();
  assert.equal(r.valid, true); assert.equal(r.glReturn, f.gl.ALREADY_SIGNALED); assert.equal(r.glThrew, false); assert.equal(r.failureAfter, 'api-error');
});

test('one fixed record survives later failures/mission changes; wrappers become inert', () => {
  const f = fixture(); f.queue.submit(0); f.view.pollRender(1001); const first = f.handle!.read();
  f.mission.tick = 999; f.mission.phase = 'paused'; f.gl.result = f.gl.WAIT_FAILED;
  f.view.pollRender(2000); f.view.implicitNow = 3000; f.view.pollRender();
  assert.deepEqual(f.handle!.read(), first); assert.equal(Object.isFrozen(first), true);
});

test('prior non-queue displayed safety latch is reported before main consumption', () => {
  const f = fixture(); f.queue.submit(0);
  f.input.start.disabled = true; f.input.startupError.hidden = false; f.input.reload.hidden = false;
  f.view.pollRender(1001); const r = f.handle!.read();
  assert.equal(r.valid, true); assert.equal(r.priorDisplayedLatch, 'already-displayed'); assert.equal(r.failureBefore, null);
});

test('mixed latch flags invalidate trigger provenance without changing native stop', () => {
  const f = fixture(); f.queue.submit(0); f.input.reload.hidden = false;
  assert.equal(f.view.pollRender(1001), 'stalled'); assert.equal(f.handle!.read().valid, false); assert.equal(f.handle!.read().invalidCode, 'latch-ambiguous');
});

test('UI flag reads happen only at setup and capture, not healthy polls', () => {
  const f = fixture(false); let reads = 0;
  Object.defineProperty(f.input.start, 'disabled', { get() { reads++; return false; } });
  const h = installFirstNativeStop(f.input); const afterSetup = reads;
  for (let n = 0; n < 100; n++) assert.equal(f.view.pollRender(n), 'ready');
  assert.equal(reads, afterSetup); f.queue.submit(100); f.view.pollRender(1101); assert.equal(reads, afterSetup + 1);
  h.read(); assert.equal(reads, afterSetup + 1);
});

test('observer mission read error cannot suppress or replace native return; no error text', () => {
  const f = fixture(); f.queue.submit(0);
  Object.defineProperty(f.input.api, 'mission', { get() { throw new Error('SECRET'); } });
  assert.equal(f.view.pollRender(1001), 'stalled'); const r = f.handle!.read();
  assert.equal(r.captured, true); assert.equal(r.valid, false); assert.equal(r.invalidCode, 'observer-read'); assert.equal(JSON.stringify(r).includes('SECRET'), false);
});

test('unexpected view arity passes exact receiver/arguments through and marks invalid', () => {
  const f = fixture(false); const original = f.view.pollRender; let observed: any[] = [];
  f.view.pollRender = function (now?: number) { observed = [this, ...arguments]; return original.call(this, now); };
  const h = installFirstNativeStop(f.input); f.queue.submit(0);
  assert.equal((f.view.pollRender as any)(1001, 'extra'), 'stalled');
  assert.equal(observed[0], f.view); assert.deepEqual(observed.slice(1), [1001, 'extra']);
  assert.equal(h.read().valid, false); assert.equal(h.read().invalidCode, 'unexpected-call'); assert.equal(h.read().captured, false);
});

test('unexpected direct queue invocation preserves native result and invalidates observation', () => {
  const f = fixture(); f.queue.submit(0);
  assert.equal((f.queue.poll as any)(1001, 'extra'), 'stalled'); assert.equal(f.handle!.read().valid, false);
  assert.equal(f.view.pollRender(1002), 'stalled'); assert.equal(f.handle!.read().captured, true); assert.equal(f.handle!.read().valid, false);
});

test('native poll exception identity is unchanged and never exported', () => {
  const f = fixture(false); const sentinel = new Error('SECRET_NATIVE'); f.queue.poll = () => { throw sentinel; };
  const h = installFirstNativeStop(f.input);
  assert.throws(() => f.view.pollRender(1), e => e === sentinel); const r = h.read();
  assert.equal(r.captured, false); assert.equal(r.valid, false); assert.equal(r.invalidCode, 'native-throw'); assert.equal(JSON.stringify(r).includes('SECRET'), false);
});

test('wrong view receiver and no-argument undefined behavior are not silently repaired', () => {
  const f = fixture(); const other = { queue: f.queue, calls: [] as number[], clock: () => 5 };
  assert.equal(f.view.pollRender.call(other as any, 5), 'ready'); assert.deepEqual(other.calls, [1]); assert.equal(f.handle!.read().valid, false);
  const g = fixture(); g.view.implicitNow = 10;
  assert.equal(g.view.pollRender(undefined), 'ready'); assert.deepEqual(g.view.calls, [1]); assert.equal(g.view.clockReads, 1); assert.equal(g.handle!.read().valid, false);
});

test('arming rejects prior queue/graphics failure without modifying methods', () => {
  for (const mode of ['queue', 'start', 'error', 'reload', 'prepared'] as const) {
    const f = fixture(false); const native = f.gl.clientWaitSync;
    if (mode === 'queue') { f.gl.lost = true; f.queue.poll(0); }
    if (mode === 'start') f.input.start.disabled = true;
    if (mode === 'error') f.input.startupError.hidden = false;
    if (mode === 'reload') f.input.reload.hidden = false;
    if (mode === 'prepared') f.view.prepared = false;
    assert.throws(() => installFirstNativeStop(f.input)); assert.equal(f.gl.clientWaitSync, native);
    assert.equal(Object.hasOwn(f.view, 'pollRender'), false);
  }
});

test('preflight rejects accessor private data without invoking it', () => {
  const f = fixture(false); let reads = 0;
  Object.defineProperty(f.queue, 'submittedAtMs', { get() { reads++; return 0; } });
  assert.throws(() => installFirstNativeStop(f.input)); assert.equal(reads, 0); assert.equal(Object.hasOwn(f.gl, 'clientWaitSync'), false);
});

test('uninstall restores exact own/inherited descriptors and is idempotent', () => {
  const f = fixture(false); const original = f.view.pollRender;
  Object.defineProperty(f.view, 'pollRender', { value: original, configurable: true, writable: true, enumerable: true });
  const before = Object.getOwnPropertyDescriptor(f.view, 'pollRender'); const h = installFirstNativeStop(f.input);
  assert.equal(h.uninstall(), true); assert.deepEqual(Object.getOwnPropertyDescriptor(f.view, 'pollRender'), before);
  assert.equal(Object.hasOwn(f.queue, 'poll'), false); assert.equal(Object.hasOwn(f.gl, 'clientWaitSync'), false); assert.equal(h.uninstall(), true);
});

test('foreign attribute-only method changes are preserved; cleanup leaves collector inert', () => {
  const f = fixture(); Object.defineProperty(f.view, 'pollRender', { enumerable: true });
  const foreignDescriptor = Object.getOwnPropertyDescriptor(f.view, 'pollRender');
  assert.equal(f.handle!.uninstall(), false); assert.deepEqual(Object.getOwnPropertyDescriptor(f.view, 'pollRender'), foreignDescriptor);
  f.queue.submit(0); assert.equal(f.view.pollRender(1001), 'stalled'); assert.equal(f.handle!.read().captured, false); assert.equal(f.handle!.read().invalidCode, 'ownership-changed');
});

test('partial install rolls back original GL descriptor when queue attachment fails', () => {
  const f = fixture(false); const nativeWait = f.gl.clientWaitSync;
  const proxy = new Proxy(f.queue, { defineProperty(target, name, descriptor) { if (name === 'poll') throw new Error('refuse'); return Reflect.defineProperty(target, name, descriptor); } });
  f.view.queue = proxy; assert.throws(() => installFirstNativeStop(f.input));
  assert.equal(f.gl.clientWaitSync, nativeWait); assert.equal(Object.hasOwn(f.gl, 'clientWaitSync'), false); assert.equal(Object.hasOwn(f.view, 'pollRender'), false);
});

test('foreign queue/view replacement invalidates record at extraction', () => {
  const f = fixture(); f.input.api.view = fixture(false).view;
  assert.equal(f.handle!.read().valid, false); assert.equal(f.handle!.read().invalidCode, 'ownership-changed');
});

test('invalid timestamp and ordinal data stays diagnostic-only', () => {
  const f = fixture(); f.queue.submit(0); (f.queue as any).submittedCount = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(f.view.pollRender(1001), 'stalled'); assert.equal(f.handle!.read().valid, false); assert.equal(f.handle!.read().submittedOrdinal, null);
  const g = fixture(); g.queue.submit(0); assert.equal(g.view.pollRender(Number.NaN), 'pending'); assert.equal(g.handle!.read().valid, false);
});

test('record is bounded primitives and never contains native handles, state arrays, or identifiers', () => {
  const f = fixture(); f.queue.submit(0); f.view.pollRender(1001); const r = f.handle!.read();
  for (const v of Object.values(r)) assert.ok(v === null || ['string', 'number', 'boolean'].includes(typeof v));
  const serialized = JSON.stringify(r); assert.ok(Buffer.byteLength(serialized) <= MAX_RECORD_JSON_BYTES);
  for (const term of ['WebGLSync', 'SECRET', 'missionId', 'http:', 'token', 'units', 'intervals', 'stack']) assert.equal(serialized.includes(term), false);
});

test('wrapper source performs no explicit per-poll allocation, clock, snapshot, IO, or extra GL operation', () => {
  const source = readFileSync(new URL('./first-native-stop.ts', import.meta.url), 'utf8');
  const hot = source.slice(source.indexOf('  function wrappedView'), source.indexOf('  function restore'));
  assert.doesNotMatch(hot, /\bnew\s|\.\.\.|\bperformance\b|\bDate\b|\bsnapshot\s*\(|\bdiagnostics\s*\(|battleHash|\bfetch\b|\bconsole\b|\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b|\baddEventListener\b|\bJSON\b|Object\.(?:assign|keys|values|entries|create|freeze)/);
  assert.doesNotMatch(hot, /=\s*\[|=\s*\{/);
  assert.doesNotMatch(hot, /\.isContextLost\s*\(|\.flush\s*\(|\.fenceSync\s*\(|\.deleteSync\s*\(|\.submit\s*\(|\.reset\s*\(/);
  assert.match(hot, /originalWait\.call\(this, sync, flags, timeout\)/);
});

test('observer one-shot UI read error cannot replace native return', () => {
  const f = fixture(); f.queue.submit(0);
  Object.defineProperty(f.input.start, 'disabled', { get() { throw new Error('SECRET_UI'); } });
  assert.equal(f.view.pollRender(1001), 'stalled'); const r = f.handle!.read();
  assert.equal(r.captured, true); assert.equal(r.valid, false); assert.equal(r.invalidCode, 'observer-read'); assert.equal(JSON.stringify(r).includes('SECRET'), false);
});

test('implicit failure/stall counters are distinct and no-event extraction proves observed coverage', () => {
  const f = fixture(); f.view.pollRender(0); f.queue.submit(0); f.view.implicitNow = 1001;
  f.view.pollRender(); const none = f.handle!.read();
  assert.equal(none.captured, false); assert.equal(none.explicitPollOrdinal, 1); assert.equal(none.priorImplicitStalledCount, 1); assert.equal(none.priorImplicitFailedCount, 0);
  f.gl.result = f.gl.WAIT_FAILED; f.view.pollRender(); f.view.pollRender(1002); const event = f.handle!.read();
  assert.equal(event.priorImplicitStopCount, 2); assert.equal(event.priorImplicitFailedCount, 1); assert.equal(event.priorImplicitStalledCount, 1);
});

test('non-finite derived intervals are normalized to null and diagnostic invalid', () => {
  const f = fixture(); f.view.pollRender(-Number.MAX_VALUE); f.queue.submit(0);
  assert.equal(f.view.pollRender(Number.MAX_VALUE), 'stalled'); const r = f.handle!.read();
  assert.equal(r.valid, false); assert.equal(r.explicitPollIntervalMs, null);
  for (const value of Object.values(r)) if (typeof value === 'number') assert.equal(Number.isFinite(value), true);
});

test('armed/unarmed failure matrix preserves every GL call, native outcome, and final queue state', () => {
  for (const scenario of ['wait-failed', 'context-lost', 'wait-throw', 'delete-throw', 'submit-prelatched'] as const) {
    function run(armed: boolean) {
      const f = fixture(armed); const sentinel = new Error('same synthetic error');
      if (scenario === 'submit-prelatched') f.gl.unavailable = true;
      f.queue.submit(0);
      if (scenario === 'wait-failed') f.gl.result = f.gl.WAIT_FAILED;
      if (scenario === 'context-lost') f.gl.lost = true;
      if (scenario === 'wait-throw') f.gl.waitError = sentinel;
      if (scenario === 'delete-throw') { f.gl.result = f.gl.ALREADY_SIGNALED; f.gl.deleteError = sentinel; }
      let escaped: boolean | null = null; let result: unknown;
      try { result = f.view.pollRender(1001); } catch (error) { escaped = error === sentinel; }
      const nativeState = { ...f.queue } as any; delete nativeState.gl;
      const diagnostics = f.queue.diagnostics(1001);
      return { trace: f.gl.trace, result, escaped, nativeState, diagnostics, clockReads: f.view.clockReads, arity: f.view.calls };
    }
    assert.deepEqual(run(true), run(false), scenario);
  }
});
