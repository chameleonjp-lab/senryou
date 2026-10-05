import type { Aircraft, FlightInput, GameMode } from '../types';
import { advanceThrottle, clamp, createFlightController, forwardOf, MAX_SPEED, updatePlayerLoop, type FlightController } from '../flight';
import { autoFireTarget, applyEasyShotCorrection, getFlightAssist, predictedShotDirection } from '../flight-assist';
import { createFlightAircraft, readFlightAircraft, writeFlightAircraft, targetsForFlight } from '../battle-flight';
import { createMission, stepMission, logicalHash } from './mission';
import { markLost } from './scoring';
import type { Mission, Team } from './types';
import { initializeRosterPositions, resolveBattleSpawn, CAPTURE_TERRAIN, sweepTerrain } from './terrain';
import { createGroundAI, updateGroundAI } from './ground-ai';
import { createCombatState, updateCombat, DEFAULT_COMBAT_TERRAIN, type CombatState } from './combat';
import { updateAirAI } from './air-ai';
import { aircraftTerrainContact } from './projectiles';

export interface BattleGame {
  mission: Mission; mode: GameMode; combat: CombatState;
  pilot: Aircraft | null; controller: FlightController | null; pilotId: string | null;
  input: FlightInput; inputs: {tick:number; input:FlightInput}[]; recordInputs:boolean;
}
export const NEUTRAL_INPUT: FlightInput = {turn:0, climb:0, fire:false, loop:false, bomb:false};
export function createBattle(seed = 1, mode: GameMode = 'easy', team: Team = 'A', aiOnly = false): BattleGame {
  const mission = createMission(seed, team);
  initializeRosterPositions(mission);
  if(aiOnly){mission.controlEnabled=false;mission.controlledAircraftId=null;for(const unit of mission.units)unit.role='ai';}
  mission.groundAI = createGroundAI(mission);
  return {mission, mode, combat:createCombatState(mission.id), pilot:null, controller:null, pilotId:null,
    input:{...NEUTRAL_INPUT}, inputs:[],recordInputs:!aiOnly};
}
function movePlayer(game: BattleGame, input: FlightInput): void {
  const m = game.mission;
  const unit = m.units.find(u => u.id === m.controlledAircraftId && u.state === 'active');
  if (!unit) {game.pilotId = null; game.pilot = null; game.controller = null; return;}
  if (!game.pilot || game.pilotId !== unit.id) {
    game.pilot = createFlightAircraft(unit, m.playerTeam);
    game.controller = createFlightController(game.pilot); game.pilotId = unit.id;
  }
  const plane = game.pilot, meta = game.controller!;
  readFlightAircraft(plane, unit, m.playerTeam);
  const previous = {...unit.position};
  const previousAttitude={heading:unit.heading,pitch:unit.pitch,bank:unit.bank};
  const assist = getFlightAssist(plane, targetsForFlight(m).filter(t=>t.team==='enemy'), input, game.mode);
  const dt = 1/60;
  const slew = (current:number, target:number, rate:number) => current + clamp(target-current,-rate*dt,rate*dt);
  const manual = Math.max(Math.abs(input.turn),Math.abs(input.climb)) >= .35;
  meta.assistTurn = manual ? 0 : slew(meta.assistTurn,assist.turn-input.turn,2.5);
  meta.assistClimb = manual ? 0 : slew(meta.assistClimb,assist.climb-input.climb,1.5);
  if (meta.assistTurn * input.turn < 0) meta.assistTurn = 0;
  if (meta.assistClimb * input.climb < 0) meta.assistClimb = 0;
  meta.responseMultiplier = slew(meta.responseMultiplier,assist.responseMultiplier,2.5);
  const adjusted = {...input,turn:input.turn+meta.assistTurn,climb:input.climb+meta.assistClimb};
  if(game.mode==='easy'){
    const direction=forwardOf(plane);
    const lookAhead={x:unit.position.x+direction.x*plane.speed*3,y:unit.position.y+direction.y*plane.speed*3,z:unit.position.z+direction.z*plane.speed*3};
    if(sweepTerrain(unit.position,lookAhead,40)){
      // Ground assistance must give terrain clearance priority over pulling at a target.
      adjusted.climb=Math.max(.85,adjusted.climb);meta.assistClimb=Math.max(0,meta.assistClimb);
    }
  }
  const pressed = input.loop && !meta.loopHeld; meta.loopHeld = input.loop;
  updatePlayerLoop(plane,meta,adjusted,input,pressed,dt,advanceThrottle(meta,input,game.mode,dt),MAX_SPEED,meta.responseMultiplier);
  writeFlightAircraft(unit,plane);
  // World bounds remove only the outward component; no wrap or invisible death.
  unit.position.x = clamp(unit.position.x,-4500,4500); unit.position.z = clamp(unit.position.z,-3000,3000);
  unit.position.y = Math.min(unit.position.y,2500);
  unit.velocity = {x:(unit.position.x-previous.x)*60,y:(unit.position.y-previous.y)*60,z:(unit.position.z-previous.z)*60};
  plane.position.set(unit.position.x,unit.position.y,unit.position.z);
  if (aircraftTerrainContact(unit,previous,DEFAULT_COMBAT_TERRAIN,previousAttitude)) markLost(m,unit.id);
}
export function stepBattle(game: BattleGame, raw: FlightInput = NEUTRAL_INPUT, abort = false): void {
  if (game.mission.phase !== 'running') return;
  const input = {...raw}; game.input = input;
  // Bounded audit records consumed input, never wall-clock events.
  if (game.recordInputs && game.inputs.length < 72000) game.inputs.push({tick:game.mission.tick+1,input});
  stepMission(game.mission, {
    spawn:resolveBattleSpawn, surface:CAPTURE_TERRAIN, abort,
    move(m) {
      updateGroundAI(m,m.groundAI!);
      movePlayer(game,input);
    },
    combat(m) {
      const commands = updateAirAI(m,game.combat.air,DEFAULT_COMBAT_TERRAIN);
      const plane = game.pilot;
      const target = game.mode==='easy' && plane && m.controlledAircraftId ? autoFireTarget(plane,targetsForFlight(m).filter(t=>t.team==='enemy'),game.mode,input.viewAspect) : null;
      const directions: Partial<Record<'mg'|'cannon',{x:number;y:number;z:number}>> = {};
      if (plane && target) for (const kind of ['mg','cannon'] as const) {
        const forward = forwardOf(plane);
        const predicted = predictedShotDirection(plane.position,forward,target,plane.speed+(kind==='mg'?820:700),1.5);
        const corrected = applyEasyShotCorrection(forward,predicted);
        directions[kind] = {x:corrected.x,y:corrected.y,z:corrected.z};
      }
      updateCombat(m,game.combat,{playerFire:game.mode==='easy'?!!target:input.fire,playerBomb:!!input.bomb,
        playerDirections:directions,airCommands:commands});
    },
  });
}
/** Rendering state and camera are absent; projectile/controller facts are included. */
export function battleHash(game: BattleGame): string {
  const state = JSON.stringify({mode:game.mode,core:logicalHash(game.mission),combat:game.combat,
    controller:game.controller}, (key,value) => key==='missionId' ? 'mission' : value instanceof Map ? [...value] : value instanceof Set ? [...value] : value);
  let hash=2166136261; for (let i=0;i<state.length;i++) hash=Math.imul(hash^state.charCodeAt(i),16777619);
  return (hash>>>0).toString(16).padStart(8,'0');
}
