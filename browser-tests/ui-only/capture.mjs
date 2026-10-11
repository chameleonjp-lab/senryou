/** Local, finite UI capture. Run only where a browser is available; never launches CI or uploads files. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { assertFixtureId } from './samples.ts';
import { collectUiOnlySourceHashes, loadUiOnlyBatch, uiOnlySourceHashFingerprint } from './extract-product.mjs';
const origin='http://127.0.0.1:4189';
const evidenceRoot=resolve(process.env.UI_ONLY_EVIDENCE_DIR??'../senryou-ui-only-evidence');
mkdirSync(evidenceRoot,{recursive:true});
const output=resolve(evidenceRoot,'capture-'+new Date().toISOString().replaceAll(':','-'));
mkdirSync(output,{recursive:false});
const report={status:'not-run',scope:'product UI functions and pixels only',browser:'chromium',output,batchIdentity:null,batchManifestPath:null,sourceHashes:null,sourceHashesFingerprint:null,sourceHashesStable:null,productUiStarted:false,screenshotCount:0,centerHitPolicy:'observational-only; false does not fail capture',screens:[],actions:[],errors:[],externalRequests:[],uiMs:null,setupMs:null,setupAttemptElapsedMs:null,setupStatus:'not-started',imageReview:'not-run',imageReviewMs:null,screenReviewTotalMs:null,gameplayVerified:false,canvasFont200Verified:false};
const fileSha256=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
async function text200(page){
 const result=await page.evaluate(()=>{
  const host=window;
  for(const saved of host.__uiOnlySavedFonts??[])if(saved.element.isConnected){
   if(saved.inline)saved.element.style.setProperty('font-size',saved.inline,saved.priority);
   else saved.element.style.removeProperty('font-size');
  }
  const nodes=[...document.querySelectorAll('#app, #app *')].filter(element=>!(element instanceof HTMLCanvasElement));
  const base=nodes.map(element=>({element,inline:element.style.fontSize,priority:element.style.getPropertyPriority('font-size'),pixels:Number.parseFloat(getComputedStyle(element).fontSize)}));
  host.__uiOnlySavedFonts=base.map(({element,inline,priority,pixels})=>({element,inline,priority,pixels}));
  for(const saved of base)saved.element.style.setProperty('font-size',(saved.pixels*2)+'px','important');
  const ratios=base.filter(saved=>saved.pixels>0&&[...saved.element.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent?.trim())).map(saved=>Number.parseFloat(getComputedStyle(saved.element).fontSize)/saved.pixels);
  return {count:ratios.length,min:Math.min(...ratios),max:Math.max(...ratios),method:'measured text font sizes; not browser zoom'};
 });
 if(!result.count||Math.abs(result.min-2)>.001||Math.abs(result.max-2)>.001)throw new Error('Text scale not 200%: '+JSON.stringify(result));
 return result;
}
async function verifyText200(page){
 const observation=await page.evaluate(()=>{
  const saved=window.__uiOnlySavedFonts??[];
  const measured=new Map(saved.map(item=>[item.element,item.pixels]));
  const nodes=[...document.querySelectorAll('#app, #app *')].filter(element=>element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&[...element.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent?.trim()));
  return nodes.map(element=>({tag:element.tagName,id:element.id,baseline:measured.get(element)??null,current:Number.parseFloat(getComputedStyle(element).fontSize)}));
 });
 const invalid=observation.filter(item=>item.baseline===null||!Number.isFinite(item.current)||Math.abs(item.current/item.baseline-2)>.001);
 if(!observation.length||invalid.length)throw new Error('Text scale observation stale or not 200%: '+JSON.stringify(invalid));
 return {count:observation.length,verifiedAtObservation:true};
}
const rows=[
 ['P-home',320,568,'home','easy',false],['P-easy',320,568,'hud-easy','easy',false],
 ['P-touch',320,568,'settings-touch','easy',false],['P-rules',320,568,'rules','easy',false],['P-startup-error',320,568,'startup-error','easy',false],
 ['L-normal',568,320,'flying-effective','normal',false],['L-notice',568,320,'hud-notice','normal',false],['L-pause',568,320,'pause','normal',false],['L-keyboard',568,320,'settings-keyboard','normal',false],
 ['L-victory',568,320,'result-victory','normal',false],['L-defeat',568,320,'result-defeat','normal',false],['L-draw',568,320,'result-draw','normal',false],['L-aborted',568,320,'result-aborted','normal',false],['L-paused-error',568,320,'paused-error','normal',false],
 ['D-normal',1366,768,'hud-normal','normal',false],
 ['T-normal',393,852,'flying-effective','normal',true],['T-touch',393,852,'settings-touch','normal',true],['T-keyboard',393,852,'settings-keyboard','normal',true],['T-waiting',393,852,'waiting','normal',true],['T-spectating',393,852,'spectating','normal',true],['T-result',393,852,'result-aborted','normal',true],['T-rules',393,852,'rules','normal',true],
];
for(const row of rows)assertFixtureId(row[3]);
const started=performance.now();let server,browser,uiStart,uiWatchdog,terminating=false,activeCase=null;
const budgets={totalMs:90000,uiMs:65000,settleMs:2000,cleanupMs:2000};report.budgets=budgets;
const bounded=(promise,ms,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out after '+ms+'ms')),ms);})]).finally(()=>clearTimeout(timer));};
const saveReport=()=>{report.totalExecutionMs=performance.now()-started;writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');};
const cleanup=async()=>{try{const results=await bounded(Promise.allSettled([Promise.resolve().then(()=>browser?.close()),Promise.resolve().then(()=>server?.close())]),budgets.cleanupMs,'cleanup');for(const result of results)if(result.status==='rejected')report.errors.push({kind:'cleanup',message:String(result.reason)});}catch(error){report.errors.push({kind:'cleanup',message:String(error)});}};
const timeoutStop=async(label)=>{if(terminating)return;terminating=true;report.timedOut=true;report.status='incomplete-or-failed';report.errors.push({kind:'timeout',message:label});if(uiStart)report.uiMs=performance.now()-uiStart;
 if(activeCase){activeCase.item.status='failed';activeCase.item.error='Capture deadline interrupted this case';try{await saveTopScreenshot(activeCase.item);}catch(error){activeCase.item.evidenceError='Top screenshot unavailable during timeout: '+String(error);}try{await saveBottomScreenshot(activeCase.item,activeCase.fixture);}catch(error){activeCase.item.bottomEvidenceError='Bottom screenshot unavailable during timeout: '+String(error);}saveCaseJson(activeCase.item);}
 saveReport();await cleanup();saveReport();process.exit(1);};
const totalWatchdog=setTimeout(()=>void timeoutStop('Overall capture deadline exceeded'),budgets.totalMs);
try{
 const batch=loadUiOnlyBatch(evidenceRoot);
 report.batchIdentity=batch.batch.batchIdentity;report.batchManifestPath='extraction-verification.json';report.sourceHashes=batch.sourceHashes;report.sourceHashesFingerprint=batch.sourceHashesFingerprint;
 server=await createServer({configFile:'vite.ui-only.config.ts',mode:'ui-only'});await server.listen();
 browser=await chromium.launch({headless:true,...(process.env.UI_CHROMIUM_PATH?{executablePath:process.env.UI_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:320,height:568},hasTouch:true,serviceWorkers:'block'});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){report.externalRequests.push(url.href);return route.abort();}return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(2000);
 await page.addInitScript(()=>{
  const getContext=HTMLCanvasElement.prototype.getContext,wrapped=new WeakMap();
  HTMLCanvasElement.prototype.getContext=function(type,...args){
   const canvas=this;
   const context=getContext.call(this,type,...args);
   if(this.id!=='markers'||type!=='2d'||!context)return context;
   if(wrapped.has(context))return wrapped.get(context);
   let path=[],pathSegments=[],currentPoint=null,sightArc=false;
   const include=(x,y)=>{if(Number.isFinite(x)&&Number.isFinite(y))path.push({x,y});};
   const proxy=new Proxy(context,{get(target,key){
    const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
    if(key==='clearRect')return (...values)=>{window.__uiOnlyCanvasText=[];return value.apply(target,values);};
    if(key==='fillText')return (text,x,y,...values)=>{
     const m=target.measureText(String(text)),matrix=target.getTransform(),rect=canvas.getBoundingClientRect(),sx=rect.width/canvas.width,sy=rect.height/canvas.height;
     const corners=[[x-m.actualBoundingBoxLeft,y-m.actualBoundingBoxAscent],[x+m.actualBoundingBoxRight,y-m.actualBoundingBoxAscent],[x-m.actualBoundingBoxLeft,y+m.actualBoundingBoxDescent],[x+m.actualBoundingBoxRight,y+m.actualBoundingBoxDescent]]
      .map(([px,py])=>({x:rect.left+(matrix.a*px+matrix.c*py+matrix.e)*sx,y:rect.top+(matrix.b*px+matrix.d*py+matrix.f)*sy}));
     const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);
     (window.__uiOnlyCanvasText??=[]).push({text:String(text),left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)});
     return value.call(target,text,x,y,...values);
    };
    if(key==='beginPath')return (...values)=>{path=[];pathSegments=[];currentPoint=null;sightArc=false;return value.apply(target,values);};
    if(key==='arc')return (x,y,r,...values)=>{
     if(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(r)){
      include(x-r,y-r);include(x+r,y+r);
      const matrix=target.getTransform(),rect=canvas.getBoundingClientRect(),sx=rect.width/canvas.width,sy=rect.height/canvas.height;
      const cx=(matrix.a*x+matrix.c*y+matrix.e)*sx,cy=(matrix.b*x+matrix.d*y+matrix.f)*sy;
      const padX=Math.abs(matrix.a)*target.lineWidth*.5*sx,padY=Math.abs(matrix.d)*target.lineWidth*.5*sy;
      const rx=Math.abs(matrix.a)*r*sx+padX,ry=Math.abs(matrix.d)*r*sy+padY;
      if(r>=20&&Math.abs(cx-rect.width/2)<rect.width*.1)sightArc=true;
      if(Math.min(rx,ry)>=40&&cx>rect.width/2&&cy<rect.height/2){
       window.__uiOnlyCanvasRadar={source:'observed-product-BattleView.drawRadar-Canvas2D-arc',bounds:{left:cx-rx,top:cy-ry,right:cx+rx,bottom:cy+ry},center:{x:cx,y:cy},radius:{x:rx-padX,y:ry-padY},strokePadding:{x:padX,y:padY}};
      }
     }
     return value.call(target,x,y,r,...values);
    };
    if(key==='moveTo')return (x,y,...values)=>{include(x,y);currentPoint=Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null;return value.call(target,x,y,...values);};
    if(key==='lineTo')return (x,y,...values)=>{include(x,y);const next=Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null;if(currentPoint&&next)pathSegments.push({from:currentPoint,to:next});currentPoint=next;return value.call(target,x,y,...values);};
    if(key==='stroke')return (...values)=>{
     if(!window.__uiOnlyCanvasSight&&sightArc&&path.length){
      const xs=path.map(point=>point.x),ys=path.map(point=>point.y),pad=(Number(target.lineWidth)||1)/2;
      window.__uiOnlyCanvasSight={source:'observed-product-markers-Canvas2D-first-stroke',strokeStyle:target.strokeStyle,lineWidth:target.lineWidth,
       bounds:{left:Math.min(...xs)-pad,top:Math.min(...ys)-pad,right:Math.max(...xs)+pad,bottom:Math.max(...ys)+pad},pathPoints:path,pathSegments,strokePadding:pad};
     }
     return value.apply(target,values);
    };
    return value.bind(target);
   },set(target,key,value){return Reflect.set(target,key,value,target);}});
   wrapped.set(context,proxy);return proxy;
  };
  window.__uiOnlyCanvasSight=null;window.__uiOnlyCanvasRadar=null;
 });
 page.on('pageerror',error=>report.errors.push({kind:'pageerror',message:error.message}));page.on('console',msg=>{if(msg.type()==='error')report.errors.push({kind:'console',message:msg.text()});});
 await page.goto(origin+'/__ui_only__/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.documentElement.dataset.uiOnlyReady==='true');report.productUiStarted=true;
 report.setupMs=performance.now()-started;report.setupAttemptElapsedMs=report.setupMs;report.setupStatus='completed';uiStart=performance.now();uiWatchdog=setTimeout(()=>void timeoutStop('UI capture deadline exceeded; missing work is not a pass'),budgets.uiMs);
 const settle=()=>bounded(page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}),budgets.settleMs,'fonts/frame settling');
 const canvasState=()=>page.locator('#markers').evaluate(canvas=>{const c=canvas.getContext('2d'),d=c.getImageData(0,0,canvas.width,canvas.height).data;let painted=0;for(let i=3;i<d.length;i+=4)if(d[i])painted++;return {width:canvas.width,height:canvas.height,paintedPixels:painted,sight:window.__uiOnlyCanvasSight??null,radar:window.__uiOnlyCanvasRadar??null,textPaints:window.__uiOnlyCanvasText??[]};});
 const state=()=>page.evaluate(()=>({...window.__senryouUiOnly.snapshot(),telemetry:window.__senryouUiOnly.telemetry}));
 const resetScrollPositions=()=>page.evaluate(()=>{
  window.scrollTo(0,0);
  const elements=[document.documentElement,document.body,...document.querySelectorAll('*')];let resetCount=0;
  for(const element of elements)if(element.scrollTop!==0||element.scrollLeft!==0){element.scrollTop=0;element.scrollLeft=0;resetCount++;}
  return {scrollY:window.scrollY,documentTop:document.documentElement.scrollTop,bodyTop:document.body.scrollTop,resetCount};
 });
 const saveCaseJson=item=>writeFileSync(resolve(output,item.id+'.json'),JSON.stringify(item,null,2)+'\n');
 const saveTopScreenshot=async item=>{
  if(item.screenshot)return;
  await settle();item.state??=await state();item.canvas??=await canvasState();
  item.screenshot=item.id+'.png';const screenshotPath=resolve(output,item.screenshot);await page.screenshot({path:screenshotPath});
  item.screenshotSha256=fileSha256(screenshotPath);report.screenshotCount++;
 };
 const saveBottomScreenshot=async(item,fixture)=>{
  const owner=fixture.startsWith('settings-')?'#control-settings .settings-main':fixture==='rules'?'#rules-content':fixture.startsWith('result-')?'#result':fixture==='startup-error'?'#home':fixture==='paused-error'?'#pause-screen':fixture==='pause'?'#pause-screen':fixture==='home'?'#home':null;
  const required=fixture.startsWith('result-')||fixture.includes('error');
  if(!owner)return;
  const metrics=await page.locator(owner).evaluate(e=>{const beforeTop=e.scrollTop;e.scrollTop=e.scrollHeight;return {target:e.id||e.className,beforeTop,afterTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,bottomReached:e.scrollTop+e.clientHeight>=e.scrollHeight-1};});
  if(required||metrics.scrollHeight>metrics.clientHeight+1){await settle();item.bottomScroll=metrics;item.bottomScreenshot=item.id+'-bottom.png';const path=resolve(output,item.bottomScreenshot);await page.screenshot({path});item.bottomScreenshotSha256=fileSha256(path);report.screenshotCount++;}
 };
 for(const [id,width,height,fixture,mode,enlarge] of rows){
  const displayFixture=id==='L-notice'?'waiting':fixture;
  const item={id,fixture,displayFixture,mode,viewport:{width,height},domTextScale:enlarge?2:1,status:'not-run',batchIdentity:report.batchIdentity,sourceHashesFingerprint:report.sourceHashesFingerprint,centerHitPolicy:'observational-only; false does not fail capture',imageReviewed:false};report.screens.push(item);
  activeCase={item,fixture:displayFixture};
  try{
   await page.setViewportSize({width,height});await page.evaluate(({fixture,mode})=>{window.__uiOnlyCanvasSight=null;window.__uiOnlyCanvasRadar=null;window.__senryouUiOnly.show(fixture,mode);},{fixture:displayFixture,mode});item.scrollReset=await resetScrollPositions();
   if(enlarge)item.textScale=await text200(page);await settle();if(enlarge)item.textScaleVerification=await verifyText200(page);
   const beforeRepaint=await page.evaluate(()=>window.__senryouUiOnly.missionState());
   await page.evaluate(()=>window.__senryouUiOnly.repaint());
   const afterRepaint=await page.evaluate(()=>window.__senryouUiOnly.missionState());
   if(beforeRepaint!==afterRepaint)throw new Error('Read-only overlay repaint changed the frozen mission');
   item.readonlyRepaint={missionStateUnchanged:true,continuousLoop:false};
   item.state=await state();item.canvas=await canvasState();
   await saveTopScreenshot(item);await saveBottomScreenshot(item,displayFixture);
   item.layoutObservation=await page.evaluate(()=>{
    const rectOf=element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const visible=element=>element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
    const box=document.querySelector('#hud .targets');
    const view={width:innerWidth,height:innerHeight};
    const sight=window.__uiOnlyCanvasSight??null,radar=window.__uiOnlyCanvasRadar??null;
    const targetBox=box&&visible(box)?rectOf(box):null;
    const targetChildren=[...(box?.children??[])].map(element=>({className:(element instanceof HTMLElement?element.className:''),text:element.textContent?.trim()??'',...rectOf(element)}));
    const textRectsOf=element=>{
     const rects=[],walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
     for(let node=walker.nextNode();node;node=walker.nextNode())if(node.textContent?.trim()){
      const parent=node.parentElement;if(!parent||!visible(parent)||parent.closest('.visually-hidden,[aria-hidden="true"]'))continue;
      const range=document.createRange();range.selectNodeContents(node);
      for(const rect of range.getClientRects())if(rect.width>0&&rect.height>0)rects.push({left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height,text:node.textContent.trim()});
     }
     return rects;
    };
    const rectanglesOverlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    const lineIntersectsRect=(segment,rect,padding=0)=>{
     const left=rect.left-padding,right=rect.right+padding,top=rect.top-padding,bottom=rect.bottom+padding;
     const dx=segment.to.x-segment.from.x,dy=segment.to.y-segment.from.y;let lo=0,hi=1;
     for(const [p,q] of [[-dx,segment.from.x-left],[dx,right-segment.from.x],[-dy,segment.from.y-top],[dy,bottom-segment.from.y]]){
      if(Math.abs(p)<1e-9){if(q<0)return false;continue;}
      const ratio=q/p;if(p<0){if(ratio>hi)return false;if(ratio>lo)lo=ratio;}else{if(ratio<lo)return false;if(ratio<hi)hi=ratio;}
     }
     return lo<=hi;
    };
    const canvasRegionIntersectsRect=(region,rect)=>{
     if(!region)return false;
     if(region.center&&region.radius){
      const cx=region.center.x,cy=region.center.y,rx=region.radius.x+(region.strokePadding?.x??0),ry=region.radius.y+(region.strokePadding?.y??0);
      const nearX=Math.max(rect.left,Math.min(cx,rect.right)),nearY=Math.max(rect.top,Math.min(cy,rect.bottom));
      const farthest=[{x:rect.left,y:rect.top},{x:rect.right,y:rect.top},{x:rect.left,y:rect.bottom},{x:rect.right,y:rect.bottom}].reduce((max,p)=>Math.max(max,((p.x-cx)/rx)**2+((p.y-cy)/ry)**2),0);
      const nearest=((nearX-cx)/rx)**2+((nearY-cy)/ry)**2;
      return nearest<=1&&farthest>=1;
     }
     const segments=region.pathSegments??[];
     if(segments.length)return segments.some(segment=>lineIntersectsRect(segment,rect,(region.strokePadding??region.lineWidth/2)||0));
     return !!(region.bounds&&rectanglesOverlap(rect,region.bounds));
    };
    const targetTextRects=box&&visible(box)?textRectsOf(box):[];
    const targetSightOverlap=!!(sight&&targetTextRects.some(rect=>canvasRegionIntersectsRect(sight,rect)));
    const previewControls=[...document.querySelectorAll('#control-settings .preview-control')].filter(visible).map(element=>{const r=rectOf(element),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {id:element.dataset.control,...r,centerHit:hit===element||element.contains(hit)};});
    const previewControlCenterMisses=previewControls.filter(control=>!control.centerHit).map(control=>control.id);
    const previewControlOverlaps=[];
    for(let i=0;i<previewControls.length;i++)for(let j=i+1;j<previewControls.length;j++)if(rectanglesOverlap(previewControls[i],previewControls[j]))previewControlOverlaps.push({first:previewControls[i].id,second:previewControls[j].id});
    const previewLabels=[...document.querySelectorAll('#control-settings .preview-control.external-label > span')].filter(visible).map(element=>({owner:element.parentElement?.dataset.control,text:element.textContent.trim(),...rectOf(element),scrollWidth:element.scrollWidth,clientWidth:element.clientWidth}));
    const previewLabelOverlaps=[];
    for(let i=0;i<previewLabels.length;i++)for(let j=i+1;j<previewLabels.length;j++){
     const a=previewLabels[i],b=previewLabels[j];if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)previewLabelOverlaps.push([a.text,b.text]);
    }
    const previewLabelControlOverlaps=[];
    for(const label of previewLabels)for(const control of previewControls)if(control.id!==label.owner&&label.left<control.right&&label.right>control.left&&label.top<control.bottom&&label.bottom>control.top)previewLabelControlOverlaps.push({label:label.text,owner:label.owner,control:control.id});
    const controls=[...document.querySelectorAll('#hud [data-flight-control]')].filter(visible).map(element=>({id:element.id,...rectOf(element)}));
    const hudElements=[...document.querySelectorAll('#hud .time-block,#hud .targets,#hud .flight-data,#hud .capture-info,#hud .hud-notice-top > *,#hud .hud-notice-shared > *,#hud #flight-tip,#hud #announcement')].filter(visible);
    const hudContent=hudElements.map(element=>({id:element.id||element.className,text:element.textContent.trim(),...rectOf(element),textRects:textRectsOf(element)}));
    const hudContentOverlaps=[];
    for(let i=0;i<hudContent.length;i++)for(let j=i+1;j<hudContent.length;j++){const a=hudContent[i],b=hudContent[j];for(const first of a.textRects)for(const second of b.textRects)if(rectanglesOverlap(first,second))hudContentOverlaps.push({first:a.id,second:b.id,firstText:first.text,secondText:second.text,intersection:{left:Math.max(first.left,second.left),top:Math.max(first.top,second.top),right:Math.min(first.right,second.right),bottom:Math.min(first.bottom,second.bottom)}});}
    const hudControlOverlaps=[];
    for(const control of controls)for(const content of hudContent)for(const textRect of content.textRects)if(rectanglesOverlap(control,textRect))hudControlOverlaps.push({control:control.id,content:content.id,text:textRect.text});
    const flightControlOverlaps=[];
    for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++)if(rectanglesOverlap(controls[i],controls[j]))flightControlOverlaps.push({first:controls[i].id,second:controls[j].id});
    const canvasRegionOverlaps=[];
    for(const element of hudContent)for(const textRect of element.textRects)for(const [name,region] of [['sight',sight],['radar',radar]])if(canvasRegionIntersectsRect(region,textRect))canvasRegionOverlaps.push({element:element.id,text:textRect.text,kind:'visible-hud-text',region:name,intersection:{left:Math.max(textRect.left,region.bounds.left),top:Math.max(textRect.top,region.bounds.top),right:Math.min(textRect.right,region.bounds.right),bottom:Math.min(textRect.bottom,region.bounds.bottom)}});
    for(const control of controls)for(const [name,region] of [['sight',sight],['radar',radar]])if(canvasRegionIntersectsRect(region,control))canvasRegionOverlaps.push({element:control.id,kind:'flight-control',region:name});
    const targetText=[...(box?.querySelectorAll('*')??[])].filter(visible).map(element=>({text:element.textContent.trim(),scrollWidth:element.scrollWidth,clientWidth:element.clientWidth})).filter(item=>item.text&&item.scrollWidth>item.clientWidth+1);
    const targetCounts=[...(box?.querySelectorAll('.target-tally b')??[])].filter(visible).map(element=>({text:element.textContent.trim(),lineRects:[...(()=>{const range=document.createRange();range.selectNodeContents(element);return range.getClientRects();})()].map(rect=>({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}))}));
    const outsideHudText=[];
    const walker=document.createTreeWalker(document.querySelector('#hud')??document.body,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode())if(node.textContent?.trim()){
     const parent=node.parentElement;if(!parent||!visible(parent)||parent.closest('.visually-hidden,[aria-hidden="true"]'))continue;
     const range=document.createRange();range.selectNodeContents(node);
     for(const rect of range.getClientRects())if(rect.left<0||rect.right>view.width||rect.top<0||rect.bottom>view.height)outsideHudText.push({text:node.textContent.trim(),left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom});
    }
    const outsidePreviewLabels=previewLabels.filter(item=>item.left<0||item.right>view.width||item.top<0||item.bottom>view.height).map(item=>item.text);
    const preview=document.querySelector('#control-settings .control-preview'),previewBox=preview&&visible(preview)?rectOf(preview):null;
    const previewLabelOverflow=previewLabels.filter(item=>previewBox&&(item.left<previewBox.left-1||item.right>previewBox.right+1||item.top<previewBox.top-1||item.bottom>previewBox.bottom+1)).map(item=>item.text);
    const previewControlOverflow=[...document.querySelectorAll('#control-settings .preview-control')].filter(visible).map(element=>({id:element.dataset.control,...rectOf(element)})).filter(item=>previewBox&&(item.left<previewBox.left-1||item.right>previewBox.right+1||item.top<previewBox.top-1||item.bottom>previewBox.bottom+1)).map(item=>item.id);
    const outsideFlightControls=controls.filter(item=>item.left<0||item.right>view.width||item.top<0||item.bottom>view.height).map(item=>item.id);
    const worldTexts=window.__uiOnlyCanvasText??[];
    const worldLabelIssues=[];
    if((view.width>view.height?view.height<=360:view.width<=430)&&document.querySelector('#app')?.dataset.screen==='playing'){
     const hudButtons=[...document.querySelectorAll('#hud button,[data-flight-control]')].filter(visible).map(rectOf);
     for(const label of worldTexts){
      if(label.left<0||label.right>view.width||label.top<0||label.bottom>view.height)worldLabelIssues.push({text:label.text,kind:'outside-viewport'});
      if(hudContent.some(content=>content.textRects.some(rect=>rectanglesOverlap(label,rect)))||hudButtons.some(rect=>rectanglesOverlap(label,rect)))worldLabelIssues.push({text:label.text,kind:'hud-or-control-overlap'});
      if([sight,radar].some(region=>region&&rectanglesOverlap(label,region.bounds)))worldLabelIssues.push({text:label.text,kind:'sight-or-radar-overlap'});
     }
     for(let i=0;i<worldTexts.length;i++)for(let j=i+1;j<worldTexts.length;j++)if(rectanglesOverlap(worldTexts[i],worldTexts[j]))worldLabelIssues.push({text:worldTexts[i].text,other:worldTexts[j].text,kind:'world-text-overlap'});
    }
    return {viewport:view,targetBox,targetChildren,sight,sightSource:sight?.source??'no-product-Canvas2D-sight-observed',radar,radarSource:radar?.source??'no-product-Canvas2D-radar-observed',targetSightOverlap,targetTextRects,targetTextOverflow:targetText,targetCounts,hudContent,hudContentOverlaps,hudControlOverlaps,flightControlOverlaps,canvasRegionOverlaps,outsideHudText,previewControls,previewControlOverlaps,previewControlCenterMisses,previewLabels,previewLabelOverlaps,previewLabelControlOverlaps,outsidePreviewLabels,previewLabelOverflow,previewControlOverflow,outsideFlightControls,flightControls:controls,worldTexts,worldLabelIssues,layoutObservationPhase:document.querySelector('#control-settings .settings-main')?.scrollTop?'after-required-settings-bottom-scroll':'top-state',centerHitRemainsObservational:true};
   });
   item.layoutIssues=[];
   const sightExpected=['hud-easy','hud-normal','hud-notice','flying-effective','flying-ineffective','flying-no-prediction'].includes(displayFixture);
   if(sightExpected&&(!item.layoutObservation.sight||!item.layoutObservation.sight.bounds))item.layoutIssues.push('product Canvas2D sight bounds were not observed');
   if(item.state.screen==='playing'&&(!item.layoutObservation.radar||!item.layoutObservation.radar.bounds))item.layoutIssues.push('product Canvas2D radar bounds were not observed');
   if(item.layoutObservation.targetSightOverlap)item.layoutIssues.push('HUD target panel overlaps observed product sight bounds');
   if(item.layoutObservation.targetTextOverflow.length)item.layoutIssues.push('HUD target text overflows its measured box');
   if(item.layoutObservation.targetCounts.some(count=>count.text==='296'&&count.lineRects.length!==1))item.layoutIssues.push('target count 296 is not visible on a single line');
   if(item.layoutObservation.hudContentOverlaps.length)item.layoutIssues.push('visible HUD content overlaps another HUD content region');
   if(item.layoutObservation.hudControlOverlaps.length)item.layoutIssues.push('flight control overlaps a visible HUD reservation');
   if(item.layoutObservation.flightControlOverlaps.length)item.layoutIssues.push('flight control hit regions overlap');
   if(item.layoutObservation.canvasRegionOverlaps.length)item.layoutIssues.push('visible HUD or flight control overlaps a measured Canvas2D sight/radar region');
   if(item.layoutObservation.outsideHudText.length)item.layoutIssues.push('visible HUD text extends beyond viewport');
   if(item.layoutObservation.previewLabelOverlaps.length)item.layoutIssues.push('Touch preview labels overlap');
   if(item.layoutObservation.previewControlOverlaps.length)item.layoutIssues.push('Touch preview control hit regions overlap');
   if(item.layoutObservation.previewControlCenterMisses.length)item.layoutIssues.push('Touch preview control center is intercepted by another element');
   if(item.layoutObservation.previewLabelControlOverlaps.length)item.layoutIssues.push('Touch preview label overlaps another control');
   if(item.layoutObservation.outsidePreviewLabels.length)item.layoutIssues.push('Touch preview label extends beyond viewport');
   if(item.layoutObservation.previewLabelOverflow.length)item.layoutIssues.push('Touch preview label extends beyond its clipped preview frame');
   if(item.layoutObservation.previewControlOverflow.length)item.layoutIssues.push('Touch preview control extends beyond its visible preview frame');
   if(item.layoutObservation.outsideFlightControls.length)item.layoutIssues.push('flight control extends beyond viewport');
   if(item.layoutObservation.worldLabelIssues.length)item.layoutIssues.push('compact world labels overlap protected HUD/controls/sight/radar or each other');
   if(id==='L-normal'||id==='T-normal')for(const text of ['対空照準 1門','作戦空域の境界 · 内側へ旋回','爆弾の落下目安 · 30.0秒','P3 競合','619m','戦車 294m','2.4km']){
    if(!item.layoutObservation.worldTexts.map(item=>item.text).join(' ').includes(text))item.layoutIssues.push('Required world label was not painted: '+text);
   }
   const playing=item.state.screen==='playing'||item.state.screen==='paused';
   if(playing&&item.canvas.paintedPixels===0)throw new Error('Required actual Canvas2D HUD was not painted');
   if(!playing&&item.canvas.paintedPixels!==0)throw new Error('Canvas HUD not cleared on non-game screen');
   if(item.state.telemetry.webglRequests!==0)throw new Error('Unexpected WebGL request');
   item.visibleControls=await page.evaluate(()=>[...document.querySelectorAll('button,[role="slider"],select')].filter(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})).map(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {id:e.id,label:e.getAttribute('aria-label')||e.textContent.trim(),disabled:!!e.disabled,x:r.x,y:r.y,width:r.width,height:r.height,centerHit:hit===e||e.contains(hit)};}));
   item.visibleControlCenterMisses=item.visibleControls.filter(control=>!control.centerHit).map(({id,label})=>({id,label}));
   item.status=item.layoutIssues.length?'failed':'captured-needs-visual-review';
   if(item.layoutIssues.length)item.error='Visible layout geometry issue: '+JSON.stringify(item.layoutIssues);
  }catch(error){item.status='failed';item.error=String(error);
   try{await saveTopScreenshot(item);}catch(e){item.evidenceError='Top screenshot unavailable: '+String(e);}
   try{await saveBottomScreenshot(item,displayFixture);}catch(e){item.bottomEvidenceError='Bottom screenshot unavailable: '+String(e);}
  }finally{saveCaseJson(item);activeCase=null;}
 }
 const action=async(name,fn)=>{try{await fn();report.actions.push({name,status:'passed'});}catch(error){report.actions.push({name,status:'failed',error:String(error)});}};
 await page.setViewportSize({width:393,height:852});
 await action('product Home/start/Pause/Home bindings clear the overlay',async()=>{
  await page.evaluate(()=>window.__senryouUiOnly.show('home','normal'));await page.locator('#start').tap();await settle();if((await state()).screen!=='playing')throw new Error('Start did not show HUD');
  await page.locator('#pause').tap();await settle();if((await state()).screen!=='paused')throw new Error('Pause did not open');
  await page.locator('#pause-home').tap();await settle();if((await state()).screen!=='home'||(await canvasState()).paintedPixels!==0)throw new Error('Home transition left a HUD overlay');
 });
 await action('product result/home clears canvas and resize redraws actual HUD',async()=>{
  await page.evaluate(()=>window.__senryouUiOnly.show('result-aborted','normal'));await page.locator('#result-home').tap();await settle();if((await canvasState()).paintedPixels!==0)throw new Error('Result/Home overlay not clear');
  await page.evaluate(()=>window.__senryouUiOnly.show('hud-normal','normal'));await page.setViewportSize({width:568,height:320});await settle();if((await canvasState()).paintedPixels===0)throw new Error('Resize left HUD canvas empty');
 });
 await action('product settings close and Rules return restore focus',async()=>{
  await page.setViewportSize({width:393,height:852});await page.evaluate(()=>window.__senryouUiOnly.show('home','easy'));await page.locator('#home-controls').tap();await page.locator('#control-close').tap();await settle();if(await page.locator('#control-settings').isVisible())throw new Error('Settings remained open');
  await page.locator('#home-rules').tap();await page.locator('#rules-back').tap();await settle();if(await page.locator('#rules-guide').isVisible())throw new Error('Rules remained open');
  if(!await page.locator('#home-rules').evaluate(e=>e===document.activeElement))throw new Error('Rules focus did not return');
 });
 report.uiMs=performance.now()-uiStart;
 report.status=report.errors.length||report.externalRequests.length||report.screens.some(s=>s.status==='failed')||report.actions.some(a=>a.status==='failed')?'incomplete-or-failed':'captured-needs-visual-review';
 report.notVerified=['Actual image review pending','gameplay/weapon eligibility/physics/GPU/performance','full viewport/state cross product','canvas font200/native browser zoom/real devices','settings save/reload/fault branch unless separately captured'];
}catch(error){report.status=report.timedOut?'incomplete-or-failed':'blocked';report.errors.push({kind:'execution',message:String(error)});}finally{
 if(uiStart&&report.uiMs===null)report.uiMs=performance.now()-uiStart;
 if(!uiStart){report.setupAttemptElapsedMs=performance.now()-started;report.setupStatus='failed-before-ui-ready';}
 if(report.batchIdentity){
  try{const finalHashes=collectUiOnlySourceHashes();report.sourceHashesStable=uiOnlySourceHashFingerprint(finalHashes)===report.sourceHashesFingerprint;if(!report.sourceHashesStable){report.errors.push({kind:'source-drift',message:'UI-only sources changed during capture'});report.status='incomplete-or-failed';}report.sourceHashesAtEnd=finalHashes;}
  catch(error){report.sourceHashesStable=false;report.errors.push({kind:'source-hash',message:String(error)});report.status='incomplete-or-failed';}
 }
 clearTimeout(uiWatchdog);await cleanup();if(report.errors.some(e=>e.kind==='cleanup'))report.status='incomplete-or-failed';saveReport();clearTimeout(totalWatchdog);console.log(JSON.stringify({status:report.status,output,screens:report.screens.length,batchIdentity:report.batchIdentity,uiMs:report.uiMs,imageReviewMs:report.imageReviewMs}));
 const failedCases=report.screens.filter(item=>item.status==='failed').map(({id,error,layoutIssues,layoutObservation,visibleControlCenterMisses,evidenceError,bottomEvidenceError,screenshot,bottomScreenshot})=>({id,error,layoutIssues,layoutObservation,visibleControlCenterMisses,evidenceError,bottomEvidenceError,screenshot,bottomScreenshot}));
 if(failedCases.length||report.errors.length||report.actions.some(item=>item.status==='failed'))console.log(JSON.stringify({kind:'ui-only-failure-details',failedCases,errors:report.errors,failedActions:report.actions.filter(item=>item.status==='failed')}));
}
if(report.status==='blocked'||report.status==='incomplete-or-failed')process.exitCode=1;

// If cleanup itself failed, do not leave a browser/server handle keeping the runner alive. The report is already durable.
if(report.errors.some(e=>e.kind==='cleanup'))process.exit(1);
