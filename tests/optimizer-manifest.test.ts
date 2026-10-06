import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { optimizeDeps, resolveConfig, createServer } from 'vite';
import { optimizerManifest } from '../browser-tests/optimizer-manifest.mjs';
import { createAssetManifest } from '../browser-tests/asset-manifest.mjs';
import { installNetworkGuard, isStaticAssetRequest, SMOKE_ORIGIN } from '../browser-tests/network-guard';

const prefix = '/node_modules/.vite/deps/';
const entry = prefix + 'three.js?v=1234abcd';
async function fixture(writeMetadata = true, waitForMetadataMs = 0) {
  const directory = await mkdtemp(path.join(tmpdir(), 'senryou-optimizer-'));
  const depsCacheDir = path.join(directory, 'deps');
  await mkdir(depsCacheDir);
  const source = path.join(directory, 'three.module.js');
  await writeFile(source, 'export const Vector3 = 1;');
  await writeFile(path.join(depsCacheDir, 'three.js'), 'export { Vector3 } from "./chunk-known.js";');
  await writeFile(path.join(depsCacheDir, 'chunk-known.js'), 'export const Vector3 = 1;');
  const metadata: any = { hash: 'aabbccdd', configHash: 'bbccddee', lockfileHash: 'ccddeeff', browserHash: 'eeff0011',
    optimized: { three: { file: 'three.js', src: '../three.module.js', fileHash: 'ddeeff00' } },
    chunks: { 'chunk-known': { file: 'chunk-known.js' } } };
  const save = () => writeFile(path.join(depsCacheDir, '_metadata.json'), JSON.stringify(metadata));
  if (writeMetadata) await save();
  const manifest = new Map<string, any>([['/src/main.ts', { physicalFile: '/fixture/src/main.ts', resourceTypes: ['script'] }]]);
  const observer = optimizerManifest(manifest, { depsCacheDir, cacheUrlPrefix: prefix,
    dependencySources: new Map([['three', await realpath(source)]]), waitForMetadataMs });
  Object.assign(manifest, observer);
  return { directory, depsCacheDir, metadata, save, manifest, observer };
}

test('exact served cache URL is independently bound to metadata and existing source/file', async () => {
  const { observer, manifest } = await fixture();
  assert.equal(await observer.resolveOptimizedAsset(entry), false, 'metadata alone does not authorize a browser query');
  observer.observeServedScript('/src/main.ts', `import { Vector3 } from '${entry}';`);
  assert.equal(await observer.resolveOptimizedAsset(entry), true);
  assert.equal(isStaticAssetRequest(SMOKE_ORIGIN + entry, 'GET', 'script', manifest), true);
  for (const [url, method, type] of [
    [entry.replace('1234abcd', 'ffffffff'), 'GET', 'script'],
    [entry + '&payload=fixture', 'GET', 'script'],
    [entry + '&v=1234abcd', 'GET', 'script'],
    [entry.replace('?v=', '?%76='), 'GET', 'script'],
    [entry.split('?')[0], 'GET', 'script'],
    [entry, 'POST', 'script'], [entry, 'HEAD', 'script'], [entry, 'GET', 'fetch'],
    [prefix + 'unknown.js?v=1234abcd', 'GET', 'script'],
  ]) assert.equal(isStaticAssetRequest(SMOKE_ORIGIN + url, method, type, manifest), false, `${method} ${url} ${type}`);
  assert.equal(await observer.resolveOptimizedAsset(entry.replace('1234abcd', 'ffffffff')), false);
  observer.observeServedScript(entry, 'export { Vector3 } from "./chunk-known.js";');
  assert.equal(await observer.resolveOptimizedAsset(prefix + 'chunk-known.js'), true);
  assert.equal(isStaticAssetRequest(SMOKE_ORIGIN + prefix + 'chunk-known.js', 'GET', 'script', manifest), true);
});

test('unknown files and direct arbitrary chunks fail despite physical cache files', async () => {
  for (const name of ['unknown.js', 'chunk-known.js']) {
    const { observer, depsCacheDir, manifest } = await fixture();
    if (name === 'unknown.js') await writeFile(path.join(depsCacheDir, name), '// exists but is not metadata-listed');
    const url = prefix + name + '?v=1234abcd';
    observer.observeServedScript('/src/main.ts', `import '${url}';`);
    await assert.rejects(observer.resolveOptimizedAsset(url), /not a known metadata entry or reachable chunk/);
    assert.equal(manifest.has(url), false);
  }
});

test('invalid query shapes and an unapproved importer fail before metadata can authorize them', async () => {
  const { observer } = await fixture();
  for (const query of ['?v=arbitrary', '?v=1234abcd&v=1234abcd', '?v=1234abcd&x=1', '?x=1234abcd', '?v=1234abcd#fragment']) {
    assert.throws(() => observer.observeServedScript('/src/main.ts', `import '${prefix}three.js${query}';`), /Invalid optimizer import query/);
  }
  assert.throws(() => observer.observeServedScript('/api/not-approved', `import '${entry}';`), /Importer was not an allowed script/);
  for (const address of [prefix + '../deps/three.js?v=1234abcd', prefix + '%2e%2e/deps/three.js?v=1234abcd']) {
    assert.throws(() => observer.observeServedScript('/src/main.ts', `import '${address}';`), /traversal/);
  }
});

test('comments, arbitrary strings and external imports cannot register cache URLs', async () => {
  const { observer, manifest } = await fixture();
  observer.observeServedScript('/src/main.ts', `// import '${entry}';\nconst text = "${entry}";\nimport 'https://network-probe.invalid${entry}';`);
  assert.equal(await observer.resolveOptimizedAsset(entry), false);
  assert.equal(manifest.has(entry), false);
});

test('missing metadata stays closed and late optimizer completion is read at request arrival', async () => {
  const missing = await fixture(false);
  missing.observer.observeServedScript('/src/main.ts', `import '${entry}';`);
  await assert.rejects(missing.observer.resolveOptimizedAsset(entry), { code: 'ENOENT' });
  assert.equal(missing.manifest.has(entry), false);
  const late = await fixture(false, 500);
  late.observer.observeServedScript('/src/main.ts', `import '${entry}';`);
  const pending = late.observer.resolveOptimizedAsset(entry);
  await late.save();
  assert.equal(await pending, true);
});

test('real route wiring registers before fulfill and revalidates metadata before each child fetch', async () => {
  const { manifest, metadata, save } = await fixture();
  let handler: any;
  const blocked = await installNetworkGuard({ route: async (_pattern: string, callback: any) => { handler = callback; }, routeWebSocket: async () => {} } as any, manifest);
  const invoke = async (address: string, body: string, status = 200) => {
    const calls: string[] = [];
    const response = { status: () => status, text: async () => body, dispose: async () => { calls.push('dispose'); } };
    await handler({ request: () => ({ url: () => SMOKE_ORIGIN + address, method: () => 'GET', resourceType: () => 'script' }),
      fetch: async (options: any) => { assert.deepEqual(options, { maxRedirects: 0 }); calls.push('fetch'); return response; },
      fulfill: async () => { calls.push('fulfill'); },
      abort: async () => { calls.push('abort'); },
      continue: () => assert.fail('must not bypass guard'),
    });
    return calls;
  };
  for (const status of [404, 500]) {
    assert.deepEqual(await invoke('/src/main.ts', `import '${entry}';`, status), ['fetch', 'abort', 'dispose']);
    assert.equal(await (manifest as any).resolveOptimizedAsset(entry), false, 'error response cannot authorize a child URL');
  }
  assert.deepEqual(await invoke('/src/main.ts', `import '${entry}';`), ['fetch', 'fulfill', 'dispose']);
  assert.equal(manifest.has(entry), false, 'observation alone does not admit the asset');
  assert.deepEqual(await invoke(entry, 'export const Three = true;'), ['fetch', 'fulfill', 'dispose']);
  assert.equal(blocked.length, 2);
  assert.ok(blocked.every(value => value.includes('static asset error')));
  metadata.optimized.three.src = '../not-the-source.js'; await save();
  assert.deepEqual(await invoke(entry, ''), ['abort']);
  assert.match(blocked[2], /optimizer evidence/);
});

for (const defect of ['bad-source', 'bad-hash', 'path-traversal', 'physical-symlink']) test(`optimizer metadata fails closed: ${defect}`, async () => {
  const { observer, metadata, save, directory, depsCacheDir, manifest } = await fixture();
  const outside = path.join(directory, 'outside.js'); await writeFile(outside, 'export const outside = true;');
  let requested = entry;
  if (defect === 'bad-source') metadata.optimized.three.src = '../outside.js';
  if (defect === 'bad-hash') metadata.browserHash = 'not-a-cache-hash';
  if (defect === 'path-traversal') metadata.optimized.three.file = '../outside.js';
  if (defect === 'physical-symlink') {
    await symlink(outside, path.join(depsCacheDir, 'escape.js'));
    metadata.optimized.three.file = 'escape.js'; requested = prefix + 'escape.js?v=1234abcd';
  }
  await save();
  observer.observeServedScript('/src/main.ts', `import '${requested}';`);
  await assert.rejects(observer.resolveOptimizedAsset(requested), /Optimizer|optimizer/);
  assert.equal(manifest.has(requested), false);
});

for (const warmCache of [true, false]) test(`installed Vite ${warmCache ? 'warm' : 'cold'} cache proves real metadata and exact served imports`, async () => {
  // In-process transform only: no listening server, browser, request or package manager.
  const root = fileURLToPath(new URL('..', import.meta.url));
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'senryou-real-optimizer-'));
  const config = await resolveConfig({ root, configFile: root + '/vite.config.ts', cacheDir }, 'serve');
  assert.equal(config.optimizeDeps.noDiscovery, false);
  if (warmCache) await optimizeDeps(config);
  const depsCacheDir = path.join(cacheDir, 'deps');
  const require = createRequire(import.meta.url);
  const threeRoot = path.dirname(path.dirname(require.resolve('three')));
  const sources = new Map<string, string>();
  for (const id of ['three', 'three/addons/lines/LineSegments2.js', 'three/addons/lines/LineSegmentsGeometry.js', 'three/addons/lines/LineMaterial.js', 'three/addons/utils/BufferGeometryUtils.js']) {
    const file = id === 'three' ? path.join(threeRoot, 'build/three.module.js')
      : path.join(threeRoot, 'examples/jsm', id.slice('three/addons/'.length));
    assert.ok(id === 'three' || id.startsWith('three/addons/'));
    sources.set(id, await realpath(file));
  }
  const manifest: any = createAssetManifest();
  const cacheUrlPrefix = `/@fs${depsCacheDir}/`;
  const observer = optimizerManifest(manifest, { depsCacheDir, cacheUrlPrefix, dependencySources: sources, waitForMetadataMs: 5000 });
  const server = await createServer({ root, configFile: root + '/vite.config.ts', cacheDir,
    server: { middlewareMode: true, ws: false, watch: null } });
  try {
    assert.equal(server.httpServer, null);
    const transformed = await server.transformRequest('/src/battle-flight.ts');
    assert.ok(transformed);
    observer.observeServedScript('/src/battle-flight.ts', transformed!.code);
    const cacheImports = [...transformed!.code.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)]
      .map(match => match[1]).filter(address => address.startsWith(cacheUrlPrefix));
    assert.ok(cacheImports.length, 'actual transformed code must import the optimized Three entry');
    for (const address of cacheImports) {
      assert.equal(await observer.resolveOptimizedAsset(address), true);
      assert.equal(isStaticAssetRequest(SMOKE_ORIGIN + address, 'GET', 'script', manifest), true);
      const source = await readFile(manifest.get(address).physicalFile, 'utf8');
      observer.observeServedScript(address, source);
      for (const match of source.matchAll(/(?:from|import)\s*["'](\.\/[^"']+)["']/g)) {
        const child = new URL(match[1], SMOKE_ORIGIN + address);
        assert.equal(await observer.resolveOptimizedAsset(child.pathname + child.search), true);
      }
    }
    const metadata = JSON.parse(await readFile(path.join(depsCacheDir, '_metadata.json'), 'utf8'));
    assert.ok(metadata.optimized.three);
  } finally { await server.close(); }
});
