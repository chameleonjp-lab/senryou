import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = s => createHash('sha256').update(s).digest('hex');
export const UI_ONLY_SOURCE_PATHS = [
 'index.html',
 'package.json','package-lock.json',
 'src/style.css','src/control-settings.css',
 'src/main.ts','src/control-settings.ts','src/control-obstacles.ts','src/control-footprints.ts','src/hud-geometry.ts','src/hud-notification-reservations.ts','src/hud-sight-reservation.ts','src/settings-storage.ts','src/dialog-focus.ts',
 'src/input.ts','src/throttle-control.ts','src/throttle-lever.ts','src/keyboard-settings.ts','src/rules-guide.ts','src/flight-assist.ts','src/gun-sight.ts','src/flight-view.ts',
 'src/battle-view.ts','src/overlay-labels.ts','src/battle/terrain.ts','src/battle/rules.ts',
 'browser-tests/ui-only/canvas-adapter.template.ts','browser-tests/ui-only/capture.mjs','browser-tests/ui-only/check-fixture.mjs','browser-tests/ui-only/entry.ts','browser-tests/ui-only/extract-product.mjs','browser-tests/ui-only/extraction-contract.json','browser-tests/ui-only/samples.ts','browser-tests/ui-only/ui-adapter.template.ts','browser-tests/ui-only/validate-vite.mjs',
 'tests/ui-only-extraction.test.ts','tsconfig.ui-only.json','vite.ui-only.config.ts',
].sort();
export function collectUiOnlySourceHashes({includeGenerated=true}={}){
 const paths=[...UI_ONLY_SOURCE_PATHS,...(includeGenerated?['browser-tests/ui-only/generated/canvas.ts','browser-tests/ui-only/generated/ui.ts']:[])].sort();
 return Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')]));
}
export function uiOnlySourceHashFingerprint(sourceHashes){
 return hash(JSON.stringify(Object.entries(sourceHashes).sort(([a],[b])=>a<b?-1:a>b?1:0)));
}
export function loadUiOnlyBatch(evidenceRoot){
 const manifestPath=resolve(evidenceRoot,'extraction-verification.json');
 const batch=JSON.parse(readFileSync(manifestPath,'utf8'));
 if(typeof batch.batchIdentity!=='string'||!batch.batchIdentity||!batch.sourceHashes||typeof batch.sourceHashesFingerprint!=='string')throw new Error('UI-only extraction evidence is missing batch identity or source hashes');
 const current=collectUiOnlySourceHashes(),fingerprint=uiOnlySourceHashFingerprint(current);
 if(JSON.stringify(current)!==JSON.stringify(batch.sourceHashes)||fingerprint!==batch.sourceHashesFingerprint)throw new Error('UI-only source hashes changed after fixture generation');
 return {batch,sourceHashes:current,sourceHashesFingerprint:fingerprint,manifestPath};
}
const uiNames = ['instructions','sound','setScreen','begin','pause','resume','home','graphicsFailure','time','forces','forceText','hud','result'];
const paintNames = ['project','drawOverlay','drawTargets','drawBombGuide','drawAAWarnings','drawBoundaryWarning','drawPointLabels','drawRadar'];
const dependencies = node => {
 const names = new Set(), members = new Set();
 const visit = n => {if(ts.isIdentifier(n))names.add(n.text);if(ts.isPropertyAccessExpression(n)&&n.expression.kind===ts.SyntaxKind.ThisKeyword)members.add(n.name.text);ts.forEachChild(n,visit);};visit(node);
 return {identifiers:[...names].sort(),thisMembers:[...members].sort()};
};
function one(nodes, name, source) {
 const matching=nodes.filter(n=>n.name?.getText(source)===name);
 if(matching.length!==1)throw new Error(`Expected exactly one product function ${name}, found ${matching.length}`);
 const n=matching[0],body=n.getText(source),signature=body.slice(0,body.indexOf('{')).trim();
 return {name,body,signature,sha256:hash(body),...dependencies(n)};
}
export function inspectExtraction() {
 const main=readFileSync(resolve(root,'src/main.ts'),'utf8'),view=readFileSync(resolve(root,'src/battle-view.ts'),'utf8');
 const mainAst=ts.createSourceFile('main.ts',main,ts.ScriptTarget.Latest,true),viewAst=ts.createSourceFile('battle-view.ts',view,ts.ScriptTarget.Latest,true);
 const classes=viewAst.statements.filter(n=>ts.isClassDeclaration(n)&&n.name?.text==='BattleView');
 if(classes.length!==1)throw new Error('Expected exactly one BattleView class');
 const ui=uiNames.map(name=>one(mainAst.statements.filter(ts.isFunctionDeclaration),name,mainAst));
 const canvas=paintNames.map(name=>one(classes[0].members.filter(ts.isMethodDeclaration),name,viewAst));
 const start="for(const id of ['start','retry','pause-restart'])",end="canvas.addEventListener('webglcontextlost'";
 if(main.split(start).length!==2||main.split(end).length!==2)throw new Error('UI event block boundary drift');
 const events=main.slice(main.indexOf(start),main.indexOf(end)).trim();
 const eventAst=ts.createSourceFile('events.ts',events,ts.ScriptTarget.Latest,true);
 const terrain=readFileSync(resolve(root,'src/battle/terrain.ts'),'utf8'),terrainAst=ts.createSourceFile('terrain.ts',terrain,ts.ScriptTarget.Latest,true);
 const fields=terrainAst.statements.filter(ts.isVariableStatement).flatMap(n=>[...n.declarationList.declarations]).filter(n=>n.name.getText(terrainAst)==='BATTLEFIELD');
 if(fields.length!==1||!fields[0].initializer||!ts.isObjectLiteralExpression(fields[0].initializer))throw new Error('Expected one BATTLEFIELD object');
 const bounds=fields[0].initializer.properties.filter(n=>n.name?.getText(terrainAst)==='bounds');
 if(bounds.length!==1||!ts.isPropertyAssignment(bounds[0]))throw new Error('Expected one BATTLEFIELD.bounds assignment');
 const boundsBody=bounds[0].initializer.getText(terrainAst);
 return {terrainSha256:hash(terrain),bounds:{body:boundsBody,sha256:hash(boundsBody),...dependencies(bounds[0])},mainSha256:hash(main),viewSha256:hash(view),ui,canvas,events:{body:events,sha256:hash(events),...dependencies(eventAst)}};
}
export function extractionContract(report=inspectExtraction()) {
 return {schemaVersion:1,mainSha256:report.mainSha256,viewSha256:report.viewSha256,terrainSha256:report.terrainSha256,bounds:(({body,...r})=>r)(report.bounds),
  ui:report.ui.map(({body,...r})=>r),canvas:report.canvas.map(({body,...r})=>r),events:(({body,...r})=>r)(report.events),
  notice:'Exact product function bodies and event block; injected fixed display dependencies do not validate gameplay.'};
}
export function replaceExactlyOnce(source,needle,body){if(source.split(needle).length!==2)throw new Error(`Expected exactly one adapter placeholder ${needle}`);return source.replace(needle,body);}
export function generateProductModules() {
 const report=inspectExtraction(),expected=JSON.parse(readFileSync(resolve(root,'browser-tests/ui-only/extraction-contract.json'),'utf8'));
 if(JSON.stringify(extractionContract(report))!==JSON.stringify(expected))throw new Error('Product UI extraction source/signature/dependency contract drift. Review and repin; no silent fallback.');
 const uiTemplate=readFileSync(resolve(root,'browser-tests/ui-only/ui-adapter.template.ts'),'utf8');
 const paintTemplate=readFileSync(resolve(root,'browser-tests/ui-only/canvas-adapter.template.ts'),'utf8');
 return {ui:replaceExactlyOnce(replaceExactlyOnce(uiTemplate,'/* PRODUCT_FUNCTIONS */',report.ui.map(r=>r.body).join('\n')),'/* PRODUCT_EVENTS */',report.events.body),canvas:replaceExactlyOnce(replaceExactlyOnce(paintTemplate,'/* PRODUCT_METHODS */',report.canvas.map(r=>r.body).join('\n')),'/* PRODUCT_BOUNDS */',report.bounds.body),report:extractionContract(report)};
}
