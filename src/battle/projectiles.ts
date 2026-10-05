import type { Team, Unit, Vec3 } from './types';

export type Weapon = 'mg' | 'cannon' | 'rifle' | 'tank' | 'aa' | 'bomb';
export interface TerrainContact { t:number; position:Vec3; normal:Vec3; colliderId:string }
export interface TerrainQueryOptions { ignoreColliderId?:string; ignoreInitialContact?:boolean }
/** Logical collision contract, independent of mesh LOD and the rendering camera. */
export interface ProjectileTerrain {
  sweep(from:Vec3,to:Vec3,radius?:number,options?:TerrainQueryOptions):TerrainContact|null;
  lineOfSight(from:Vec3,to:Vec3,options?:TerrainQueryOptions):boolean;
  height?(x:number,z:number):number;
}
export interface Projectile {
  missionId:string; shotId:number; ownerId:string; team:Team; sourceRole:'player'|'ai'; weapon:Weapon;
  position:Vec3; previous:Vec3; velocity:Vec3; lifeTicks:number; ageTicks:number;
  distance:number; baseDamage:number;
}
export interface ProjectileContact {
  shot:Projectile; time:number; position:Vec3; normal:Vec3; colliderId:string; targetId?:string;
}
export interface BombImpactPrediction { position:Vec3; normal:Vec3; colliderId:string; time:number; hitUnitId?:string }

export const GRAVITY=9.81;
export const FIXED_DT=1/60;
export const BULLET_CAPACITY=4096;
export const BOMB_CAPACITY=64;
/** Fixed Kaisen simulation.ts HIT_SPHERES, preserved for the inherited aircraft. */
export const AIRCRAFT_HIT_SPHERES=Object.freeze([
  Object.freeze({center:{x:0,y:0,z:-3.8},radius:3}),
  Object.freeze({center:{x:0,y:0,z:0},radius:4.6}),
  Object.freeze({center:{x:0,y:0,z:3.4},radius:2.7}),
  Object.freeze({center:{x:4,y:0,z:.25},radius:2.1}),
  Object.freeze({center:{x:-4,y:0,z:.25},radius:2.1}),
]);
export interface AircraftAttitude { heading:number; pitch?:number; bank?:number }
const EPS=1e-9;
const AXES=['x','y','z'] as const;
export const copy=(v:Vec3):Vec3=>({x:v.x,y:v.y,z:v.z});
export const add=(a:Vec3,b:Vec3):Vec3=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
export const subtract=(a:Vec3,b:Vec3):Vec3=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
export const scale=(v:Vec3,n:number):Vec3=>({x:v.x*n,y:v.y*n,z:v.z*n});
export const magnitude=(v:Vec3):number=>Math.hypot(v.x,v.y,v.z);
export const distance=(a:Vec3,b:Vec3):number=>magnitude(subtract(a,b));
export const normalize=(v:Vec3):Vec3=>{const n=magnitude(v); return n>EPS?scale(v,1/n):{x:0,y:0,z:-1};};
export const lerp=(a:Vec3,b:Vec3,t:number):Vec3=>add(a,scale(subtract(b,a),t));
const dot=(a:Vec3,b:Vec3):number=>a.x*b.x+a.y*b.y+a.z*b.z;
export function forwardOfUnit(unit:Unit):Vec3 {
  const pitch=(unit as Unit & {pitch?:number}).pitch;
  if(pitch!==undefined) return {x:-Math.sin(unit.heading)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(unit.heading)*Math.cos(pitch)};
  if(magnitude(unit.velocity)>EPS) return normalize(unit.velocity);
  return {x:-Math.sin(unit.heading),y:0,z:-Math.cos(unit.heading)};
}
/** Same YXZ attitude as Kaisen: positive bank rotates local Z negatively. */
export function rotateLocal(unit:Unit,local:Vec3):Vec3 {
  const attitude=unit as Unit & {pitch?:number;bank?:number};
  const pitch=attitude.pitch??Math.asin(Math.max(-1,Math.min(1,forwardOfUnit(unit).y))), bank=attitude.bank??0;
  const cz=Math.cos(-bank),sz=Math.sin(-bank),cx=Math.cos(pitch),sx=Math.sin(pitch),cy=Math.cos(unit.heading),sy=Math.sin(unit.heading);
  const x=local.x*cz-local.y*sz,y=local.x*sz+local.y*cz;
  const py=y*cx-local.z*sx,pz=y*sx+local.z*cx;
  return {x:x*cy+pz*sy,y:py,z:-x*sy+pz*cy};
}
export function aimPoint(unit:Unit):Vec3 {
  return add(unit.position,{x:0,y:unit.kind==='aircraft'?0:unit.kind==='infantry'?.9:1.2,z:0});
}

function sphereEntry(a:Vec3,b:Vec3,center:Vec3,radius:number):number|null {
  const relative=subtract(a,center),delta=subtract(b,a),c=dot(relative,relative)-radius*radius;
  if(c<=0) return 0;
  const aa=dot(delta,delta); if(aa<EPS) return null;
  const bb=dot(relative,delta),d=bb*bb-aa*c; if(d<0) return null;
  const t=(-bb-Math.sqrt(d))/aa;
  return t>=0&&t<=1?t:null;
}
function boxEntry(a:Vec3,b:Vec3,half:Vec3):{t:number;normal:Vec3}|null {
  let enter=0,exit=1,normal:Vec3={x:0,y:1,z:0};
  for(const axis of AXES){
    const delta=b[axis]-a[axis];
    if(Math.abs(delta)<EPS){if(a[axis]<-half[axis]||a[axis]>half[axis])return null;continue;}
    let near=(-half[axis]-a[axis])/delta,far=(half[axis]-a[axis])/delta;
    const sign=delta>0?-1:1; if(near>far)[near,far]=[far,near];
    if(near>enter){enter=near;normal={x:0,y:0,z:0};normal[axis]=sign;}
    exit=Math.min(exit,far);if(enter>exit)return null;
  }
  return enter<=1&&exit>=0?{t:Math.max(0,enter),normal}:null;
}
function toLocal(v:Vec3,yaw:number):Vec3 {
  const c=Math.cos(yaw),s=Math.sin(yaw);return {x:v.x*c-v.z*s,y:v.y,z:v.x*s+v.z*c};
}
function toAircraftLocal(v:Vec3,unit:Unit):Vec3 {
  const x=rotateLocal(unit,{x:1,y:0,z:0}),y=rotateLocal(unit,{x:0,y:1,z:0}),z=rotateLocal(unit,{x:0,y:0,z:1});
  return {x:dot(v,x),y:dot(v,y),z:dot(v,z)};
}
/** Translation is swept in relative space; a target crossing a round cannot tunnel. */
export function sweepUnit(from:Vec3,to:Vec3,unit:Unit,before:Vec3=unit.position,fromTime=0,toTime=1):TerrainContact|null {
  const startPosition=lerp(before,unit.position,fromTime),endPosition=lerp(before,unit.position,toTime);
  const a=subtract(from,startPosition),b=subtract(to,endPosition);
  let hit:{t:number;normal:Vec3}|null=null;
  if(unit.kind==='infantry'){
    // Three overlapping capsule samples retain the 0.45m radial contract.
    for(const y of [.45,.9,1.35]){
      const t=sphereEntry(a,b,{x:0,y,z:0},.45);
      if(t!==null&&(!hit||t<hit.t))hit={t,normal:normalize(subtract(lerp(a,b,t),{x:0,y,z:0}))};
    }
  }else{
    const localA=unit.kind==='aircraft'?toAircraftLocal(a,unit):toLocal(a,unit.heading),localB=unit.kind==='aircraft'?toAircraftLocal(b,unit):toLocal(b,unit.heading);
    if(unit.kind==='aircraft'){
      for(const sphere of AIRCRAFT_HIT_SPHERES){
        const t=sphereEntry(localA,localB,sphere.center,sphere.radius);
        if(t!==null&&(!hit||t<hit.t))hit={t,normal:normalize(subtract(lerp(localA,localB,t),sphere.center))};
      }
    }else{
      const half=unit.kind==='tank'?{x:1.5,y:1,z:3}:{x:1.25,y:1.2,z:2.5};
      hit=boxEntry(subtract(localA,{x:0,y:half.y,z:0}),subtract(localB,{x:0,y:half.y,z:0}),half);
    }
    if(hit){
      if(unit.kind==='aircraft')hit.normal=rotateLocal(unit,hit.normal);
      else{const c=Math.cos(unit.heading),s=Math.sin(unit.heading),n=hit.normal;hit.normal={x:n.x*c+n.z*s,y:n.y,z:-n.x*s+n.z*c};}
    }
  }
  return hit?{t:hit.t,position:lerp(from,to,hit.t),normal:hit.normal,colliderId:unit.id}:null;
}
function shortAngle(a:number,b:number,t:number):number {
  let delta=(b-a)%(2*Math.PI);if(delta>Math.PI)delta-=2*Math.PI;if(delta<-Math.PI)delta+=2*Math.PI;return a+delta*t;
}
/** Five inherited collision volumes sweep through translation and changing attitude. */
export function aircraftTerrainContact(unit:Unit,previous:Vec3,terrain:ProjectileTerrain,previousAttitude:AircraftAttitude=unit):TerrainContact|null {
  const angular=Math.max(Math.abs(shortAngle(previousAttitude.heading,unit.heading,1)-previousAttitude.heading),Math.abs(shortAngle(previousAttitude.pitch??0,unit.pitch??0,1)-(previousAttitude.pitch??0)),Math.abs(shortAngle(previousAttitude.bank??0,unit.bank??0,1)-(previousAttitude.bank??0)));
  const steps=Math.max(1,Math.ceil(angular/.02));let first:TerrainContact|null=null;
  for(let step=0;step<steps;step++){
    const fromTime=step/steps,toTime=(step+1)/steps;
    const attitude=(time:number):Unit=>({...unit,heading:shortAngle(previousAttitude.heading,unit.heading,time),pitch:shortAngle(previousAttitude.pitch??0,unit.pitch??0,time),bank:shortAngle(previousAttitude.bank??0,unit.bank??0,time)});
    const before=attitude(fromTime),after=attitude(toTime);
    for(const sphere of AIRCRAFT_HIT_SPHERES){
      const from=add(lerp(previous,unit.position,fromTime),rotateLocal(before,sphere.center)),to=add(lerp(previous,unit.position,toTime),rotateLocal(after,sphere.center));
      const hit=terrain.sweep(from,to,sphere.radius);if(!hit)continue;
      const candidate={...hit,t:(step+hit.t)/steps};
      if(!first||contactOrder(candidate,first)<0)first=candidate;
    }
    if(first&&first.t<=toTime)break;
  }
  return first;
}
/** Fixed Kaisen aircraftContactTime using both moving inherited sphere sets. */
export function aircraftContactTime(a:Unit,b:Unit,previousA:Vec3,previousB:Vec3):number|null {
  const from=subtract(previousA,previousB),to=subtract(a.position,b.position);
  if(sphereEntry(from,to,{x:0,y:0,z:0},16)===null)return null;
  let first:number|null=null;
  for(const sphereA of AIRCRAFT_HIT_SPHERES)for(const sphereB of AIRCRAFT_HIT_SPHERES){
    const offset=subtract(rotateLocal(a,sphereA.center),rotateLocal(b,sphereB.center));
    const hit=sphereEntry(add(from,offset),add(to,offset),{x:0,y:0,z:0},sphereA.radius+sphereB.radius);
    if(hit!==null&&(first===null||hit<first))first=hit;
  }
  return first;
}

export function contactOrder(a:TerrainContact&{targetId?:string},b:TerrainContact&{targetId?:string}):number {
  return a.t-b.t || Number(Boolean(a.targetId))-Number(Boolean(b.targetId)) || a.colliderId.localeCompare(b.colliderId);
}
function firstContact(from:Vec3,to:Vec3,shot:Projectile,units:readonly Unit[],terrain:ProjectileTerrain,previous:ReadonlyMap<string,Vec3>,fromTime:number,toTime:number): (TerrainContact&{targetId?:string})|null {
  let first: (TerrainContact&{targetId?:string})|null=terrain.sweep(from,to,0);
  for(const target of units){
    if(target.state!=='active'||target.hp<=0||target.team===shot.team||target.id===shot.ownerId||(shot.weapon==='bomb'&&target.kind==='aircraft'))continue;
    const hit=sweepUnit(from,to,target,previous.get(target.id)??target.position,fromTime,toTime);
    if(!hit)continue;const candidate={...hit,targetId:target.id};
    if(!first||contactOrder(candidate,first)<0)first=candidate;
  }
  return first;
}
export function ballisticPosition(position:Vec3,velocity:Vec3,dt:number,gravity:number):Vec3 {
  const next=add(position,scale(velocity,dt));next.y-=.5*gravity*dt*dt;return next;
}
/** Swept bounds are indexed every tick, including offscreen units and crossing targets. */
export class UnitSpatialIndex {
  private cells=new Map<string,Unit[]>();
  constructor(units:readonly Unit[],previous:ReadonlyMap<string,Vec3>=new Map(),private cellSize=64){
    for(const unit of units){
      if(unit.state!=='active'||unit.hp<=0)continue;
      const before=previous.get(unit.id)??unit.position,radius=unit.kind==='aircraft'?7:unit.kind==='infantry'?2:4;
      const min={x:Math.min(before.x,unit.position.x)-radius,y:Math.min(before.y,unit.position.y)-radius,z:Math.min(before.z,unit.position.z)-radius};
      const max={x:Math.max(before.x,unit.position.x)+radius,y:Math.max(before.y,unit.position.y)+radius,z:Math.max(before.z,unit.position.z)+radius};
      this.visit(min,max,key=>{const cell=this.cells.get(key);if(cell)cell.push(unit);else this.cells.set(key,[unit]);});
    }
  }
  private visit(min:Vec3,max:Vec3,callback:(key:string)=>void):void {
    for(let x=Math.floor(min.x/this.cellSize);x<=Math.floor(max.x/this.cellSize);x++)for(let y=Math.floor(min.y/this.cellSize);y<=Math.floor(max.y/this.cellSize);y++)for(let z=Math.floor(min.z/this.cellSize);z<=Math.floor(max.z/this.cellSize);z++)callback(`${x},${y},${z}`);
  }
  query(from:Vec3,to:Vec3,radius=0):Unit[] {
    const found=new Set<Unit>();
    const min={x:Math.min(from.x,to.x)-radius,y:Math.min(from.y,to.y)-radius,z:Math.min(from.z,to.z)-radius},max={x:Math.max(from.x,to.x)+radius,y:Math.max(from.y,to.y)+radius,z:Math.max(from.z,to.z)+radius};
    this.visit(min,max,key=>{for(const unit of this.cells.get(key)??[])found.add(unit);});
    return [...found];
  }
}
/** One fixed tick, shared verbatim by actual bombs and the terrain aiming guide. */
export function stepProjectile(shot:Projectile,units:readonly Unit[],terrain:ProjectileTerrain,previous:ReadonlyMap<string,Vec3>=new Map()):ProjectileContact|null {
  if(shot.lifeTicks<=0)return null;
  shot.previous=copy(shot.position);
  const gravity=shot.weapon==='bomb'||shot.weapon==='tank'?GRAVITY:0;
  const steps=gravity?2:1,dt=FIXED_DT/steps;
  for(let i=0;i<steps;i++){
    const start=copy(shot.position),end=ballisticPosition(start,shot.velocity,dt,gravity);
    const hit=firstContact(start,end,shot,units,terrain,previous,i/steps,(i+1)/steps);
    const fraction=hit?.t??1;
    shot.position=lerp(start,end,fraction);shot.distance+=distance(start,shot.position);shot.velocity.y-=gravity*dt*fraction;
    if(hit){shot.lifeTicks=0;return {shot,time:(i+fraction)/steps,position:copy(shot.position),normal:hit.normal,colliderId:hit.colliderId,targetId:hit.targetId};}
  }
  shot.lifeTicks--;shot.ageTicks++;return null;
}
export function bombRelease(unit:Unit):{position:Vec3;velocity:Vec3} {
  return {position:add(unit.position,rotateLocal(unit,{x:0,y:-1.2,z:0})),velocity:copy(unit.velocity)};
}
/** No ocean-height shortcut or future target coordinate is used by the guide. */
export function predictBombImpact(unit:Unit,terrain:ProjectileTerrain,units:readonly Unit[]=[]):BombImpactPrediction|null {
  const release=bombRelease(unit);
  if(![...AXES.map(a=>release.position[a]),...AXES.map(a=>release.velocity[a])].every(Number.isFinite))return null;
  const shot:Projectile={missionId:'prediction',shotId:0,ownerId:unit.id,team:unit.team,sourceRole:unit.role,weapon:'bomb',...release,previous:copy(release.position),lifeTicks:1800,ageTicks:0,distance:0,baseDamage:240};
  // A quarter-second chord is expanded by its exact parabola/chord deviation.
  // Only a candidate interval is replayed through the actual 1/120s sweeps.
  // The conservative envelope also catches bridge undersides above the chord.
  const stride=units.length?1:15;
  for(let tick=0;tick<1800;tick+=stride){
    const count=Math.min(stride,1800-tick),time=tick*FIXED_DT,duration=count*FIXED_DT;
    shot.position=ballisticPosition(release.position,release.velocity,time,GRAVITY);
    shot.velocity=copy(release.velocity);shot.velocity.y-=GRAVITY*time;
    const end=ballisticPosition(shot.position,shot.velocity,duration,GRAVITY);
    const deviation=GRAVITY*duration*duration/8;
    if(stride>1&&!terrain.sweep(shot.position,end,deviation))continue;
    for(let step=0;step<count;step++){
      const hit=stepProjectile(shot,units,terrain);
      if(hit)return {position:hit.position,normal:hit.normal,colliderId:hit.colliderId,time:(tick+step+hit.time)*FIXED_DT,hitUnitId:hit.targetId};
    }
  }
  return null;
}

/** Fire-time lead only. The returned vector never updates a projectile after launch. */
export function interceptDirection(origin:Vec3,target:Vec3,velocity:Vec3,speed:number,maxTime:number,gravity=0):Vec3|null {
  const relative=subtract(target,origin);let time:number|null=null;
  if(!gravity){
    const a=dot(velocity,velocity)-speed*speed,b=2*dot(relative,velocity),c=dot(relative,relative);
    if(Math.abs(a)<EPS){if(Math.abs(b)>EPS){const t=-c/b;if(t>0)time=t;}}
    else {const discriminant=b*b-4*a*c;if(discriminant>=0){const root=Math.sqrt(discriminant);const roots=[(-b-root)/(2*a),(-b+root)/(2*a)].filter(t=>t>EPS);if(roots.length)time=Math.min(...roots);}}
  }else{
    const error=(t:number):number=>{const aim=add(relative,scale(velocity,t));aim.y+=.5*gravity*t*t;return magnitude(aim)-speed*t;};
    let low=0,old=error(0);
    for(let i=1;i<=120;i++){const high=maxTime*i/120,current=error(high);if(old>=0&&current<=0){let a=low,b=high;for(let j=0;j<40;j++){const middle=(a+b)/2;if(error(middle)>0)a=middle;else b=middle;}time=(a+b)/2;break;}low=high;old=current;}
  }
  if(time===null||time>maxTime+EPS)return null;
  const aim=add(relative,scale(velocity,time));aim.y+=.5*gravity*time*time;return normalize(aim);
}
