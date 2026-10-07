import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {prepareEvidence} from '../diagnostics/acceptance/evidence-index';
import {CASES} from '../browser-tests/acceptance/contracts';
function report(){return {stats:{expected:CASES.length,unexpected:0,skipped:0,flaky:0},errors:[],suites:[{specs:CASES.map(c=>({title:c.id,tests:[{results:[{status:'passed',attachments:[{name:'acceptance-case.json',contentType:'application/json',body:Buffer.from(JSON.stringify({id:c.id,status:'passed',checks:[...c.required],errors:[],observations:{largePayload:'独立payload'.repeat(1000)}})).toString('base64')}]}]}]}))}]};}
test('each exact case body is independently saved and indexed without embedding payload twice',()=>{
 const r=report(),raw=Buffer.from(JSON.stringify(r)),saved=new Map<string,Buffer>();const index=prepareEvidence(raw,(p,b)=>saved.set(p,b));
 assert.equal(index.summary.scopedSuiteStatus,'passed');assert.equal(index.index.length,CASES.length);
 for(const e of index.index){let v:unknown=r;for(const key of e.jsonPointer.slice(1).split('/'))v=(v as Record<string,unknown>)[key.replace(/~1/g,'/').replace(/~0/g,'~')];const bytes=Buffer.from(v as string,'base64');assert.deepEqual(bytes,saved.get(e.path));assert.equal(bytes.length,e.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),e.sha256);}
 assert.ok(!JSON.stringify(index).includes('独立payload'));assert.ok(JSON.stringify(index).length<raw.length/2);
});
test('missing malformed truncated or failed raw report always yields formal failed summary',()=>{
 for(const raw of [null,Buffer.from('{bad'),Buffer.from('{}')]){const e=prepareEvidence(raw,()=>{});assert.equal(e.summary.scopedSuiteStatus,'incomplete-or-failed');assert.ok(e.extractionIssues.length);}
 const r=report();r.suites[0].specs[0].tests[0].results[0].status='failed';assert.equal(prepareEvidence(Buffer.from(JSON.stringify(r)),()=>{}).summary.scopedSuiteStatus,'incomplete-or-failed');
});
test('case save failure cannot report preservation or pass',()=>{const e=prepareEvidence(Buffer.from(JSON.stringify(report())),()=>{throw new Error('write failed');});assert.ok(e.extractionIssues.some(x=>x.includes('write failed')));assert.equal(e.summary.scopedSuiteStatus,'incomplete-or-failed');});
