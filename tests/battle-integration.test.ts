import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,stepBattle,battleHash,NEUTRAL_INPUT} from '../src/battle/simulation';
import {assertRoster} from '../src/battle/roster';
import {markLost} from '../src/battle/scoring';
import {validateGroundRoutes} from '../src/battle/ground-nav';

test('validated battlefield starts with finite nonoverlapping units and deterministic replay',()=>{
  assert.equal(validateGroundRoutes().valid,true);
  const a=createBattle(73,'normal'), b=createBattle(73,'normal');
  assert.equal(a.mission.units.length,592);
  assert.equal(a.mission.units.filter(u=>u.state==='active').length,180);
  for(let tick=0;tick<360;tick++){
    const input={...NEUTRAL_INPUT,turn:Math.sin(tick/80)*.3,climb:.15,fire:tick%120<40,viewAspect:16/9};
    stepBattle(a,input);stepBattle(b,input);
    assert.equal(battleHash(a),battleHash(b),`tick ${tick+1}`);
  }
  assertRoster(a.mission);assertRoster(b.mission);
});
test('paused and finalized battles freeze all authoritative clocks and in-flight rounds',()=>{
  const game=createBattle(41,'normal');
  stepBattle(game,{...NEUTRAL_INPUT,fire:true});
  game.mission.phase='paused';const paused=battleHash(game);
  for(let i=0;i<10;i++)stepBattle(game,{...NEUTRAL_INPUT,fire:true,bomb:true});
  assert.equal(battleHash(game),paused);
  game.mission.phase='running';stepBattle(game,NEUTRAL_INPUT,true);
  assert.equal(game.mission.result?.outcome,'aborted');
  const ended=battleHash(game), result=game.mission.result;
  for(let i=0;i<10;i++)stepBattle(game,{...NEUTRAL_INPUT,fire:true});
  assert.equal(battleHash(game),ended);assert.equal(game.mission.result,result);
});
test('pilot loss reserves one finite replacement and handoff does not regenerate aircraft',()=>{
  const game=createBattle(24,'normal');const old=game.mission.controlledAircraftId!;
  markLost(game.mission,old);
  for(let i=0;i<300;i++)stepBattle(game);
  assertRoster(game.mission);
  assert.equal(game.mission.units.find(u=>u.id===old)!.state,'lost');
  const counts=game.mission.units.filter(u=>u.kind==='aircraft'&&u.team==='A');
  assert.equal(counts.length,24);assert.ok(counts.filter(u=>u.role==='player'&&u.state==='active').length<=1);
});


import { Vector3, Quaternion } from 'three';
import { createFlightAircraft } from '../src/battle-flight';
import { FLIGHT_FOV, getFlightCameraPose } from '../src/flight-view';
test('battle Easy acquisition starts from live pitch while terrain safety stays separate', () => {
  for(const pitch of [-.6,.6]) {
    const game=createBattle(73,'easy'), m=game.mission;
    const player=m.units.find(u=>u.id===m.controlledAircraftId)!;
    player.position={x:0,y:1800,z:0}; player.pitch=pitch; player.heading=0; player.bank=0;
    const enemy=m.units.find(u=>u.team!==m.playerTeam && u.kind==='aircraft' && u.state==='active')!;
    const plane=createFlightAircraft(player,m.playerTeam), position=new Vector3(), rotation=new Quaternion();
    getFlightCameraPose(plane,'easy',position,rotation);
    const point=new Vector3(0,Math.sign(pitch)*.6*500*Math.tan(FLIGHT_FOV*Math.PI/360),-500).applyQuaternion(rotation).add(position);
    for (const unit of m.units) if (unit.team !== m.playerTeam && unit.kind === 'aircraft') unit.position={x:4000,y:300,z:2500};
    enemy.position={x:point.x,y:point.y,z:point.z};
    stepBattle(game,{...NEUTRAL_INPUT,viewAspect:393/852});
    assert.equal(game.terrainAvoidanceActive,false);
    assert.ok((player.pitch-pitch)*pitch>0,'must not pitch toward horizontal before tracking');
    const beforeManual = player.pitch;
    stepBattle(game,{...NEUTRAL_INPUT,turn:.1,viewAspect:393/852});
    assert.equal(game.terrainAvoidanceActive,false);
    assert.ok(Math.abs(player.pitch-beforeManual)<.002,'turn-only input without steeringActive must release absolute pitch history');
  }
});
