import test from 'node:test';import assert from 'node:assert/strict';
import {checkedWindowBounds,equalWindowBounds,withRestoredWindow,type WindowBounds,type WindowRestoration,type WindowPort} from '../browser-tests/acceptance/native-window-restoration';
const original:WindowBounds={left:0,top:0,width:1280,height:720,windowState:'normal'};
function fixture(state:WindowBounds=original){const calls:Partial<WindowBounds>[]=[],reports:WindowRestoration[]=[];const port:WindowPort={setBounds:async b=>{calls.push(b);},verifyRestored:async()=>({...state})};return {calls,reports,port};}
test('native window bounds reject incomplete, invalid, nonfinite and unknown state observations',()=>{
 assert.deepEqual(checkedWindowBounds(original),original);
 for(const value of [{...original,width:undefined},{...original,left:NaN},{...original,width:0},{...original,height:-1},{...original,top:1.5},{...original,windowState:'unknown'}])assert.throws(()=>checkedWindowBounds(value));
});
test('exact restoration requires both every original dimension and window state',()=>{
 assert.equal(equalWindowBounds(original,original),true);
 for(const value of [{...original,left:1},{...original,top:1},{...original,width:1000},{...original,height:700},{...original,windowState:'minimized'}])assert.equal(equalWindowBounds(value,original),false);
});
test('successful window operation restores normal state then geometry in separate commands',async()=>{
 const f=fixture();assert.equal(await withRestoredWindow(f.port,original,async()=>42,r=>f.reports.push(r)),42);
 assert.deepEqual(f.calls,[{windowState:'normal'},{left:0,top:0,width:1280,height:720}]);assert.equal(f.reports[0].restored,true);
});
test('original non-normal state is restored after geometry',async()=>{
 const bounds:WindowBounds={...original,windowState:'maximized'},f=fixture(bounds);await withRestoredWindow(f.port,bounds,async()=>{},r=>f.reports.push(r));assert.deepEqual(f.calls.at(-1),{windowState:'maximized'});assert.equal(f.reports[0].actual?.windowState,'maximized');
});
test('failed minimize or missing event still restores original window',async()=>{
 const f=fixture(),error=new Error('minimize unavailable');await assert.rejects(withRestoredWindow(f.port,original,async()=>{throw error;},r=>f.reports.push(r)),e=>e===error);assert.equal(f.calls.length,2);assert.equal(f.reports[0].restored,true);
});
test('restore command rejection cannot yield a pass',async()=>{
 const f=fixture();f.port.setBounds=async()=>{throw new Error('restore rejected');};await assert.rejects(withRestoredWindow(f.port,original,async()=>42,r=>f.reports.push(r)),/restore rejected/);assert.equal(f.reports[0].restored,false);
});
test('mismatched restore readback fails even when commands resolved',async()=>{
 const f=fixture({...original,width:1000});await assert.rejects(withRestoredWindow(f.port,original,async()=>42,r=>f.reports.push(r)),/restoration did not reproduce/);assert.equal(f.reports[0].restored,false);
});
test('restoration timeout remains failure evidence',async()=>{
 const f=fixture();f.port.verifyRestored=async()=>{throw new Error('restore timeout');};await assert.rejects(withRestoredWindow(f.port,original,async()=>42,r=>f.reports.push(r)),/restore timeout/);assert.equal(f.reports[0].restored,false);
});
test('original operation error and restore error are both retained',async()=>{
 const f=fixture(),originalError=new Error('no trusted blur');f.port.setBounds=async()=>{throw new Error('restore rejected');};await assert.rejects(withRestoredWindow(f.port,original,async()=>{throw originalError;},r=>f.reports.push(r)),e=>e===originalError);assert.equal(f.reports[0].restored,false);assert.match(f.reports[0].error!,/restore rejected/);
});

test('a successful single S.blur diagnostic still leaves the formal campaign incomplete',async()=>{
 const {CASES}=await import('../browser-tests/acceptance/contracts');const {prepareEvidence}=await import('../diagnostics/acceptance/evidence-index');
 const spec=CASES.find(c=>c.id==='S.blur')!;
 const attachment={id:spec.id,status:'passed',checks:[...spec.required],errors:[]};
 const raw=Buffer.from(JSON.stringify({stats:{expected:1,unexpected:0,skipped:0,flaky:0},errors:[],suites:[{specs:[{title:'S.blur',tests:[{results:[{status:'passed',attachments:[{name:'acceptance-case.json',contentType:'application/json',body:Buffer.from(JSON.stringify(attachment)).toString('base64')}]}]}]}]}]}));
 const saved:Buffer[]=[];const report=prepareEvidence(raw,(_p,b)=>saved.push(b));
 assert.equal(report.summary.scopedSuiteStatus,'incomplete-or-failed');assert.equal(report.summary.fullAcceptance,false);assert.equal(report.index.length,1);assert.equal(saved.length,1);assert.deepEqual(report.extractionIssues,[]);assert.equal(report.summary.issues.filter(s=>s.startsWith('missing-case:')).length,12);
});
