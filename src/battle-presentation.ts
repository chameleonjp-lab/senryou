import type { Mission,Unit,Vec3 } from './battle/types';
import { normalizeAngle } from './flight';
import { lerp } from './battle/projectiles';
/** Previous fixed state belongs to presentation only, never combat or the clock. */
export class BattlePresentation {
 private mission:Mission|null=null;
 private tick=-1;
 private pilot:string|null=null;
 private poses=new Map<string,Unit>();
 reset():void{this.mission=null;this.poses.clear();}
 capture(mission:Mission):void{
  this.mission=mission;this.tick=mission.tick;this.pilot=mission.controlledAircraftId;
  this.poses=new Map(mission.units.map(unit=>[unit.id,{...unit,position:{...unit.position},velocity:{...unit.velocity}}]));
 }
 sample(mission:Mission,alpha:number):Mission{
  if(mission.phase!=='running'){this.reset();return mission;}
  if(this.mission!==mission||this.tick!==mission.tick-1||this.pilot!==mission.controlledAircraftId)return mission;
  const t=Number.isFinite(alpha)?Math.max(0,Math.min(1,alpha)):1;
  const units=mission.units.map(unit=>{
   const before=this.poses.get(unit.id);
   if(!before||before.state!=='active'||unit.state!=='active'||before.hp<=0||unit.hp<=0)return unit;
   const angle=(a:number,b:number)=>a+normalizeAngle(b-a)*t;
   return {...unit,position:lerp(before.position,unit.position,t),heading:angle(before.heading,unit.heading),
    ...(unit.kind==='aircraft'?{pitch:angle(before.pitch??0,unit.pitch??0),bank:angle(before.bank??0,unit.bank??0)}:{})};
  });
  return {...mission,units};
 }
 sampleProjectiles<T extends {position:Vec3;previous:Vec3}>(projectiles:readonly T[],alpha:number):T[]{
  const t=Number.isFinite(alpha)?Math.max(0,Math.min(1,alpha)):1;
  return projectiles.map(round=>({...round,position:lerp(round.previous,round.position,t)}));
 }
}
