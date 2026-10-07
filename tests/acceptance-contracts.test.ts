import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, contained, inspectCampaign, inspectIndependentTargets, inspectTarget, type TargetObservation } from '../browser-tests/acceptance/contracts';
const rect = { x: 10, y: 10, width: 80, height: 50 };
const valid = (): TargetObservation => ({ selector: '#save', owner:1, batch: 1, connected: true, displayed: true, rect: {...rect},
  clip: {x:0,y:0,width:320,height:568}, viewport: {x:0,y:0,width:320,height:568},
  hitPoints: [true,true,true,true,true], accessibleName: '保存する', fragments: [{text:'保存する',rect:{x:20,y:20,width:50,height:20},clip:{x:0,y:0,width:320,height:568},visible:true}] });
test('fresh visible named target with all hit points passes',()=>assert.deepEqual(inspectTarget(valid(),1,{interactive:true}),[]));
for (const [name, mutate] of [
 ['zero target width',(o:TargetObservation)=>{o.rect.width=0;}],
 ['zero text width',(o:TargetObservation)=>{o.fragments[0].rect.width=0;}],
 ['NaN target',(o:TargetObservation)=>{o.rect.x=NaN;}],
 ['hidden text',(o:TargetObservation)=>{o.fragments[0].visible=false;}],
 ['text outside clip',(o:TargetObservation)=>{o.fragments[0].rect.x=319;}],
 ['unmeasured text',(o:TargetObservation)=>{o.fragments=[];}],
 ['stale batch',(o:TargetObservation)=>{o.batch=0;}],
 ['occluded target',(o:TargetObservation)=>{o.hitPoints[2]=false;}],
 ['unmeasured hit points',(o:TargetObservation)=>{o.hitPoints=[];}],
 ['missing name',(o:TargetObservation)=>{o.accessibleName='';}],
 ['disconnected owner',(o:TargetObservation)=>{o.connected=false;}],
 ['ghost hidden owner',(o:TargetObservation)=>{o.displayed=false;}],
] as const) test(`fails closed: ${name}`,()=>{const o=valid();mutate(o);assert.ok(inspectTarget(o,1,{interactive:true}).length>0);});
test('same owner and independent overlapping controls cannot pass',()=>{assert.ok(inspectIndependentTargets([valid(),valid()],1).includes('duplicate-owner'));const b=valid();b.selector='#cancel';b.owner=2;assert.ok(inspectIndependentTargets([valid(),b],1).some(x=>x.startsWith('overlap:')));});
test('zero and negative rectangles never count as containment',()=>{assert.equal(contained({...rect,width:0},rect),false);assert.equal(contained({...rect,height:-1},rect),false);});
const all=()=>CASES.map(c=>({id:c.id,status:'passed' as const,checks:[...c.required],errors:[] as string[]}));
test('complete registered evidence passes only the scoped suite and retains independent gates',()=>{const r=inspectCampaign(all());assert.equal(r.complete,true);assert.ok(r.separateGates.length>=5);});
test('empty partial skipped duplicate unknown or failed records cannot report complete',()=>{
 assert.equal(inspectCampaign([]).complete,false);assert.equal(inspectCampaign(all().slice(1)).complete,false);
 assert.equal(inspectCampaign([...all(),all()[0]]).complete,false);
 assert.equal(inspectCampaign([...all(),{id:'made-up',status:'passed',checks:[],errors:[]}]).complete,false);
 assert.equal(inspectCampaign(all().map((r,i)=>i?r:{...r,status:'not-run'})).complete,false);
 assert.equal(inspectCampaign(all().map((r,i)=>i?r:{...r,errors:['failed at atomic snapshot']})).complete,false);
});
test('absent, duplicate and invented check evidence all fail',()=>{
 for(const checks of [[],['real-input','real-input'],['invented']])assert.equal(inspectCampaign(all().map((r,i)=>i?r:{...r,checks})).complete,false);
});

test('alias selectors cannot manufacture two independent owners',()=>{const a=valid(),b=valid();b.selector='.alias';b.rect.x=200;assert.ok(inspectIndependentTargets([a,b],1).includes('duplicate-owner'));});

test('scroll coverage requires every positive fragment from fresh snapshots',async()=>{
 const {inspectReachableFragments}=await import('../browser-tests/acceptance/contracts');
 const a=valid();a.fragments.push({text:'last',rect:{x:20,y:600,width:50,height:20},clip:{x:0,y:0,width:320,height:568},visible:true});
 const b=structuredClone(a);b.batch=2;b.fragments[0].rect.y=-30;b.fragments[1].rect.y=100;
 assert.deepEqual(inspectReachableFragments([a,b]),[]);
 assert.ok(inspectReachableFragments([a]).includes('unreached-fragment:1'));
 b.fragments[1].rect.width=0;assert.ok(inspectReachableFragments([a,b]).includes('unreached-fragment:1'));
 b.batch=1;assert.ok(inspectReachableFragments([a,b]).includes('duplicate-or-invalid-detail-batch'));
});
test('independent visible text collision fails; adjacent text passes',async()=>{
 const {inspectTextOwners}=await import('../browser-tests/acceptance/contracts');const a=valid(),b=valid();b.owner=2;b.selector='#other';
 assert.ok(inspectTextOwners([a,b],1).some(i=>i.startsWith('text-overlap:')));
 b.rect.x=120;b.fragments[0].rect.x=125;assert.deepEqual(inspectTextOwners([a,b],1),[]);
});

test('fragment-driven scroll plan hits narrow visibility intervals skipped by fixed steps',async()=>{
 const {planDetailPositions}=await import('../browser-tests/acceptance/contracts');
 const clip={x:0,y:0,width:100,height:80};const fragment={text:'large label',visible:true,clip,rect:{x:1,y:110,width:70,height:60}};
 // Full visibility requires scrollTop 90..110; a 40px sequence misses it.
 assert.deepEqual(planDetailPositions([fragment],clip,200),[0,100,200]);
 assert.throws(()=>planDetailPositions([fragment],{...clip,height:0},200));
});

test('descendant clip cannot be replaced by the larger owner clip',()=>{const a=valid();a.fragments[0].clip={x:20,y:20,width:10,height:20};assert.ok(inspectTarget(a,1,{interactive:false}).includes('text-clipped-hidden-or-empty'));});
test('fixed controls cannot cover text between separate text owners',async()=>{
 const {inspectHud}=await import('../browser-tests/acceptance/contracts');const control=valid(),text=valid();text.selector='#label';text.owner=2;text.rect={x:12,y:12,width:76,height:40};text.fragments[0].rect={x:12,y:12,width:3,height:3};
 assert.ok(inspectHud([control],[text],1).some(x=>x.startsWith('control-covers-text:')));
});
test('self-overlapping text fragments fail even within one required owner',async()=>{const {inspectTextOwners}=await import('../browser-tests/acceptance/contracts');const a=valid();a.fragments.push({...a.fragments[0],text:'overlap'});assert.ok(inspectTextOwners([a],1).some(x=>x.startsWith('self-text-overlap:')));});
test('native select requires real named positive interactive geometry and a selected label',async()=>{
 const {inspectAction}=await import('../browser-tests/acceptance/contracts');const a=valid();a.fragments=[];a.nativeWidget={kind:'select',value:'normal',selectedLabels:['ノーマル'],disabled:false,glyphStatus:'not-measurable-with-DOM-Range'};
 assert.deepEqual(inspectAction(a,1),[]);a.rect.width=0;assert.ok(inspectAction(a,1).length);a.rect.width=80;a.nativeWidget.selectedLabels=[];assert.ok(inspectAction(a,1).includes('native-select-value-or-label-missing'));
});
