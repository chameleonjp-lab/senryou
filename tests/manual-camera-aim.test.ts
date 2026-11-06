import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3,Quaternion } from 'three';
import { createBattle,stepBattle } from '../src/battle/simulation';
import { createFlightAircraft } from '../src/battle-flight';
import { getFlightCameraPose } from '../src/flight-view';
import { createFlightController,updatePlayerLoop } from '../src/flight';
import { autoFireTarget } from '../src/flight-assist';
import { forwardOfUnit } from '../src/battle/projectiles';
const neutral={turn:0,climb:0,fire:false,loop:false,viewAspect:402/874};
function encounter(mode:'easy'|'normal',x=0,depth=500,kind:'aircraft'|'tank'='aircraft'){
 const g=createBattle(73,mode),p=g.mission.units.find(u=>u.id===g.mission.controlledAircraftId)!;Object.assign(p,{position:{x:0,y:1500,z:0},heading:0,pitch:0,bank:0,speed:110});
 for(const u of g.mission.units)if(u.id!==p.id&&u.state==='active'&&u.kind==='aircraft'){u.position={x:4000,y:2000,z:2500};}
 const t=g.mission.units.find(u=>u.kind===kind&&u.team!==p.team&&u.state==='active')!,pos=new Vector3(),q=new Quaternion();getFlightCameraPose(createFlightAircraft(p,g.mission.playerTeam),mode,pos,q);
 const v=new Vector3(x,0,-depth).applyQuaternion(q).add(pos);t.position={x:v.x,y:v.y,z:v.z};t.velocity={x:16,y:0,z:0};return {g,p,t};
}
for(const mode of ['easy','normal'] as const){
 test(`${mode}: air and ground enemy layouts cannot change flight before combat effects`,()=>{
  for(const command of [neutral,{...neutral,turn:.1,climb:.08},{...neutral,turn:-.3,steeringActive:true},{...neutral,turn:.2,climb:-.2,fire:true}]){
   let expected:unknown;
   for(const kind of ['aircraft','tank'] as const)for(const layout of ['none','front','circle-edge','screen-edge','behind','crossing']){
    const {g,p,t}=encounter(mode,layout==='circle-edge'?45:layout==='screen-edge'?105:0,layout==='behind'?-500:500,kind);if(layout==='none')t.position={x:4000,y:2000,z:2500};
    const trace=[];for(let tick=0;tick<12;tick++){if(layout==='crossing'){t.position.x=tick<6?105:-105;if(tick===9)t.hp=0;}
     stepBattle(g,command);const a=createFlightAircraft(p,g.mission.playerTeam),pos=new Vector3(),q=new Quaternion();getFlightCameraPose(a,mode,pos,q);
     trace.push([p.position,p.heading,p.pitch,p.bank,p.speed,pos.toArray(),q.toArray(),g.controller?.responseMultiplier]);}
    expected??=trace;assert.deepEqual(trace,expected,`${kind}/${layout}`);
   }
  }
 });
 test(`${mode}: centered held steering keeps twenty degree pitch until release`,()=>{
  const {g,p}=encounter(mode),a=createFlightAircraft({...p,pitch:20*Math.PI/180},g.mission.playerTeam),c=createFlightController(a),held={...neutral,steeringActive:true};
  for(let tick=0;tick<12;tick++)updatePlayerLoop(a,c,held,held,false,1/60,110,141,1,mode);assert.equal(a.pitch,20*Math.PI/180);
  updatePlayerLoop(a,c,neutral,neutral,false,1/60,110,141,1,mode);assert.ok(a.pitch<20*Math.PI/180&&a.pitch>19*Math.PI/180);
 });
 test(`${mode}: left and right MG/cannon rounds follow the bore and Normal release stops`,()=>{
  for(const fire of [true,false]){const {g,p}=encounter(mode,15);stepBattle(g,{...neutral,fire});const shots=g.combat.projectiles.filter(b=>b.ownerId===p.id),forward=forwardOfUnit(p);
   assert.equal(shots.length,mode==='easy'||fire?4:0);assert.deepEqual(shots.map(b=>b.weapon),shots.length?['mg','mg','cannon','cannon']:[]);
   for(const s of shots)assert.ok(new Vector3(s.velocity.x,s.velocity.y,s.velocity.z).normalize().distanceTo(new Vector3(forward.x,forward.y,forward.z))<1e-12);
  }
 });
}
test('Easy trigger uses live aspect, range, team and health after target changes',()=>{
 const {g,p,t}=encounter('easy'),a=createFlightAircraft(p,g.mission.playerTeam),target=createFlightAircraft(t,g.mission.playerTeam),lock=createFlightController(a).targetLock,origin=new Vector3(),q=new Quaternion();getFlightCameraPose(a,'easy',origin,q);
 for(const [x,d,aspect,want] of [[0,500,402/874,true],[55,500,402/874,false],[55,500,874/402,true],[0,1300,402/874,false]] as const){target.position.set(x,0,-d).applyQuaternion(q).add(origin);assert.equal(autoFireTarget(a,[target],'easy',aspect,lock)!==null,want);}
 target.position.set(0,0,-500).applyQuaternion(q).add(origin);target.team='friendly';assert.equal(autoFireTarget(a,[target],'easy',402/874,lock),null);target.team='enemy';target.health=0;assert.equal(autoFireTarget(a,[target],'easy',402/874,lock),null);
});
