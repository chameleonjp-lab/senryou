import type { Unit, UnitKind, Vec3 } from './types';
import { add, aimPoint, bombRelease, copy, distance, forwardOfUnit, GRAVITY, interceptDirection, magnitude, normalize, rotateLocal, scale } from './projectiles';
import type { Projectile, ProjectileTerrain, Weapon } from './projectiles';

export interface WeaponDefinition {
  capacity:number; periodTicks:number; reloadTicks:number; lifeTicks:number; speed:number; damage:number;
  count:number; range:number; gravity:number;
}
export const WEAPONS:Readonly<Record<Weapon,Readonly<WeaponDefinition>>>=Object.freeze({
  mg:Object.freeze({capacity:288,periodTicks:5,reloadTicks:360,lifeTicks:90,speed:820,damage:4,count:2,range:1200,gravity:0}),
  cannon:Object.freeze({capacity:96,periodTicks:15,reloadTicks:360,lifeTicks:90,speed:700,damage:20,count:2,range:1200,gravity:0}),
  rifle:Object.freeze({capacity:12,periodTicks:30,reloadTicks:180,lifeTicks:30,speed:500,damage:8,count:1,range:250,gravity:0}),
  tank:Object.freeze({capacity:4,periodTicks:180,reloadTicks:480,lifeTicks:180,speed:400,damage:80,count:1,range:900,gravity:GRAVITY}),
  aa:Object.freeze({capacity:16,periodTicks:15,reloadTicks:300,lifeTicks:240,speed:350,damage:8,count:1,range:1200,gravity:0}),
  bomb:Object.freeze({capacity:2,periodTicks:60,reloadTicks:1200,lifeTicks:1800,speed:0,damage:240,count:1,range:60,gravity:GRAVITY}),
});
export const TARGET_MULTIPLIERS:Readonly<Record<Weapon,Readonly<Record<UnitKind,number>>>>=Object.freeze({
  mg:Object.freeze({infantry:1,tank:0,aa:.25,aircraft:1}),
  cannon:Object.freeze({infantry:1,tank:.2,aa:.75,aircraft:1}),
  rifle:Object.freeze({infantry:1,tank:0,aa:.25,aircraft:0}),
  tank:Object.freeze({infantry:1,tank:1,aa:1,aircraft:0}),
  aa:Object.freeze({infantry:0,tank:0,aa:0,aircraft:1}),
  bomb:Object.freeze({infantry:1,tank:1,aa:1,aircraft:0}),
});
export interface CombatEvent {
  type:'shot'|'impact'|'explosion'|'reload-start'|'reload-complete'; tick:number; shotId?:number;
  ownerId:string; weapon:Weapon; position:Vec3; targetId?:string; amount?:number;
}
export interface ProjectilePool {
  missionId:string; nextShotId:number; projectiles:Projectile[]; bulletCapacity:number; bombCapacity:number;
  deferredShots:number; events:CombatEvent[];
}
export interface FireOptions { direction?:Vec3; origin?:Vec3; aiSpread?:boolean }
export const aircraftPeriod=(unit:Unit,weapon:'mg'|'cannon'):number=>unit.role==='player'?WEAPONS[weapon].periodTicks:weapon==='mg'?17:57;
export function aircraftDamageMultiplier(weapon:'mg'|'cannon',metres:number):number {
  if(!Number.isFinite(metres)||metres<0)throw new RangeError('Aircraft round distance must be finite and nonnegative');
  if(weapon==='mg')return metres>=800?.25:metres>=500?.5:metres>=200?.75:1;
  return metres>=800?.7:metres>=500?.8:metres>=200?.9:1;
}
/** Multiply once, then quantize once into the shared 1/1000 HP ledger. */
export function effectiveDamage(shot:Pick<Projectile,'weapon'|'baseDamage'|'distance'>,kind:UnitKind,blastDistance=0):number {
  const distanceScale=shot.weapon==='mg'||shot.weapon==='cannon'?aircraftDamageMultiplier(shot.weapon,shot.distance):shot.weapon==='bomb'?Math.max(0,1-blastDistance/60):1;
  return Math.round(shot.baseDamage*TARGET_MULTIPLIERS[shot.weapon][kind]*distanceScale*1000)/1000;
}
function groundWeapon(unit:Unit):Weapon|null { return unit.kind==='infantry'?'rifle':unit.kind==='tank'?'tank':unit.kind==='aa'?'aa':null; }
function event(pool:ProjectilePool,unit:Unit,tick:number,type:CombatEvent['type'],weapon:Weapon):void {
  pool.events.push({type,tick,ownerId:unit.id,weapon,position:copy(unit.position)});
}
/** Called only on active operation ticks. Handoffs retain the same fields and clocks. */
export function tickAmmunition(unit:Unit,tick:number,pool?:ProjectilePool):void {
  if(unit.state!=='active'||unit.hp<=0)return;
  if(unit.reloadUntil>0&&tick>=unit.reloadUntil){
    unit.ammo=unit.kind==='aircraft'?288:unit.kind==='infantry'?12:unit.kind==='tank'?4:16;
    if(unit.kind==='aircraft')unit.cannonAmmo=96;
    unit.reloadUntil=0;if(pool)event(pool,unit,tick,'reload-complete',groundWeapon(unit)??'mg');
  }
  if(unit.kind==='aircraft'&&unit.bombReloadUntil>0&&tick>=unit.bombReloadUntil){
    unit.bombs=2;unit.bombReloadUntil=0;if(pool)event(pool,unit,tick,'reload-complete','bomb');
  }
}
export function canFireWeapon(unit:Unit,weapon:Weapon,tick:number):boolean {
  if(unit.state!=='active'||unit.hp<=0)return false;
  if(weapon==='bomb')return unit.kind==='aircraft'&&unit.bombs>0&&unit.bombReloadUntil===0&&tick-unit.lastBombTick>=60;
  if(unit.reloadUntil>0)return false;
  if(weapon==='mg'||weapon==='cannon'){
    const emitted=unit as Unit&{lastFirePeriod?:number;lastCannonPeriod?:number};
    const period=(weapon==='mg'?emitted.lastFirePeriod:emitted.lastCannonPeriod)??aircraftPeriod(unit,weapon);
    return unit.kind==='aircraft'&&(weapon==='mg'?unit.ammo:unit.cannonAmmo)>=2&&tick-(weapon==='mg'?unit.lastFireTick:unit.lastCannonTick)>=period;
  }
  return groundWeapon(unit)===weapon&&unit.ammo>0&&tick-unit.lastFireTick>=WEAPONS[weapon].periodTicks;
}
function hasCapacity(pool:ProjectilePool,weapon:Weapon,count:number):boolean {
  const bombs=weapon==='bomb',used=pool.projectiles.reduce((n,p)=>n+Number((p.weapon==='bomb')===bombs&&p.lifeTicks>0),0);
  return used+count<=(bombs?pool.bombCapacity:pool.bulletCapacity);
}
/** Pool reservation precedes every ammo/clock/ID mutation, including twin-barrel bursts. */
export function fireWeapon(unit:Unit,weapon:Weapon,tick:number,pool:ProjectilePool,options:FireOptions={}):boolean {
  if(!canFireWeapon(unit,weapon,tick))return false;
  const definition=WEAPONS[weapon],requested=definition.count;
  const firing=options.direction??forwardOfUnit(unit);
  if(![firing.x,firing.y,firing.z].every(Number.isFinite)||magnitude(firing)<1e-9)return false;
  if(!hasCapacity(pool,weapon,requested)){pool.deferredShots++;return false;}
  const direction=normalize(firing),newShots:Projectile[]=[];
  for(let index=0;index<requested;index++){
    const side=index===0?-1:1;
    const barrelSide=side*(unit.team==='A'?1:-1);
    const muzzle=weapon==='mg'?{x:barrelSide*.3,y:.52,z:-4.25}:weapon==='cannon'?{x:barrelSide*2.5,y:0,z:-2.4}:{x:0,y:unit.kind==='infantry'?1.1:1.6,z:0};
    const release=weapon==='bomb'?bombRelease(unit):null;
    const position=release?.position??options.origin??add(unit.position,rotateLocal(unit,muzzle));
    let shotDirection=copy(direction);
    if(options.aiSpread&&(weapon==='mg'||weapon==='cannon')){
      // Fixed-source allied spread, applied equally to both AI teams.
      const idNumber=unit.id.replace(/^[AB]-/,'').split('').reduce((value,c)=>value+c.charCodeAt(0),0);
      const right=Math.sin(tick*1.7+idNumber*3+side)*.012*(unit.team==='A'?1:-1);
      const up=Math.cos(tick*1.3+idNumber*2+side)*.012;
      const spread=rotateLocal(unit,{x:right,y:up,z:0});
      shotDirection=add(shotDirection,spread);
      shotDirection=normalize(shotDirection);
    }
    const speed=definition.speed+(weapon==='mg'||weapon==='cannon'?(unit.speed??magnitude(unit.velocity)):0);
    const velocity=release?.velocity??scale(shotDirection,speed);
    const baseDamage=unit.kind==='aircraft'&&unit.role==='ai'&&(weapon==='mg'||weapon==='cannon')?(weapon==='mg'?2.4:9.6):definition.damage;
    newShots.push({missionId:pool.missionId,shotId:pool.nextShotId+index,ownerId:unit.id,team:unit.team,sourceRole:unit.role,weapon,position:copy(position),previous:copy(position),velocity,lifeTicks:definition.lifeTicks,ageTicks:0,distance:0,baseDamage});
  }
  pool.projectiles.push(...newShots);pool.nextShotId+=requested;
  for(const shot of newShots)pool.events.push({type:'shot',tick,ownerId:unit.id,weapon,position:copy(shot.position),shotId:shot.shotId});
  if(weapon==='bomb'){
    unit.bombs--;unit.lastBombTick=tick;
    if(unit.bombs===0){unit.bombReloadUntil=tick+1200;event(pool,unit,tick,'reload-start','bomb');}
  }else{
    const emitted=unit as Unit&{lastFirePeriod?:number;lastCannonPeriod?:number};
    if(weapon==='cannon'){unit.cannonAmmo-=2;unit.lastCannonTick=tick;emitted.lastCannonPeriod=aircraftPeriod(unit,'cannon');}
    else{unit.ammo-=requested;unit.lastFireTick=tick;emitted.lastFirePeriod=weapon==='mg'?aircraftPeriod(unit,'mg'):definition.periodTicks;}
    if(unit.ammo===0&&(unit.kind!=='aircraft'||unit.cannonAmmo===0)){
      unit.reloadUntil=tick+(unit.kind==='aircraft'?360:definition.reloadTicks);event(pool,unit,tick,'reload-start',weapon);
    }
  }
  return true;
}
export function fireAircraftWeapons(unit:Unit,tick:number,pool:ProjectilePool,directions:Partial<Record<'mg'|'cannon',Vec3>>={},aiSpread=false):void {
  for(const weapon of ['mg','cannon'] as const)fireWeapon(unit,weapon,tick,pool,{direction:directions[weapon],aiSpread});
}
export function groundShotSolution(unit:Unit,target:Unit,terrain:ProjectileTerrain):{origin:Vec3;direction:Vec3}|null {
  const weapon=groundWeapon(unit);if(!weapon||target.state!=='active'||target.hp<=0||target.team===unit.team)return null;
  if((weapon==='rifle'&&target.kind!=='infantry'&&target.kind!=='aa')||(weapon==='aa'&&target.kind!=='aircraft')||(weapon==='tank'&&target.kind==='aircraft'))return null;
  const origin=add(unit.position,{x:0,y:unit.kind==='infantry'?1.1:1.6,z:0}),targetPoint=aimPoint(target),definition=WEAPONS[weapon];
  if(distance(origin,targetPoint)>definition.range||!terrain.lineOfSight(origin,targetPoint))return null;
  const direction=interceptDirection(origin,targetPoint,target.velocity,definition.speed,definition.lifeTicks/60,definition.gravity);
  if(!direction)return null;
  return {origin,direction};
}

/** A conservative occupancy proof includes the emission-before-expiry endpoint. */
export const PROJECTILE_CAPACITY_PROOF=Object.freeze({
  infantry:240*(Math.floor(30/30)+1),
  tanks:24*(Math.floor(180/180)+1),
  aa:8*(Math.floor(240/15)+1),
  playerAircraft:2*(Math.floor(90/5)+1)+2*(Math.floor(90/15)+1),
  aiAircraft:11*(2*(Math.floor(90/17)+1)+2*(Math.floor(90/57)+1)),
  // Eleven AI slots: at most four bombs in 30s even across 20s waves.
  // A player slot may turn over every 5s; overcount both rack rounds at each endpoint.
  bombs:11*4+2*(Math.floor(1800/300)+1),
});
export const PROVEN_BULLET_BOUND=PROJECTILE_CAPACITY_PROOF.infantry+PROJECTILE_CAPACITY_PROOF.tanks+PROJECTILE_CAPACITY_PROOF.aa+PROJECTILE_CAPACITY_PROOF.playerAircraft+PROJECTILE_CAPACITY_PROOF.aiAircraft;
