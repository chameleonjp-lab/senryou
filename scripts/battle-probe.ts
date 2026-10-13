import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createBattle,stepBattle,battleHash} from '../src/battle/simulation';
import {MAX_TICKS} from '../src/battle/rules';
import {RUNTIME_CLEANUP_TICKS} from '../src/battle/runtime-maintenance';
const game=createBattle(1,'easy','A',true), m=game.mission, started=performance.now();
let lastCombat=0,maxQuiet=0,hqApproaches=new Set<string>(), maxWarnings=0, maxActive=0;
const cleanupSamples:{tick:number;airAI:number;aa:number;turrets:number;previousPositions:number}[]=[];
for(let i=0;i<MAX_TICKS&&!m.result;i++){
 const before=m.score.damage.length;stepBattle(game);
 if(m.score.damage.length>before)lastCombat=m.tick;else maxQuiet=Math.max(maxQuiet,m.tick-lastCombat);
 maxWarnings=Math.max(maxWarnings,m.groundAI?.warnings.length??0);
 if(m.tick%RUNTIME_CLEANUP_TICKS===0||m.result){
  const active=new Set(m.units.filter(u=>u.state==='active'&&u.hp>0).map(u=>u.id));
  for(const cache of [game.combat.air.units,game.combat.aa,game.combat.turrets,game.combat.previousPositions])
   assert.ok([...cache.keys()].every(id=>active.has(id)),`stale unit cache at tick ${m.tick}`);
  cleanupSamples.push({tick:m.tick,airAI:game.combat.air.units.size,aa:game.combat.aa.size,turrets:game.combat.turrets.size,previousPositions:game.combat.previousPositions.size});
 }
 if(m.tick%60===0){
  maxActive=Math.max(maxActive,m.units.filter(u=>u.state==='active').length);
  for(const u of m.units)if(u.kind==='infantry'&&u.state==='active'){
   const p=m.points.find(p=>p.homeTeam&&p.homeTeam!==u.team)!;
   if(Math.hypot(u.position.x-p.position.x,u.position.z-p.position.z)<=100)hqApproaches.add(u.team);
  }
 }
 if(m.tick%6000===0)console.log(JSON.stringify({tick:m.tick,wallSeconds:Math.round((performance.now()-started)/1000),owners:m.points.map(p=>[p.id,p.owner]),damage:m.score.damage.length,deaths:m.score.deaths.size,warnings:m.groundAI?.warnings.length}));
}
assert.ok(m.result&&m.tick<=MAX_TICKS,'mission must finish within ten minutes');
const out={sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),kind:'single AI-only diagnostic; not 30-seed acceptance or phone/GPU performance measurement',seed:1,mode:'easy',team:'A',ticks:m.tick,wallMs:Math.round(performance.now()-started),result:m.result,hash:battleHash(game),damage:m.score.damage.length,deaths:m.score.deaths.size,maxQuietTicks:maxQuiet,hqApproaches:[...hqApproaches],maxWarnings,finalWarnings:m.groundAI?.warnings.length,maxActive,controlEnabled:m.controlEnabled,controlledAircraftId:m.controlledAircraftId,cleanupSamples,inputHistory:game.inputs.length,owners:m.points.map(p=>[p.id,p.owner]),remaining:m.units.reduce((a,u)=>{a[u.state]=(a[u.state]??0)+1;return a},{} as Record<string,number>)};
const output=process.env.SENRYOU_PROBE_OUTPUT??'docs/evidence/single-battle-probe.json';
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({ticks:out.ticks,wallMs:out.wallMs,outcome:out.result?.outcome,reason:out.result?.reason,damage:out.damage,deaths:out.deaths,maxQuietTicks:out.maxQuietTicks,hqApproaches:out.hqApproaches,finalWarnings:out.finalWarnings,cleanupChecks:cleanupSamples.length,inputHistory:out.inputHistory}));
