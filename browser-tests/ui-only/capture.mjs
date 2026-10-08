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
const started=performance.now();let server,browser,uiStart,uiWatchdog,terminating=false;
const budgets={totalMs:90000,uiMs:65000,settleMs:2000,cleanupMs:2000};report.budgets=budgets;
const bounded=(promise,ms,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out after '+ms+'ms')),ms);})]).finally(()=>clearTimeout(timer));};
const saveReport=()=>{report.totalExecutionMs=performance.now()-started;writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');};
const cleanup=async()=>{try{const results=await bounded(Promise.allSettled([Promise.resolve().then(()=>browser?.close()),Promise.resolve().then(()=>server?.close())]),budgets.cleanupMs,'cleanup');for(const result of results)if(result.status==='rejected')report.errors.push({kind:'cleanup',message:String(result.reason)});}catch(error){report.errors.push({kind:'cleanup',message:String(error)});}};
const timeoutStop=async(label)=>{if(terminating)return;terminating=true;report.timedOut=true;report.status='incomplete-or-failed';report.errors.push({kind:'timeout',message:label});if(uiStart)report.uiMs=performance.now()-uiStart;saveReport();await cleanup();saveReport();process.exit(1);};
const totalWatchdog=setTimeout(()=>void timeoutStop('Overall capture deadline exceeded'),budgets.totalMs);
try{
 const batch=loadUiOnlyBatch(evidenceRoot);
 report.batchIdentity=batch.batch.batchIdentity;report.batchManifestPath='extraction-verification.json';report.sourceHashes=batch.sourceHashes;report.sourceHashesFingerprint=batch.sourceHashesFingerprint;
 server=await createServer({configFile:'vite.ui-only.config.ts',mode:'ui-only'});await server.listen();
 browser=await chromium.launch({headless:true,...(process.env.UI_CHROMIUM_PATH?{executablePath:process.env.UI_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:320,height:568},hasTouch:true,serviceWorkers:'block'});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){report.externalRequests.push(url.href);return route.abort();}return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(2000);
 page.on('pageerror',error=>report.errors.push({kind:'pageerror',message:error.message}));page.on('console',msg=>{if(msg.type()==='error')report.errors.push({kind:'console',message:msg.text()});});
 await page.goto(origin+'/__ui_only__/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.documentElement.dataset.uiOnlyReady==='true');report.productUiStarted=true;
 report.setupMs=performance.now()-started;report.setupAttemptElapsedMs=report.setupMs;report.setupStatus='completed';uiStart=performance.now();uiWatchdog=setTimeout(()=>void timeoutStop('UI capture deadline exceeded; missing work is not a pass'),budgets.uiMs);
 const settle=()=>bounded(page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}),budgets.settleMs,'fonts/frame settling');
 const canvasState=()=>page.locator('#markers').evaluate(canvas=>{const c=canvas.getContext('2d'),d=c.getImageData(0,0,canvas.width,canvas.height).data;let painted=0;for(let i=3;i<d.length;i+=4)if(d[i])painted++;return {width:canvas.width,height:canvas.height,paintedPixels:painted};});
 const state=()=>page.evaluate(()=>({...window.__senryouUiOnly.snapshot(),telemetry:window.__senryouUiOnly.telemetry}));
 for(const [id,width,height,fixture,mode,enlarge] of rows){
  const item={id,fixture,mode,viewport:{width,height},domTextScale:enlarge?2:1,status:'not-run',batchIdentity:report.batchIdentity,sourceHashesFingerprint:report.sourceHashesFingerprint,centerHitPolicy:'observational-only; false does not fail capture',imageReviewed:false};report.screens.push(item);
  try{
   await page.setViewportSize({width,height});await page.evaluate(({fixture,mode})=>window.__senryouUiOnly.show(fixture,mode),{fixture,mode});
   if(enlarge)item.textScale=await text200(page);await settle();if(enlarge)item.textScaleVerification=await verifyText200(page);
   item.state=await state();item.canvas=await canvasState();
   const playing=item.state.screen==='playing'||item.state.screen==='paused';
   if(playing&&item.canvas.paintedPixels===0)throw new Error('Required actual Canvas2D HUD was not painted');
   if(!playing&&item.canvas.paintedPixels!==0)throw new Error('Canvas HUD not cleared on non-game screen');
   if(item.state.telemetry.webglRequests!==0)throw new Error('Unexpected WebGL request');
   item.visibleControls=await page.evaluate(()=>[...document.querySelectorAll('button,[role="slider"],select')].filter(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})).map(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {id:e.id,label:e.getAttribute('aria-label')||e.textContent.trim(),disabled:!!e.disabled,x:r.x,y:r.y,width:r.width,height:r.height,centerHit:hit===e||e.contains(hit)};}));
   item.screenshot=id+'.png';const screenshotPath=resolve(output,item.screenshot);await page.screenshot({path:screenshotPath});item.screenshotSha256=fileSha256(screenshotPath);report.screenshotCount++;
   const scrollOwner=fixture.startsWith('settings-')?'#control-settings .settings-main':fixture==='rules'?'#rules-content':fixture.startsWith('result-')?'#result':fixture.includes('error')?null:fixture==='pause'?'#pause-screen':fixture==='home'?'#home':null;
   if(scrollOwner&&await page.locator(scrollOwner).evaluate(e=>e.scrollHeight>e.clientHeight+1)){
    await page.locator(scrollOwner).evaluate(e=>e.scrollTop=e.scrollHeight);await settle();item.bottomScreenshot=id+'-bottom.png';const bottomScreenshotPath=resolve(output,item.bottomScreenshot);await page.screenshot({path:bottomScreenshotPath});item.bottomScreenshotSha256=fileSha256(bottomScreenshotPath);report.screenshotCount++;
   }
   item.status='captured-needs-visual-review';
  }catch(error){item.status='failed';item.error=String(error);}
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
}
if(report.status==='blocked'||report.status==='incomplete-or-failed')process.exitCode=1;

// If cleanup itself failed, do not leave a browser/server handle keeping the runner alive. The report is already durable.
if(report.errors.some(e=>e.kind==='cleanup'))process.exit(1);
