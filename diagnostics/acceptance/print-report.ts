import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { prepareEvidence } from './evidence-index';
const token=randomUUID();process.stdout.write(`::stop-commands::${token}\n`);
try {
 let raw:Buffer|null=null;try{raw=readFileSync('test-results/acceptance-results.json');}catch{/* Missing report still produces a formal failed summary. */}
 const emit=(label:string,bytes:Buffer)=>{
  const sha256=createHash('sha256').update(bytes).digest('hex');
  process.stdout.write(`JSON_EVIDENCE_BEGIN ${JSON.stringify({label,bytes:bytes.length,sha256})}\n`);
  // Raw bytes are emitted once, never nested in/re-stringified with decoded bodies.
  process.stdout.write(bytes);process.stdout.write(`\nJSON_EVIDENCE_END ${JSON.stringify({label,sha256})}\n`);
 };
 const output=prepareEvidence(raw,(path,bytes)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);});
 if(raw)emit('acceptance-results.json',raw);
 const index=Buffer.from(JSON.stringify(output,null,2));mkdirSync('test-results',{recursive:true});writeFileSync('test-results/acceptance-index.json',index);
 emit('acceptance-index.json',index);
 process.stdout.write('CASE_BODIES_RECOVERABLE_FROM_RAW_REPORT: indexed base64 JSON pointers; no duplicated full decoded log payload\n');
 process.stdout.write('NON_JSON_EVIDENCE_NOT_SAVED: no screenshot, trace, cache or artifact upload\n');
 if(output.extractionIssues.length||output.summary.scopedSuiteStatus!=='passed')process.exitCode=1;
}finally{process.stdout.write(`::${token}::\n`);}
