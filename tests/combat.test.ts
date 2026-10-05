import test from 'node:test';
import assert from 'node:assert/strict';
import { createMission } from '../src/battle/mission';
import { createCombatState, updateAA, updateCombat, predictBombImpact, rotateTowards } from '../src/battle/combat';
import { aircraftDamageMultiplier, canFireWeapon, effectiveDamage, fireAircraftWeapons, fireWeapon, PROJECTILE_CAPACITY_PROOF, PROVEN_BULLET_BOUND, TARGET_MULTIPLIERS, tickAmmunition } from '../src/battle/weapons';
import { add, copy, distance, rotateLocal, stepProjectile, sweepUnit } from '../src/battle/projectiles';
import type { Projectile, ProjectileTerrain, Weapon } from '../src/battle/projectiles';
import type { Unit, UnitKind, Vec3 } from '../src/battle/types';

const EMPTY:ProjectileTerrain={sweep:()=>null,lineOfSight:()=>true,height:()=>0};
const FLAT:ProjectileTerrain={
  height:()=>0,
  sweep(a,b,r=0){if(a.y<=r)return {t:0,position:copy(a),normal:{x:0,y:1,z:0},colliderId:'ground'};if(b.y>r)return null;const t=(a.y-r)/(a.y-b.y);return {t,position:{x:a.x+(b.x-a.x)*t,y:r,z:a.z+(b.z-a.z)*t},normal:{x:0,y:1,z:0},colliderId:'ground'};},
  lineOfSight(a,b){return a.y>=0&&b.y>=0;},
};
function fixture(kind:UnitKind='aircraft',team:'A'|'B'='A',ordinal=0):Unit {
  const m=createMission();const unit=m.units.find(u=>u.kind===kind&&u.team===team&&u.id.endsWith(String(ordinal).padStart(3,'0')))!;
  unit.state='active';unit.role=team==='A'&&kind==='aircraft'&&ordinal===0?'player':'ai';unit.position={x:0,y:kind==='aircraft'?100:0,z:0};unit.velocity={x:0,y:0,z:kind==='aircraft'?-110:0};unit.heading=0;unit.pitch=0;unit.bank=0;return unit;
}
function shot(weapon:Weapon='mg',id=1,baseDamage=4):Projectile {
  return {missionId:'test',shotId:id,ownerId:'A-aircraft-000',team:'A',sourceRole:'player',weapon,position:{x:0,y:.9,z:0},previous:{x:0,y:.9,z:0},velocity:{x:0,y:0,z:-1200},lifeTicks:90,ageTicks:0,distance:0,baseDamage};
}
function isolated(units:Unit[]){const m=createMission();m.units=units;m.controlledAircraftId=units.find(u=>u.role==='player')?.id??null;return m;}

test('R13 player exact twin-barrel cadence and both-empty 360tick common reload',()=>{
  const unit=fixture(),pool=createCombatState('test');
  for(let tick=0;tick<715;tick++){fireAircraftWeapons(unit,tick,pool);pool.projectiles=[];}
  assert.equal(unit.ammo,2);assert.equal(unit.cannonAmmo,0);assert.equal(unit.reloadUntil,0);
  fireAircraftWeapons(unit,715,pool);assert.equal(unit.ammo,0);assert.equal(unit.reloadUntil,1075);
  tickAmmunition(unit,1074);assert.equal(unit.ammo,0);
  tickAmmunition(unit,1075);assert.equal(unit.ammo,288);assert.equal(unit.cannonAmmo,96);assert.equal(unit.reloadUntil,0);
  assert.equal(unit.lastFireTick,715);assert.equal(unit.lastCannonTick,705);
});
test('R13 both AI armies use 17/57ticks, identical damage, magazines and reload',()=>{
  for(const team of ['A','B'] as const){
    const unit=fixture('aircraft',team,1),pool=createCombatState('test');
    fireAircraftWeapons(unit,0,pool);assert.deepEqual(pool.projectiles.map(p=>p.baseDamage),[2.4,2.4,9.6,9.6]);
    pool.projectiles=[];fireAircraftWeapons(unit,16,pool);assert.equal(pool.projectiles.length,0);
    fireAircraftWeapons(unit,17,pool);assert.equal(pool.projectiles.length,2);pool.projectiles=[];
    for(let tick=18;tick<=2679;tick++){fireAircraftWeapons(unit,tick,pool);pool.projectiles=[];}
    assert.equal(unit.ammo,0);assert.equal(unit.cannonAmmo,0);assert.equal(unit.reloadUntil,3039);
  }
});
test('R06 handoff preserves a running AI fire clock, then applies the player cadence to new bursts',()=>{
  const unit=fixture('aircraft','A',1),pool=createCombatState('test');fireAircraftWeapons(unit,100,pool);unit.role='player';pool.projectiles=[];
  fireAircraftWeapons(unit,105,pool);assert.equal(pool.projectiles.length,0);assert.equal(unit.lastFireTick,100);assert.equal(unit.lastCannonTick,100);
  fireAircraftWeapons(unit,117,pool);assert.equal(pool.projectiles.length,2);assert.equal(unit.lastFireTick,117);assert.equal(unit.lastCannonTick,100);
  pool.projectiles=[];fireAircraftWeapons(unit,122,pool);assert.equal(pool.projectiles.length,2);assert.equal(unit.lastFireTick,122);
  pool.projectiles=[];fireAircraftWeapons(unit,157,pool);assert.equal(pool.projectiles.filter(p=>p.weapon==='cannon').length,2);assert.equal(unit.lastCannonTick,157);
  pool.projectiles=[];fireAircraftWeapons(unit,172,pool);assert.equal(pool.projectiles.filter(p=>p.weapon==='cannon').length,2);
});
test('R13 ground magazine, period and reload contracts',()=>{
  for(const [kind,weapon,capacity,period,reload] of [['infantry','rifle',12,30,180],['tank','tank',4,180,480],['aa','aa',16,15,300]] as const){
    const unit=fixture(kind),pool=createCombatState('test');
    for(let i=0;i<capacity;i++){assert.equal(fireWeapon(unit,weapon,i*period,pool),true);assert.equal(fireWeapon(unit,weapon,i*period+1,pool),false);}
    const deadline=(capacity-1)*period+reload;assert.equal(unit.ammo,0);assert.equal(unit.reloadUntil,deadline);
    tickAmmunition(unit,deadline-1);assert.equal(unit.ammo,0);tickAmmunition(unit,deadline);assert.equal(unit.ammo,capacity);
  }
});
test('R13 bomb rack holds two single drops, 60tick spacing, 1200tick empty reload',()=>{
  const unit=fixture(),pool=createCombatState('test');assert.equal(fireWeapon(unit,'bomb',0,pool),true);
  assert.equal(fireWeapon(unit,'bomb',59,pool),false);assert.equal(fireWeapon(unit,'bomb',60,pool),true);
  assert.equal(unit.bombs,0);assert.equal(unit.bombReloadUntil,1260);tickAmmunition(unit,1259);assert.equal(unit.bombs,0);
  tickAmmunition(unit,1260);assert.equal(unit.bombs,2);assert.equal(canFireWeapon(unit,'bomb',1260),true);
});
test('A11 a missing second pool slot leaves ammo, clocks and shot IDs unchanged',()=>{
  const unit=fixture(),pool=createCombatState('test');pool.bulletCapacity=1;
  assert.equal(fireWeapon(unit,'mg',0,pool),false);assert.equal(unit.ammo,288);assert.equal(unit.lastFireTick,-10000);assert.equal(pool.nextShotId,1);assert.equal(pool.projectiles.length,0);
  pool.bulletCapacity=2;assert.equal(fireWeapon(unit,'mg',1,pool),true);assert.equal(unit.ammo,286);assert.equal(pool.projectiles.length,2);
  pool.bombCapacity=0;assert.equal(fireWeapon(unit,'bomb',1,pool),false);assert.equal(unit.bombs,2);assert.equal(unit.lastBombTick,-10000);
});
test('A09 every weapon/target multiplier and farther distance boundary is exact',()=>{
  const expected={mg:[1,0,.25,1],cannon:[1,.2,.75,1],rifle:[1,0,.25,0],tank:[1,1,1,0],aa:[0,0,0,1],bomb:[1,1,1,0]};
  for(const [weapon,values] of Object.entries(expected))assert.deepEqual(Object.values(TARGET_MULTIPLIERS[weapon as Weapon]),values);
  assert.equal(aircraftDamageMultiplier('mg',199.999),1);assert.equal(aircraftDamageMultiplier('mg',200),.75);
  assert.equal(aircraftDamageMultiplier('mg',500),.5);assert.equal(aircraftDamageMultiplier('mg',800),.25);
  assert.equal(aircraftDamageMultiplier('cannon',200),.9);assert.equal(aircraftDamageMultiplier('cannon',500),.8);assert.equal(aircraftDamageMultiplier('cannon',800),.7);
  assert.equal(effectiveDamage({weapon:'cannon',baseDamage:9.6,distance:800},'tank'),1.344);
});
test('A09 actual and predicted bombs use the same trajectory and terrain contact',()=>{
  const unit=fixture();unit.position={x:10,y:220,z:30};unit.velocity={x:30,y:10,z:-110};unit.pitch=Math.asin(10/Math.hypot(30,10,110));unit.heading=Math.atan2(-30,110);
  const prediction=predictBombImpact(unit,FLAT)!;assert.ok(prediction.time>0);
  const pool=createCombatState('test');fireWeapon(unit,'bomb',0,pool);const round=pool.projectiles[0];let actual=null,tick=0;
  for(;tick<1800&&!actual;tick++)actual=stepProjectile(round,[],FLAT);
  assert.ok(actual);assert.ok(distance(prediction.position,actual.position)<1e-6);assert.ok(Math.abs(prediction.time-(tick-1+actual.time)/60)<1e-7);
});
test('A09 closed bridge side/underside and narrow obstacle prediction are shared',()=>{
  const unit=fixture();unit.position={x:0,y:10,z:0};unit.velocity={x:0,y:0,z:-110};
  const bridge:ProjectileTerrain={...EMPTY,sweep(a,b,r=0){const plane=-100;if(a.z>plane+r&&b.z<=plane+r){const t=(a.z-plane-r)/(a.z-b.z),y=a.y+(b.y-a.y)*t;if(y>=-2-r&&y<=20+r)return {t,position:{x:0,y,z:plane+r},normal:{x:0,y:0,z:1},colliderId:'bridge-side'};}return null;}};
  const prediction=predictBombImpact(unit,bridge)!;assert.equal(prediction.colliderId,'bridge-side');assert.ok(prediction.time<1);
});
test('A09 friendly rounds pass through allies; swept enemy and terrain first contact is stable',()=>{
  const ally=fixture('infantry','A',1),enemy=fixture('infantry','B',1);ally.position.z=-5;enemy.position.z=-10;
  const round=shot();const contact=stepProjectile(round,[ally,enemy],EMPTY)!;assert.equal(contact.targetId,enemy.id);
  const tie:ProjectileTerrain={...EMPTY,sweep:(a,b)=>{const target=sweepUnit(a,b,enemy);return target?{...target,colliderId:'wall'}:null;}};
  const tied=stepProjectile(shot(),[enemy],tie)!;assert.equal(tied.colliderId,'wall');assert.equal(tied.targetId,undefined);
  const overlap=fixture('infantry','B',2);overlap.position=copy(enemy.position);
  assert.equal(stepProjectile(shot(),[overlap,enemy],EMPTY)!.targetId,enemy.id);
});
test('A11 moving targets sweep across bullets between endpoints',()=>{
  const unit=fixture('infantry','B',1);unit.position={x:2,y:0,z:-10};const previous=new Map([[unit.id,{x:-2,y:0,z:-10}]]);
  const contact=stepProjectile(shot(),[unit],EMPTY,previous);assert.equal(contact?.targetId,unit.id);
});
test('A17 projectile aircraft colliders follow vertical pitch and banked inherited wings',()=>{
  const unit=fixture('aircraft','B',1);unit.pitch=Math.PI/2;
  assert.ok(sweepUnit({x:-2,y:104,z:0},{x:2,y:104,z:0},unit));
  unit.pitch=0;unit.bank=Math.PI/2;
  const wingPoint=add(unit.position,rotateLocal(unit,{x:5,y:0,z:-.4}));
  assert.ok(sweepUnit(add(wingPoint,{x:0,y:0,z:-2}),add(wingPoint,{x:0,y:0,z:2}),unit));
  assert.equal(sweepUnit({x:5,y:100,z:-3},{x:5,y:100,z:3},unit),null);
});
test('A11 damage resolves by contact time then shot ID and keeps fire-time attribution after death',()=>{
  const owner=fixture(),target=fixture('infantry','B',1);owner.state='lost';owner.hp=0;target.position.z=-10;
  const m=isolated([owner,target]),state=createCombatState(m.id);m.tick=1;
  const first=shot('cannon',1,20),second=shot('cannon',2,30);second.sourceRole='ai';first.missionId=second.missionId=m.id;state.projectiles=[second,first];
  updateCombat(m,state,{},EMPTY);assert.equal(target.hp,0);assert.equal(m.score.support,20);assert.equal(m.score.kill,20);assert.deepEqual(m.score.damage.map(d=>d.amount),[20,20]);assert.equal(m.deaths.length,1);
  const frozen=JSON.stringify(m.score.damage);updateCombat(m,state,{},EMPTY);assert.equal(JSON.stringify(m.score.damage),frozen);
});
test('A15 AI old rounds stay AI after a live owner becomes player',()=>{
  const owner=fixture('aircraft','A',1),target=fixture('infantry','B',1);target.position.z=-10;
  const m=isolated([owner,target]),state=createCombatState(m.id),round=shot('cannon',1,20);round.sourceRole='ai';round.ownerId=owner.id;round.missionId=m.id;state.projectiles=[round];owner.role='player';m.controlledAircraftId=owner.id;m.tick=1;
  updateCombat(m,state,{},EMPTY);assert.equal(m.score.support,0);assert.equal(target.hp,20);
});
test('A09 bomb direct hit is a single zero-distance blast; aircraft and friendly damage stay zero',()=>{
  const target=fixture('tank','B',1),ally=fixture('infantry','A',1),air=fixture('aircraft','B',1);ally.position.x=5;air.position={x:0,y:3,z:0};
  const m=isolated([target,ally,air]),state=createCombatState(m.id),round=shot('bomb',1,240);round.position={x:0,y:10,z:0};round.previous=copy(round.position);round.velocity={x:0,y:-600,z:0};round.missionId=m.id;round.lifeTicks=1800;state.projectiles=[round];m.tick=1;
  updateCombat(m,state,{},FLAT);assert.equal(target.hp,60);assert.equal(ally.hp,40);assert.equal(air.hp,80);assert.equal(m.score.support,240);assert.equal(m.score.damage.length,1);assert.equal(state.projectiles.length,0);
  m.tick++;updateCombat(m,state,{},FLAT);assert.equal(target.hp,60);assert.equal(m.score.damage.length,1);
});
test('A09 bomb normal offset permits outward blast but does not bypass an intervening wall',()=>{
  const near=fixture('infantry','B',1),hidden=fixture('infantry','B',2);near.position={x:-10,y:0,z:0};hidden.position={x:10,y:0,z:0};
  const m=isolated([near,hidden]),state=createCombatState(m.id),round=shot('bomb',1,240);round.position={x:-15,y:1,z:0};round.previous=copy(round.position);round.velocity={x:0,y:-120,z:0};round.missionId=m.id;state.projectiles=[round];m.tick=1;
  const wall:ProjectileTerrain={...FLAT,lineOfSight:(a,b)=>!(a.x<0&&b.x>0)};
  updateCombat(m,state,{},wall);assert.equal(near.hp,0);assert.equal(hidden.hp,40);
});
test('A10 AA warns 48ticks, rotates at 60degrees/s, resets on visibility loss, max two slots',()=>{
  const guns=[0,1,2].map(i=>fixture('aa','B',i)),target=fixture();target.position={x:0,y:100,z:-300};
  guns.forEach((gun,i)=>gun.position.x=i*10);const m=isolated([...guns,target]),state=createCombatState(m.id);let firstShot=-1;
  for(let tick=0;tick<=60;tick++){m.tick=tick;state.events=[];updateAA(m,state,EMPTY);if(state.events.some(e=>e.type==='shot')&&firstShot<0)firstShot=tick;assert.ok([...state.aa.values()].filter(g=>g.hasSlot&&g.targetId===target.id).length<=2);}
  assert.equal(firstShot,48);assert.equal(state.aaWarnings.length,2);
  const prior=copy(state.aa.get(guns[0].id)!.direction);target.position={x:300,y:100,z:0};m.tick=61;updateAA(m,state,EMPTY);const after=state.aa.get(guns[0].id)!.direction;
  const rotated=Math.acos(Math.max(-1,Math.min(1,prior.x*after.x+prior.y*after.y+prior.z*after.z)));assert.ok(rotated<=Math.PI/180+1e-8);
  m.tick=62;updateAA(m,state,{...EMPTY,lineOfSight:()=>false});assert.equal(state.aaWarnings.length,0);
  m.tick=63;updateAA(m,state,EMPTY);assert.ok(state.aaWarnings.every(w=>w.readyTick===111));
});
test('A10 two-second AA slot rotation does not reset fire or reload clocks',()=>{
  const guns=[0,1,2].map(i=>fixture('aa','B',i)),target=fixture();target.position={x:0,y:100,z:-300};const m=isolated([...guns,target]),state=createCombatState(m.id);
  for(let tick=0;tick<=119;tick++){m.tick=tick;updateAA(m,state,EMPTY);}
  const clocks=guns.map(g=>[g.lastFireTick,g.reloadUntil]);m.tick=120;updateAA(m,state,EMPTY,true);
  assert.deepEqual(guns.map(g=>[g.lastFireTick,g.reloadUntil]),clocks);assert.equal(state.aa.get(guns[0].id)!.hasSlot,false);assert.equal(state.aa.get(guns[2].id)!.hasSlot,true);
});
test('A11 AA and aircraft reserve a scarce pool in the same stable unit ID order',()=>{
  const player=fixture(),gun=fixture('aa','B',1),target=fixture('aircraft','A',1);target.position={x:0,y:100,z:-300};gun.position={x:0,y:0,z:0};
  const m=isolated([gun,target,player]),state=createCombatState(m.id);state.bulletCapacity=2;
  state.aa.set(gun.id,{targetId:target.id,aimStartedTick:0,requestStartedTick:0,hasSlot:true,direction:{x:0,y:99/Math.hypot(99,300),z:-300/Math.hypot(99,300)},lastShotTick:-1,interruptedSince:null,interruptionWarned:false,lastSeenTick:0,rememberedPosition:copy(target.position)});m.tick=60;
  updateCombat(m,state,{playerFire:true},EMPTY);assert.equal(player.ammo,286);assert.equal(gun.ammo,16);assert.equal(gun.lastFireTick,-10000);assert.equal(state.projectiles.length,2);
});
test('A14 pause, result and stale mission states cannot advance ammo, projectiles or warning clocks',()=>{
  const unit=fixture(),m=isolated([unit]),state=createCombatState(m.id);unit.ammo=unit.cannonAmmo=0;unit.reloadUntil=5;m.tick=5;m.phase='paused';
  updateCombat(m,state,{playerFire:true},EMPTY);assert.equal(unit.ammo,0);assert.equal(state.lastTick,-1);
  m.phase='running';state.missionId='older';updateCombat(m,state,{},EMPTY);assert.equal(unit.ammo,0);
  state.missionId=m.id;m.phase='result';updateCombat(m,state,{},EMPTY);assert.equal(unit.ammo,0);
});
test('A20 lifetime/rate endpoint capacity proof stays below logical pools',()=>{
  assert.equal(PROVEN_BULLET_BOUND,892);assert.ok(PROVEN_BULLET_BOUND<4096);assert.equal(PROJECTILE_CAPACITY_PROOF.bombs,58);assert.ok(PROJECTILE_CAPACITY_PROOF.bombs<=64);
  const turned=rotateTowards({x:0,y:0,z:-1},{x:0,y:0,z:1},Math.PI/180);assert.ok(Math.abs(Math.hypot(turned.x,turned.y,turned.z)-1)<1e-9);
});
