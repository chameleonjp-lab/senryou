import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertNoForbiddenTraffic, installNetworkGuard, isStaticAssetRequest, SMOKE_ORIGIN, staticAssetPaths } from '../browser-tests/network-guard';

const assets = new Set(['/', '/index.html', '/assets/game.js', '/assets/style.css']);

test('only exact-origin GET static assets pass; methods, APIs, other ports and query payloads fail closed', () => {
  for (const pathname of assets) assert.equal(isStaticAssetRequest(SMOKE_ORIGIN + pathname, 'GET', assets), true);
  for (const [url, method] of [
    ['https://network-probe.invalid/collect', 'GET'],
    [SMOKE_ORIGIN + '/assets/game.js', 'POST'],
    [SMOKE_ORIGIN + '/assets/game.js', 'HEAD'],
    [SMOKE_ORIGIN + '/api/collect', 'GET'],
    [SMOKE_ORIGIN + '/assets/unlisted.js', 'GET'],
    [SMOKE_ORIGIN + '/assets/game.js?payload=fixture', 'GET'],
    ['http://127.0.0.1:59999/assets/game.js', 'GET'],
    ['http://localhost:4179/assets/game.js', 'GET'],
    ['https://127.0.0.1:4179/assets/game.js', 'GET'],
    ['http://fixture:fixture@127.0.0.1:4179/assets/game.js', 'GET'],
    ['not a URL', 'GET'],
  ]) assert.equal(isStaticAssetRequest(url, method, assets), false, `${method} ${url}`);
});

test('asset manifest comes from actual built files and requires index.html', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'senryou-static-assets-'));
  await assert.rejects(staticAssetPaths(directory), /Build the candidate/);
  await mkdir(path.join(directory, 'assets'));
  await writeFile(path.join(directory, 'index.html'), '<!doctype html>');
  await writeFile(path.join(directory, 'assets/game.js'), '// inert fixture');
  assert.deepEqual(await staticAssetPaths(directory), new Set(['/', '/index.html', '/assets/game.js']));
});

test('HTTP abort, redirect rejection and WebSocket close happen without upstream forbidden transmission', async () => {
  let http: any, websocket: any;
  const registration: string[] = [];
  const context = {
    route: async (pattern: string, handler: any) => { assert.equal(pattern, '**/*'); registration.push('http'); http = handler; },
    routeWebSocket: async (pattern: string, handler: any) => { assert.equal(pattern, '**/*'); registration.push('websocket'); websocket = handler; },
  };
  const blockedExternal = await installNetworkGuard(context as any, assets);
  assert.deepEqual(registration, ['http', 'websocket']);
  const invoke = async (url: string, method = 'GET', status = 200) => {
    const calls: string[] = [];
    const response = { status: () => status, dispose: async () => { calls.push('dispose'); } };
    await http({
      request: () => ({ url: () => url, method: () => method }),
      continue: () => assert.fail('continue could bypass redirect interception'),
      fetch: async (options: unknown) => { assert.deepEqual(options, { maxRedirects: 0 }); calls.push('fetch-local-only'); return response; },
      fulfill: async (options: any) => { assert.equal(options.response, response); calls.push('fulfill'); },
      abort: async (reason: string) => { assert.equal(reason, 'blockedbyclient'); calls.push('abort'); },
    });
    return calls;
  };
  assert.deepEqual(await invoke(SMOKE_ORIGIN + '/assets/game.js'), ['fetch-local-only', 'fulfill', 'dispose']);
  assertNoForbiddenTraffic(blockedExternal);
  assert.deepEqual(await invoke('https://network-probe.invalid/collect'), ['abort']);
  assert.deepEqual(await invoke(SMOKE_ORIGIN + '/', 'POST'), ['abort']);
  assert.deepEqual(await invoke(SMOKE_ORIGIN + '/api/collect'), ['abort']);
  assert.deepEqual(await invoke(SMOKE_ORIGIN + '/assets/game.js', 'GET', 302), ['fetch-local-only', 'abort', 'dispose']);
  for (const url of ['wss://network-probe.invalid/socket', 'ws://127.0.0.1:4179/socket']) {
    const calls: string[] = [];
    await websocket({
      url: () => url,
      connectToServer: () => assert.fail('must never connect a WebSocket upstream'),
      close: async (options: any) => { assert.equal(options.code, 1008); calls.push('close'); },
    });
    assert.deepEqual(calls, ['close']);
  }
  assert.equal(blockedExternal.length, 6);
  // A handled application rejection need not create a pageerror; the network gate still rejects.
  const pageErrors: string[] = [];
  await Promise.reject(new Error('synthetic handled error')).catch(() => {});
  assert.deepEqual(pageErrors, []);
  assert.throws(() => assertNoForbiddenTraffic(blockedExternal), /forbidden communication/);
});
