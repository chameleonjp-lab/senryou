import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateProductModules, inspectExtraction, extractionContract, replaceExactlyOnce, UI_ONLY_SOURCE_PATHS, collectUiOnlySourceHashes, uiOnlySourceHashFingerprint } from '../browser-tests/ui-only/extract-product.mjs';
import { assertFixtureId, makeSample } from '../browser-tests/ui-only/samples';
const modules=generateProductModules(),source=inspectExtraction();
test('UI fixture uses exactly the pinned product function/method bodies and original event bindings',()=>{
 for(const fn of source.ui)assert.ok(modules.ui.includes(fn.body),fn.name);
 for(const method of source.canvas)assert.ok(modules.canvas.includes(method.body),method.name);
 assert.ok(modules.ui.includes(source.events.body));assert.equal(source.ui.length,13);assert.equal(source.canvas.length,8);
});
test('source hashes, signatures, identifiers and this-members remain fail-closed',()=>{
 const expected=JSON.parse(readFileSync(new URL('../browser-tests/ui-only/extraction-contract.json',import.meta.url),'utf8'));
 assert.deepEqual(extractionContract(source),expected);
 assert.equal(expected.mainSha256,createHash('sha256').update(readFileSync(new URL('../src/main.ts',import.meta.url))).digest('hex'));
 const used=[...new Set(source.canvas.flatMap((m:{thisMembers:string[]})=>m.thisMembers))].sort();
 assert.deepEqual(used,['bombGuide','camera','ctx','drawAAWarnings','drawBombGuide','drawBoundaryWarning','drawOverlay','drawPointLabels','drawRadar','drawTargets','flightPlayer','height','overlayLabels','position','project','width'].filter(n=>n!=='drawOverlay').sort());
});
test('fixture does not import a runtime renderer, simulation, weapons, terrain or audio module',()=>{
 const text=[modules.ui,modules.canvas,readFileSync(new URL('../browser-tests/ui-only/samples.ts',import.meta.url),'utf8')].join('\n');
 const runtimeImports=[...text.matchAll(/import\s+(?!type\b)[^;]+?from\s+['"]([^'"]+)['"]/g)].map(x=>x[1]);
 assert.ok(runtimeImports.every((x:string)=>!/(battle-view|simulation|weapons|terrain|battle-audio|render-queue)$/.test(x)),runtimeImports.join(','));
 assert.doesNotMatch(modules.ui+modules.canvas,/\bstepBattle\s*\(|\bnew\s+(?:WebGLRenderer|BattleView)\s*\(|function\s+frame\s*\(/);
});
test('ordinary product entry/config have no fixture activation',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),config=readFileSync(new URL('../vite.config.ts',import.meta.url),'utf8');
 assert.doesNotMatch(html+config,/ui-only|__senryouUiOnly|__ui_only__/);
 const entry=readFileSync(new URL('../browser-tests/ui-only/entry.ts',import.meta.url),'utf8');
 assert.doesNotMatch(entry,/import\s+['"][^'"]+\.css/);
 assert.ok(entry.includes("import.meta.env.MODE!=='ui-only'||location.pathname!=='/__ui_only__/'"));
 assert.ok(entry.indexOf("throw new Error('Private UI")<entry.indexOf("await import('virtual:senryou-ui')"));
});
test('fixture config rejects build or an omitted explicit development mode',()=>{
 const config=readFileSync(new URL('../vite.ui-only.config.ts',import.meta.url),'utf8');
 assert.ok(config.includes("command!=='serve'||mode!=='ui-only'"));assert.ok(config.includes("apply:'serve'"));
 assert.ok(config.includes('ws:false,hmr:false'));
 assert.ok(config.includes('<link rel="stylesheet" href="/src/style.css?direct">'));
 assert.ok(config.includes('<link rel="stylesheet" href="/src/control-settings.css?direct">'));
 assert.ok(config.includes('src=\"/@vite/client\"'));
 assert.ok(config.includes('html.split(viteClient).length!==2'));
 assert.ok(config.includes("html.replace(viteClient,'')"));
});

test('UI-only and legacy workflows hand off on the same repository, branch, and main base for every path',()=>{
 const legacy=readFileSync(new URL('../.github/workflows/throttle-lever.yml',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../.github/workflows/ui-only.yml',import.meta.url),'utf8');
 const branch="'codex/senryou-ui-only-context-fix-20261008'";
 assert.ok(legacy.includes(`head.repo.full_name != github.repository || github.event.pull_request.head.ref != ${branch} || github.event.pull_request.base.ref != 'main'`));
 assert.ok(legacy.includes(`github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.head.ref == ${branch} && github.event.pull_request.base.ref == 'main'`));
 assert.ok(legacy.includes('Normal unit tests'));
 assert.ok(legacy.includes('Capture bounded product UI states'));
 assert.ok(legacy.includes('Preserve UI-only screenshots and reports'));
 assert.ok(legacy.includes('workflow_dispatch:'));
 assert.ok(legacy.includes("github.event_name == 'workflow_dispatch' ||"));
 assert.ok(legacy.includes('github.event_name == \'workflow_dispatch\' && github.sha'));
 assert.ok(ui.includes('workflow_dispatch:'));
 assert.ok(ui.includes('Capture bounded product UI states'));
 assert.ok(ui.includes('ref: ${{ github.sha }}'));
 assert.doesNotMatch(ui,/^\s+pull_request:/m);
 assert.doesNotMatch(ui,/^\s+paths:/m);
});

test('all fixture stages share runner.temp evidence through GitHub Actions step contexts',()=>{
 const workflows=[
  readFileSync(new URL('../.github/workflows/throttle-lever.yml',import.meta.url),'utf8'),
  readFileSync(new URL('../.github/workflows/ui-only.yml',import.meta.url),'utf8')
 ];
 const steps=[
  ['Generate pinned product UI modules','browser-tests/ui-only/check-fixture.mjs'],
  ['Validate fixture Vite transforms','browser-tests/ui-only/validate-vite.mjs'],
  ['Capture bounded product UI states','browser-tests/ui-only/capture.mjs']
 ];
 for(const workflow of workflows){
  assert.doesNotMatch(workflow,/^ {4}env:\r?\n^ {6}UI_ONLY_EVIDENCE_DIR:.*\$\{\{\s*runner\.temp\s*\}\}/m);
  for(const [name,script] of steps){
   const escapedName=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   const escapedScript=script.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   assert.match(workflow,new RegExp(`^      - name: ${escapedName}\\r?\\n        env:\\r?\\n          UI_ONLY_EVIDENCE_DIR: \\$\\{\\{ runner\\.temp \\}\\}\\/senryou-ui-only-evidence\\r?\\n        run: node ${escapedScript}$`,'m'));
  }
  assert.match(workflow,/^ {10}path: \$\{\{ runner\.temp \}\}\/senryou-ui-only-evidence\/$/m);
  assert.equal([...workflow.matchAll(/\$\{\{\s*runner\.temp\s*\}\}/g)].length,4);
 }
});

test('adapter placeholders reject missing or duplicate tokens',()=>{assert.equal(replaceExactlyOnce('a TOKEN b','TOKEN','ok'),'a ok b');assert.throws(()=>replaceExactlyOnce('none','TOKEN','ok'));assert.throws(()=>replaceExactlyOnce('TOKEN TOKEN','TOKEN','ok'));});
test('canvas display is flushed once after UI events and resize, without a continuous frame',()=>{assert.ok(modules.ui.includes("for(const event of ['click','change','keydown','keyup'])"));assert.ok(modules.ui.includes("window.addEventListener('resize',queueFlush)"));assert.ok(modules.ui.includes("view.render(game.mission,mode,game.combat,screen==='playing'||screen==='paused')"));assert.ok(modules.ui.includes("game.mission.phase==='running'"));assert.ok(modules.canvas.includes(source.bounds.body));});

test('source identity covers final HTML, CSS, product UI dependencies, Canvas painter, and fixture bytes',()=>{
 const hashes=collectUiOnlySourceHashes({includeGenerated:false});
 for(const path of ['index.html','package-lock.json','src/style.css','src/control-settings.css','src/main.ts','src/control-settings.ts','src/control-obstacles.ts','src/dialog-focus.ts','src/input.ts','src/throttle-control.ts','src/throttle-lever.ts','src/keyboard-settings.ts','src/rules-guide.ts','src/battle-view.ts','src/flight-assist.ts','src/gun-sight.ts','src/flight-view.ts','browser-tests/ui-only/entry.ts','browser-tests/ui-only/extract-product.mjs','browser-tests/ui-only/samples.ts','browser-tests/ui-only/extraction-contract.json','vite.ui-only.config.ts'])assert.match(hashes[path],/^[a-f0-9]{64}$/);
 assert.deepEqual(Object.keys(hashes),UI_ONLY_SOURCE_PATHS);
 assert.equal(uiOnlySourceHashFingerprint(hashes),uiOnlySourceHashFingerprint(hashes));
});

test('capture binds each image to one source batch and records center-hit observations without asserting them',()=>{
 const capture=readFileSync(new URL('../browser-tests/ui-only/capture.mjs',import.meta.url),'utf8');
 const docs=readFileSync(new URL('../docs/UI_ONLY.md',import.meta.url),'utf8');
 assert.ok(capture.includes('sourceHashesFingerprint:report.sourceHashesFingerprint'));
 assert.ok(capture.includes('item.screenshotSha256=fileSha256(screenshotPath)'));
 assert.ok(capture.includes("setupStatus='failed-before-ui-ready'"));
 assert.ok(capture.includes("centerHitPolicy:'observational-only; false does not fail capture'"));
 assert.doesNotMatch(capture,/if\s*\([^\n]*centerHit/);
 assert.match(docs,/0 screenshots|0枚/);
 assert.match(docs,/false does not fail|false.*fail/);
});

test('unknown fixture IDs fail before display and every capture row is known',()=>{assert.throws(()=>assertFixtureId('typo-hud'));assert.throws(()=>makeSample('typo-hud'));assert.doesNotThrow(()=>makeSample('ready'));const capture=readFileSync(new URL('../browser-tests/ui-only/capture.mjs',import.meta.url),'utf8');const ids=[...capture.matchAll(/\['[^']+',\d+,\d+,'([^']+)'/g)].map(m=>m[1]);assert.equal(ids.length,22);for(const id of ids)assert.doesNotThrow(()=>assertFixtureId(id));for(const id of ['hud-notice','waiting','spectating'])assert.ok(ids.includes(id));assert.ok(modules.ui.includes("assertFixtureId(id);if(nextMode!=='easy'&&nextMode!=='normal')throw"));});
