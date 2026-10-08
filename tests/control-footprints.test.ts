import test from 'node:test';import assert from 'node:assert/strict';
import {controlLayoutCacheKey,getCachedControlLayoutAndSyncFits,placeControlFootprints,separated,type NamedFootprint,type SafeFrame} from '../src/control-footprints';
const frame:SafeFrame={width:393,height:648,left:8,right:8,top:8,bottom:8};
const body=[{x:100,y:328,width:176,height:200},{x:292,y:319,width:178,height:182},{x:185,y:116,width:346,height:208},{x:185,y:528,width:162,height:38}];
const enlarged:NamedFootprint[]=[{id:'fire',x:326,y:544,width:96,height:96},{id:'loop',x:326,y:427,width:94,height:122},{id:'bomb',x:153,y:609,width:126,height:83},{id:'throttle',x:67,y:486,width:64,height:128}];
test('full enlarged label footprints fit without shrinking text geometry or touching HUD lanes',()=>{
 const snapshot=JSON.stringify(enlarged),result=placeControlFootprints(enlarged,frame,body);assert.equal(result.fits,true);assert.equal(JSON.stringify(enlarged),snapshot);
 for(const p of result.placements){assert.equal(p.width,enlarged.find(i=>i.id===p.id)!.width);assert.equal(p.height,enlarged.find(i=>i.id===p.id)!.height);assert.ok(p.x-p.width/2>=8&&p.x+p.width/2<=385&&p.y-p.height/2>=8&&p.y+p.height/2<=640);for(const o of body)assert.ok(separated(p,o));for(const other of result.placements)if(p!==other)assert.ok(separated(p,other));}
});
test('an already readable custom layout is preserved exactly',()=>{
 const items=[{id:'loop',x:320,y:420,width:94,height:122},{id:'bomb',x:100,y:580,width:126,height:83}];assert.deepEqual(placeControlFootprints(items,frame,[]),{placements:items,fits:true});
});
test('landscape loop text extent, not old circle alone, excludes the fire footprint',()=>{
 const f={...frame,width:568,height:320};const items=[{id:'loop',x:471.44,y:211.19,width:54,height:59},{id:'fire',x:471.44,y:268.8,width:51.2,height:51.2}];const result=placeControlFootprints(items,f,[]);assert.equal(result.fits,true);assert.ok(separated(result.placements[0],result.placements[1]));assert.equal(result.placements[0].height,59);
});
test('small safe area returns an explicit non-fit without hiding or shrinking controls',()=>{
 const result=placeControlFootprints(enlarged,{...frame,width:100,height:100},[]);assert.equal(result.fits,false);assert.equal(result.placements.length,4);assert.deepEqual(result.placements.map(p=>[p.width,p.height]),enlarged.map(p=>[p.width,p.height]));
});
test('safe-area insets and edge labels are included in the same bounds',()=>{
 const f={...frame,left:25,right:30,top:20,bottom:40};const result=placeControlFootprints([{id:'bomb',x:390,y:647,width:126,height:83}],f,[]);assert.equal(result.fits,true);const p=result.placements[0];assert.ok(p.x+p.width/2<=363&&p.y+p.height/2<=608);
});
test('invalid or sub-44px footprint is rejected rather than passed',()=>{for(const item of [{...enlarged[0],width:43},{...enlarged[0],height:NaN}])assert.throws(()=>placeControlFootprints([item],frame,[]));});

test('product data-flight-control=true is a marker; each id owns its measured footprint',async()=>{
 const {controlFootprintId}=await import('../src/hud-geometry');const buttons=['fire','loop','bomb','throttle'].map(id=>({id,dataset:{flightControl:'true'}}));
 assert.deepEqual(buttons.map(controlFootprintId),['fire','loop','bomb','throttle']);assert.equal(controlFootprintId({id:'true'}),undefined);assert.equal(controlFootprintId({id:''}),undefined);
});

test('legacy peers stay pinned and only the lever finds a free location',()=>{
 const peers=[{id:'fire',x:200,y:500,width:96,height:96},{id:'loop',x:320,y:420,width:72,height:72},{id:'bomb',x:100,y:580,width:80,height:60}];
 const result=placeControlFootprints([...peers,{id:'throttle',x:200,y:500,width:64,height:128}],frame,[],4,peers.map(p=>p.id));assert.equal(result.fits,true);assert.deepEqual(result.placements.slice(0,3),peers);assert.notDeepEqual(result.placements[3],{id:'throttle',x:200,y:500,width:64,height:128});
});
test('an invalid pinned legacy peer produces non-fit instead of silently moving it',()=>{
 const peer={id:'bomb',x:20,y:640,width:126,height:83};const result=placeControlFootprints([peer],frame,[],4,['bomb']);assert.equal(result.fits,false);assert.deepEqual(result.placements[0],peer);
});
test('ordinary content refresh defers during capture; only environment changes clear then apply',async()=>{
 const {layoutRefreshPolicy}=await import('../src/control-footprints');assert.equal(layoutRefreshPolicy('same','same',true),'defer');assert.equal(layoutRefreshPolicy('old','new',true),'clear-and-apply');assert.equal(layoutRefreshPolicy('old','new',false),'apply');assert.equal(layoutRefreshPolicy('same','same',false),'apply');
});

test('placement cache key changes when measured obstacles or geometry readiness changes',()=>{
 const layout={fire:{x:.8,y:.8,size:1},loop:{x:.8,y:.6,size:1}};
 const controls={fire:{width:96,height:96},loop:{width:94,height:122}};
 const obstacles=[{x:180,y:70,width:300,height:140}];
 const key=controlLayoutCacheKey('normal',layout,'same-environment',obstacles,controls,true);
 const cache=new Map([[key,{placements:'stale',fits:false}]]);
 assert.equal(controlLayoutCacheKey('normal',layout,'same-environment',obstacles,controls,true),key);
 for(const changed of [
  controlLayoutCacheKey('normal',layout,'same-environment',[{...obstacles[0],height:141}],controls,true),
  controlLayoutCacheKey('normal',layout,'same-environment',obstacles,{...controls,fire:{width:97,height:96}},true),
  controlLayoutCacheKey('normal',layout,'same-environment',obstacles,controls,false),
  controlLayoutCacheKey('normal',layout,'changed-environment',obstacles,controls,true),
 ]){assert.notEqual(changed,key);assert.equal(cache.has(changed),false,'changed measured geometry cannot return stale placement/fits');}
});

test('A true, B false, then cached A restores placement, blocked state, and dataset fits',()=>{
 const layout={fire:{x:.8,y:.8,size:1},throttle:{x:.2,y:.7,size:1}},controls={fire:{width:96,height:96},throttle:{width:64,height:128}};
 const obstacleA=[{x:180,y:70,width:180,height:100}],obstacleB=[{x:180,y:70,width:300,height:220}];
 const keyA=controlLayoutCacheKey('normal',layout,'same-environment',obstacleA,controls,true);
 const keyB=controlLayoutCacheKey('normal',layout,'same-environment',obstacleB,controls,false);
 type Entry={placements:{fire:{x:number;blocked:boolean};throttle:{x:number;blocked:boolean}};fits:boolean};
 const a:Entry={fits:true,placements:{fire:{x:.82,blocked:false},throttle:{x:.2,blocked:false}}};
 const b:Entry={fits:false,placements:{fire:{x:.48,blocked:false},throttle:{x:.52,blocked:true}}};
 const cache=new Map<string,Entry>(),dataset:{controlLayoutFits?:string}={};
 const render=(key:string,fresh?:Entry):Entry=>{
  const cached=getCachedControlLayoutAndSyncFits(cache,key,dataset);if(cached)return cached;
  assert.ok(fresh,'a cache miss must compute a new entry');dataset.controlLayoutFits=String(fresh.fits);cache.set(key,fresh);return fresh;
 };
 assert.deepEqual(render(keyA,a),a);assert.equal(dataset.controlLayoutFits,'true');
 assert.deepEqual(render(keyB,b),b);assert.equal(dataset.controlLayoutFits,'false');
 const restoredA=render(keyA);assert.deepEqual(restoredA,a);assert.deepEqual(restoredA.placements,a.placements);
 assert.equal(restoredA.placements.throttle.blocked,false);assert.equal(dataset.controlLayoutFits,'true');
});
