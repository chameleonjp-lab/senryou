import {expect,test} from '@playwright/test';
import {installFrameDriver,prepareApp,advanceFrame,clickDom,readState} from './native-frame-driver';
import {installNetworkGuard,assertNoForbiddenTraffic,SMOKE_ORIGIN} from './network-guard';
import {createAssetManifest} from './asset-manifest.mjs';
import {text200,verifyText200} from './acceptance/observe-dom';
import {PROFILES,REGISTRY,ENVELOPES,inspectDiagnostic,STYLE_PROPERTIES} from '../diagnostics/layout-reservation/contracts';
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
   record.scenarios=await page.evaluate(async({mode,envelopes,styleProperties})=>{
    const app=document.querySelector<HTMLElement>('#app')!,hud=app.querySelector<HTMLElement>('#hud')!,width=app.offsetWidth,height=app.offsetHeight;
    const game=(window as unknown as {__senryou:{game:BattleGame}}).__senryou.game;
    const modulePath='/src/gun-sight.ts';const {projectGunSight}=await import(modulePath) as typeof import('../src/gun-sight');
    if(mode==='normal'&&!game.pilot)throw new Error('Normal sight cannot be measured without the real tick-initialized pilot');
    const center=mode==='normal'?projectGunSight(game.pilot!,[],width,height):{x:width/2,y:height/2};
    const radius=mode==='normal'?Math.max(26,Math.min(38,Math.min(width,height)*.085)):Math.min(width,height)*.135;
    const sight={x:center.x,y:center.y,radius,margin:8};
    const rect=(r:DOMRect,origin:DOMRect)=>({x:r.x-origin.x,y:r.y-origin.y,width:r.width,height:r.height});
    type Rect={x:number;y:number;width:number;height:number};const overlap=(a:Rect,b:Rect)=>a.width>0&&a.height>0&&b.width>0&&b.height>0&&a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
    const mathPath='/src/layout-diagnostic-math.ts';
    const {intersection,overflowClip,insetClip,circleRelation,DIAGNOSTIC_TOLERANCE}=await import(mathPath) as typeof import('../src/layout-diagnostic-math');
    const collect=(host:HTMLElement,name:string,band:HTMLElement|null,styleIdentity:unknown[]=[])=>{
     const origin=host.getBoundingClientRect(),isClone=name!=='current';const elements=[...host.querySelectorAll<HTMLElement>('#hud *')];
     const describedIds=new Set(elements.flatMap(e=>(e.getAttribute('aria-describedby')??'').split(/\s+/).filter(Boolean)));
     const client=(el:HTMLElement)=>{const b=rect(el.getBoundingClientRect(),origin),sx=el.offsetWidth?b.width/el.offsetWidth:1,sy=el.offsetHeight?b.height/el.offsetHeight:1;return {x:b.x+el.clientLeft*sx,y:b.y+el.clientTop*sy,width:el.clientWidth*sx,height:el.clientHeight*sy};};
     const nodes=elements.map((element,index)=>{
      const style=getComputedStyle(element),box=rect(element.getBoundingClientRect(),origin),fragments:{text:string;rect:Rect;visibleRect:Rect}[]=[],textNodes:{text:string;rangeCount:number;zeroRange:boolean;rects:Rect[]}[]=[];
      let effectiveClip:Rect={x:0,y:0,width,height},unsupportedClip=false;
      const clipAncestors=[],hiddenReasons:string[]=[];
      if(style.visibility==='hidden'||style.visibility==='collapse')hiddenReasons.push('computed-visibility');
      for(let a:HTMLElement|null=element;a&&a!==host.parentElement;a=a.parentElement){
       const cs=getComputedStyle(a),ab=rect(a.getBoundingClientRect(),origin),cb=client(a);
       if(cs.display==='none')hiddenReasons.push('display-none');
       if(cs.contentVisibility==='hidden')hiddenReasons.push('content-visibility-hidden');
       if(!(isClone&&a===host)&&Number(cs.opacity)===0)hiddenReasons.push('zero-opacity');
       const hasOverflow=[cs.overflowX,cs.overflowY].some(v=>['hidden','clip','auto','scroll'].includes(v));
       if(hasOverflow)effectiveClip=overflowClip(effectiveClip,cb,cs.overflowX,cs.overflowY);
       if(cs.clipPath!=='none'){const inset=insetClip(cs.clipPath,ab);if(inset)effectiveClip=intersection(effectiveClip,inset);else unsupportedClip=true;}
       if(cs.clip!=='auto')unsupportedClip=true;
       if(hasOverflow||cs.clipPath!=='none'||cs.clip!=='auto')clipAncestors.push({id:a.id,overflowX:cs.overflowX,overflowY:cs.overflowY,clipPath:cs.clipPath,legacyClip:cs.clip,box:ab,clientBox:cb,clientLeft:a.clientLeft,clientTop:a.clientTop,clientWidth:a.clientWidth,clientHeight:a.clientHeight,scrollWidth:a.scrollWidth,scrollHeight:a.scrollHeight,scrollLeft:a.scrollLeft,scrollTop:a.scrollTop});
      }
      for(const node of element.childNodes)if(node.nodeType===Node.TEXT_NODE&&node.textContent?.trim()){
       const range=document.createRange();range.selectNodeContents(node);const rects=[...range.getClientRects()].map(b=>rect(b,origin));textNodes.push({text:node.textContent,rangeCount:rects.length,zeroRange:rects.length===0||rects.every(r=>r.width===0||r.height===0),rects});for(const r of rects)fragments.push({text:node.textContent,rect:r,visibleRect:intersection(r,effectiveClip)});
      }
      const clippedOut=intersection(box,effectiveClip).width===0||intersection(box,effectiveClip).height===0;
      const visualState=hiddenReasons.length?'hidden':unsupportedClip?'uncertain-clip':clippedOut?(describedIds.has(element.id)?'nonvisual-accessibility-description':'fully-clipped'):'visible-equivalent';
      return {index,id:element.id,tag:element.tagName,className:element.className,text:element.textContent??'',attributes:{role:element.getAttribute('role'),ariaHidden:element.getAttribute('aria-hidden'),ariaDescribedby:element.getAttribute('aria-describedby'),ariaDisabled:element.getAttribute('aria-disabled'),disabled:element.hasAttribute('disabled')},hidden:element.hidden,hiddenByAncestor:!!element.closest('[hidden]'),display:style.display,visibility:style.visibility,opacity:style.opacity,clipPath:style.clipPath,legacyClip:style.clip,fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,letterSpacing:style.letterSpacing,whiteSpace:style.whiteSpace,overflowX:style.overflowX,overflowY:style.overflowY,box,clientBox:client(element),offsetWidth:element.offsetWidth,offsetHeight:element.offsetHeight,clientWidth:element.clientWidth,clientHeight:element.clientHeight,scrollWidth:element.scrollWidth,scrollHeight:element.scrollHeight,clipAncestors,effectiveClip,hiddenReasons,visualState,isAccessibleDescription:describedIds.has(element.id),liveCheckVisibility:isClone?null:element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),fragments,textNodes};
     });
     const controls=elements.filter(e=>e.matches('[data-flight-control],#pause,#game-sound')).map(e=>{const n=nodes.find(n=>n.id===e.id)!;return {id:e.id,hidden:!!e.closest('[hidden]'),display:n.display,visibility:n.visibility,visualState:n.visualState,ariaDisabled:e.getAttribute('aria-disabled'),disabled:e.hasAttribute('disabled'),box:n.box,minimum44:e.offsetWidth>=44&&e.offsetHeight>=44};});
     const conflicts:{kind:string;a:string;b:string;rect?:Rect}[]=[];
     const guarded={x:sight.x-sight.radius-sight.margin,y:sight.y-sight.radius-sight.margin,width:2*(sight.radius+sight.margin),height:2*(sight.radius+sight.margin)};
     for(const n of nodes)for(const f of n.fragments){if(f.rect.x<0||f.rect.y<0||f.rect.x+f.rect.width>width||f.rect.y+f.rect.height>height)conflicts.push({kind:'fragment-outside-viewport',a:n.id||`${n.tag}:${n.index}`,b:'viewport',rect:f.rect});for(const c of controls)if(!c.hidden&&c.id!==n.id&&!elements[n.index].closest('#'+c.id)&&overlap(f.rect,c.box))conflicts.push({kind:'control-over-text',a:c.id,b:n.id||`${n.tag}:${n.index}`,rect:f.rect});if(overlap(f.rect,guarded))conflicts.push({kind:'text-in-sight-reservation',a:n.id||`${n.tag}:${n.index}`,b:'sight',rect:f.rect});}
     const fragments=nodes.flatMap(n=>n.fragments.map((f,fragmentIndex)=>({...f,fragmentIndex,nodeIndex:n.index,visualState:n.visualState,owner:n.id||`${n.tag}:${n.index}`})));
     for(let i=0;i<fragments.length;i++)for(let j=0;j<i;j++)if(overlap(fragments[i].rect,fragments[j].rect))conflicts.push({kind:'text-overlap',a:fragments[i].owner,b:fragments[j].owner,rect:fragments[i].rect});
     for(let i=0;i<controls.length;i++)for(let j=0;j<i;j++)if(!controls[i].hidden&&!controls[j].hidden&&overlap(controls[i].box,controls[j].box))conflicts.push({kind:'control-overlap',a:controls[i].id,b:controls[j].id});
     const visible=fragments.filter(f=>f.visualState==='visible-equivalent'&&f.visibleRect.width>0&&f.visibleRect.height>0),visualConflicts:Record<string,unknown>[]=[],sightRelations:Record<string,unknown>[]=[];
     const relation=(a:Rect,b:Rect)=>{const intersectionRect=intersection(a,b);return {intersection:intersectionRect,severity:Math.min(intersectionRect.width,intersectionRect.height)<=DIAGNOSTIC_TOLERANCE?'subpixel-contact':'overlap',tolerance:DIAGNOSTIC_TOLERANCE};};
     for(const f of visible){
      if(f.visibleRect.width<f.rect.width||f.visibleRect.height<f.rect.height)visualConflicts.push({kind:'partially-clipped-text',owner:f.owner,raw:f.rect,visible:f.visibleRect});
      const circle=circleRelation(f.visibleRect,sight);if(circle.classification!=='outside')sightRelations.push({owner:f.owner,fragmentIndex:f.fragmentIndex,rawRect:f.rect,visibleRect:f.visibleRect,...circle});
      for(const c of controls)if(c.visualState==='visible-equivalent'&&c.id!==nodes[f.nodeIndex].id&&!elements[f.nodeIndex].closest('#'+c.id)&&overlap(f.visibleRect,c.box))visualConflicts.push({kind:'control-over-visible-text',a:c.id,b:f.owner,...relation(f.visibleRect,c.box)});
     }
     for(let i=0;i<visible.length;i++)for(let j=0;j<i;j++)if(overlap(visible[i].visibleRect,visible[j].visibleRect))visualConflicts.push({kind:'visible-text-overlap',a:visible[i].owner,b:visible[j].owner,...relation(visible[i].visibleRect,visible[j].visibleRect)});
     for(const n of nodes)if(n.textNodes.length&&n.visualState==='fully-clipped'&&!n.hiddenByAncestor&&!n.isAccessibleDescription)visualConflicts.push({kind:'nonhidden-text-fully-clipped',owner:n.id||`${n.tag}:${n.index}`,clip:n.effectiveClip,textNodes:n.textNodes});
     for(let i=0;i<controls.length;i++)for(let j=0;j<i;j++)if(controls[i].visualState==='visible-equivalent'&&controls[j].visualState==='visible-equivalent'&&overlap(controls[i].box,controls[j].box))visualConflicts.push({kind:'visible-control-overlap',a:controls[i].id,b:controls[j].id,...relation(controls[i].box,controls[j].box)});
     const required=mode==='normal'?['pause','game-sound','fire','loop','throttle','bomb']:['pause','game-sound','loop','bomb'];
     for(const id of required){const c=controls.find(c=>c.id===id);if(!c||c.visualState!=='visible-equivalent'||c.ariaDisabled==='true'||c.disabled||!c.minimum44)visualConflicts.push({kind:'required-control-unavailable',id,control:c??null});}
     return {name,nodeCount:elements.length,liveSourceControlLayoutFits:app.dataset.controlLayoutFits,copiedFitIsCloneVerdict:false,viewport:{width,height},sight,nodes,controls,conflicts,visualConflicts,uncertainVisualNodes:nodes.filter(n=>n.visualState==='uncertain-clip').map(n=>({index:n.index,id:n.id,clipAncestors:n.clipAncestors})),sightRelations,styleIdentity,classificationTolerance:DIAGNOSTIC_TOLERANCE,visualClassificationScope:isClone?'equivalent visibility ignoring only the artificial offscreen host opacity':'real DOM',band:band?{box:rect(band.getBoundingClientRect(),origin),scrollWidth:band.scrollWidth,scrollHeight:band.scrollHeight}:null,interpretation:name==='current'?'current real DOM measurement':'detached clone full-width reservation alternative; not natural warning occurrence'};
    };
    const records=[collect(app,'current',null)];
    for(const [name,contents] of [['flying-envelope',envelopes.flying],['waiting-envelope',envelopes.waiting]] as const){
     const host=app.cloneNode(false) as HTMLElement;host.style.cssText+=`;position:fixed!important;left:-100000px!important;top:0!important;width:${width}px!important;height:${height}px!important;opacity:0!important;pointer-events:none!important;transform:none!important`;host.inert=true;
     const copy=hud.cloneNode(true) as HTMLElement;copy.hidden=false;host.append(copy);document.body.append(host);
     try{
      const band=document.createElement('div');band.id='diagnostic-reservation-band';Object.assign(band.style,{position:'absolute',left:'12px',right:'12px',top:'12px',display:'grid',gridTemplateColumns:'1fr',gap:'4px'});copy.prepend(band);
      for(const [id,text]of [['loop-status',envelopes.controls.loop],['bomb-ammo',envelopes.controls.bombAmmo],['bomb-hint',envelopes.controls.bombHint]] as const){const el=copy.querySelector<HTMLElement>('#'+id)!;el.textContent=text;}
      const identities=[];
      for(const [id,text] of [['warning',contents.warning],['reload-status',contents.reload],['payload-status',contents.payload],['control-status',contents.status]] as const){
       const el=copy.querySelector<HTMLElement>('#'+id)!;el.hidden=!text;el.textContent=text;
       const snapshot=()=>{const computed=getComputedStyle(el);return Object.fromEntries(styleProperties.map(property=>[property,computed.getPropertyValue(property)]));};
       const before=snapshot(),beforeParent=el.parentElement?.id||el.parentElement?.className,beforeBox=rect(el.getBoundingClientRect(),host.getBoundingClientRect());
       for(const [property,value]of Object.entries(before))el.style.setProperty(property,value,'important');
       Object.assign(el.style,{position:'static',transform:'none',width:'auto',maxWidth:'none'});band.append(el);
       const after=snapshot(),differences=styleProperties.filter(property=>before[property]!==after[property]);
       identities.push({id,text,beforeParent,beforeBox,before,after,differences});
      }
      const reserve=band.getBoundingClientRect().height;const readouts=copy.querySelector<HTMLElement>('.hud-readouts')!;readouts.style.top=`${12+reserve+8}px`;
      records.push(collect(host,name,band,identities));
     }finally{host.remove();}
    }
    return records;
   },{mode,envelopes:ENVELOPES,styleProperties:STYLE_PROPERTIES});
   if(pageErrors.length||consoleErrors.length)record.error='Page or console error during measurement';
  }catch(error){record.error=String(error);}finally{await context.close();try{assertNoForbiddenTraffic(blocked);}catch(error){record.networkError=String(error);record.error=String(error);}}
 }
 }finally{await info.attach('layout-reservation-diagnostic.json',{body:JSON.stringify(evidence),contentType:'application/json'});}
 const report=inspectDiagnostic(evidence);expect(report.issues).toEqual([]);
});
