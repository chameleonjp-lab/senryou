import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3,Quaternion } from 'three';
import { BattlePresentation } from '../src/battle-presentation';
import { createBattle,stepBattle,battleHash } from '../src/battle/simulation';
import { createFlightAircraft } from '../src/battle-flight';
import { getFlightCameraPose } from '../src/flight-view';
const input={turn:0,climb:.45,fire:false,loop:false,steeringActive:true};
for(const mode of ['easy','normal'] as const)test(`${mode}: 120Hz sampled camera has no repeated direction and sampling does not change flight`,()=>{
 const g=createBattle(73,mode),p=g.mission.units.find(u=>u.id===g.mission.controlledAircraftId)!;p.position={x:0,y:1500,z:0};p.heading=0;p.pitch=0;p.bank=0;
 const presentation=new BattlePresentation();let previous:Vector3|undefined,repeats=0;
 for(let frame=1;frame<=52;frame++){
  if(frame%2===0){presentation.capture(g.mission);stepBattle(g,input);}
  const hash=battleHash(g),sample=presentation.sample(g.mission,frame%2===0?0:.5),plane=createFlightAircraft(sample.units.find(u=>u.id===p.id)!,sample.playerTeam),pos=new Vector3(),q=new Quaternion();
  getFlightCameraPose(plane,mode,pos,q);const forward=new Vector3(0,0,-1).applyQuaternion(q);
  if(frame>4&&previous&&previous.distanceTo(forward)<1e-12)repeats++;previous=forward;assert.equal(battleHash(g),hash);
 }
 assert.equal(repeats,0);
});
test('start, pause, resume, death and pilot handoff never blend stale poses',()=>{
 const g=createBattle(73,'normal'),presentation=new BattlePresentation(),p=g.mission.units.find(u=>u.id===g.mission.controlledAircraftId)!;p.position={x:0,y:1500,z:0};
 assert.equal(presentation.sample(g.mission,0),g.mission);presentation.capture(g.mission);stepBattle(g,input);
 const sampled=presentation.sample(g.mission,0);assert.notEqual(sampled,g.mission);assert.equal(sampled.units.find(u=>u.id===p.id)!.position.y,1500);
 p.hp=0;assert.equal(presentation.sample(g.mission,.5).units.find(u=>u.id===p.id),p);p.hp=80;
 g.mission.phase='paused';assert.equal(presentation.sample(g.mission,.5),g.mission);g.mission.phase='running';assert.equal(presentation.sample(g.mission,.5),g.mission);
 presentation.capture(g.mission);stepBattle(g,input);g.mission.controlledAircraftId=null;assert.equal(presentation.sample(g.mission,.5),g.mission);
 presentation.reset();assert.equal(presentation.sample(g.mission,.5),g.mission);
});

test('new units and projectiles use their own presentation interval without mutating combat',()=>{
 const g=createBattle(73,'normal'),presentation=new BattlePresentation();presentation.capture(g.mission);
 const born={...g.mission.units.find(u=>u.kind==='aircraft')!,id:'new-aircraft',position:{x:20,y:1500,z:40}};g.mission.units.push(born);g.mission.tick++;
 assert.equal(presentation.sample(g.mission,.5).units.find(u=>u.id===born.id),born);
 const rounds=[{id:1,previous:{x:0,y:2,z:4},position:{x:10,y:12,z:14}}],copy=structuredClone(rounds);
 assert.deepEqual(presentation.sampleProjectiles(rounds,.5)[0].position,{x:5,y:7,z:9});assert.deepEqual(rounds,copy);
});

import { BattleView } from '../src/battle-view';
test('reticle entry, exit and target ID switch use the sampled display phase at alpha 0, half and 1',()=>{
 for(const mode of ['easy','normal'] as const)for(const transition of ['entry','exit','id-switch']){
  const g=createBattle(73,mode),p=g.mission.units.find(u=>u.id===g.mission.controlledAircraftId)!,targets=g.mission.units.filter(u=>u.kind==='aircraft'&&u.team!==p.team&&u.state==='active').slice(0,transition==='id-switch'?2:1);
  p.position={x:0,y:1500,z:0};p.heading=0;p.pitch=0;p.bank=0;g.mission.units=[p,...targets];
  const plane=createFlightAircraft(p,g.mission.playerTeam),origin=new Vector3(),q=new Quaternion();getFlightCameraPose(plane,mode,origin,q);
  const base=mode==='easy'?new Vector3(0,0,-500).applyQuaternion(q).add(origin):new Vector3(0,1500,-500),right=new Vector3(1,0,0).applyQuaternion(q),at=(x:number)=>{const v=base.clone().addScaledVector(right,x);return{x:v.x,y:v.y,z:v.z};};
  const outside=transition==='id-switch'?300:mode==='normal'?100:150;
  for(const [i,t]of targets.entries())t.position=at(transition==='entry'||i===1?outside:0);
  const presentation=new BattlePresentation();presentation.capture(g.mission);
  for(const [i,t]of targets.entries())t.position=at(transition==='entry'||i===1?0:outside);g.mission.tick++;
  if(g.controller)g.controller.targetLock.key='enemy:current-target';
  const actual=[];
  for(const alpha of[0,.5,1]){
   let color='';const ctx=new Proxy({canvas:{},fillStyle:'',fillRect(_x:number,_y:number,w:number,h:number){if(w===2&&h===2)color=this.fillStyle;}},{get:(o:any,k)=>k in o?o[k]:()=>{}});
   const sampled=presentation.sample(g.mission,alpha),view=Object.create(BattleView.prototype) as any;Object.assign(view,{ctx,width:874,height:402,flightPlayer:createFlightAircraft(sampled.units[0],sampled.playerTeam),drawBombGuide(){},drawTargets(){},drawAAWarnings(){},drawBoundaryWarning(){},drawPointLabels(){},drawRadar(){}});
   view.drawOverlay(sampled,mode,undefined,true);actual.push(color);
  }
  const expected=transition==='entry'?['#ffffff','#ff645b','#ff645b']:transition==='exit'?['#ff645b','#ff645b','#ffffff']:['#ff645b','#ffffff','#ff645b'];assert.deepEqual(actual,expected,`${mode}/${transition}`);
 }
});

import { readFileSync } from 'node:fs';
import ts from 'typescript';
test('actual main pause and resume discard old poses even with no intervening render',()=>{
 const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
 const selected=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&['setScreen','pause','resume'].includes(node.name?.text??'')).map(node=>node.getText(ast)).join('\n');
 assert.equal(selected.match(/function /g)?.length,3);
 const runtime=ts.transpileModule(selected,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const run=(body:string)=>new Function('flightPresentation','game',`let screen='playing',accumulator=.008,lastFrame=42,pendingLoop=false,pendingBomb=false;const ready=true,lost=false,document={hidden:false},app={dataset:{}},settings={isOpen:false,close(){}},rules={isOpen:false,close(){}},controls={clear(){}},audio={stop(){}},el=()=>({focus(){}}),sound=()=>{},clearBattleFlightAssistance=()=>{};${body};pause();resume();return flightPresentation.sample(game.mission,0);`);
 for(const [body,expectStale]of[[runtime,false],[runtime.replace('flightPresentation.reset();',''),true]] as const){
  const g=createBattle(73,'normal'),p=g.mission.units.find(u=>u.id===g.mission.controlledAircraftId)!;p.position={x:0,y:1500,z:0};const presentation=new BattlePresentation();presentation.capture(g.mission);stepBattle(g,input);
  const sampled=run(body)(presentation,g),shown=sampled.units.find((u:any)=>u.id===p.id)!;assert.equal(shown===p,!expectStale);assert.equal(shown.position.y===p.position.y,!expectStale);
 }
});

test('30, 60 and 120Hz sampling leaves identical authoritative flight, bullets, clock and outcomes',()=>{
 for(const mode of ['easy','normal'] as const){let expected:unknown;
  for(const hz of[30,60,120]){const g=createBattle(73,mode),p=g.mission.units.find(u=>u.id===g.mission.controlledAircraftId)!,presentation=new BattlePresentation();p.position={x:0,y:1500,z:0};p.heading=0;p.pitch=0;p.bank=0;let tick=0;
   for(let frame=1;frame<=hz*.4;frame++){const time=frame*60/hz;while(tick<Math.floor(time)){presentation.capture(g.mission);stepBattle(g,{...input,fire:true});tick++;}presentation.sample(g.mission,time-Math.floor(time));presentation.sampleProjectiles(g.combat.projectiles,time-Math.floor(time));}
   const result={hash:battleHash(g),tick:g.mission.tick,phase:g.mission.phase,projectiles:g.combat.projectiles.map(({missionId,...round})=>round)};expected??=result;assert.deepEqual(result,expected,`${mode}/${hz}`);
  }
 }
});
