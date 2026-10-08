import {Quaternion,Vector3} from 'three';
import {projectGunSight} from './gun-sight';
import type {Aircraft,GameMode} from './types';
/** Camera-relative bore projection is invariant under world pose and bank:
 * the forward axis is unchanged by the camera's bank-only correction.
 * This calibrates layout geometry; it is not a simulated player or gameplay evidence.
 */
export function hudSightReservation(mode:GameMode,width:number,height:number){
 const calibration:Aircraft={kind:'aircraft',id:'layout-calibration',team:'friendly',role:'player',position:new Vector3(),previous:new Vector3(),quaternion:new Quaternion(),yaw:0,pitch:0,bank:0,speed:110,health:80,maxHealth:80,loopProgress:0,loopCooldown:0};
 const center=mode==='normal'?projectGunSight(calibration,[],width,height):{x:width/2,y:height/2};
 const radius=mode==='normal'?Math.max(26,Math.min(38,Math.min(width,height)*.085)):Math.min(width,height)*.135;
 return {x:center.x,y:center.y,width:2*(radius+8),height:2*(radius+8)};
}
