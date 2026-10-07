import { createHash } from 'node:crypto';
import { inspectPlaywrightReport } from '../../browser-tests/acceptance/report';
export interface EvidenceIndex { jsonPointer:string; encoding:'base64'; path:string; bytes:number; sha256:string; caseId:string }
export function prepareEvidence(raw:Buffer|null,save:(path:string,bytes:Buffer)=>void) {
 const index:EvidenceIndex[]=[],issues:string[]=[];
 let summary:ReturnType<typeof inspectPlaywrightReport>|undefined;
 try {
  if(raw===null)throw new Error('Playwright report is missing');
  const report:unknown=JSON.parse(raw.toString('utf8'));
  const visit=(value:unknown,pointer:string):void=>{
   if(!value||typeof value!=='object')return;
   if(Array.isArray(value)){value.forEach((v,i)=>visit(v,`${pointer}/${i}`));return;}
   const o=value as Record<string,unknown>;
   if(o.name==='acceptance-case.json'&&o.contentType==='application/json'){
    if(typeof o.body!=='string')throw new Error('Case attachment is not inline base64');
    const bytes=Buffer.from(o.body,'base64');if(bytes.toString('base64')!==o.body)throw new Error('Invalid base64 evidence');
    const record:unknown=JSON.parse(bytes.toString('utf8'));
    if(!record||typeof record!=='object'||typeof (record as Record<string,unknown>).id!=='string')throw new Error('Case attachment has no id');
    const path=`test-results/acceptance-evidence/case-${String(index.length+1).padStart(3,'0')}.json`;
    save(path,bytes);index.push({jsonPointer:`${pointer}/body`,encoding:'base64',path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),caseId:(record as {id:string}).id});
   }
   for(const [key,child] of Object.entries(o))visit(child,`${pointer}/${key.replace(/~/g,'~0').replace(/\//g,'~1')}`);
  };
  visit(report,'');summary=inspectPlaywrightReport(report);
 }catch(error){issues.push(error instanceof Error?`${error.name}: ${error.message}`:String(error));}
 return {schemaVersion:1,raw:raw?{path:'test-results/acceptance-results.json',bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')}:null,
  reconstruction:'Resolve each RFC6901 jsonPointer in the one raw report; decode base64; verify bytes and SHA256. This recovers each separate case file exactly without a second full log copy.',
  index,summary:summary??{schemaVersion:1,scopedSuiteStatus:'incomplete-or-failed',issues,records:[],separateGates:[],fullAcceptance:false},extractionIssues:issues};
}
