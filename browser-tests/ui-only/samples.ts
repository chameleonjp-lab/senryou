import { Quaternion, Vector3 } from 'three';
import type { Mission, MissionResult, Unit, CapturePoint, Team, UnitKind } from '../../src/battle/types';
import type { Aircraft, CombatTarget } from '../../src/types';
import type { BattleCombatView, ViewBombGuide, ViewAAWarning } from '../../src/battle-view';
export const UI_FIXTURE_IDS=['home','hud-easy','hud-normal','hud-notice','flying-effective','flying-ineffective','flying-no-prediction','waiting','spectating','settings-touch','settings-keyboard','rules','pause','result-victory','result-defeat','result-draw','result-aborted','startup-error','paused-error'] as const;
export function assertFixtureId(id:string):void {if(!(UI_FIXTURE_IDS as readonly string[]).includes(id))throw new Error('Unknown UI fixture: '+id);}
export interface DisplaySample {
 game:{mission:Mission;pilot:Aircraft|null;combat:BattleCombatView & {aaWarnings:ViewAAWarning[]}};player:Aircraft;targets:CombatTarget[];
 guide:ViewBombGuide|null;score:MissionResult['score'];forces:Record<Team,Record<UnitKind,number>>;
}
const counts=()=>({infantry:240,tank:24,aa:8,aircraft:24});
export function resultSample(outcome:string):MissionResult {
 if(!['victory','defeat','draw','aborted'].includes(outcome))throw new Error('Unknown display outcome');
 return {rulesVersion:'senryou-rules-v1',seed:1,outcome:outcome as MissionResult['outcome'],reason:({victory:'敵本拠地占領',defeat:'味方本拠地占領',draw:'時間切れ',aborted:'作戦中断'} as Record<string,string>)[outcome],tick:36661,
 score:{kill:2460,support:1724.45,capture:3000,time:1234.56,loss:9876,total:-1457},owners:{HA:'A',P1:'A',P2:'N',P3:'B',P4:'A',P5:'B',HB:'B'},remaining:{A:counts(),B:counts()},damage:[]};
}
function unit(id:string,team:Team,kind:UnitKind,x:number,y:number,z:number,role:'player'|'ai'='ai'):Unit {
 return {id,team,kind,state:'active',role,hp:kind==='aircraft'?80:100,hpFixed:8000,maxHpFixed:8000,position:{x,y,z},velocity:{x:0,y:0,z:-110},heading:0,ammo:288,cannonAmmo:96,bombs:2,reloadUntil:0,bombReloadUntil:0,lastFireTick:0,lastCannonTick:0,lastBombTick:0,retryNotBefore:0,loopCooldown:0};
}
export function makeSample(id:string):DisplaySample {
 if(id!=='ready')assertFixtureId(id);
 const dense=id.startsWith('flying-')||id==='hud-notice',inactive=id==='waiting'||id==='spectating';
 const x=dense?4300:0,y=dense?40:220;
 const pilot=unit('sample-player','A','aircraft',x,y,0,'player');
 if(dense){pilot.ammo=0;pilot.cannonAmmo=0;pilot.bombs=0;pilot.reloadUntil=720;pilot.bombReloadUntil=1560;pilot.loopCooldown=2;}
 const player:Aircraft={kind:'aircraft',id:pilot.id,team:'friendly',role:'player',position:new Vector3(x,y,0),previous:new Vector3(x,y,0),quaternion:new Quaternion(),yaw:0,pitch:0,bank:0,speed:110,health:80,maxHealth:80,loopProgress:0,loopCooldown:pilot.loopCooldown??0};
 const enemy=unit('sample-tank','B','tank',x+80,0,-280),friend=unit('sample-wingman','A','aircraft',x-80,y+20,-500),foe=unit('sample-enemy','B','aircraft',x+150,y+15,-600),aa=unit('sample-aa','B','aa',x-140,0,-650);
 const units=inactive?[enemy,friend,foe,aa]:[pilot,enemy,friend,foe,aa];
 const points:CapturePoint[]=['HA','P1','P2','P3','P4','P5','HB'].map((name,index)=>({id:name,position:{x:x+(index-3)*160,y:0,z:-400-index*150},owner:index<2?'A':index>4?'B':'N',phase:'stable',progressTeam:null,progress:0,progressNumerator:0,remainder:0,lastEligibleTick:0,idleTicks:0,contested:index===3,stableSince:0}));
 const score=resultSample('aborted').score;
 const mission:Mission={id:'ui-display-sample',missionId:'ui-display-sample',rulesVersion:'senryou-rules-v1',seed:1,tick:360,phase:'running',playerTeam:'A',units,points,controlledAircraftId:inactive?null:pilot.id,respawnCandidateId:null,respawnReadyTick:inactive?660:null,playerStatus:id==='spectating'?'spectating':id==='waiting'?'waiting':'flying',waitingReason:'安全な出撃回廊を確認中',nextWaveTick:1200,score:{...score,deaths:new Set(),captures:new Set(),damageIds:new Set(),damage:[]},result:null,deaths:[]};
 const targets:CombatTarget[]=[{kind:'tank',id:enemy.id,team:'enemy',position:new Vector3(enemy.position.x,enemy.position.y,enemy.position.z),velocity:new Vector3(),health:100,maxHealth:300,aimHeight:1.2},{...player,id:friend.id,role:'interceptor',position:new Vector3(friend.position.x,friend.position.y,friend.position.z)},{...player,id:foe.id,team:'enemy',role:'interceptor',position:new Vector3(foe.position.x,foe.position.y,foe.position.z)}];
 const guide=inactive||id==='flying-no-prediction'?null:{position:{x:enemy.position.x+(id==='flying-ineffective'?500:0),y:0,z:enemy.position.z},time:dense?30:2.4,effective:id!=='flying-ineffective'};
 return {game:{mission,pilot:inactive?null:player,combat:{projectiles:[],events:[],aaWarnings:dense?[{gunId:aa.id,targetId:pilot.id,position:aa.position,direction:{x:0,y:1,z:0},stage:'aiming',readyTick:408}]:[]}},player,targets,guide,score,forces:{A:counts(),B:counts()}};
}
