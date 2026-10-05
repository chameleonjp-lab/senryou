import type { Mission, Unit, Vec3 } from './types';
import { add, aimPoint, aircraftContactTime, aircraftTerrainContact, copy, distance, FIXED_DT, forwardOfUnit, interceptDirection, magnitude, normalize, predictBombImpact, scale, subtract } from './projectiles';
import type { ProjectileTerrain } from './projectiles';
import { sweepTerrain, terrainHeight, terrainLineOfSight } from './terrain';
import { markLost } from './scoring';

export interface AirMemory { position:Vec3; velocity:Vec3; tick:number }
export interface AirAIUnitState {
  task:'air'|'support'; phase:'approach'|'attack'|'extend'; phaseSince:number; targetId:string|null;
  noTargetSince:number; disengageUntil:number; pursuitSince:number; waypoint:Vec3;
  turn:number; climb:number; memories:Map<string,AirMemory>; taskOverride?:boolean;
}
export interface AirAIState { units:Map<string,AirAIUnitState> }
export interface AirCommand { fire:boolean; bomb:boolean; targetId?:string; directions?:Partial<Record<'mg'|'cannon',Vec3>> }
export const createAirAIState=():AirAIState=>({units:new Map()});
export const DEFAULT_AIR_TERRAIN:ProjectileTerrain={sweep:sweepTerrain,lineOfSight:terrainLineOfSight,height:terrainHeight};
const clamp=(v:number,a:number,b:number):number=>Math.max(a,Math.min(b,v));
export function normalizeAngle(angle:number):number {let wrapped=(angle+Math.PI)%(2*Math.PI);if(wrapped<0)wrapped+=2*Math.PI;return wrapped-Math.PI;}
const directionAngle=(a:Vec3,b:Vec3):number=>Math.acos(clamp((a.x*b.x+a.y*b.y+a.z*b.z)/(magnitude(a)*magnitude(b)||1),-1,1));

/** Numerically identical normal-flight equations from fixed Kaisen flight.ts. */
export function moveAIAircraft(unit:Unit,turnInput:number,climbInput:number,preferredSpeed=110):void {
  const turn=clamp(turnInput,-1,1),climb=clamp(climbInput,-1,1),dt=FIXED_DT;
  const speed=unit.speed??(magnitude(unit.velocity)||110),pitch=unit.pitch??Math.asin(clamp(forwardOfUnit(unit).y,-1,1)),bank=unit.bank??0;
  const lowSpeedAuthority=speed<=85?.92+((speed-65)/20)*.23:speed<=110?1.15-((speed-85)/25)*.15:1;
  const authority=lowSpeedAuthority*clamp(1-Math.max(0,speed-115)*.008,.78,1);
  unit.pitch=pitch+(climb*.62-pitch)*(1-Math.exp(-dt*4.2));
  unit.heading=normalizeAngle(unit.heading-turn*.82*authority*dt);
  unit.bank=bank+(turn*.72-bank)*(1-Math.exp(-dt*5.5));
  const trim=(preferredSpeed-speed)*.72,drag=Math.abs(turn)*2.7+Math.max(0,climb)*2.1+Math.sin(unit.pitch)*2.6;
  unit.speed=clamp(speed+(trim-drag)*dt,65,141);
  unit.velocity=scale(forwardOfUnit(unit),unit.speed);
  unit.position=add(unit.position,scale(unit.velocity,dt));
}
function desiredControls(unit:Unit,point:Vec3):{turn:number;climb:number} {
  const direction=subtract(point,unit.position),horizontal=Math.hypot(direction.x,direction.z);
  if(magnitude(direction)<1e-8)return {turn:0,climb:0};
  const yaw=Math.atan2(-direction.x,-direction.z),pitch=Math.atan2(direction.y,Math.max(horizontal,1e-8));
  return {turn:horizontal<1e-8?0:clamp(-normalizeAngle(yaw-unit.heading)/.7,-1,1),climb:clamp(pitch/.62,-1,1)};
}
function beginExtension(unit:Unit,state:AirAIUnitState,tick:number,ground:boolean):void {
  const forward=normalize({x:forwardOfUnit(unit).x,y:0,z:forwardOfUnit(unit).z}),side={x:-forward.z,y:0,z:forward.x};
  // Unit ordinal, without its team prefix, gives mirrored teams the same behaviour.
  const ordinal=Number(unit.id.match(/\d+$/)?.[0]??0),direction=(ordinal%2===0?1:-1)*(unit.team==='A'?1:-1);
  state.waypoint=add(add(unit.position,scale(forward,ground?510:380)),scale(side,direction*85));
  state.waypoint.y=Math.max(ground?210:160,Math.min(650,unit.position.y+65));
  state.phase='extend';state.phaseSince=tick;state.disengageUntil=tick+180;state.pursuitSince=tick;
}
function visible(unit:Unit,target:Unit,terrain:ProjectileTerrain):boolean {
  if(target.state!=='active'||target.hp<=0||target.team===unit.team)return false;
  return distance(unit.position,aimPoint(target))<=(target.kind==='aircraft'?2500:1200)&&terrain.lineOfSight(unit.position,aimPoint(target));
}
function initializeStates(planes:Unit[],state:AirAIState,tick:number):void {
  for(const team of ['A','B'] as const){
    const allied=planes.filter(p=>p.team===team),airCount=Math.ceil(allied.length/2);
    for(let index=0;index<allied.length;index++){
      const unit=allied[index];if(state.units.has(unit.id))continue;
      state.units.set(unit.id,{task:index<airCount?'air':'support',phase:'approach',phaseSince:tick,targetId:null,noTargetSince:tick,disengageUntil:0,pursuitSince:tick,waypoint:copy(unit.position),turn:0,climb:0,memories:new Map()});
    }
  }
}
/** Pure logical AI: no renderer projection, camera position or mesh visibility enters this function. */
export function updateAirAI(mission:Mission,state:AirAIState,terrain:ProjectileTerrain=DEFAULT_AIR_TERRAIN):Map<string,AirCommand> {
  const commands=new Map<string,AirCommand>();
  if(mission.phase!=='running'||mission.result)return commands;
  const planes=mission.units.filter(u=>u.kind==='aircraft'&&u.state==='active'&&u.hp>0&&u.role==='ai').sort((a,b)=>a.id.localeCompare(b.id));
  const unitById=new Map(mission.units.map(unit=>[unit.id,unit]));
  const before=new Map(planes.map(unit=>[unit.id,copy(unit.position)]));
  const beforeAttitude=new Map(planes.map(unit=>[unit.id,{heading:unit.heading,pitch:unit.pitch,bank:unit.bank}]));
  initializeStates(planes,state,mission.tick);
  if(mission.tick%60===0||mission.tick<=1){
    for(const team of ['A','B'] as const){
      const allied=planes.filter(p=>p.team===team),overrides=allied.filter(p=>state.units.get(p.id)!.taskOverride),ordinary=allied.filter(p=>!state.units.get(p.id)!.taskOverride);
      const airWanted=Math.max(0,Math.ceil(allied.length/2)-overrides.filter(p=>state.units.get(p.id)!.task==='air').length);
      for(let i=0;i<ordinary.length;i++){const memory=state.units.get(ordinary[i].id)!,task=i<airWanted?'air':'support';if(memory.task!==task){memory.task=task;memory.targetId=null;memory.noTargetSince=mission.tick;}}
    }
  }
  const loads=new Map<string,number>();
  const observations=new Map<string,Unit[]>();
  for(const unit of planes){
    const memory=state.units.get(unit.id)!;
    const detected=mission.units.filter(target=>visible(unit,target,terrain));observations.set(unit.id,detected);
    for(const target of detected)memory.memories.set(target.id,{position:copy(aimPoint(target)),velocity:copy(target.velocity),tick:mission.tick});
    for(const [id,last] of memory.memories){const known=unitById.get(id);if(mission.tick-last.tick>180||!known||known.state!=='active'||known.hp<=0)memory.memories.delete(id);}
    const old=detected.find(t=>t.id===memory.targetId),armed=unit.reloadUntil===0&&(unit.ammo>0||unit.cannonAmmo>0),bombArmed=unit.bombs>0&&unit.bombReloadUntil===0;
    const legal=old&&(memory.task==='air'?old.kind==='aircraft':old.kind!=='aircraft')&&(old.kind==='aircraft'?armed:armed||bombArmed)&&memory.disengageUntil<=mission.tick;
    if(legal&&(old.kind!=='aircraft'||(loads.get(old.id)??0)<2))loads.set(old.id,(loads.get(old.id)??0)+1);
    else if(!old||!legal||old.kind==='aircraft')memory.targetId=null;
  }
  for(const unit of planes){
    const memory=state.units.get(unit.id)!,detected=observations.get(unit.id)!;
    const armed=unit.reloadUntil===0&&(unit.ammo>0||unit.cannonAmmo>0),bombArmed=unit.bombs>0&&unit.bombReloadUntil===0;
    if(memory.targetId===null&&memory.disengageUntil<=mission.tick){
      const candidates=detected.filter(t=>memory.task==='air'?t.kind==='aircraft'&&armed&&(loads.get(t.id)??0)<2:t.kind!=='aircraft'&&(armed||bombArmed));
      candidates.sort((a,b)=>{
        const priority=(t:Unit)=>memory.task==='support'?(t.kind==='aa'?0:t.kind==='tank'?1:2):0;
        return priority(a)-priority(b)||(loads.get(a.id)??0)-(loads.get(b.id)??0)||distance(unit.position,a.position)-distance(unit.position,b.position)||a.id.localeCompare(b.id);
      });
      const target=candidates[0];if(target){memory.targetId=target.id;memory.pursuitSince=mission.tick;loads.set(target.id,(loads.get(target.id)??0)+1);}
    }
    const target=detected.find(t=>t.id===memory.targetId);
    if(target)memory.noTargetSince=mission.tick;
    else if(mission.tick-memory.noTargetSince>=600){memory.task=memory.task==='air'?'support':'air';memory.taskOverride=true;memory.noTargetSince=mission.tick;memory.targetId=null;}
    unit.targetId=target?.id;
    let aim:Vec3;
    const ground=target!==undefined&&target.kind!=='aircraft',surface=terrain.height?.(unit.position.x,unit.position.z)??0;
    const terrainAhead=add(unit.position,scale(forwardOfUnit(unit),Math.max(180,(unit.speed??110)*2)));
    const terrainDanger=Boolean(terrain.sweep(unit.position,terrainAhead,6))||unit.position.y<surface+80;
    const nearBoundary=Math.abs(unit.position.x)>3900||Math.abs(unit.position.z)>2400||unit.position.y>2200;
    if(memory.phase!=='extend'&&target&&(terrainDanger||distance(unit.position,aimPoint(target))<(ground?215:88)||(!ground&&mission.tick-memory.pursuitSince>=600)))beginExtension(unit,memory,mission.tick,ground);
    if(memory.phase==='extend'&&mission.tick>=memory.disengageUntil){memory.phase='approach';memory.phaseSince=mission.tick;memory.pursuitSince=mission.tick;}
    if(nearBoundary){aim={x:unit.position.x*.45,y:clamp(unit.position.y,250,1000),z:unit.position.z*.45};}
    else if(terrainDanger){aim=add(unit.position,scale(forwardOfUnit(unit),250));aim.y=Math.max(surface+260,unit.position.y+180);}
    else if(memory.phase==='extend'){aim=copy(memory.waypoint);}
    else if(target){
      const lead=ground?Math.min(2,distance(unit.position,target.position)/750):Math.min(.75,distance(unit.position,target.position)/930);
      aim=add(aimPoint(target),scale(target.velocity,lead));
      if(ground){
        const heading=forwardOfUnit(unit),horizontal={x:aim.x-unit.position.x,y:0,z:aim.z-unit.position.z};
        const linedUp=directionAngle({x:heading.x,y:0,z:heading.z},horizontal)<.26;
        if(linedUp&&distance(unit.position,target.position)<980&&distance(unit.position,target.position)>330)memory.phase='attack';
        aim.y=memory.phase==='attack'&&armed?aimPoint(target).y:Math.max(terrain.height?.(aim.x,aim.z)??0,0)+230;
      }else{aim.y=Math.max(surface+110,aim.y);memory.phase=distance(unit.position,target.position)<700?'attack':'approach';}
    }else{
      const latest=[...memory.memories.values()].sort((a,b)=>b.tick-a.tick)[0];
      const ordinal=Number(unit.id.match(/\d+$/)?.[0]??0);
      aim=latest?copy(latest.position):{x:0,y:450,z:ordinal%2===0?-400:400};
      aim.y=Math.max(aim.y,(terrain.height?.(aim.x,aim.z)??0)+230);
    }
    // Fixed-source decisions are held between 10Hz planning ticks. Avoidance is immediate.
    const ordinal=Number(unit.id.match(/\d+$/)?.[0]??0);
    if(mission.tick%6===ordinal%6||memory.phaseSince===mission.tick||terrainDanger||nearBoundary||mission.tick===1){const controls=desiredControls(unit,aim);memory.turn=controls.turn;memory.climb=controls.climb;}
    moveAIAircraft(unit,memory.turn,memory.climb);
    const command:AirCommand={fire:false,bomb:false,targetId:target?.id};
    if(target&&visible(unit,target,terrain)&&memory.phase!=='extend'&&!terrainDanger&&!nearBoundary){
      const targetPoint=aimPoint(target),toTarget=subtract(targetPoint,unit.position),range=distance(unit.position,targetPoint);
      command.fire=armed&&range>35&&range<(ground?980:740)&&directionAngle(forwardOfUnit(unit),toTarget)<(ground?.10:.09);
      if(command.fire){
        command.directions={};
        for(const weapon of ['mg','cannon'] as const){const speed=(unit.speed??110)+(weapon==='mg'?820:700);const solution=interceptDirection(unit.position,targetPoint,target.velocity,speed,1.5);if(solution)command.directions[weapon]=solution;}
      }
      if(ground&&bombArmed&&mission.tick-unit.lastBombTick>=60){
        const prediction=predictBombImpact(unit,terrain);
        if(prediction&&distance(prediction.position,aimPoint(target))<60){command.bomb=true;beginExtension(unit,memory,mission.tick,true);}
      }
    }
    commands.set(unit.id,command);
  }
  for(const unit of planes){
    if(aircraftTerrainContact(unit,before.get(unit.id)!,terrain,beforeAttitude.get(unit.id)!))markLost(mission,unit.id);
  }
  const allAircraft=mission.units.filter(u=>u.kind==='aircraft'&&u.state==='active'&&u.hp>0).sort((a,b)=>a.id.localeCompare(b.id));
  // Both endpoints move. Contacts are gathered before loss mutation, then resolved by time/IDs.
  const collisions:{time:number;a:Unit;b:Unit}[]=[];
  for(let i=0;i<allAircraft.length;i++)for(let j=i+1;j<allAircraft.length;j++){
    const a=allAircraft[i],b=allAircraft[j];if(a.team===b.team)continue;
    const oldA=before.get(a.id)??subtract(a.position,scale(a.velocity,FIXED_DT)),oldB=before.get(b.id)??subtract(b.position,scale(b.velocity,FIXED_DT));
    const time=aircraftContactTime(a,b,oldA,oldB);
    if(time!==null)collisions.push({time,a,b});
  }
  collisions.sort((a,b)=>a.time-b.time||a.a.id.localeCompare(b.a.id)||a.b.id.localeCompare(b.b.id));
  for(const collision of collisions)if(collision.a.state==='active'&&collision.b.state==='active'){markLost(mission,collision.a.id);markLost(mission,collision.b.id);}
  return commands;
}
