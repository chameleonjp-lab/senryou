import { createServer } from 'vite';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadUiOnlyBatch } from './extract-product.mjs';
const evidence=resolve(process.env.UI_ONLY_EVIDENCE_DIR??'../senryou-ui-only-evidence');
mkdirSync(evidence,{recursive:true});
const batch=loadUiOnlyBatch(evidence);
const server=await createServer({configFile:'vite.ui-only.config.ts',mode:'ui-only',server:{middlewareMode:true,watch:null,ws:false},optimizeDeps:{noDiscovery:true}});
const routes=['/browser-tests/ui-only/entry.ts','/browser-tests/ui-only/samples.ts','/src/style.css','/src/overlay-labels.ts','/src/control-settings.css','/src/input.ts','/src/control-settings.ts','/src/keyboard-settings.ts','/src/rules-guide.ts','/src/flight-assist.ts','/src/gun-sight.ts','/src/flight-view.ts','/src/battle/rules.ts','/src/hud-notification-reservations.ts','\0virtual:senryou-ui','\0virtual:senryou-canvas'];
const transformed=[];
try{
 for(const id of routes){const result=await server.transformRequest(id);if(!result?.code)throw new Error('No transform result: '+id);transformed.push({id,bytes:result.code.length});}
 const source=readFileSync('index.html','utf8');const html=await server.transformIndexHtml('/__ui_only__/',source.replace('<script type="module" src="/src/main.ts"></script>','<script type="module" src="/browser-tests/ui-only/entry.ts"></script>'));
 if(html.includes('src="/src/main.ts"')||!html.includes('src="/browser-tests/ui-only/entry.ts"'))throw new Error('Entry substitution failed');
 const finalBatch=loadUiOnlyBatch(evidence);if(finalBatch.batch.batchIdentity!==batch.batch.batchIdentity)throw new Error('UI-only batch changed during Vite transforms');
 const report={status:'passed-static-transform-not-browser',batchIdentity:batch.batch.batchIdentity,sourceHashesFingerprint:batch.sourceHashesFingerprint,sourceHashes:batch.sourceHashes,transformed,productHtmlReadThrough:true,browserExecuted:false};
 writeFileSync(resolve(evidence,'vite-transform-verification.json'),JSON.stringify(report,null,2)+'\n');
 writeFileSync(resolve(evidence,`vite-transform-verification-${batch.batch.batchIdentity}.json`),JSON.stringify(report,null,2)+'\n');console.log('Vite transforms passed:',transformed.length,'batch:',batch.batch.batchIdentity);
}finally{await server.close();}
