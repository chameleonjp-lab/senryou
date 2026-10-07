import test from 'node:test';import assert from 'node:assert/strict';import {REGISTRY,SCENARIOS,inspectDiagnostic,inspectBrowserEnvelope,ENVELOPES,PROFILES,STYLE_PROPERTIES,styleDifferences} from '../diagnostics/layout-reservation/contracts';
const box={x:0,y:0,width:44,height:44};
const complete=()=>({records:REGISTRY.map(id=>{const p=PROFILES.find(p=>id.startsWith(p.id+':'))!;return {id,gpuTargetSubmitted:1,pageErrors:[],consoleErrors:[],nativeState:{screen:'playing',tick:1,queue:{completedCount:1}},scenarios:SCENARIOS.map(name=>{
 const envelope=name==='flying-envelope'?ENVELOPES.flying:ENVELOPES.waiting;
 const words:Record<string,string>={'warning':envelope.warning,'reload-status':envelope.reload,'payload-status':envelope.payload,'control-status':envelope.status,'loop-status':ENVELOPES.controls.loop,'bomb-ammo':ENVELOPES.controls.bombAmmo,'bomb-hint':ENVELOPES.controls.bombHint};
 return {name,visualConflicts:[],copiedFitIsCloneVerdict:false,styleIdentity:['warning','reload-status','payload-status','control-status'].map(id=>({id,before:Object.fromEntries(STYLE_PROPERTIES.map(p=>[p,'fixture'])),after:Object.fromEntries(STYLE_PROPERTIES.map(p=>[p,'fixture']))})),nodeCount:8,viewport:{width:p.width,height:p.height},nodes:['warning','reload-status','payload-status','control-status','ally-announcements','loop-status','bomb-ammo','bomb-hint'].map(id=>({id,text:name==='current'?'fixture':words[id]??'',hiddenByAncestor:false,fontSize:'12px',display:'block',visibility:'visible',visualState:'visible-equivalent',box,clientBox:box,fragments:[{text:words[id]??'',rect:box,visibleRect:box}],textNodes:[{text:words[id]??'',rangeCount:1,zeroRange:false,rects:[box]}],clipAncestors:[]})),controls:['pause','game-sound','fire','loop','throttle','bomb'].map(id=>({id,hidden:false,box})),sight:{x:100,y:100,radius:40,margin:8},conflicts:[]};})};})});
test('all8 profiles and all3 scenarios complete measurement only, never product acceptance',()=>{const r=inspectDiagnostic(complete());assert.equal(r.complete,true);assert.equal(r.productAcceptance,false);assert.equal(REGISTRY.length,8);});
test('missing profile/scenario/geometry and environment errors fail measurement closed',()=>{for(const mutate of [(d:ReturnType<typeof complete>)=>{d.records.pop();},(d:ReturnType<typeof complete>)=>{d.records[0].scenarios.pop();},(d:ReturnType<typeof complete>)=>{d.records[0].scenarios[0].nodes=[];},(d:ReturnType<typeof complete>)=>{d.records.push(d.records[0]);}]){const d=complete();mutate(d);assert.equal(inspectDiagnostic(d).complete,false);}assert.equal(inspectDiagnostic(null).complete,false);assert.equal(inspectDiagnostic({records:[{id:REGISTRY[0],error:'GPU unavailable'}]}).complete,false);});
test('source envelopes retain warning, reload, prediction and respawn information',()=>{assert.match(ENVELOPES.flying.warning,/対空.*低空注意.*空域境界/);assert.match(ENVELOPES.flying.reload,/6\.0秒/);assert.match(ENVELOPES.flying.payload,/命中保証ではありません/);assert.match(ENVELOPES.waiting.status,/復帰待ち.*5\.0秒.*経路待機/);});

test('diagnostic runner errors and retries are never hidden by complete geometry',()=>{
 const make=()=>({stats:{expected:1,unexpected:0,skipped:0,flaky:0},errors:[] as string[],suites:[{specs:[{title:'layout-reservation-diagnostic',tests:[{results:[{status:'passed',errors:[] as string[]}]}]}]}]});
 assert.deepEqual(inspectBrowserEnvelope(make()),[]);const a=make();a.errors.push('runner error');assert.ok(inspectBrowserEnvelope(a).length);const b=make();b.suites[0].specs[0].tests[0].results.push(b.suites[0].specs[0].tests[0].results[0]);assert.ok(inspectBrowserEnvelope(b).length);const c=make();c.suites[0].specs[0].tests[0].results[0].status='failed';assert.ok(inspectBrowserEnvelope(c).length);
});

test('completed native count must cover the actual target submission',()=>{const d=complete();d.records[0].gpuTargetSubmitted=2;assert.equal(inspectDiagnostic(d).complete,false);});

test('font or line-height drift after moving a clone is a failed measurement, never a size estimate',()=>{
 const before=Object.fromEntries(STYLE_PROPERTIES.map(k=>[k,'value'])),after={...before,'font-size':'16px'};assert.deepEqual(styleDifferences(before,after),['font-size']);
 const d=complete();d.records[0].scenarios[1].styleIdentity[0].after['line-height']='34px';assert.equal(inspectDiagnostic(d).complete,false);
});

test('matching styles cannot turn missing or hidden nonempty envelope text into a measured result',()=>{
 for(const kind of ['text','display','zero','range','clip']){const d=complete(),n=d.records[0].scenarios[1].nodes.find(n=>n.id==='warning')!;if(kind==='text')n.text='omitted';if(kind==='display')n.display='none';if(kind==='zero')n.box={...box,height:0};if(kind==='range')n.textNodes[0].zeroRange=true;if(kind==='clip')n.visualState='uncertain-clip';assert.equal(inspectDiagnostic(d).complete,false,kind);}
});

test('known viewport clipping is a measured overflow finding, not missing geometry or acceptance success',()=>{
 const d=complete(),s=d.records[0].scenarios[1],n=s.nodes.find(n=>n.id==='warning')!;n.box={...box,y:700};n.visualState='fully-clipped';n.fragments[0].rect={...box,y:700};n.fragments[0].visibleRect={x:0,y:700,width:0,height:0};n.textNodes[0].rects=[{...box,y:700}];const result=inspectDiagnostic(d);assert.equal(result.complete,true);assert.equal(result.productAcceptance,false);
});
