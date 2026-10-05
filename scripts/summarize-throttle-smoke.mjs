import { readFile, writeFile, mkdir } from 'node:fs/promises';
const records=[];
for(const [version,directory] of [['candidate','docs/evidence/smoke'],['baseline','throttle-baseline/docs/evidence/smoke']]) {
 for(const viewport of ['phone-portrait-393x648','phone-landscape-568x320','pc-1280x720']) {
  try {
   const evidence=JSON.parse(await readFile(`${directory}/${viewport}.json`,'utf8'));
   const row={version,viewport,easyRun:evidence.easyRun??null,pageErrors:evidence.pageErrors??[],consoleErrors:evidence.consoleErrors??[],actions:evidence.actions??[],failure:evidence.failure??null,finalState:evidence.finalState??null,finalUi:evidence.finalUi??null};
   records.push(row);console.log('THROTTLE_BASELINE_SMOKE '+JSON.stringify(row));
  } catch(error) { records.push({version,viewport,missing:true,reason:String(error)}); }
 }
}
await mkdir('test-results',{recursive:true});
await writeFile('test-results/throttle-baseline-smoke-comparison.json',JSON.stringify(records,null,2));
