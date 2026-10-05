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
