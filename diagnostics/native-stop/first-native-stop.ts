/** LOCAL-ONLY, unwired candidate. No browser/runner transport or source mutation.
 * Observe original calls; never call a clock or an extra graphics API.
 */
type NativeStatus = 'ready' | 'pending' | 'stalled' | 'failed';
type Failure = 'context-lost' | 'wait-failed' | 'fence-unavailable' | 'submission-pending' | 'api-error' | 'disposed' | null;
type Invalid = 'none' | 'unexpected-call' | 'reentrant-call' | 'observer-read' | 'native-throw' | 'counter-overflow' | 'call-mismatch' | 'invalid-data' | 'ownership-changed' | 'payload-bound' | 'latch-ambiguous';
export interface FirstNativeStop {
  schema: 1; kind: 'first-explicit-stop-poll'; coverage: 'post-ready-armed-epoch';
  captured: boolean; valid: boolean; invalidCode: Invalid;
  explicitPollOrdinal: number; priorImplicitStopCount: number; priorImplicitFailedCount: number; priorImplicitStalledCount: number;
  viewArgumentCount: number | null; viewNowMs: number | null; queueNowMs: number | null;
  previousExplicitNowMs: number | null; explicitPollIntervalMs: number | null;
  nativeViewReturn: NativeStatus | null; nativeQueueReturn: NativeStatus | null; queuePollCount: number;
  fencePresentBefore: boolean; submittedOrdinal: number | null; completedOrdinal: number | null;
  submittedAtMs: number | null; fenceAgeMs: number | null;
  failureBefore: Failure; failureAfter: Failure;
  failureOrigin: 'not-failed' | 'this-poll' | 'prelatched-origin-unobserved';
  glResultSource: 'original-call-direct' | 'not-called';
  glCallCount: number; glReturn: number | null; glThrew: boolean;
  glFenceMatches: boolean | null; glFlags: number | null; glTimeout: number | null;
  startDisabledBeforeConsumption: boolean | null; startupErrorHiddenBeforeConsumption: boolean | null; reloadHiddenBeforeConsumption: boolean | null;
  priorDisplayedLatch: 'not-displayed' | 'already-displayed' | 'mixed-or-unobserved';
  tick: number | null; phase: 'running' | 'paused' | 'result' | null;
}
export const MAX_RECORD_JSON_BYTES = 4096;
type Fn = (...args: any[]) => any; // Type only; wrappers below have no rest parameters.
type AnyObject = Record<string, any>;
export interface ArmInput {
  api: { readonly view: unknown; readonly mission: unknown };
  start: { readonly disabled: boolean };
  startupError: { readonly textContent: string | null; readonly hidden: boolean };
  reload: { readonly hidden: boolean };
}

export function installFirstNativeStop(input: ArmInput) {
  // Setup only. Shape checks reject accessors for private fields/methods before
  // installing anything. Private TS fields are ordinary own data fields here.
  const view = input.api.view as AnyObject;
  const ownData = (o: AnyObject, key: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(o, key);
    if (!descriptor || !('value' in descriptor)) throw new Error('Unsupported diagnostic shape');
    return descriptor.value;
  };
  if (!view || ownData(view, 'prepared') !== true || input.start.disabled !== false || input.startupError.hidden !== true || input.reload.hidden !== true || input.startupError.textContent?.trim()) {
    throw new Error('Diagnostic must arm while preparation is complete and Start is enabled');
  }
  const queue = ownData(view, 'queue') as AnyObject;
  const gl = ownData(queue, 'gl') as AnyObject;
  for (const key of ['fence', 'submittedAtMs', 'submittedCount', 'completedCount', 'failure']) ownData(queue, key);
  if (queue.failure !== null) throw new Error('Diagnostic cannot arm over a latched queue failure');
  function method(o: AnyObject, name: string): Fn {
    if (!Object.isExtensible(o)) throw new Error('Unsupported diagnostic target');
    let owner: AnyObject | null = o;
    while (owner) {
      const d = Object.getOwnPropertyDescriptor(owner, name);
      if (d) {
        if (!('value' in d) || typeof d.value !== 'function' || (owner === o && !d.configurable)) throw new Error('Unsupported diagnostic method');
        return d.value;
      }
      owner = Object.getPrototypeOf(owner);
    }
    throw new Error('Diagnostic method missing');
  }
  const originalView = method(view, 'pollRender');
  const originalQueue = method(queue, 'poll');
  const originalWait = method(gl, 'clientWaitSync');
  const viewDescriptor = Object.getOwnPropertyDescriptor(view, 'pollRender');
  const queueDescriptor = Object.getOwnPropertyDescriptor(queue, 'poll');
  const waitDescriptor = Object.getOwnPropertyDescriptor(gl, 'clientWaitSync');
  const record: FirstNativeStop = {
    schema: 1, kind: 'first-explicit-stop-poll', coverage: 'post-ready-armed-epoch',
    captured: false, valid: true, invalidCode: 'none', explicitPollOrdinal: 0, priorImplicitStopCount: 0, priorImplicitFailedCount: 0, priorImplicitStalledCount: 0,
    viewArgumentCount: null, viewNowMs: null, queueNowMs: null, previousExplicitNowMs: null, explicitPollIntervalMs: null,
    nativeViewReturn: null, nativeQueueReturn: null, queuePollCount: 0,
    fencePresentBefore: false, submittedOrdinal: null, completedOrdinal: null, submittedAtMs: null, fenceAgeMs: null,
    failureBefore: null, failureAfter: null, failureOrigin: 'not-failed',
    glResultSource: 'not-called', glCallCount: 0, glReturn: null, glThrew: false, glFenceMatches: null,
    glFlags: null, glTimeout: null, startDisabledBeforeConsumption: null, startupErrorHiddenBeforeConsumption: null, reloadHiddenBeforeConsumption: null, priorDisplayedLatch: 'mixed-or-unobserved', tick: null, phase: null,
  };
  let enabled = true, installed = false;
  let viewActive = false, queueActive = false;
  let explicitOrdinal = 0, implicitStops = 0, implicitFailed = 0, implicitStalled = 0, previousExplicit: number | null = null;
  let queueCalls = 0, queueNow: number | null = null, queueReturn: NativeStatus | null = null;
  let fenceBefore: unknown = null, submittedAt: number | null = null, submittedOrdinal: number | null = null, completedOrdinal: number | null = null;
  let failureBefore: Failure = null, failureAfter: Failure = null;
  let waitCalls = 0, waitReturn: number | null = null, waitThrew = false, waitFenceMatches: boolean | null = null;
  let waitFlags: number | null = null, waitTimeout: number | null = null;
  function invalid(code: Invalid): void { record.valid = false; if (record.invalidCode === 'none') record.invalidCode = code; }
  function finite(value: unknown): number | null { if (typeof value === 'number' && Number.isFinite(value)) return value; invalid('invalid-data'); return null; }
  function timestamp(value: unknown): number | null { const n = finite(value); if (n !== null && n >= 0) return n; invalid('invalid-data'); return null; }
  function ordinal(value: unknown): number | null { if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value; invalid('invalid-data'); return null; }
  function increment(value: number): number { if (value >= Number.MAX_SAFE_INTEGER) { invalid('counter-overflow'); return Number.MAX_SAFE_INTEGER; } return value + 1; }
  function failure(value: unknown): Failure {
    switch (value) {
      case null: case 'context-lost': case 'wait-failed': case 'fence-unavailable': case 'submission-pending': case 'api-error': case 'disposed': return value;
      default: invalid('invalid-data'); return null;
    }
  }
  function status(value: unknown): NativeStatus | null {
    switch (value) { case 'ready': case 'pending': case 'stalled': case 'failed': return value; default: invalid('invalid-data'); return null; }
  }
  // No explicit allocation, array/rest/spread, clock, I/O, or extra GL call in
  // these three wrappers. Unexpected arity is invalidated and transparently
  // forwarded with the existing arguments object; it is not a valid hot path.
  function wrappedView(this: unknown, now?: number): any {
    const count = arguments.length;
    if (!enabled) {
      if (count === 0) return originalView.call(this);
      if (count === 1) return originalView.call(this, now);
      return originalView.apply(this, arguments as any);
    }
    if (this !== view || viewActive || (count !== 0 && !(count === 1 && typeof now === 'number' && Number.isFinite(now)))) {
      invalid(viewActive ? 'reentrant-call' : 'unexpected-call');
      if (count === 0) return originalView.call(this);
      if (count === 1) return originalView.call(this, now);
      return originalView.apply(this, arguments as any);
    }
    const explicit = count === 1;
    const preceding = previousExplicit;
    if (explicit) { explicitOrdinal = increment(explicitOrdinal); previousExplicit = now!; }
    queueCalls = 0; queueReturn = null; queueNow = null;
    viewActive = true;
    let result: any;
    try { result = explicit ? originalView.call(this, now) : originalView.call(this); }
    catch (error) { invalid('native-throw'); throw error; }
    finally { viewActive = false; }
    if (queueCalls !== 1 || queueReturn !== result || (explicit && queueNow !== now)) invalid('call-mismatch');
    if (!explicit) {
      if (result === 'failed' || result === 'stalled') implicitStops = increment(implicitStops);
      if (result === 'failed') implicitFailed = increment(implicitFailed);
      if (result === 'stalled') implicitStalled = increment(implicitStalled);
      return result;
    }
    if (result !== 'failed' && result !== 'stalled') return result;
    // First main-eligible return wins. This is before the original frame caller
    // consumes it; no claim to observe graphicsFailure closure locals is made.
    record.captured = true; enabled = false;
    try {
      record.explicitPollOrdinal = explicitOrdinal; record.priorImplicitStopCount = implicitStops; record.priorImplicitFailedCount = implicitFailed; record.priorImplicitStalledCount = implicitStalled;
      record.viewArgumentCount = count; record.viewNowMs = now!; record.queueNowMs = queueNow;
      record.previousExplicitNowMs = preceding; record.explicitPollIntervalMs = preceding === null ? null : finite(now! - preceding);
      record.nativeViewReturn = result; record.nativeQueueReturn = queueReturn; record.queuePollCount = queueCalls;
      record.fencePresentBefore = fenceBefore !== null;
      record.submittedOrdinal = submittedOrdinal; record.completedOrdinal = completedOrdinal;
      record.submittedAtMs = fenceBefore === null ? null : submittedAt;
      record.fenceAgeMs = fenceBefore === null || queueNow === null || submittedAt === null ? null : finite(Math.max(0, queueNow - submittedAt));
      record.failureBefore = failureBefore; record.failureAfter = failureAfter;
      record.failureOrigin = result !== 'failed' ? 'not-failed' : failureBefore === null ? 'this-poll' : 'prelatched-origin-unobserved';
      record.glResultSource = waitCalls ? 'original-call-direct' : 'not-called';
      record.glCallCount = waitCalls; record.glReturn = waitReturn; record.glThrew = waitThrew; record.glFenceMatches = waitFenceMatches;
      record.glFlags = waitFlags; record.glTimeout = waitTimeout;
      // Read these existing UI flags once, after the original poll, before its
      // caller can set the graphics latch. The pinned poll does not write DOM.
      const startDisabled = input.start.disabled, startupHidden = input.startupError.hidden, reloadHidden = input.reload.hidden;
      if (typeof startDisabled === 'boolean' && typeof startupHidden === 'boolean' && typeof reloadHidden === 'boolean') {
        record.startDisabledBeforeConsumption = startDisabled; record.startupErrorHiddenBeforeConsumption = startupHidden; record.reloadHiddenBeforeConsumption = reloadHidden;
        if (!startDisabled && startupHidden && reloadHidden) record.priorDisplayedLatch = 'not-displayed';
        else if (startDisabled && !startupHidden && !reloadHidden) record.priorDisplayedLatch = 'already-displayed';
        else invalid('latch-ambiguous');
      } else invalid('invalid-data');
      const mission = input.api.mission as AnyObject;
      record.tick = ordinal(mission.tick);
      const phase = mission.phase;
      if (phase === 'running' || phase === 'paused' || phase === 'result') record.phase = phase; else invalid('invalid-data');
      if (record.explicitPollIntervalMs !== null && (!Number.isFinite(record.explicitPollIntervalMs) || record.explicitPollIntervalMs < 0)) invalid('invalid-data');
      if (record.fenceAgeMs !== null && (!Number.isFinite(record.fenceAgeMs) || submittedAt! > queueNow!)) invalid('invalid-data');
      if (queueCalls !== 1 || waitCalls > 1 || (waitCalls === 1 && (!waitFenceMatches || waitFlags !== 0 || waitTimeout !== 0))) invalid('call-mismatch');
    } catch { invalid('observer-read'); }
    fenceBefore = null; // Retain no WebGLSync after capture.
    return result;
  }
  function wrappedQueue(this: unknown, now?: number): any {
    if (!enabled || !viewActive || this !== queue || arguments.length !== 1 || queueActive) {
      if (enabled) invalid(queueActive ? 'reentrant-call' : 'unexpected-call');
      if (arguments.length === 1) return originalQueue.call(this, now);
      return originalQueue.apply(this, arguments as any);
    }
    queueCalls = increment(queueCalls);
    waitCalls = 0; waitReturn = null; waitThrew = false; waitFenceMatches = null; waitFlags = null; waitTimeout = null;
    try {
      queueNow = timestamp(now); fenceBefore = queue.fence;
      submittedAt = timestamp(queue.submittedAtMs); submittedOrdinal = ordinal(queue.submittedCount); completedOrdinal = ordinal(queue.completedCount);
      failureBefore = failure(queue.failure);
    } catch { invalid('observer-read'); }
    queueActive = true;
    let result: any;
    try { result = originalQueue.call(this, now); }
    catch (error) { invalid('native-throw'); throw error; }
    finally { queueActive = false; }
    try { queueReturn = status(result); failureAfter = failure(queue.failure); }
    catch { invalid('observer-read'); }
    return result;
  }
  function wrappedWait(this: unknown, sync?: unknown, flags?: number, timeout?: number): any {
    const observing = enabled && queueActive && this === gl && arguments.length === 3;
    if (enabled && queueActive && !observing) invalid('unexpected-call');
    if (observing) {
      waitCalls = increment(waitCalls); waitFenceMatches = sync === fenceBefore;
      waitFlags = finite(flags); waitTimeout = finite(timeout);
    }
    let result: any;
    try {
      result = arguments.length === 3 ? originalWait.call(this, sync, flags, timeout) : originalWait.apply(this, arguments as any);
    } catch (error) { if (observing) waitThrew = true; throw error; }
    if (observing) waitReturn = finite(result);
    return result;
  }
  function restore(o: AnyObject, key: string, descriptor: PropertyDescriptor | undefined) {
    if (descriptor) Object.defineProperty(o, key, descriptor); else delete o[key];
  }
  // Setup and teardown are outside the running frame. Roll back a partial
  // installation. No prototype or global method is touched.
  function unchangedDescriptor(o: AnyObject, name: string, installedDescriptor: PropertyDescriptor | undefined): boolean {
    const d = Object.getOwnPropertyDescriptor(o, name);
    return !!d && !!installedDescriptor && d.value === installedDescriptor.value && d.configurable === installedDescriptor.configurable && d.enumerable === installedDescriptor.enumerable && d.writable === installedDescriptor.writable && !d.get && !d.set;
  }
  let installedViewDescriptor: PropertyDescriptor | undefined, installedQueueDescriptor: PropertyDescriptor | undefined, installedWaitDescriptor: PropertyDescriptor | undefined;
  function ownsMethods(): boolean {
    return unchangedDescriptor(view, 'pollRender', installedViewDescriptor) && unchangedDescriptor(queue, 'poll', installedQueueDescriptor) && unchangedDescriptor(gl, 'clientWaitSync', installedWaitDescriptor);
  }
  let changedWait = false, changedQueue = false, changedView = false;
  try {
    Object.defineProperty(gl, 'clientWaitSync', { configurable: true, writable: true, value: wrappedWait }); changedWait = true;
    Object.defineProperty(queue, 'poll', { configurable: true, writable: true, value: wrappedQueue }); changedQueue = true;
    Object.defineProperty(view, 'pollRender', { configurable: true, writable: true, value: wrappedView }); changedView = true;
    installedViewDescriptor = Object.getOwnPropertyDescriptor(view, 'pollRender'); installedQueueDescriptor = Object.getOwnPropertyDescriptor(queue, 'poll'); installedWaitDescriptor = Object.getOwnPropertyDescriptor(gl, 'clientWaitSync');
    installed = true;
  } catch (error) {
    if (changedView) restore(view, 'pollRender', viewDescriptor);
    if (changedQueue) restore(queue, 'poll', queueDescriptor);
    if (changedWait) restore(gl, 'clientWaitSync', waitDescriptor);
    throw error;
  }
  return {
    // Explicit end-of-case extraction only. No global slot, event, or transport.
    read(): Readonly<FirstNativeStop> {
      try {
        if (input.api.view !== view || view.queue !== queue || queue.gl !== gl || (installed && !ownsMethods())) invalid('ownership-changed');
      } catch { invalid('observer-read'); }
      if (!record.captured) { record.explicitPollOrdinal = explicitOrdinal; record.priorImplicitStopCount = implicitStops; record.priorImplicitFailedCount = implicitFailed; record.priorImplicitStalledCount = implicitStalled; }
      // All strings are fixed ASCII enums; 4096 UTF-8 bytes is a hard bound.
      if (JSON.stringify(record).length > MAX_RECORD_JSON_BYTES) invalid('payload-bound');
      return Object.freeze({ ...record });
    },
    uninstall(): boolean {
      enabled = false; fenceBefore = null;
      if (!installed) return true;
      if (!ownsMethods()) { invalid('ownership-changed'); return false; }
      restore(view, 'pollRender', viewDescriptor); restore(queue, 'poll', queueDescriptor); restore(gl, 'clientWaitSync', waitDescriptor);
      installed = false; fenceBefore = null;
      return true;
    },
  };
}
