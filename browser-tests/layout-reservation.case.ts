import {expect,test} from '@playwright/test';
import {installFrameDriver,prepareApp,advanceFrame,clickDom,readState} from './native-frame-driver';
import {installNetworkGuard,assertNoForbiddenTraffic,SMOKE_ORIGIN} from './network-guard';
import {createAssetManifest} from './asset-manifest.mjs';
import {text200,verifyText200} from './acceptance/observe-dom';
import {PROFILES,REGISTRY,ENVELOPES,inspectDiagnostic} from '../diagnostics/layout-reservation/contracts';
import type {BattleGame} from '../src/battle/simulation';
test('layout-reservation-diagnostic',async({browser},info)=>{
 const evidence:{kind:string;registry:typeof REGISTRY;productAcceptance:false;sources:string[];records:Record<string,unknown>[]}={kind:'detached-clone-layout-envelope-not-natural-gameplay',registry:REGISTRY,productAcceptance:false,sources:[...ENVELOPES.sources,...ENVELOPES.limitations],records:[]};
 try{for(const profile of PROFILES)for(const mode of ['easy','normal'] as const){
  const record:Record<string,unknown>={id:`${profile.id}:${mode}`,profile,mode,scenarios:[]};evidence.records.push(record);
  const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},serviceWorkers:'block'});let blocked:string[]=[];
  try{
   const guard=await installNetworkGuard(context,createAssetManifest());blocked=guard;
   const page=await context.newPage();const pageErrors:string[]=[],consoleErrors:string[]=[];record.pageErrors=pageErrors;record.consoleErrors=consoleErrors;page.on('pageerror',e=>pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});await installFrameDriver(page);await page.goto(SMOKE_ORIGIN+'/',{waitUntil:'domcontentloaded'});await prepareApp(page);
   await clickDom(page,`input[name="game-mode"][value="${mode}"]`);await clickDom(page,'#start');await advanceFrame(page,0);await advanceFrame(page,17);
   if(profile.text){record.scale=await text200(page);await advanceFrame(page,0);record.verifiedScale=await verifyText200(page);}
   const submitted=await readState(page);record.gpuTargetSubmitted=submitted.queue.submittedCount;await advanceFrame(page,0);
   const completed=await readState(page);expect(completed.queue.completedCount).toBeGreaterThanOrEqual(submitted.queue.submittedCount);record.nativeState=completed;expect(completed.screen).toBe('playing');
   record.scenarios=await page.evaluate(async({mode,envelopes})=>{
    const app=document.querySelector<HTMLElement>('#app')!,hud=app.querySelector<HTMLElement>('#hud')!,width=app.offsetWidth,height=app.offsetHeight;
    const game=(window as unknown as {__senryou:{game:BattleGame}}).__senryou.game;
    const modulePath='/src/gun-sight.ts';const {projectGunSight}=await import(modulePath) as typeof import('../src/gun-sight');
    if(mode==='normal'&&!game.pilot)throw new Error('Normal sight cannot be measured without the real tick-initialized pilot');
    const center=mode==='normal'?projectGunSight(game.pilot!,[],width,height):{x:width/2,y:height/2};
    const radius=mode==='normal'?Math.max(26,Math.min(38,Math.min(width,height)*.085)):Math.min(width,height)*.135;
    const sight={x:center.x,y:center.y,radius,margin:8};
    const rect=(r:DOMRect,origin:DOMRect)=>({x:r.x-origin.x,y:r.y-origin.y,width:r.width,height:r.height});
    type Rect={x:number;y:number;width:number;height:number};const overlap=(a:Rect,b:Rect)=>a.width>0&&a.height>0&&b.width>0&&b.height>0&&a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
    const collect=(host:HTMLElement,name:string,band:HTMLElement|null)=>{
     const origin=host.getBoundingClientRect();const elements=[...host.querySelectorAll<HTMLElement>('#hud *')];
     const nodes=elements.map((element,index)=>{
      const style=getComputedStyle(element),box=rect(element.getBoundingClientRect(),origin),fragments:{text:string;rect:Rect}[]=[],textNodes:{text:string;rangeCount:number;zeroRange:boolean;rects:Rect[]}[]=[];
      const client=(el:HTMLElement)=>{const b=rect(el.getBoundingClientRect(),origin),sx=el.offsetWidth?b.width/el.offsetWidth:1,sy=el.offsetHeight?b.height/el.offsetHeight:1;return {x:b.x+el.clientLeft*sx,y:b.y+el.clientTop*sy,width:el.clientWidth*sx,height:el.clientHeight*sy};};
      for(const node of element.childNodes)if(node.nodeType===Node.TEXT_NODE&&node.textContent?.trim()){
       const range=document.createRange();range.selectNodeContents(node);const rects=[...range.getClientRects()].map(b=>rect(b,origin));textNodes.push({text:node.textContent,rangeCount:rects.length,zeroRange:rects.length===0||rects.every(r=>r.width===0||r.height===0),rects});for(const r of rects)fragments.push({text:node.textContent,rect:r});
      }
      const clipAncestors=[];for(let a:HTMLElement|null=element;a&&a!==host.parentElement;a=a.parentElement){const as=getComputedStyle(a);if([as.overflowX,as.overflowY].some(v=>['hidden','clip','auto','scroll'].includes(v)))clipAncestors.push({id:a.id,overflowX:as.overflowX,overflowY:as.overflowY,box:rect(a.getBoundingClientRect(),origin),clientBox:client(a),clientLeft:a.clientLeft,clientTop:a.clientTop,clientWidth:a.clientWidth,clientHeight:a.clientHeight,scrollWidth:a.scrollWidth,scrollHeight:a.scrollHeight,scrollLeft:a.scrollLeft,scrollTop:a.scrollTop});}
      return {textNodes,clientBox:client(element),offsetWidth:element.offsetWidth,offsetHeight:element.offsetHeight,clientWidth:element.clientWidth,clientHeight:element.clientHeight,scrollWidth:element.scrollWidth,scrollHeight:element.scrollHeight,clipAncestors,index,id:element.id,tag:element.tagName,className:element.className,text:element.textContent??'',hidden:element.hidden,hiddenByAncestor:!!element.closest('[hidden]'),display:style.display,visibility:style.visibility,fontSize:style.fontSize,lineHeight:style.lineHeight,whiteSpace:style.whiteSpace,overflowX:style.overflowX,overflowY:style.overflowY,box,fragments};
     });
     const controls=elements.filter(e=>e.matches('[data-flight-control],#pause,#game-sound')).map(e=>({id:e.id,hidden:!!e.closest('[hidden]'),box:rect(e.getBoundingClientRect(),origin),minimum44:e.offsetWidth>=44&&e.offsetHeight>=44}));
     const conflicts:{kind:string;a:string;b:string;rect?:Rect}[]=[];
     const guarded={x:sight.x-sight.radius-sight.margin,y:sight.y-sight.radius-sight.margin,width:2*(sight.radius+sight.margin),height:2*(sight.radius+sight.margin)};
     for(const n of nodes)for(const f of n.fragments){if(f.rect.x<0||f.rect.y<0||f.rect.x+f.rect.width>width||f.rect.y+f.rect.height>height)conflicts.push({kind:'fragment-outside-viewport',a:n.id||`${n.tag}:${n.index}`,b:'viewport',rect:f.rect});for(const c of controls)if(!c.hidden&&c.id!==n.id&&!elements[n.index].closest('#'+c.id)&&overlap(f.rect,c.box))conflicts.push({kind:'control-over-text',a:c.id,b:n.id||`${n.tag}:${n.index}`,rect:f.rect});if(overlap(f.rect,guarded))conflicts.push({kind:'text-in-sight-reservation',a:n.id||`${n.tag}:${n.index}`,b:'sight',rect:f.rect});}
     const fragments=nodes.flatMap(n=>n.fragments.map(f=>({...f,owner:n.id||`${n.tag}:${n.index}`})));
     for(let i=0;i<fragments.length;i++)for(let j=0;j<i;j++)if(overlap(fragments[i].rect,fragments[j].rect))conflicts.push({kind:'text-overlap',a:fragments[i].owner,b:fragments[j].owner,rect:fragments[i].rect});
     for(let i=0;i<controls.length;i++)for(let j=0;j<i;j++)if(!controls[i].hidden&&!controls[j].hidden&&overlap(controls[i].box,controls[j].box))conflicts.push({kind:'control-overlap',a:controls[i].id,b:controls[j].id});
     return {name,nodeCount:elements.length,controlLayoutFits:host.dataset.controlLayoutFits,viewport:{width,height},sight,nodes,controls,conflicts,band:band?{box:rect(band.getBoundingClientRect(),origin),scrollWidth:band.scrollWidth,scrollHeight:band.scrollHeight}:null,interpretation:name==='current'?'current real DOM measurement':'detached clone full-width reservation alternative; not natural warning occurrence'};
    };
    const records=[collect(app,'current',null)];
    for(const [name,contents] of [['flying-envelope',envelopes.flying],['waiting-envelope',envelopes.waiting]] as const){
     const host=app.cloneNode(false) as HTMLElement;host.style.cssText+=`;position:fixed!important;left:-100000px!important;top:0!important;width:${width}px!important;height:${height}px!important;visibility:hidden!important;pointer-events:none!important;transform:none!important`;host.inert=true;
     const copy=hud.cloneNode(true) as HTMLElement;copy.hidden=false;host.append(copy);document.body.append(host);
     try{
      const band=document.createElement('div');band.id='diagnostic-reservation-band';Object.assign(band.style,{position:'absolute',left:'12px',right:'12px',top:'12px',display:'grid',gridTemplateColumns:'1fr',gap:'4px'});copy.prepend(band);
      for(const [id,text]of [['loop-status',envelopes.controls.loop],['bomb-ammo',envelopes.controls.bombAmmo],['bomb-hint',envelopes.controls.bombHint]] as const){const el=copy.querySelector<HTMLElement>('#'+id)!;el.textContent=text;}
      for(const [id,text] of [['warning',contents.warning],['reload-status',contents.reload],['payload-status',contents.payload],['control-status',contents.status]] as const){const el=copy.querySelector<HTMLElement>('#'+id)!;el.hidden=!text;el.textContent=text;Object.assign(el.style,{position:'static',transform:'none',width:'auto',maxWidth:'none',margin:'0',whiteSpace:'normal'});band.append(el);}
      const reserve=band.getBoundingClientRect().height;const readouts=copy.querySelector<HTMLElement>('.hud-readouts')!;readouts.style.top=`${12+reserve+8}px`;
      records.push(collect(host,name,band));
     }finally{host.remove();}
    }
    return records;
   },{mode,envelopes:ENVELOPES});
   if(pageErrors.length||consoleErrors.length)record.error='Page or console error during measurement';
  }catch(error){record.error=String(error);}finally{await context.close();try{assertNoForbiddenTraffic(blocked);}catch(error){record.networkError=String(error);record.error=String(error);}}
 }
 }finally{await info.attach('layout-reservation-diagnostic.json',{body:JSON.stringify(evidence),contentType:'application/json'});}
 const report=inspectDiagnostic(evidence);expect(report.issues).toEqual([]);
});
