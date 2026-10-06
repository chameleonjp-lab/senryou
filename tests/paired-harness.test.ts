import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PairedObserver, OUTER_FENCE, ORIGIN, isLocalHttp, observeCapture } from '../browser-tests/paired-diagnostic-observer';
import { instrument, gameplayBody, gitBlob, BLOBS } from '../scripts/paired-harness-source.mjs';
import { runOrderedPair, validateArmRecords, validateObserver } from '../scripts/run-paired-harness.mjs';

function fixture() {
  const context: any = new EventEmitter();
  const commands: any[] = [];
  const cdp: any = new EventEmitter();
  cdp.send = async (method: string, params: any) => { commands.push({ method, params }); };
  context.newCDPSession = async () => cdp;
  context.route = async (_pattern: string, callback: any) => { context.httpHandler = callback; };
  context.routeWebSocket = async (_pattern: string, callback: any) => { context.socketHandler = callback; };
  const page: any = { evaluate: async () => ({ nowMs: 12, queue: { status: 'pending', pendingMs: 2, submittedCount: 1, completedCount: 0, skippedCount: 0, lastCompletedPendingMs: null, completedFrameIntervalMs: null } }) };
  return { context, page, commands, cdp };
}

test('outer fence has only exact4178 exceptions and a fail-closed legacy wildcard', () => {
  assert.deepEqual(OUTER_FENCE, { urlPatterns: [
    { urlPattern: 'http://127.0.0.1:4178/*', block: false },
    { urlPattern: 'ws://127.0.0.1:4178/*', block: false },
  ], urls: ['*'] });
  assert.equal(isLocalHttp(ORIGIN + '/src/main.ts'), true);
  for (const address of ['http://localhost:4178/', 'http://127.0.0.1:4177/', 'https://127.0.0.1:4178/', 'http://user@127.0.0.1:4178/', 'https://fixture.invalid/']) assert.equal(isLocalHttp(address), false);
});

test('page fence precedes original routing, is shared once per page, and frame-less requests abort', async () => {
  const { context, page, commands } = fixture();
  const observer = new PairedObserver(context, 'guard', 'fixture');
  await observer.installOuterHttpFence();
  let fallback = 0, abort = 0;
  const route: any = { request: () => ({ url: () => ORIGIN + '/', frame: () => ({ page: () => page }) }), fallback: async () => { assert.equal(commands.at(-1).method, 'Network.setBlockedURLs'); fallback++; }, abort: async () => { abort++; } };
  await context.httpHandler(route); await context.httpHandler(route);
  assert.equal(fallback, 2); assert.equal(commands.length, 2); assert.equal(observer.evidence.preparedPages, 1);
  await context.httpHandler({ ...route, request: () => ({ url: () => ORIGIN + '/', frame: () => { throw new Error('frame-less'); } }) });
  assert.equal(abort, 1); assert.equal(observer.evidence.errors.length, 1);
});

test('CDP setup failure aborts without fallback and external redirect evidence survives routing blind spots', async () => {
  const { context, page, cdp } = fixture();
  cdp.send = async () => { throw new Error('unsupported'); };
  const observer = new PairedObserver(context, 'guard', 'fixture'); await observer.installOuterHttpFence();
  let abort = 0;
  await context.httpHandler({ request: () => ({ url: () => ORIGIN + '/', frame: () => ({ page: () => page }) }), fallback: () => assert.fail('must not continue'), abort: async () => { abort++; } });
  assert.equal(abort, 1);
  cdp.emit('Network.requestWillBeSent', { requestId: 'redirect', request: { url: 'https://fixture.invalid/redirect' }, timestamp: 5 });
  cdp.emit('Network.loadingFailed', { requestId: 'redirect', errorText: 'net::ERR_BLOCKED_BY_CLIENT', blockedReason: 'inspector', timestamp: 6 });
  assert.equal(observer.evidence.outerForbidden.length, 1);
  assert.equal(observer.evidence.requests.at(-1).blockedReason, 'inspector');
});

test('control rejects nonloopback sockets immediately and awaits the actual served token before connect', async () => {
  const { context } = fixture(); const observer = new PairedObserver(context, 'control', 'fixture');
  await observer.installControlSockets(); let connects = 0, closes = 0, receive: any, forwarded: any;
  const socket = (url: string): any => ({ url: () => url, close: async () => { closes++; }, connectToServer: () => { connects++; return { onMessage: (callback: any) => { receive = callback; } }; }, send: (message: any) => { forwarded = message; } });
  await context.socketHandler(socket('wss://fixture.invalid/')); assert.equal(closes, 1); assert.equal(connects, 0);
  let completeBody!: (value: string) => void; const body = new Promise<string>(resolve => { completeBody = resolve; });
  context.emit('response', { url: () => ORIGIN + '/@vite/client', status: () => 200, request: () => ({ method: () => 'GET', resourceType: () => 'script' }), text: () => body });
  const pending = context.socketHandler(socket('ws://127.0.0.1:4178/?token=observed'));
  await Promise.resolve(); assert.equal(connects, 0);
  completeBody('const wsToken = "observed";'); await pending;
  assert.equal(connects, 1); receive('{"type":"connected"}');
  assert.equal(observer.evidence.hmr.connectedMessages, 1); assert.equal(forwarded, '{"type":"connected"}');
  await context.socketHandler(socket('ws://127.0.0.1:4178/?token=wrong')); assert.equal(connects, 1); assert.equal(closes, 2);
});

test('queue observations retain before/after timing and missing queue is an evidence error', async () => {
  const { context, page } = fixture(); const observer = new PairedObserver(context, 'guard', 'fixture');
  await observer.preparePage(page);
  await observeCapture(page, 'vp', 'hud-easy', 'before'); await observeCapture(page, 'vp', 'hud-easy', 'after');
  assert.equal(observer.evidence.captures.length, 2); assert.ok(observer.evidence.captures[1].screenshotElapsedMs >= 0);
  page.evaluate = async () => ({ nowMs: 14, queue: null }); await observeCapture(page, 'vp', 'pause', 'before');
  assert.equal(observer.evidence.errors.length, 1);
});

test('guard instrumentation preserves the complete gameplay body, captures and guard install', () => {
  const source = readFileSync(new URL('../browser-tests/smoke.spec.ts', import.meta.url), 'utf8');
  assert.equal(gitBlob(source), BLOBS.guard);
  const generated = instrument(source, 'guard');
  assert.equal(gameplayBody(source), gameplayBody(generated));
  assert.ok(generated.includes('const blockedExternal = await installNetworkGuard(context, createAssetManifest());'));
  assert.ok(!generated.includes('await diagnostic.installControlSockets()'));
  assert.equal((generated.match(/await observeCapture\(/g) ?? []).length, 2);
  assert.throws(() => instrument(source + '\n', 'guard'), /Pinned smoke source drifted/);
});

test('a failed first arm still yields exactly one invocation and record for each arm', () => {
  const calls: string[] = [];
  const results = runOrderedPair((arm: string) => { calls.push(arm); return { arm, exitCode: arm === 'control' ? 1 : 0 }; });
  assert.deepEqual(calls, ['control', 'guard']); assert.deepEqual(results.map((r: any) => r.exitCode), [1, 0]);
});

test('summary rejects repeated, skipped/missing and malformed evidence instead of counting it as a pair', () => {
  const ids = ['phone-portrait-393x648', 'phone-landscape-568x320', 'pc-1280x720'];
  const records: any = ids.map(id => ({ title: `smoke ${id}: flow`, results: [{ retry: 0, status: 'passed' }] }));
  assert.deepEqual(validateArmRecords(records, { stats: { skipped: 0, flaky: 0, expected: 3, unexpected: 0 } }, ids.map(id => `${id}.json`), 0), []);
  records[0].results.push({ retry: 1, status: 'passed' }); assert.ok(validateArmRecords(records, {}, []).length > 0);
});

test('missing observer problems/queue/HMR evidence cannot be treated as success', () => {
  assert.ok(validateObserver({ arm: 'guard', id: 'vp', preparedPages: 1 }, 'guard', 'vp', true).length);
});

test('summary refuses skipped cases, missing stats and contradictory exit codes', () => {
  const ids = ['phone-portrait-393x648', 'phone-landscape-568x320', 'pc-1280x720'];
  const records = ids.map(id => ({ title: `smoke ${id}: flow`, results: [{ retry: 0, status: 'passed' }] }));
  const files = ids.map(id => `${id}.json`);
  const stats = { skipped: 0, flaky: 0, expected: 3, unexpected: 0 };
  assert.ok(validateArmRecords(records, {}, files, 0).length);
  assert.ok(validateArmRecords(records, { stats }, files, 1).length);
  records[0].results[0].status = 'skipped';
  assert.ok(validateArmRecords(records, { stats: { ...stats, expected: 2, skipped: 1 } }, files, 0).length);
});
