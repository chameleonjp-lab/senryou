import {controlLayoutSize,type ControlObstacle} from './control-obstacles';

export function controlFootprintId(element:{id:string}):string|undefined {return ['fire','loop','bomb','throttle'].includes(element.id)?element.id:undefined;}

export interface HudGeometry { obstacles:ControlObstacle[]; controls:Record<string,{width:number;height:number}>; complete:boolean }
export function measureHudGeometry(app: HTMLElement,mode:'normal'|'easy'='normal'): HudGeometry {
  const hud = app.querySelector<HTMLElement>('#hud');
  const rect = controlLayoutSize(app);
  if (!hud || typeof app.cloneNode !== 'function' || !(rect.width > 0 && rect.height > 0)) return {obstacles:[],controls:{},complete:false};
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
  // Reserve stable content widths for normal cooldown/reload text. The live
  // labels are never replaced; only this detached measurement copy is used.
  for(const [id,text] of [['loop-status','待ち 2.0秒'],['bomb-ammo','装填 20.0秒'],['bomb-hint','地形着弾 15.0秒']]){
    const el=copy.querySelector<HTMLElement>('#'+id);if(el&&el.textContent!.length<=text.length)el.textContent=text;
  }
  host.append(copy);
  app.parentElement?.append(host);
  try {
    if (!host.isConnected) return {obstacles:[],controls:{},complete:false};
    const origin = host.getBoundingClientRect();
    const scaleX = rect.width / origin.width, scaleY = rect.height / origin.height;
    const controls:HudGeometry['controls']={};
    for(const el of copy.querySelectorAll<HTMLElement>('[data-flight-control]')){const id=controlFootprintId(el),b=el.getBoundingClientRect();if(id&&b.width>0&&b.height>0)controls[id]={width:b.width*scaleX,height:b.height*scaleY};}
    const obstacles=[...copy.querySelectorAll<HTMLElement>('.time-block,.targets,.flight-data,.capture-info,#ally-announcements:not(:empty),#payload-status:not(:empty),#reload-status:not([hidden]),#warning:not([hidden]),#flight-tip')]
      .filter(element => !element.hidden && !element.closest('[hidden]'))
      .map(element => element.getBoundingClientRect())
      .filter(item => item.width > 0 && item.height > 0)
      .map(item => ({ x:(item.left-origin.left+item.width/2)*scaleX, y:(item.top-origin.top+item.height/2)*scaleY, width:item.width*scaleX, height:item.height*scaleY }));
    // Keep the aircraft/sight corridor free of automatically relocated controls.
    const radius=Math.min(rect.width,rect.height)*.135+8;
    obstacles.push({x:rect.width/2,y:rect.height/2,width:radius*2,height:radius*2});
    const required=[...copy.querySelectorAll<HTMLElement>('.time-block,.targets,.flight-data,.capture-info')];
    const complete=['fire','loop','bomb','throttle'].every(id=>!!controls[id])&&required.length===4&&required.every(el=>el.offsetWidth>0&&el.offsetHeight>0);
    return {obstacles,controls,complete};
  } finally { host.remove(); }
}

