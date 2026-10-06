import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { optimizerManifest } from './optimizer-manifest.mjs';

const require = createRequire(import.meta.url);
const defaultRoot = fileURLToPath(new URL('..', import.meta.url));

function importsOf(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  return source.statements.flatMap(statement => {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) return [statement.moduleSpecifier.text];
    return [];
  });
}

/** Register only existing project files and the physical Three.js import graph. */
export function createAssetManifest(root = defaultRoot) {
  root = realpathSync(root);
  const manifest = new Map();
  const register = (url, file, resourceTypes) => {
    const physicalFile = realpathSync(file);
    if (!statSync(physicalFile).isFile()) throw new Error(`Not an acceptance asset: ${file}`);
    manifest.set(url, { physicalFile, resourceTypes });
  };
  const fileUrl = file => {
    const fromRoot = relative(root, file);
    return !fromRoot.startsWith(`..${sep}`) && fromRoot !== '..'
      ? `/${fromRoot.split(sep).join('/')}` : `/@fs${file.split(sep).join('/')}`;
  };
  register('/', resolve(root, 'index.html'), ['document']);
  register('/index.html', resolve(root, 'index.html'), ['document']);
  // An explicit inert browser icon is served in memory; it never reaches the server.
  manifest.set('/favicon.ico', { physicalFile: null, resourceTypes: ['image'] });

  const threeRoot = realpathSync(resolve(dirname(require.resolve('three')), '..'));
  const threeEntry = resolve(threeRoot, 'build/three.module.js');
  const pendingThree = new Set();
  const dependencySources = new Map();
  const addBareThree = specifier => {
    let file;
    if (specifier === 'three') file = threeEntry;
    else if (specifier.startsWith('three/addons/')) file = resolve(threeRoot, 'examples/jsm', specifier.slice('three/addons/'.length));
    else throw new Error(`Unlisted dependency in browser acceptance: ${specifier}`);
    dependencySources.set(specifier, realpathSync(file));
    pendingThree.add(file);
  };
  const sourceDir = resolve(root, 'src');
  // Senryou also imports nested source modules such as src/battle/simulation.ts.
  const visitSource = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) { visitSource(file, name + '/'); continue; }
      if (!entry.isFile() || !/\.(ts|css)$/.test(name)) continue;
      register(`/src/${name}`, file, name.endsWith('.css') ? ['script', 'stylesheet'] : ['script']);
      if (name.endsWith('.ts')) {
        for (const specifier of importsOf(file)) {
          if (!specifier.startsWith('.')) addBareThree(specifier);
        }
      }
    }
  };
  visitSource(sourceDir);

  const visited = new Set();
  for (const requested of pendingThree) {
    const file = realpathSync(requested);
    if (!file.startsWith(`${threeRoot}${sep}`) || !file.endsWith('.js')) throw new Error(`Unexpected Three.js dependency: ${file}`);
    if (visited.has(file)) continue;
    visited.add(file);
    register(fileUrl(file), file, ['script']);
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith('.')) pendingThree.add(resolve(dirname(file), specifier));
      else addBareThree(specifier);
    }
  }

  const viteRoot = dirname(require.resolve('vite/package.json'));
  register('/@vite/client', resolve(viteRoot, 'dist/client/client.mjs'), ['script']);
  const envFile = realpathSync(resolve(viteRoot, 'dist/client/env.mjs'));
  register(fileUrl(envFile), envFile, ['script']);
  // Keep the original Vite optimizer. Cache entries are admitted only after a
  // known served module imports that exact URL and current metadata proves it.
  Object.assign(manifest, optimizerManifest(manifest, {
    depsCacheDir: resolve(root, 'node_modules/.vite/deps'),
    cacheUrlPrefix: '/node_modules/.vite/deps/',
    dependencySources,
  }));
  return manifest;
}
