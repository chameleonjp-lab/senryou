import './style.css';
import './control-settings.css';
import { FlightControls } from './input';
import { ControlSettings } from './control-settings';
import {reservationPhase} from './hud-notification-reservations';
import { KeyboardSettings, ControlInputPresentation } from './keyboard-settings';
import { RulesGuide } from './rules-guide';
import { BattleView } from './battle-view';
import { BattleAudio } from './battle-audio';
import { createBattle, stepBattle, battleHash, NEUTRAL_INPUT, type BattleGame } from './battle/simulation';
import { rosterCounts } from './battle/roster';
import { supplyConnections } from './battle/capture';
import { scoreSnapshot } from './battle/scoring';
import { terrainHeight } from './battle/terrain';
import { validateGroundRoutes } from './battle/ground-nav';
import { predictBombImpact } from './battle/combat';
import { opposite, KINDS } from './battle/rules';
import type { Team, UnitKind } from './battle/types';
import type { FlightInput, GameMode } from './types';

const el = <T extends HTMLElement=HTMLElement>(id:string):T => {
  const node=document.getElementById(id); if(!node)throw new Error(`Missing UI: ${id}`); return node as T;
};
const app=el('app'), canvas=el<HTMLCanvasElement>('flight'), overlay=el<HTMLCanvasElement>('markers');
let mode:GameMode='easy', game=createBattle(1,mode), screen:'home'|'playing'|'paused'|'result'='home';
game.mission.phase='paused';
let view:BattleView|null=null, ready=false, lost=false, disposed=false;
let accumulator=0,lastFrame=0,frameId=0,lastPilot:string|null=null, pendingLoop=false,pendingBomb=false;
const intervals:number[]=[],updates:number[]=[];
const buttons={fire:el<HTMLButtonElement>('fire'),loop:el<HTMLButtonElement>('loop'),throttle:el<HTMLElement>('throttle'),
  bomb:el<HTMLButtonElement>('bomb')};
for(const b of Object.values(buttons))b.dataset.flightControl='true';
const keyboard=new KeyboardSettings(), presentation=new ControlInputPresentation();
const settings=new ControlSettings(buttons,keyboard,presentation,()=>{controls.clear();pendingLoop=false;pendingBomb=false;});
let rules:RulesGuide;
const controls=new FlightControls(canvas,buttons,()=>screen==='playing'&&game.mission.phase==='running'&&game.mission.playerStatus==='flying'&&!settings.isOpen&&!rules?.isOpen,keyboard);
const audio=new BattleAudio();
rules=new RulesGuide(()=>({mode,input:presentation.value,keyboardDescription:keyboard.describe(mode)}),()=>controls.clear());
function instructions():void{
  app.dataset.mode=mode;app.dataset.input=presentation.value;
  controls.setMode(mode); settings.setActiveMode(mode);
  el('normal-controls').hidden=mode!=='normal';el('hud-mode').textContent=mode==='easy'?'イージー':'ノーマル';
  const touch=presentation.value==='touch';
  el('input-guide').textContent=touch?'画面をドラッグして操縦':'キーボードで操縦';
  el('flight-tip').textContent=touch?'ドラッグで操縦':'キーで操縦';
  el('mode-guide').textContent=mode==='easy'?'照準円内・1.2km以内へ自動射撃 · 爆弾は手動投下':'手動射撃 · 速度レバーは上で加速・下で減速、離すと速度を保持';
  el('keyboard-guide').hidden=touch;el('keyboard-guide').textContent=keyboard.describe(mode);
}
const unsubscribeKeyboard=keyboard.subscribe(instructions),unsubscribePresentation=presentation.subscribe(instructions);
instructions();
function sound():void{
  audio.sync(screen==='playing'&&game.mission.phase==='running'&&!document.hidden,game.pilot?.speed);
  el('home-sound').textContent=audio.enabled?'音をオフにする':'音をオンにする';
  el('game-sound').textContent=audio.enabled?'音 ON':'音 OFF';
  for(const id of ['home-sound','game-sound']){
    el(id).setAttribute('aria-pressed',String(audio.enabled));
    el(id).setAttribute('aria-label',audio.enabled?'音をオフにする':'音をオンにする');
  }
}
function setScreen(next:typeof screen):void{
  settings.close();rules.close();controls.clear();pendingLoop=false;pendingBomb=false;audio.stop();
  screen=next;app.dataset.screen=next;
  el('home').hidden=next!=='home';el('hud').hidden=next!=='playing'&&next!=='paused';
  el('pause-screen').hidden=next!=='paused';el('result').hidden=next!=='result';
  const focus=next==='home'?'start':next==='paused'?'resume':next==='result'?'retry':'flight';
  el(focus).focus({preventScroll:true});sound();
}
function begin(seed=1):void{
  if(!ready||lost||document.hidden||settings.isOpen||rules.isOpen)return;
  game=createBattle(seed,mode);lastPilot=game.mission.controlledAircraftId;
  accumulator=0;lastFrame=0;intervals.length=0;updates.length=0;el('announcement').textContent='';
  instructions();setScreen('playing');hud();view?.render(game.mission,mode,game.combat,true);
}
function pause(reason='作戦時間と戦況も止まっています'):void{
  if(screen!=='playing')return;
  game.mission.phase='paused';accumulator=0;lastFrame=0;el('pause-reason').textContent=reason;setScreen('paused');
}
function resume():void{
  if(screen!=='paused'||!ready||lost||document.hidden||settings.isOpen||rules.isOpen)return;
  accumulator=0;lastFrame=0;controls.clear();game.mission.phase='running';setScreen('playing');
}
function home():void{game.mission.phase='paused';accumulator=0;lastFrame=0;setScreen('home');}
function graphicsFailure(reason:string):void{
  ready=false;pause(reason);controls.clear();audio.stop();
  el('resume').hidden=true;el('pause-reload').hidden=false;el<HTMLButtonElement>('start').disabled=true;
  el('startup-error').hidden=false;el('startup-error').textContent=reason;el('reload').hidden=false;
}
function abort():void{
  if(screen!=='playing'&&screen!=='paused')return;
  game.mission.phase='running';stepBattle(game,NEUTRAL_INPUT,true);result();
}
function time(seconds:number):string{
  const t=Math.max(0,Math.floor(seconds));return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
}
function forces(team:Team):Record<UnitKind,number>{return Object.fromEntries(KINDS.map(k=>{const c=rosterCounts(game.mission,team,k);return[k,c.reserve+c.pending+c.active];})) as Record<UnitKind,number>;}
function forceText(n:Record<UnitKind,number>):string{return `歩${n.infantry} · 戦${n.tank} · 対${n.aa} · 空${n.aircraft}`;}
function hud():void{
  const m=game.mission,player=m.units.find(u=>u.id===m.controlledAircraftId&&u.state==='active');
  const notificationPhase=reservationPhase(!!player,m.playerStatus);
  if(app.dataset.hudReservationPhase!==notificationPhase)app.dataset.hudReservationPhase=notificationPhase;
  el('timer').textContent=time(1200-m.tick/60);
  for(const [key,team] of [['friendly',m.playerTeam],['enemy',opposite(m.playerTeam)]] as const){
    const f=forces(team);el(`${key}-total`).textContent=String(Object.values(f).reduce((a,b)=>a+b,0));el(`force-${key}`).textContent=forceText(f);
  }
  el('health').textContent=player?String(Math.ceil(player.hp)):'—';el('health-bar').style.width=`${player?player.hp/80*100:0}%`;
  el('altitude').textContent=player?`${Math.round(player.position.y)}m`:'観戦';
  el('speed').textContent=player?`${Math.round(Math.hypot(player.velocity.x,player.velocity.y,player.velocity.z)*3.6)}km/h`:'—';
  el('allies-count').textContent=String(m.units.filter(u=>u.team===m.playerTeam&&u.kind==='aircraft'&&u.state==='active'&&u.role==='ai').length);
  el('score').textContent=String(scoreSnapshot(m).total);
  el('mg-ammo').textContent=String(player?.ammo??0);el('cannon-ammo').textContent=String(player?.cannonAmmo??0);
  const reload=player?Math.max(0,player.reloadUntil-m.tick)/60:0;
  el('reload-status').hidden=reload<=0;el('reload-status').textContent=`機銃・機関砲 装填 ${reload.toFixed(1)}秒`;
  const bombReload=player?Math.max(0,player.bombReloadUntil-m.tick)/60:0;
  el('bomb-ammo').textContent=bombReload?`装填 ${bombReload.toFixed(1)}秒`:`残り${player?.bombs??0}発`;
  el('loop-status').textContent=(player?.loopCooldown??0)>0?`待ち ${(player!.loopCooldown!).toFixed(1)}秒`:'すぐ使える';
  el('control-status').textContent=m.playerStatus==='flying'?'':`${m.playerStatus==='spectating'?'観戦':'復帰待ち'} · ${m.waitingReason}${m.respawnReadyTick&&m.tick<m.respawnReadyTick?` · ${((m.respawnReadyTick-m.tick)/60).toFixed(1)}秒`:''}`;
  if(m.groundAI?.warnings.length)el('control-status').textContent+=` 経路待機 ${m.groundAI.warnings.length}体 · ${m.groundAI.warnings[0].reason}`;
  const supply=supplyConnections(m.points);
  for(const point of m.points){
    const node=document.querySelector<HTMLElement>(`[data-point="${point.id}"]`)!;
    const connected=point.owner!=='N'&&supply[point.owner].has(point.id);
    node.textContent=`${point.id} ${point.owner}${point.contested?' ⚔':point.progress>0?` ${Math.floor(point.progress*100)}%`:''}${connected?' ↔':''}`;
    node.dataset.owner=point.owner;node.title=`${point.id} 所有${point.owner} ${point.contested?'競合':point.phase} ${connected?'供給接続':'供給未接続'}`;
  }
  const ground=m.units.filter(u=>u.state==='active'&&u.team!==m.playerTeam&&u.kind!=='aircraft').sort((a,b)=>
    (a.kind==='aa'?0:a.kind==='tank'?1:2)-(b.kind==='aa'?0:b.kind==='tank'?1:2)||a.id.localeCompare(b.id));
  el('support-target').textContent=ground[0]?`支援目標：${ground[0].kind==='aa'?'対空砲':ground[0].kind==='tank'?'戦車':'敵歩兵'} · ${ground[0].targetPointId??'前線'}`:'支援目標：前進する味方歩兵を守る';
  const guide=player?predictBombImpact(player):null;
  const effective=!!guide&&ground.some(u=>Math.hypot(u.position.x-guide.position.x,u.position.y-guide.position.y,u.position.z-guide.position.z)<60);
  view?.setBombGuide(guide?{position:guide.position,time:guide.time,effective}:null);
  el('bomb-hint').textContent=guide?`${effective?'有効圏':'地形着弾'} ${guide.time.toFixed(1)}秒`:'予測なし';
  el('payload-status').textContent=effective?'爆弾予測：敵地上軍の60m内 · 命中保証ではありません':'';
  const warnings:string[]=[];
  if(player){
    const aa=game.combat.aaWarnings.filter(w=>w.targetId===player.id);
    if(aa.length){const w=aa[0],angle=Math.atan2(w.position.x-player.position.x,w.position.z-player.position.z)*180/Math.PI;
      warnings.push(`対空 ${w.stage==='aiming'?'照準予告':'射撃中'} ${aa.length}門 · 方位${Math.round((angle+360)%360)}°`);}
    if(player.position.y-terrainHeight(player.position.x,player.position.z)<80)warnings.push('低空注意 · 機首を上げて');
    if(Math.abs(player.position.x)>4200||Math.abs(player.position.z)>2700||player.position.y>2200)warnings.push('空域境界 · 内側へ旋回');
  }
  el('warning').hidden=!warnings.length;el('warning').textContent=warnings.join(' / ');
}
function result():void{
  const r=game.mission.result;if(!r)return;
  el('result-title').textContent={victory:'勝利',defeat:'敗北',draw:'引分',aborted:'作戦中断'}[r.outcome];
  el('result-reason').textContent=r.reason;el('result-mode').textContent=mode==='easy'?'イージー':'ノーマル';
  el('result-time').textContent=time(r.tick/60);el('result-score').textContent=String(r.score.total);
  for(const key of ['kill','support','capture','time','loss'] as const)el(`result-score-${key}`).textContent=(key==='loss'?'−':'')+r.score[key].toLocaleString('ja-JP',{maximumFractionDigits:2});
  el('result-score-version').textContent=`${r.rulesVersion} · seed ${r.seed}`;
  el('result-ownership').textContent=Object.entries(r.owners).map(([id,owner])=>`${id} ${owner}`).join(' · ');
  el('result-friendly-forces').textContent=forceText(r.remaining[game.mission.playerTeam]);
  el('result-enemy-forces').textContent=forceText(r.remaining[opposite(game.mission.playerTeam)]);
  setScreen('result');
}
for(const id of ['start','retry','pause-restart'])el(id).addEventListener('click',()=>begin());
el('pause').addEventListener('click',()=>pause());el('resume').addEventListener('click',resume);
el('pause-end').addEventListener('click',abort);
for(const id of ['pause-home','result-home'])el(id).addEventListener('click',home);
for(const id of ['reload','pause-reload'])el(id).addEventListener('click',()=>location.reload());
for(const id of ['home-controls','pause-controls','result-controls'])el(id).addEventListener('click',()=>{
  controls.clear();pendingLoop=false;pendingBomb=false;settings.open(el(id),mode,screen!=='paused');
});
for(const id of ['home-rules','pause-rules'])el(id).addEventListener('click',()=>{controls.clear();pendingLoop=false;pendingBomb=false;rules.open(el(id));});
for(const id of ['home-sound','game-sound'])el(id).addEventListener('click',async()=>{audio.enabled=!audio.enabled;await audio.unlock();sound();});
for(const radio of document.querySelectorAll<HTMLInputElement>('input[name="game-mode"]'))radio.addEventListener('change',()=>{
  if(screen!=='home'||!radio.checked)return;mode=radio.value==='normal'?'normal':'easy';game=createBattle(1,mode);game.mission.phase='paused';instructions();
});
document.addEventListener('keydown',event=>{
  if(settings.isOpen||rules.isOpen)return;
  if(screen==='paused'&&event.key==='Tab'&&!event.ctrlKey&&!event.altKey&&!event.metaKey){
    const items=[...el('pause-screen').querySelectorAll<HTMLButtonElement>('button')].filter(b=>!b.hidden&&!b.disabled&&b.getClientRects().length>0);
    const i=items.indexOf(document.activeElement as HTMLButtonElement);
    const target=event.shiftKey?(i<=0?items.at(-1):null):(i<0||i===items.length-1?items[0]:null);
    if(target){event.preventDefault();target.focus();}
  }
  if(keyboard.matchesPause(event)&&(screen==='playing'||screen==='paused')){event.preventDefault();if(screen==='playing')pause();else resume();}
});
window.addEventListener('blur',()=>pause('画面の操作が離れたため停止しました'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause('画面が非表示になったため停止しました');});
window.addEventListener('resize',()=>{controls.clear();pendingLoop=false;pendingBomb=false;view?.resize();});
canvas.addEventListener('webglcontextlost',event=>{
  event.preventDefault();lost=true;graphicsFailure('描画が停止しました。再読み込みしてください');
});
canvas.addEventListener('webglcontextrestored',()=>{lost=true;el('announcement').textContent='描画の復旧には再読み込みが必要です';});
function frame(_timestamp:number):void{
  if(disposed)return;frameId=requestAnimationFrame(frame);
  const now=performance.now();
  const delta=lastFrame?Math.max(0,(now-lastFrame)/1000):0;lastFrame=now;
  const renderStatus=view?.pollRender(now);
  if(renderStatus==='failed'||renderStatus==='stalled'){
    graphicsFailure('描画処理が停止しました。再読み込みしてください');
    return;
  }
  if(screen==='playing'&&game.mission.phase==='running'){
    if(delta>0){intervals.push(delta*1000);if(intervals.length>20000)intervals.shift();}
    accumulator+=delta;
    if(accumulator>.5){pause('処理が遅れたため停止しました。描画負荷を下げて再開してください');return;}
    const sampled=controls.sample(false);pendingLoop ||= sampled.loop;pendingBomb ||= !!sampled.bomb;
    let ticks=0;
    while(accumulator>=1/60&&ticks<8&&game.mission.phase==='running'){
      const input={...sampled,throttle:controls.sampleThrottle(),loop:pendingLoop,bomb:pendingBomb,viewAspect:canvas.clientWidth/Math.max(1,canvas.clientHeight)};
      const start=performance.now();stepBattle(game,input);view?.queueEvents(game.combat.events,game.mission.id);updates.push(performance.now()-start);if(updates.length>20000)updates.shift();
      pendingLoop=false;pendingBomb=false;accumulator-=1/60;ticks++;
      if(lastPilot!==game.mission.controlledAircraftId){controls.clear();lastPilot=game.mission.controlledAircraftId;sampled.turn=0;sampled.climb=0;sampled.fire=false;sampled.accelerate=false;sampled.brake=false;sampled.throttle=0;}
      if(game.mission.result){result();break;}
    }
    hud();sound();
  }
  try { view?.render(game.mission,mode,game.combat,screen==='playing'||screen==='paused',delta); }
  catch(error){
    graphicsFailure('描画に失敗しました。再読み込みしてください');el('announcement').textContent=error instanceof Error?error.message:'描画エラー';
  }
}
async function prepare():Promise<void>{
  let preparationTimer:ReturnType<typeof setTimeout>|undefined;
  try{
    const nav=validateGroundRoutes();if(!nav.valid)throw new Error(`地上経路の検証に失敗: ${nav.errors.join(' / ')}`);
    view=new BattleView(canvas,overlay);
    await Promise.race([view.prepare(),new Promise<never>((_,reject)=>{preparationTimer=setTimeout(()=>reject(new Error('描画の準備が完了しませんでした。再読み込みしてください')),30000);})]);
    if(lost||disposed)throw new Error('描画の準備が中断されました。再読み込みしてください');
    view.render(game.mission,mode,game.combat,false);
    ready=true;el<HTMLButtonElement>('start').disabled=false;el('start').textContent='出撃する';frameId=requestAnimationFrame(frame);
  }catch(error){ready=false;el('startup-error').hidden=false;el('startup-error').textContent=`開始できません: ${error instanceof Error?error.message:String(error)}`;el('reload').hidden=false;view?.dispose();view=null;}
  finally{if(preparationTimer!==undefined)clearTimeout(preparationTimer);}
}
function dispose():void{disposed=true;cancelAnimationFrame(frameId);controls.dispose();settings.dispose();rules.dispose();unsubscribeKeyboard();unsubscribePresentation();presentation.dispose();audio.dispose();view?.dispose();}
window.addEventListener('pagehide',event=>{if(!event.persisted)dispose();else pause();});
// Explicit opt-in harness, stripped from production builds by Vite.
if(import.meta.env.DEV){
  Object.defineProperty(window,'__senryou',{value:{
    get game(){return game;},get mission(){return game.mission;},get view(){return view;},begin,pause,resume,abort,home,
    snapshot:()=>({screen,ready,lost,mode,mission:game.mission,hash:battleHash(game),diagnostics:view?.diagnostics(),intervals:[...intervals],updates:[...updates]}),
    step:(count=1,input:FlightInput=NEUTRAL_INPUT)=>{for(let i=0;i<count&&game.mission.phase==='running';i++){stepBattle(game,input);view?.queueEvents(game.combat.events,game.mission.id);}hud();if(game.mission.result)result();view?.render(game.mission,mode,game.combat,screen!=='home');},
    fixture:(name:string)=>{if(name==='home')home();else if(name==='pause'){begin();pause();}else if(name==='result'){begin();abort();}else{mode=name==='normal'?'normal':'easy';begin();}},
  }});
}
void prepare();
