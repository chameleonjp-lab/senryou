import { readFileSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import ts from 'typescript';

const INERT_ORIGIN = 'http://asset-manifest.invalid'; // URL parsing only; never requested.
const HASH = /^[a-f0-9]{8}$/;

function importsOf(source) {
  const file = ts.createSourceFile('served.js', source, ts.ScriptTarget.Latest, true);
  const imports = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return imports;
}

/** Bind exact served import URLs to known optimizer entries and their real chunks. */
export function optimizerManifest(manifest, { depsCacheDir, cacheUrlPrefix, dependencySources, waitForMetadataMs = 5000 }) {
  const observed = new Map();
  const within = (directory, file) => {
    const rel = relative(directory, file);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep);
  };
  function resolveObserved(address) {
    const observation = observed.get(address);
    if (!observation) return false;
    const metadata = JSON.parse(readFileSync(resolve(depsCacheDir, '_metadata.json'), 'utf8'));
    for (const name of ['hash', 'configHash', 'lockfileHash', 'browserHash']) {
      if (!HASH.test(metadata[name] ?? '')) throw new Error(`Invalid optimizer ${name}`);
    }
    if (!metadata.optimized || Array.isArray(metadata.optimized) || !metadata.chunks || Array.isArray(metadata.chunks)) throw new Error('Invalid optimizer file records');
    const physicalCache = realpathSync(depsCacheDir);
    const fileOf = entry => {
      if (!entry || typeof entry.file !== 'string') throw new Error('Invalid optimizer file');
      const file = resolve(depsCacheDir, entry.file);
      if (!within(resolve(depsCacheDir), file) || !file.endsWith('.js')) throw new Error('Optimizer file escaped cache');
      return file;
    };
    const target = resolve(depsCacheDir, observation.pathname.slice(cacheUrlPrefix.length));
    let matched = false;
    for (const [id, entry] of Object.entries(metadata.optimized)) {
      if (!dependencySources.has(id) || fileOf(entry) !== target) continue;
      if (!HASH.test(entry.fileHash ?? '') || typeof entry.src !== 'string'
        || realpathSync(resolve(depsCacheDir, entry.src)) !== dependencySources.get(id)) throw new Error('Optimizer source does not match a known dependency');
      matched = true;
    }
    if (!matched && manifest.get(observation.importer)?.optimized === true) {
      matched = Object.values(metadata.chunks).some(entry => fileOf(entry) === target);
    }
    if (!matched) throw new Error('Observed import is not a known metadata entry or reachable chunk');
    const physicalFile = realpathSync(target);
    if (!within(physicalCache, physicalFile) || !statSync(physicalFile).isFile()) throw new Error('Optimizer asset escaped physical cache');
    // Persisted Vite metadata omits per-entry live browserHash values. The exact
    // hash observed in a trusted served import is the authority for this URL;
    // metadata independently proves the target and original package source.
    manifest.set(address, { physicalFile, resourceTypes: ['script'], optimized: true, browserHash: observation.browserHash });
    return true;
  }
  return {
    observeServedScript(importer, source) {
      if (!manifest.get(importer)?.resourceTypes.includes('script')) throw new Error('Importer was not an allowed script');
      for (const specifier of importsOf(source)) {
        const url = new URL(specifier, INERT_ORIGIN + importer);
        if (url.origin !== INERT_ORIGIN || !url.pathname.startsWith(cacheUrlPrefix)) continue;
        if (/(^|\/)\.\.(\/|$)|%2e|%2f|%5c|\\/i.test(specifier)) throw new Error('Optimizer import path contains traversal or encoded separators');
        if (url.username || url.password || url.hash || (url.search && !/^\?v=[a-f0-9]{8}$/.test(url.search))) throw new Error('Invalid optimizer import query');
        const address = url.pathname + url.search;
        observed.set(address, { importer, pathname: url.pathname, browserHash: url.search ? url.search.slice(3) : undefined });
      }
    },
    async resolveOptimizedAsset(address) {
      if (!observed.has(address)) return false;
      const deadline = Date.now() + waitForMetadataMs;
      for (;;) {
        try { return resolveObserved(address); }
        catch (error) {
          // Wait only for an optimizer file not yet committed. Malformed metadata,
          // wrong sources, unknown files and stale query requests have no fallback.
          if (error?.code !== 'ENOENT' || Date.now() >= deadline) throw error;
          await setTimeout(20);
        }
      }
    },
  };
}
