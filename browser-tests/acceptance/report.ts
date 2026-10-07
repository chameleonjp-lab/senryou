import { CASES, inspectCampaign, type CaseEvidence } from './contracts';
function object(value:unknown):Record<string,unknown> {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected report object');return value as Record<string,unknown>;
}
function array(value:unknown):unknown[]{if(!Array.isArray(value))throw new Error('Expected report array');return value;}
export function inspectPlaywrightReport(raw:unknown) {
 const report=object(raw),stats=object(report.stats),records:CaseEvidence[]=[];
 const reportIssues:string[]=[];
 function suite(value:unknown):void {
  const s=object(value);
  for(const value of array(s.specs??[])) {
   const spec=object(value);
   for(const test of array(spec.tests)) {
    const t=object(test),results=array(t.results);
    if(results.length!==1)reportIssues.push(`retry-or-missing-result:${String(spec.title)}`);
    for(const result of results) {
     const r=object(result);if(r.status!=='passed')reportIssues.push(`browser-status:${String(spec.title)}:${String(r.status)}`);
     const attachments=array(r.attachments).map(object).filter(a=>a.name==='acceptance-case.json');
     if(attachments.length!==1){reportIssues.push(`missing-or-duplicate-evidence:${String(spec.title)}`);continue;}
     const a=attachments[0];if(a.contentType!=='application/json'||typeof a.body!=='string')throw new Error('Case evidence must be inline JSON');
     const record=object(JSON.parse(Buffer.from(a.body,'base64').toString('utf8')));
     if(typeof record.id!=='string'||record.id!==spec.title)throw new Error('Case identity differs from collected test');
     if(!['passed','failed','blocked','not-run'].includes(String(record.status)))throw new Error('Invalid case status');
     const checks=array(record.checks),errors=array(record.errors);
     if(!checks.every(x=>typeof x==='string')||!errors.every(x=>typeof x==='string'))throw new Error('Invalid case checks/errors');
     records.push({id:record.id,status:record.status as CaseEvidence['status'],checks:checks as string[],errors:errors as string[]});
    }
   }
  }
  for(const child of array(s.suites??[]))suite(child);
 }
 for(const s of array(report.suites))suite(s);
 if(stats.expected!==CASES.length||stats.unexpected!==0||stats.skipped!==0||stats.flaky!==0)reportIssues.push('playwright-counts-not-complete');
 if(array(report.errors??[]).length)reportIssues.push('top-level-browser-errors');
 const result=inspectCampaign(records);
 return {schemaVersion:1,scopedSuiteStatus:result.complete&&!reportIssues.length?'passed':'incomplete-or-failed',issues:[...reportIssues,...result.issues],records:records.map(r=>({id:r.id,status:r.status,checks:r.checks,errorCount:r.errors.length})),
  separateGates:result.separateGates.map(name=>({name,status:'not-verified-by-this-suite'})),fullAcceptance:false};
}
