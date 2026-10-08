import { FlightControls } from '/src/input';
import { ControlSettings } from '/src/control-settings';
import { reservationPhase } from '/src/hud-notification-reservations';
import { KeyboardSettings, ControlInputPresentation } from '/src/keyboard-settings';
import { RulesGuide } from '/src/rules-guide';
import { opposite, KINDS } from '/src/battle/rules';
import { createProductOverlay } from 'virtual:senryou-canvas';
import { makeSample, resultSample, assertFixtureId, type DisplaySample } from '/browser-tests/ui-only/samples';
import type { GameMode } from '/src/types';
import type { Team, UnitKind, Mission, Unit } from '/src/battle/types';
export function mountProductUi(){
 const el=<T extends HTMLElement=HTMLElement>(id:string):T=>{const node=document.getElementById(id);if(!node)throw new Error(`Missing UI: ${id}`);return node as T;};
 const app=el('app'),canvas=el<HTMLCanvasElement>('flight'),overlay=el<HTMLCanvasElement>('markers');
 let mode:GameMode='easy',sample:DisplaySample=makeSample('ready'),game=sample.game,screen:'home'|'playing'|'paused'|'result'='home';
 let ready=true,lost=false,accumulator=0,lastFrame=0,lastPilot:string|null=null,pendingLoop=false,pendingBomb=false;
 const intervals:number[]=[],updates:number[]=[],commands:string[]=[];
 // Fixed-data boundaries substitute only unavailable game/audio dependencies, never DOM/CSS/listeners.
 const createBattle=(_seed=1,_mode=mode)=>{sample=makeSample('ready');return sample.game;};
 const rosterCounts=(_m:unknown,team:Team,kind:UnitKind)=>({reserve:sample.forces[team][kind],pending:0,active:0});
 const supplyConnections=(_points:Mission['points'])=>({A:new Set(['HA','P1']),B:new Set(['HB','P5'])});
 const scoreSnapshot=(_mission:Mission)=>sample.score;
 const terrainHeight=(_x:number,_z:number)=>0;
 const predictBombImpact=(_player:Unit)=>sample.guide;
 const audio={enabled:false,sync(_active:boolean,_speed?:number){},stop(){},async unlock(){commands.push('sound-toggle');}};
 const view=createProductOverlay(overlay,()=>sample);
 const buttons={fire:el<HTMLButtonElement>('fire'),loop:el<HTMLButtonElement>('loop'),throttle:el<HTMLElement>('throttle'),bomb:el<HTMLButtonElement>('bomb')};
 for(const b of Object.values(buttons))b.dataset.flightControl='true';
 const keyboard=new KeyboardSettings(),presentation=new ControlInputPresentation();
 const settings=new ControlSettings(buttons,keyboard,presentation,()=>{controls.clear();pendingLoop=false;pendingBomb=false;});
 let rules:RulesGuide;
 const controls=new FlightControls(canvas,buttons,()=>screen==='playing'&&game.mission.phase==='running'&&game.mission.playerStatus==='flying'&&!settings.isOpen&&!rules?.isOpen,keyboard);
 rules=new RulesGuide(()=>({mode,input:presentation.value,keyboardDescription:keyboard.describe(mode)}),()=>controls.clear());
 function abort(){commands.push('end-display-request');game.mission.result=resultSample('aborted');result();}
 /* PRODUCT_FUNCTIONS */
 /* PRODUCT_EVENTS */
 const unsubscribeKeyboard=keyboard.subscribe(instructions),unsubscribePresentation=presentation.subscribe(instructions);
 let presentationFlushes=0;
 function flush(){hud();view.render(game.mission,mode,game.combat,screen==='playing'||screen==='paused');presentationFlushes++;}
 const queueFlush=()=>queueMicrotask(flush);
 for(const event of ['click','change','keydown','keyup'])document.addEventListener(event,queueFlush);
 app.addEventListener('close',queueFlush,true);window.addEventListener('resize',queueFlush);
 // One display-only flush follows an actual UI event; there is no continuous frame loop.
 instructions();sound();setScreen('home');el<HTMLButtonElement>('start').disabled=false;el('start').textContent='出撃する';
 function show(id:string,nextMode:GameMode='normal'){
  assertFixtureId(id);if(nextMode!=='easy'&&nextMode!=='normal')throw new Error('Unknown UI mode: '+nextMode);
  settings.close();rules.close();controls.clear();mode=nextMode;sample=makeSample(id);game=sample.game;ready=true;lost=false;
  el('resume').hidden=false;el('pause-reload').hidden=true;el('startup-error').hidden=true;el('reload').hidden=true;el<HTMLButtonElement>('start').disabled=false;
  el('announcement').textContent='';instructions();
  for(const radio of document.querySelectorAll<HTMLInputElement>('input[name="game-mode"]'))radio.checked=radio.value===mode;
  if(id==='home'){setScreen('home');}
  else if(id.startsWith('result-')){game.mission.result=resultSample(id.slice(7));result();}
  else if(id==='startup-error'){setScreen('home');graphicsFailure('開始できません: 描画を初期化できませんでした。再読み込みしてください');}
  else if(id==='paused-error'){setScreen('playing');graphicsFailure('描画が停止しました。再読み込みしてください');}
  else if(id==='pause'){setScreen('playing');pause();}
  else if(id==='rules'){setScreen('home');rules.open(el('home-rules'));}
  else if(id.startsWith('settings-')){setScreen('home');settings.open(el('home-controls'),mode,true);el(id==='settings-keyboard'?'control-editor-keyboard':'control-editor-touch').click();}
  else {setScreen('playing');}
  flush();
  return {id,screen,mode};
 }
 return {show,commands,snapshot:()=>({screen,mode,settings:settings.isOpen,rules:rules.isOpen,scope:'UI display samples, no gameplay evidence',canvasTextScale:1,presentationFlushes}),
  input:()=>controls.peek(),dispose:()=>{controls.dispose();settings.dispose();rules.dispose();unsubscribeKeyboard();unsubscribePresentation();presentation.dispose();}};
}
