import test from 'node:test';
import assert from 'node:assert/strict';
import { createMission } from '../src/battle/mission';
import { createAirAIState, moveAIAircraft, updateAirAI } from '../src/battle/air-ai';
import { createCombatState } from '../src/battle/combat';
import { fireWeapon } from '../src/battle/weapons';
import { aircraftTerrainContact, copy, distance } from '../src/battle/projectiles';
import type { ProjectileTerrain } from '../src/battle/projectiles';
import { createFlightAircraft } from '../src/battle-flight';
import { updateAircraftMotion } from '../src/flight';
import type { Unit, UnitKind } from '../src/battle/types';

const EMPTY:ProjectileTerrain={sweep:()=>null,lineOfSight:()=>true,height:()=>0};
function unit(kind:UnitKind='aircraft',team:'A'|'B'='A',ordinal=0):Unit {
  const m=createMission(),u=m.units.find(u=>u.kind===kind&&u.team===team&&u.id.endsWith(String(ordinal).padStart(3,'0')))!;
  u.role='ai';u.state='active';u.position={x:team==='A'?-600:600,y:kind==='aircraft'?500:0,z:ordinal*40};u.heading=team==='A'?-Math.PI/2:Math.PI/2;u.velocity={x:team==='A'?110:-110,y:0,z:0};u.pitch=0;u.bank=0;u.speed=110;return u;
}
function mission(units:Unit[]){const m=createMission();m.units=units;m.controlledAircraftId=null;return m;}
function close(actual:number,expected:number){assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);}

test('P6 numeric aircraft AI motion preserves the fixed Kaisen equations across flight envelope',()=>{
  for(const initialSpeed of [65,75,85,100,110,125,141]){
    const u=unit();u.speed=initialSpeed;u.pitch=.27;u.bank=-.18;u.heading=-1.2;
    const inherited=createFlightAircraft(u);
    for(let tick=0;tick<120;tick++){
      const turn=Math.sin(tick*.11),climb=Math.cos(tick*.07),preferred=100+10*Math.sin(tick*.031);
      moveAIAircraft(u,turn,climb,preferred);updateAircraftMotion(inherited,turn,climb,1/60,preferred);
      close(u.heading,inherited.yaw);close(u.pitch!,inherited.pitch);close(u.bank!,inherited.bank);close(u.speed!,inherited.speed);
      close(u.position.x,inherited.position.x);close(u.position.y,inherited.position.y);close(u.position.z,inherited.position.z);
    }
  }
});
test('R09 active AI roles use half rounded up for air, and support prioritizes AA/tanks',()=>{
  const planes=Array.from({length:5},(_,i)=>unit('aircraft','A',i)),air=unit('aircraft','B',1),aa=unit('aa','B',1),tank=unit('tank','B',1),inf=unit('infantry','B',1);
  air.role='player';aa.position={x:200,y:0,z:0};tank.position={x:0,y:0,z:0};inf.position={x:-100,y:0,z:0};
  const m=mission([...planes,air,aa,tank,inf]),state=createAirAIState();m.tick=1;updateAirAI(m,state,EMPTY);
  assert.equal([...state.units.values()].filter(s=>s.task==='air').length,3);assert.equal([...state.units.values()].filter(s=>s.task==='support').length,2);
  const supports=planes.filter(p=>state.units.get(p.id)!.task==='support');assert.ok(supports.every(p=>p.targetId===aa.id));
  assert.equal(planes.filter(p=>p.targetId===air.id).length,2);
  planes[0].state='lost';m.tick=60;updateAirAI(m,state,EMPTY);assert.equal(planes.filter(p=>p.state==='active'&&state.units.get(p.id)!.task==='air').length,2);
});
test('R14 pursuers release their target slots for a full three-second extension',()=>{
  const plane=unit(),target=unit('aircraft','B',1);target.role='player';target.position={x:400,y:500,z:0};target.velocity={x:110,y:0,z:0};
  const m=mission([plane,target]),state=createAirAIState();m.tick=1;updateAirAI(m,state,EMPTY);const ai=state.units.get(plane.id)!;assert.equal(ai.targetId,target.id);
  ai.pursuitSince=0;ai.phase='attack';m.tick=600;const departure=updateAirAI(m,state,EMPTY).get(plane.id)!;
  assert.equal(ai.phase,'extend');assert.equal(ai.disengageUntil,780);assert.equal(departure.fire,false);
  for(const tick of [601,650,779]){m.tick=tick;const commands=updateAirAI(m,state,EMPTY);assert.equal(commands.get(plane.id)!.fire,false);assert.equal(plane.targetId,undefined);}
  m.tick=780;updateAirAI(m,state,EMPTY);assert.notEqual(ai.phase,'extend');
});
test('R14 obstruction retains only three seconds of last known coordinates and cannot fire hidden targets',()=>{
  const plane=unit(),target=unit('aircraft','B',1);target.role='player';target.position={x:400,y:500,z:0};
  const m=mission([plane,target]),state=createAirAIState();m.tick=1;updateAirAI(m,state,EMPTY);const saved=copy(state.units.get(plane.id)!.memories.get(target.id)!.position);
  target.position={x:2000,y:900,z:1500};m.tick=2;const hidden={...EMPTY,lineOfSight:()=>false};const commands=updateAirAI(m,state,hidden);
  assert.equal(plane.targetId,undefined);assert.equal(commands.get(plane.id)!.fire,false);assert.deepEqual(state.units.get(plane.id)!.memories.get(target.id)!.position,saved);
  m.tick=182;updateAirAI(m,state,hidden);assert.equal(state.units.get(plane.id)!.memories.has(target.id),false);
});
test('R09 no effective target for ten seconds reverses aircraft roles, with empty weapons returning no shots',()=>{
  const plane=unit();plane.ammo=plane.cannonAmmo=plane.bombs=0;plane.reloadUntil=2000;plane.bombReloadUntil=2000;
  const m=mission([plane]),state=createAirAIState();m.tick=0;updateAirAI(m,state,EMPTY);assert.equal(state.units.get(plane.id)!.task,'air');
  m.tick=599;assert.equal(updateAirAI(m,state,EMPTY).get(plane.id)!.fire,false);assert.equal(state.units.get(plane.id)!.task,'air');
  m.tick=600;const command=updateAirAI(m,state,EMPTY).get(plane.id)!;assert.equal(state.units.get(plane.id)!.task,'support');assert.equal(command.fire,false);assert.equal(command.bomb,false);
});
test('R07 terrain avoidance precedes attack and uses bounded climb instead of moving altitude instantly',()=>{
  const plane=unit();plane.position.y=50;const target=unit('tank','B',1);target.position.x=0;
  const m=mission([plane,target]),state=createAirAIState();m.tick=1;const command=updateAirAI(m,state,EMPTY).get(plane.id)!;
  assert.equal(command.fire,false);assert.equal(command.bomb,false);assert.ok(plane.position.y>50&&plane.position.y<51);assert.ok(plane.pitch!<=.62);
});
test('R07 inherited wing tips and tilted nose sweep terrain beyond a center-only radius',()=>{
  const plane=unit();plane.position={x:0,y:20,z:0};plane.heading=0;plane.pitch=0;plane.bank=Math.PI/2;
  const seen:{x:number;y:number;r:number}[]=[];
  const wall:ProjectileTerrain={...EMPTY,sweep(a,_b,r=0){seen.push({x:a.x,y:a.y,r});if(a.y-r<15)return {t:0,position:copy(a),normal:{x:0,y:1,z:0},colliderId:'wing-tip-ground'};return null;}};
  const hit=aircraftTerrainContact(plane,copy(plane.position),wall);assert.equal(hit?.colliderId,'wing-tip-ground');assert.equal(seen.length,5);
  assert.ok(seen.some(s=>s.y<17&&s.r===2.1));
});
test('R07 loop completion and Euler wrapping sweep the short attitude change without phantom terrain loss',()=>{
  const plane=unit();plane.position={x:0,y:20,z:0};plane.heading=plane.pitch=plane.bank=0;
  const floor:ProjectileTerrain={...EMPTY,sweep(a,b,r=0){const start=a.y-r-15,end=b.y-r-15;if(start<=0)return {t:0,position:copy(a),normal:{x:0,y:1,z:0},colliderId:'floor'};if(end>0)return null;return {t:start/(start-end),position:copy(b),normal:{x:0,y:1,z:0},colliderId:'floor'};}};
  assert.equal(aircraftTerrainContact(plane,copy(plane.position),floor),null);
  assert.equal(aircraftTerrainContact(plane,copy(plane.position),floor,{heading:0,pitch:Math.PI*2-.02,bank:0}),null);
  assert.equal(aircraftTerrainContact(plane,copy(plane.position),floor,{heading:Math.PI*2-.02,pitch:0,bank:Math.PI*2-.02}),null);
});
test('A21 mirrored aircraft firing has reflected muzzle positions and velocities for every barrel',()=>{
  const a=unit('aircraft','A',2),b=unit('aircraft','B',2);a.position={x:-200,y:300,z:40};b.position={x:200,y:300,z:40};a.pitch=b.pitch=.2;a.bank=.3;b.bank=-.3;a.heading=-1.1;b.heading=1.1;
  a.velocity={x:97,y:22,z:-45};b.velocity={x:-97,y:22,z:-45};
  for(const weapon of ['mg','cannon'] as const){
    const left=createCombatState('a'),right=createCombatState('b');fireWeapon(a,weapon,100,left,{aiSpread:true});fireWeapon(b,weapon,100,right,{aiSpread:true});
    for(let i=0;i<2;i++){const p=left.projectiles[i],q=right.projectiles[i];close(p.position.x,-q.position.x);close(p.position.y,q.position.y);close(p.position.z,q.position.z);close(p.velocity.x,-q.velocity.x);close(p.velocity.y,q.velocity.y);close(p.velocity.z,q.velocity.z);}
  }
});
test('A21 mirrored unopposed patrols and extension waypoints preserve x reflection',()=>{
  const a=unit('aircraft','A',2),b=unit('aircraft','B',2),left=mission([a]),right=mission([b]),l=createAirAIState(),r=createAirAIState();
  for(let tick=1;tick<=120;tick++){left.tick=right.tick=tick;updateAirAI(left,l,EMPTY);updateAirAI(right,r,EMPTY);close(a.position.x,-b.position.x);close(a.position.y,b.position.y);close(a.position.z,b.position.z);}
  const enemyA=unit('aircraft','B',3),enemyB=unit('aircraft','A',3);enemyA.role=enemyB.role='player';enemyA.position={x:a.position.x+50,y:a.position.y,z:a.position.z};enemyB.position={x:b.position.x-50,y:b.position.y,z:b.position.z};left.units.push(enemyA);right.units.push(enemyB);left.tick=right.tick=121;
  updateAirAI(left,l,EMPTY);updateAirAI(right,r,EMPTY);const lp=l.units.get(a.id)!,rp=r.units.get(b.id)!;assert.equal(lp.phase,'extend');assert.equal(rp.phase,'extend');close(lp.waypoint.x,-rp.waypoint.x);close(lp.waypoint.y,rp.waypoint.y);close(lp.waypoint.z,rp.waypoint.z);
});
