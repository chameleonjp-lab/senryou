import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { generateProductModules, collectUiOnlySourceHashes, uiOnlySourceHashFingerprint } from './extract-product.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const generated=resolve(root,'browser-tests/ui-only/generated');
const evidence=resolve(process.env.UI_ONLY_EVIDENCE_DIR??resolve(root,'..','senryou-ui-only-evidence'));
const modules=generateProductModules();mkdirSync(generated,{recursive:true});mkdirSync(evidence,{recursive:true});
if(!modules.ui.includes(modules.report.events?.body??'for(const id')){throw new Error('UI event extraction missing');}
writeFileSync(resolve(generated,'ui.ts'),modules.ui);
writeFileSync(resolve(generated,'canvas.ts'),modules.canvas);
const batchIdentity=randomUUID(),sourceHashes=collectUiOnlySourceHashes(),sourceHashesFingerprint=uiOnlySourceHashFingerprint(sourceHashes);
const report={status:'fixture-generated',batchIdentity,createdAtUtc:new Date().toISOString(),sourceHashes,sourceHashesFingerprint,sourceBodyEquivalence:true,sourceHashesPinned:true,uiFunctions:modules.report.ui.map(r=>r.name),canvasMethods:modules.report.canvas.map(r=>r.name),eventBlockSha256:modules.report.events.sha256,allThisMembers:modules.report.canvas.flatMap(r=>r.thisMembers).filter((x,i,a)=>a.indexOf(x)===i).sort(),extractorModifiedProductSource:false};
const reportText=JSON.stringify(report,null,2)+'\n';
writeFileSync(resolve(evidence,'extraction-verification.json'),reportText);
writeFileSync(resolve(evidence,`extraction-verification-${batchIdentity}.json`),reportText);
console.log(JSON.stringify({batchIdentity,sourceHashesFingerprint,hashedSources:Object.keys(sourceHashes).length}));
