import type { Mission, Unit, Vec3 } from './types';
import { applyDamage } from './scoring';
import { createAirAIState, DEFAULT_AIR_TERRAIN } from './air-ai';
import type { AirAIState, AirCommand } from './air-ai';
import { add, aimPoint, ballisticPosition, BOMB_CAPACITY, BULLET_CAPACITY, copy, distance, FIXED_DT, forwardOfUnit, GRAVITY, lerp, magnitude, normalize, predictBombImpact as predictTerrainBombImpact, scale, stepProjectile, subtract, sweepUnit, UnitSpatialIndex } from './projectiles';
import type { BombImpactPrediction, ProjectileContact, ProjectileTerrain, Weapon } from './projectiles';
import { canFireWeapon, effectiveDamage, fireAircraftWeapons, fireWeapon, groundShotSolution, tickAmmunition, WEAPONS } from './weapons';
import type { ProjectilePool } from './weapons';
export type { Projectile, ProjectileTerrain, Weapon } from './projectiles';
export type { CombatEvent } from './weapons';

export const DEFAULT_COMBAT_TERRAIN=DEFAULT_AIR_TERRAIN;
export interface AAWarning { gunId:string; targetId:string; position:Vec3; direction:Vec3; stage:'aiming'|'firing'; readyTick:number }
export interface AAGunState {
  targetId:string|null; aimStartedTick:number; requestStartedTick:number; hasSlot:boolean;
  direction:Vec3; lastShotTick:number; interruptedSince:number|null; interruptionWarned:boolean;
  lastSeenTick:number; rememberedPosition:Vec3|null;
}
export interface CombatState extends ProjectilePool {
  air:AirAIState; aa:Map<string,AAGunState>; aaWarnings:AAWarning[];
  turrets:Map<string,Vec3>; previousPositions:Map<string,Vec3>; lastTick:number;
}
export interface CombatInput {
  playerFire?:boolean; playerBomb?:boolean; playerDirections?:Partial<Record<'mg'|'cannon',Vec3>>;
  airCommands?:ReadonlyMap<string,AirCommand>;
}
export function createCombatState(missionId:string):CombatState {
  return {missionId,nextShotId:1,projectiles:[],bulletCapacity:BULLET_CAPACITY,bombCapacity:BOMB_CAPACITY,deferredShots:0,events:[],air:createAirAIState(),aa:new Map(),aaWarnings:[],turrets:new Map(),previousPositions:new Map(),lastTick:-1};
}
export function predictBombImpact(unit:Unit,terrain:ProjectileTerrain=DEFAULT_COMBAT_TERRAIN,units:readonly Unit[]=[]):BombImpactPrediction|null {
  return predictTerrainBombImpact(unit,terrain,units);
}
const dot=(a:Vec3,b:Vec3):number=>a.x*b.x+a.y*b.y+a.z*b.z;
const angle=(a:Vec3,b:Vec3):number=>Math.acos(Math.max(-1,Math.min(1,dot(normalize(a),normalize(b)))));
/** Geodesic rotation limits total turret speed, including simultaneous yaw and pitch. */
export function rotateTowards(from:Vec3,to:Vec3,maxAngle:number):Vec3 {
  const a=normalize(from),b=normalize(to),difference=angle(a,b);
  if(difference<=maxAngle)return b;
  if(difference>Math.PI-1e-6){
    const perpendicular=normalize(Math.abs(a.y)<.9?{x:-a.z,y:0,z:a.x}:{x:1,y:0,z:0});
    return normalize(add(scale(a,Math.cos(maxAngle)),scale(perpendicular,Math.sin(maxAngle))));
  }
  const fraction=maxAngle/difference,sine=Math.sin(difference);
  return normalize(add(scale(a,Math.sin((1-fraction)*difference)/sine),scale(b,Math.sin(fraction*difference)/sine)));
}
function aaVisible(gun:Unit,target:Unit,terrain:ProjectileTerrain):boolean {
  if(target.state!=='active'||target.hp<=0||target.kind!=='aircraft'||target.team===gun.team)return false;
  const origin=add(gun.position,{x:0,y:1.6,z:0});
  return distance(origin,target.position)<=1200&&terrain.lineOfSight(origin,target.position);
}
/** Two slots per target apply equally to all aircraft, including offscreen AI and player aircraft. */
export function updateAA(mission:Mission,state:CombatState,terrain:ProjectileTerrain=DEFAULT_COMBAT_TERRAIN,deferFire=false):Map<string,{origin:Vec3;direction:Vec3}> {
  const requests=new Map<string,{origin:Vec3;direction:Vec3}>();
  const guns=mission.units.filter(u=>u.kind==='aa'&&u.state==='active'&&u.hp>0).sort((a,b)=>a.id.localeCompare(b.id));
  const aircraft=mission.units.filter(u=>u.kind==='aircraft'&&u.state==='active'&&u.hp>0);
  const candidates=new Map<string,Unit[]>();
  for(const gun of guns){
    let memory=state.aa.get(gun.id);
    if(!memory){memory={targetId:null,aimStartedTick:mission.tick,requestStartedTick:mission.tick,hasSlot:false,direction:forwardOfUnit(gun),lastShotTick:-1,interruptedSince:null,interruptionWarned:false,lastSeenTick:-1,rememberedPosition:null};state.aa.set(gun.id,memory);}
    const visible=aircraft.filter(target=>aaVisible(gun,target,terrain)).sort((a,b)=>distance(gun.position,a.position)-distance(gun.position,b.position)||a.id.localeCompare(b.id));
    candidates.set(gun.id,visible);
    const retained=visible.find(t=>t.id===memory!.targetId),next=retained??visible[0];
    if((next?.id??null)!==memory.targetId){
      memory.targetId=next?.id??null;memory.aimStartedTick=mission.tick;memory.requestStartedTick=mission.tick;memory.interruptedSince=null;memory.interruptionWarned=false;
    }
    memory.hasSlot=false;
    if(next){memory.lastSeenTick=mission.tick;memory.rememberedPosition=copy(next.position);}
    else if(mission.tick-memory.lastSeenTick>180)memory.rememberedPosition=null;
  }
  for(const team of ['A','B'] as const){
    const ordered=guns.filter(g=>g.team===team).sort((a,b)=>state.aa.get(a.id)!.requestStartedTick-state.aa.get(b.id)!.requestStartedTick||a.id.localeCompare(b.id));
    const epoch=Math.floor(mission.tick/120),rotation=ordered.length?epoch%ordered.length:0;
    const priority=[...ordered.slice(rotation),...ordered.slice(0,rotation)],loads=new Map<string,number>();
    for(const gun of priority){
      const memory=state.aa.get(gun.id)!,visible=candidates.get(gun.id)!;
      const preferred=visible.find(t=>t.id===memory.targetId&&(loads.get(t.id)??0)<2);
      const target=preferred??visible.find(t=>(loads.get(t.id)??0)<2);
      if(!target)continue;
      if(target.id!==memory.targetId){memory.targetId=target.id;memory.aimStartedTick=mission.tick;memory.requestStartedTick=mission.tick;memory.interruptedSince=null;memory.interruptionWarned=false;}
      memory.hasSlot=true;loads.set(target.id,(loads.get(target.id)??0)+1);
    }
  }
  state.aaWarnings=[];
  for(const gun of guns){
    const memory=state.aa.get(gun.id)!,target=memory.targetId?aircraft.find(u=>u.id===memory.targetId):undefined;
    gun.targetId=target&&memory.hasSlot?target.id:undefined;
    if(!target||!memory.hasSlot||!aaVisible(gun,target,terrain)){
      if(memory.interruptedSince===null)memory.interruptedSince=mission.tick;
      if(memory.rememberedPosition){const look=normalize(subtract(memory.rememberedPosition,add(gun.position,{x:0,y:1.6,z:0})));memory.direction=rotateTowards(memory.direction,look,Math.PI/180);}
      continue;
    }
    if(memory.interruptedSince!==null&&mission.tick-memory.interruptedSince>=120){memory.aimStartedTick=mission.tick;memory.interruptionWarned=false;}
    memory.interruptedSince=null;
    // A long reload or blocked fire starts one fresh warning, without resetting ammo/fire clocks.
    if(memory.lastShotTick>=0&&mission.tick-memory.lastShotTick>=120&&!memory.interruptionWarned){memory.aimStartedTick=mission.tick;memory.interruptionWarned=true;}
    const solution=groundShotSolution(gun,target,terrain);
    if(!solution)continue;
    memory.direction=rotateTowards(memory.direction,solution.direction,Math.PI/180);
    const readyTick=memory.aimStartedTick+48,ready=mission.tick>=readyTick&&angle(memory.direction,solution.direction)<=5*Math.PI/180;
    state.aaWarnings.push({gunId:gun.id,targetId:target.id,position:copy(solution.origin),direction:normalize(subtract(solution.origin,target.position)),stage:mission.tick>=readyTick?'firing':'aiming',readyTick});
    if(ready&&canFireWeapon(gun,'aa',mission.tick)&&aaVisible(gun,target,terrain)){
      requests.set(gun.id,solution);
      if(!deferFire&&fireWeapon(gun,'aa',mission.tick,state,{origin:solution.origin,direction:solution.direction})){
        memory.lastShotTick=mission.tick;memory.interruptionWarned=false;
      }
    }
  }
  return requests;
}
function ballisticPathClear(origin:Vec3,direction:Vec3,speed:number,time:number,terrain:ProjectileTerrain):boolean {
  const velocity=scale(direction,speed);let previous=origin;
  const steps=Math.ceil(time*120);
  for(let step=1;step<=steps;step++){
    const next=ballisticPosition(origin,velocity,Math.min(time,step/120),GRAVITY);
    const hit=terrain.sweep(previous,next,0);if(hit&&hit.t<1-1e-7)return false;previous=next;
  }
  return true;
}
function fireGround(mission:Mission,state:CombatState,unit:Unit,terrain:ProjectileTerrain,unitsById:ReadonlyMap<string,Unit>):void {
  if(unit.kind==='aa'||unit.kind==='aircraft')return;
  if(!unit.targetId)return;
  const target=unitsById.get(unit.targetId);if(!target)return;
  const solution=groundShotSolution(unit,target,terrain);if(!solution)return;
  const weapon=unit.kind==='infantry'?'rifle':'tank';
  if(weapon==='tank'){
    const elevation=Math.asin(Math.max(-1,Math.min(1,solution.direction.y)));
    if(elevation<-10*Math.PI/180||elevation>35*Math.PI/180)return;
    const current=state.turrets.get(unit.id)??forwardOfUnit(unit),direction=rotateTowards(current,solution.direction,.75*Math.PI/180);state.turrets.set(unit.id,direction);
    if(angle(direction,solution.direction)>5*Math.PI/180||!canFireWeapon(unit,weapon,mission.tick))return;
    const relative=subtract(aimPoint(target),solution.origin),horizontalSpeed=Math.hypot(solution.direction.x,solution.direction.z)*400;
    const time=Math.min(3,Math.hypot(relative.x,relative.z)/Math.max(1,horizontalSpeed));
    if(!ballisticPathClear(solution.origin,solution.direction,400,time,terrain))return;
  }
  fireWeapon(unit,weapon,mission.tick,state,{origin:solution.origin,direction:solution.direction});
}
function blastDamage(mission:Mission,state:CombatState,contact:ProjectileContact,terrain:ProjectileTerrain,index:UnitSpatialIndex):void {
  const shot=contact.shot,origin=add(contact.position,scale(normalize(contact.normal),.05));
  const targets=index.query(contact.position,contact.position,67).sort((a,b)=>a.id.localeCompare(b.id));
  for(const target of targets){
    if(target.state!=='active'||target.hp<=0||target.team===shot.team||target.kind==='aircraft')continue;
    const before=state.previousPositions.get(target.id)??target.position,atImpact=lerp(before,target.position,contact.time);
    const targetPoint=add(atImpact,{x:0,y:target.kind==='infantry'?.9:1.2,z:0});
    const metres=target.id===contact.targetId?0:distance(contact.position,targetPoint);
    if(metres>=60)continue;
    if(target.id!==contact.targetId&&!terrain.lineOfSight(origin,targetPoint,{ignoreInitialContact:true}))continue;
    const amount=effectiveDamage(shot,target.kind,metres);
    const actual=applyDamage(mission,target.id,amount,{id:`shot-${shot.shotId}`,sourceTeam:shot.team,sourceRole:shot.sourceRole});
    if(actual>0)state.events.push({type:'impact',tick:mission.tick,shotId:shot.shotId,ownerId:shot.ownerId,weapon:'bomb',position:copy(targetPoint),targetId:target.id,amount:actual});
  }
}
/** Fire, sweep, sort all contacts, then apply actual fixed-point damage and unique deaths. */
export function updateCombat(mission:Mission,state:CombatState,input:CombatInput={},terrain:ProjectileTerrain=DEFAULT_COMBAT_TERRAIN):void {
  if(mission.phase!=='running'||mission.result||mission.id!==state.missionId||state.lastTick===mission.tick)return;
  state.lastTick=mission.tick;state.events=[];
  const active=mission.units.filter(u=>u.state==='active'&&u.hp>0).sort((a,b)=>a.id.localeCompare(b.id));
  const unitsById=new Map(active.map(unit=>[unit.id,unit]));
  for(const unit of active)tickAmmunition(unit,mission.tick,state);
  // All requests share one stable unit order. An AA request reserves its pool slot here.
  // AA targeting itself is evaluated before requests, with its clocks preserved.
  const aaRequests=updateAA(mission,state,terrain,true);
  for(const unit of active){
    if(unit.kind==='aircraft'){
      const command=input.airCommands?.get(unit.id),player=unit.id===mission.controlledAircraftId&&unit.role==='player';
      if(player?input.playerFire:command?.fire)fireAircraftWeapons(unit,mission.tick,state,player?input.playerDirections:command?.directions,!player);
      if(player?input.playerBomb:command?.bomb)fireWeapon(unit,'bomb',mission.tick,state);
    }else if(unit.kind==='aa'){
      const request=aaRequests.get(unit.id);
      if(request&&fireWeapon(unit,'aa',mission.tick,state,request)){const gun=state.aa.get(unit.id)!;gun.lastShotTick=mission.tick;gun.interruptionWarned=false;}
    }else fireGround(mission,state,unit,terrain,unitsById);
  }
  const index=new UnitSpatialIndex(active,state.previousPositions),contacts:ProjectileContact[]=[];
  for(const shot of state.projectiles){
    if(shot.missionId!==mission.id){shot.lifeTicks=0;continue;}
    const end=ballisticPosition(shot.position,shot.velocity,FIXED_DT,shot.weapon==='bomb'||shot.weapon==='tank'?GRAVITY:0);
    const candidates=index.query(shot.position,end,1);
    const hit=stepProjectile(shot,candidates,terrain,state.previousPositions);if(hit)contacts.push(hit);
  }
  contacts.sort((a,b)=>a.time-b.time||a.shot.shotId-b.shot.shotId);
  for(const contact of contacts){
    const shot=contact.shot;
    if(shot.weapon==='bomb'){
      state.events.push({type:'explosion',tick:mission.tick,shotId:shot.shotId,ownerId:shot.ownerId,weapon:'bomb',position:copy(contact.position)});
      blastDamage(mission,state,contact,terrain,index);
    }else{
      let actual=0;
      if(contact.targetId){const target=unitsById.get(contact.targetId)!;actual=applyDamage(mission,target.id,effectiveDamage(shot,target.kind),{id:`shot-${shot.shotId}`,sourceTeam:shot.team,sourceRole:shot.sourceRole});}
      state.events.push({type:'impact',tick:mission.tick,shotId:shot.shotId,ownerId:shot.ownerId,weapon:shot.weapon,position:copy(contact.position),targetId:contact.targetId,amount:actual});
    }
  }
  state.projectiles=state.projectiles.filter(p=>p.lifeTicks>0);
  state.previousPositions=new Map(active.map(u=>[u.id,copy(u.position)]));
}
