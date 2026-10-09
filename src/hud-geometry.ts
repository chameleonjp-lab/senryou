import {hudSightReservation} from './hud-sight-reservation';
import {controlLayoutSize,type ControlObstacle} from './control-obstacles';
import {notificationHidden,READY_CONTROL_TEXT,reservationStatesForFamily,reservationFamily,type HudReservationPhase} from './hud-notification-reservations';
import {radarCanvasMetrics} from './battle-view';

export function controlFootprintId(element:{id:string}):string|undefined {return ['fire','loop','bomb','throttle'].includes(element.id)?element.id:undefined;}

export interface HudGeometry { obstacles:ControlObstacle[]; controls:Record<string,{width:number;height:number}>; complete:boolean; notification:{family:string;topHeight:number;sharedHeight:number;states:string[]} }
export function measureHudGeometry(app: HTMLElement,mode:'normal'|'easy'='normal'): HudGeometry {
  const hud = app.querySelector<HTMLElement>('#hud');
  const rect = controlLayoutSize(app);
  if (!hud || typeof app.cloneNode !== 'function' || !(rect.width > 0 && rect.height > 0)) return {obstacles:[],controls:{},complete:false,notification:{family:'unknown',topHeight:0,sharedHeight:0,states:[]}};
  const host = app.cloneNode(false) as HTMLElement;
  host.removeAttribute('hidden');
  host.classList.add('playing'); host.classList.remove('easy-mode');
  host.dataset.phase = 'playing'; host.dataset.mode = mode; host.dataset.screen = 'playing';
  host.inert = true; host.setAttribute('aria-hidden', 'true');
  for (const [property,value] of Object.entries({ position:'fixed', left:'-100000px', top:'0', right:'auto', bottom:'auto', width:`${rect.width}px`, height:`${rect.height}px`, minWidth:'0', maxWidth:'none', minHeight:'0', maxHeight:'none', margin:'0', transform:'translateZ(0)', visibility:'hidden', pointerEvents:'none' })) {
    host.style.setProperty(property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`),value,'important');
  }
  const copy = hud.cloneNode(true) as HTMLElement;
  copy.removeAttribute('hidden');
  const modeLabel=copy.querySelector('#hud-mode');if(modeLabel)modeLabel.textContent=mode==='normal'?'ノーマル':'イージー';
  copy.querySelector('#normal-controls')?.removeAttribute('hidden');
  for(const el of copy.querySelectorAll<HTMLElement>('[data-flight-control]')){el.style.setProperty('--control-size','44px');el.style.setProperty('--control-height','44px');}
  host.append(copy);
  app.parentElement?.append(host);
  try {
    if (!host.isConnected) return {obstacles:[],controls:{},complete:false,notification:{family:'unknown',topHeight:0,sharedHeight:0,states:[]}};
    const origin = host.getBoundingClientRect();
    const scaleX = rect.width / origin.width, scaleY = rect.height / origin.height;
    const controls:HudGeometry['controls']={};
    const phase:HudReservationPhase=app.dataset.hudReservationPhase==='waiting'?'waiting':app.dataset.hudReservationPhase==='spectating'?'spectating':'flying';
    const states=reservationStatesForFamily(phase),top=copy.querySelector<HTMLElement>('.hud-notice-top'),shared=copy.querySelector<HTMLElement>('.hud-notice-shared');
    let topHeight=0,sharedHeight=0;
    const measureControls=()=>{for(const el of copy.querySelectorAll<HTMLElement>('[data-flight-control]')){const id=controlFootprintId(el),b=el.getBoundingClientRect();if(id&&b.width>0&&b.height>0)controls[id]={width:Math.max(controls[id]?.width??0,b.width*scaleX),height:Math.max(controls[id]?.height??0,b.height*scaleY)};}};
    // Include current labels as well as all source-valid family variants. Ready
    // Japanese text can be wider than a short numeric countdown in some fonts.
    measureControls();
    if(top)top.style.minHeight='0px';if(shared)shared.style.minHeight='0px';
    for(const state of states){
      for(const [id,text]of [['warning',state.warning],['reload-status',state.reload],['payload-status',state.payload],['control-status',state.status]] as const){const el=copy.querySelector<HTMLElement>('#'+id);if(el){el.textContent=text;el.hidden=notificationHidden(id,text);}}
      for(const [id,text]of [['loop-status',state.loop],['bomb-ammo',state.bombAmmo],['bomb-hint',state.bombHint]] as const){const el=copy.querySelector<HTMLElement>('#'+id);if(el)el.textContent=text;}
      topHeight=Math.max(topHeight,(top?.getBoundingClientRect().height??0)*scaleY);sharedHeight=Math.max(sharedHeight,(shared?.getBoundingClientRect().height??0)*scaleY);measureControls();
    }
    for(const [id,text]of [['loop-status',READY_CONTROL_TEXT.loop],['bomb-ammo',READY_CONTROL_TEXT.bombAmmo],['bomb-hint',READY_CONTROL_TEXT.bombHint]] as const){const el=copy.querySelector<HTMLElement>('#'+id);if(el)el.textContent=text;}
    measureControls();
    host.style.setProperty('--hud-notice-top-height',`${topHeight}px`);host.style.setProperty('--hud-notice-shared-height',`${sharedHeight}px`);
    if(top)top.style.minHeight=`${topHeight}px`;if(shared)shared.style.minHeight=`${sharedHeight}px`;
    const obstacles=[...copy.querySelectorAll<HTMLElement>('.time-block,.targets,.flight-data,.capture-info,.hud-notice-top,.hud-notice-shared,#ally-announcements:not(:empty),#flight-tip')]
      .filter(element => !element.hidden && !element.closest('[hidden]'))
      .map(element => element.getBoundingClientRect())
      .filter(item => item.width > 0 && item.height > 0)
      .map(item => ({ x:(item.left-origin.left+item.width/2)*scaleX, y:(item.top-origin.top+item.height/2)*scaleY, width:item.width*scaleX, height:item.height*scaleY }));
    // Keep the aircraft/sight corridor free of automatically relocated controls.
    obstacles.push(hudSightReservation(mode,rect.width,rect.height));
    // Reserve the exact measured product Canvas radar bounds as a flight-control obstacle.
    const radar=radarCanvasMetrics(rect.width,rect.height);
    obstacles.push({x:radar.x,y:radar.y,width:2*(radar.radius+.5),height:2*(radar.radius+.5)});
    const required=[...copy.querySelectorAll<HTMLElement>('.time-block,.targets,.flight-data,.capture-info')];
    const complete=['fire','loop','bomb','throttle'].every(id=>!!controls[id])&&required.length===4&&required.every(el=>el.offsetWidth>0&&el.offsetHeight>0);
    return {obstacles,controls,complete,notification:{family:reservationFamily(phase),topHeight,sharedHeight,states:states.map(s=>s.id)}};
  } finally { host.remove(); }
}
