import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';
import { createAssetManifest } from '../browser-tests/asset-manifest.mjs';
import { assertNoForbiddenTraffic, installNetworkGuard, isStaticAssetRequest, SMOKE_ORIGIN, viteHmrDiagnosticUrl, type AssetManifest } from '../browser-tests/network-guard';

const assets: AssetManifest = new Map([
  ['/', { physicalFile: '/fixture/index.html', resourceTypes: ['document'] }],
  ['/index.html', { physicalFile: '/fixture/index.html', resourceTypes: ['document'] }],
  ['/src/game.ts', { physicalFile: '/fixture/src/game.ts', resourceTypes: ['script'] }],
  ['/src/style.css', { physicalFile: '/fixture/src/style.css', resourceTypes: ['script', 'stylesheet'] }],
  ['/@vite/client', { physicalFile: '/fixture/vite/client.mjs', resourceTypes: ['script'] }],
  ['/favicon.ico', { physicalFile: null, resourceTypes: ['image'] }],
]);

test('only exact-origin GET manifest assets and expected resource types pass', () => {
  for (const [pathname, asset] of assets) for (const resourceType of asset.resourceTypes) {
    assert.equal(isStaticAssetRequest(SMOKE_ORIGIN + pathname, 'GET', resourceType, assets), true);
  }
  for (const [url, method, resourceType] of [
    ['https://network-probe.invalid/collect', 'GET', 'fetch'],
    [SMOKE_ORIGIN + '/src/game.ts', 'POST', 'script'],
    [SMOKE_ORIGIN + '/src/game.ts', 'HEAD', 'script'],
    [SMOKE_ORIGIN + '/src/game.ts', 'GET', 'fetch'],
    [SMOKE_ORIGIN + '/api/collect', 'GET', 'script'],
    [SMOKE_ORIGIN + '/src/unlisted.ts', 'GET', 'script'],
    [SMOKE_ORIGIN + '/src/game.ts?payload=fixture', 'GET', 'script'],
    [SMOKE_ORIGIN + '/src/game.ts#payload', 'GET', 'script'],
    ['http://127.0.0.1:59999/src/game.ts', 'GET', 'script'],
    ['http://localhost:4179/src/game.ts', 'GET', 'script'],
    ['https://127.0.0.1:4179/src/game.ts', 'GET', 'script'],
    ['http://fixture:fixture@127.0.0.1:4179/src/game.ts', 'GET', 'script'],
    ['not a URL', 'GET', 'script'],
  ]) assert.equal(isStaticAssetRequest(url, method, resourceType, assets), false, `${method} ${url}`);
});

test('recursive manifest lists physical nested source and complete existing dependency files', async () => {
  const manifest: AssetManifest = createAssetManifest();
  for (const name of ['/src/main.ts', '/src/battle/simulation.ts', '/src/battle/ground-nav.ts', '/src/style.css', '/@vite/client']) {
    assert.ok(manifest.has(name), name);
  }
  assert.ok([...manifest.keys()].some(name => name.endsWith('/build/three.module.js')));
  assert.ok([...manifest.keys()].some(name => name.endsWith('/lines/LineSegments2.js')));
  for (const [url, asset] of manifest) {
    if (url === '/favicon.ico') { assert.equal(asset.physicalFile, null); continue; }
    assert.ok(asset.physicalFile);
    assert.equal(await realpath(asset.physicalFile!), asset.physicalFile);
    assert.equal((await stat(asset.physicalFile!)).isFile(), true);
    for (const type of asset.resourceTypes) assert.equal(isStaticAssetRequest(SMOKE_ORIGIN + url, 'GET', type, manifest), true);
  }
  assert.equal(manifest.has('/api/collect'), false);
  assert.equal(manifest.has('/src/battle/unlisted.ts'), false);
});

test('acceptance server retains the existing DEV oracle and exact unoptimized module addresses', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const config = await resolveConfig({ root, configFile: root + '/vite.browser-tests.config.ts' }, 'serve');
  assert.equal(config.env.DEV, true);
  assert.equal(config.env.PROD, false);
  assert.equal(config.optimizeDeps.noDiscovery, true);
  assert.deepEqual(config.optimizeDeps.include, []);
  assert.equal((config.server.ws as any).clientPort, 4179);
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /if\(import\.meta\.env\.DEV\)\{/);
  assert.match(main, /Object\.defineProperty\(window,'__senryou'/);
  for (const name of ['playwright.config.ts', 'playwright.throttle.config.ts']) {
    const configSource = await readFile(new URL('../' + name, import.meta.url), 'utf8');
    assert.match(configSource, /vite\.js --config vite\.browser-tests\.config\.ts --host 127\.0\.0\.1 --port 4179 --strictPort/);
    assert.doesNotMatch(configSource, /vite\.js preview/);
  }
});

test('HTTP abort, redirect rejection and WebSocket interception never forward forbidden traffic', async () => {
  let http: any, websocket: any;
  const registration: string[] = [];
  const context = {
    route: async (pattern: string, handler: any) => { assert.equal(pattern, '**/*'); registration.push('http'); http = handler; },
    routeWebSocket: async (pattern: string, handler: any) => { assert.equal(pattern, '**/*'); registration.push('websocket'); websocket = handler; },
  };
  const blockedExternal = await installNetworkGuard(context as any, assets);
  assert.deepEqual(registration, ['http', 'websocket']);
  const invoke = async (url: string, method = 'GET', status = 200, resourceType = 'script', body = '') => {
    const calls: string[] = [];
    const response = { status: () => status, text: async () => body, dispose: async () => { calls.push('dispose'); } };
    await http({
      request: () => ({ url: () => url, method: () => method, resourceType: () => resourceType }),
      continue: () => assert.fail('continue could bypass redirect interception'),
      fetch: async (options: unknown) => { assert.deepEqual(options, { maxRedirects: 0 }); calls.push('fetch-local-only'); return response; },
      fulfill: async (options: any) => {
        if (url.endsWith('/favicon.ico')) assert.deepEqual(options, { status: 204, body: '' });
        else assert.equal(options.response, response);
        calls.push('fulfill');
      },
      abort: async (reason: string) => { assert.equal(reason, 'blockedbyclient'); calls.push('abort'); },
    });
    return calls;
  };
  const invokeSocket = async (url: string) => {
    const calls: string[] = [];
    await websocket({
      url: () => url,
      connectToServer: () => assert.fail('must never connect a WebSocket upstream'),
      send: () => assert.fail('must never send WebSocket data upstream'),
      onMessage: (consume: (data: string) => void) => { calls.push('inert'); consume('synthetic ping'); },
      close: async (options: any) => { assert.equal(options.code, 1008); calls.push('close'); },
    });
    return calls;
  };
  assert.deepEqual(await invoke(SMOKE_ORIGIN + '/src/game.ts'), ['fetch-local-only', 'fulfill', 'dispose']);
  assert.deepEqual(await invoke(SMOKE_ORIGIN + '/favicon.ico', 'GET', 200, 'image'), ['fulfill']);
  assertNoForbiddenTraffic(blockedExternal);
  // A guessed token is denied before the client has actually been served.
  assert.deepEqual(await invokeSocket('ws://127.0.0.1:4179/?token=fixture-token'), ['close']);
  assert.deepEqual(await invoke(SMOKE_ORIGIN + '/@vite/client', 'GET', 200, 'script', 'const wsToken = "fixture-token";'), ['fetch-local-only', 'fulfill', 'dispose']);
  const beforeHmr = blockedExternal.length;
  assert.deepEqual(await invokeSocket('ws://127.0.0.1:4179/?token=fixture-token'), ['inert']);
  assert.equal(blockedExternal.length, beforeHmr);
  for (const url of ['wss://network-probe.invalid/socket', 'ws://127.0.0.1:4179/socket', 'ws://127.0.0.1:4179/?token=wrong-token', 'ws://127.0.0.1:4179/', 'ws://127.0.0.1:4179/?token=fixture-token&payload=fixture']) {
    assert.deepEqual(await invokeSocket(url), ['close']);
  }
  assert.deepEqual(await invoke('https://network-probe.invalid/collect'), ['abort']);
  assert.deepEqual(await invoke(SMOKE_ORIGIN + '/', 'POST'), ['abort']);
  assert.deepEqual(await invoke(SMOKE_ORIGIN + '/api/collect'), ['abort']);
  assert.deepEqual(await invoke(SMOKE_ORIGIN + '/src/game.ts', 'GET', 302), ['fetch-local-only', 'abort', 'dispose']);
  assert.equal(blockedExternal.length, 10);
  // A handled application rejection need not create a pageerror; the network gate still rejects.
  const pageErrors: string[] = [];
  await Promise.reject(new Error('synthetic handled error')).catch(() => {});
  assert.deepEqual(pageErrors, []);
  assert.throws(() => assertNoForbiddenTraffic(blockedExternal), /forbidden communication/);
});

test('unrecognized served Vite HMR tokens fail closed', () => {
  assert.equal(viteHmrDiagnosticUrl('const wsToken = "known-token_123";'), 'ws://127.0.0.1:4179/?token=known-token_123');
  for (const source of ['', 'const wsToken = "";', 'const wsToken = "bad token";', 'const wsToken = window.token;']) {
    assert.throws(() => viteHmrDiagnosticUrl(source), /no recognized HMR token/);
  }
});
