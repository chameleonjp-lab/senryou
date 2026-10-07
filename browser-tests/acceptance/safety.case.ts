import { expect, test } from '@playwright/test';
import { runCase, start, advanceFrame, clickDom, readState, EnvironmentBlocker } from './harness';
import { checkedWindowBounds, equalWindowBounds, withRestoredWindow, type WindowBounds, type WindowRestoration } from './native-window-restoration';
import { text200, verifyText200 } from './observe-dom';
import { prepareApp } from '../native-frame-driver';
import { deliveredResize, deliveredNativeBlur, withNativeFocus, type ResizeWitness, type FocusWitness } from './native-environment-witness';

test('S.pointer.resize',async({browser},info)=>runCase(browser,info,'S.pointer.resize',async h=>{
 const {page,evidence}=h;await start(page,'normal');let pointerId=-1;
 await h.check('native-capture',async()=>{
  await page.evaluate(()=>{
   const events:{id:number;trusted:boolean}[]=[];Object.defineProperty(window,'__acceptancePointerEvents',{value:events});
   document.querySelector('#throttle')!.addEventListener('pointerdown',event=>{const e=event as PointerEvent;events.push({id:e.pointerId,trusted:e.isTrusted});});
  });
  const b=await page.locator('#throttle').boundingBox();if(!b)throw new Error('Missing lever box');
  await page.mouse.move(b.x+b.width/2,b.y+2);await page.mouse.down();
  const events=await page.evaluate(()=>(window as unknown as {__acceptancePointerEvents:{id:number;trusted:boolean}[]}).__acceptancePointerEvents);
  expect(events).toHaveLength(1);expect(events[0].trusted).toBe(true);pointerId=events[0].id;
  expect(await page.locator('#throttle').evaluate((el,id)=>el.hasPointerCapture(id),pointerId)).toBe(true);
  await advanceFrame(page,17);const consumed=await readState(page);expect(consumed.inputs[0].input.throttle).toBe(1);expect(consumed.targetSpeed).toBeCloseTo(110.3,8);
  evidence.observations.capture={pointerId,events,consumed};
 });
 await h.check('outside-drag',async()=>{
  const b=await page.locator('#throttle').boundingBox();if(!b)throw new Error('Missing lever');await page.mouse.move(b.x+b.width+30,Math.max(1,b.y-20));
  expect(await page.locator('#throttle').evaluate((el,id)=>el.hasPointerCapture(id),pointerId)).toBe(true);
  await advanceFrame(page,17);const s=await readState(page);expect(s.inputs.at(-1).input.throttle).toBe(1);expect(s.targetSpeed).toBeGreaterThan(110.3);evidence.observations.outside=s;
  // Actual loop input changes the cooldown label while the lever remains held.
  // A label update must not move the captured control or change its axis.
  const beforeBox=await page.locator('#throttle').boundingBox();expect(beforeBox).not.toBeNull();
  await page.keyboard.press('KeyL');await advanceFrame(page,17);
  const held=await readState(page),afterBox=await page.locator('#throttle').boundingBox();
  expect(held.inputs.at(-1).input.loop).toBe(true);expect(held.inputs.at(-1).input.throttle).toBe(1);
  expect(await page.locator('#throttle').evaluate((el,id)=>el.hasPointerCapture(id),pointerId)).toBe(true);
  expect(afterBox).toEqual(beforeBox);await expect(page.locator('#loop-status')).toContainText('待ち');
  evidence.observations.heldLabelUpdate={beforeBox,afterBox,state:held};
 });
 await h.check('resize-release',async()=>{
  const before=await readState(page),expected={width:1000,height:700};
  await page.evaluate(pointerId=>{
   const proof:{events:ResizeWitness[]}={events:[]};Object.defineProperty(window,'__acceptanceResizeProof',{value:proof});
   window.addEventListener('resize',event=>proof.events.push({sequence:proof.events.length+1,trusted:event.isTrusted,width:innerWidth,height:innerHeight,captured:document.querySelector('#throttle')!.hasPointerCapture(pointerId)}));
  },pointerId);
  await page.setViewportSize(expected);
  let delivered:ResizeWitness|undefined;
  try{await expect.poll(async()=>{
   const proof=await page.evaluate(() => ({...(window as unknown as {__acceptanceResizeProof:{events:ResizeWitness[]}}).__acceptanceResizeProof,width:innerWidth,height:innerHeight,visualViewport:{width:visualViewport?.width,height:visualViewport?.height}}));
   evidence.observations.resizeDelivery=proof;delivered=deliveredResize(proof.events,expected);
   return !!delivered&&proof.width===expected.width&&proof.height===expected.height;
  },{timeout:5000,intervals:[20,50,100,250]}).toBe(true);}
  catch{throw new EnvironmentBlocker('A trusted resize at the requested real dimensions was not delivered; release assertion was not exercised');}
  expect(delivered!.captured).toBe(false);
  expect(await page.locator('#throttle').evaluate((el,id)=>el.hasPointerCapture(id),pointerId)).toBe(false);
  await advanceFrame(page,17);const after=await readState(page);expect(after.inputs.at(-1).input.throttle).toBe(0);expect(after.targetSpeed).toBe(before.targetSpeed);
  await page.mouse.up();evidence.observations.resize={before,after};
 });
 await h.check('fresh-press',async()=>{
  const before=await readState(page);const b=await page.locator('#throttle').boundingBox();if(!b)throw new Error('Missing fresh lever');
  await page.mouse.move(b.x+b.width/2,b.y+2);await page.mouse.down();await advanceFrame(page,17);await page.mouse.up();
  const adjusted=await readState(page);expect(adjusted.inputs.at(-1).input.throttle).toBe(1);expect(adjusted.targetSpeed).toBeGreaterThan(before.targetSpeed);
  await advanceFrame(page,17);const released=await readState(page);expect(released.inputs.at(-1).input.throttle).toBe(0);expect(released.targetSpeed).toBe(adjusted.targetSpeed);
  evidence.observations.fresh={before,adjusted,released};
  const heldBox=await page.locator('#throttle').boundingBox();if(!heldBox)throw new Error('Missing lever before font enlargement');
  await page.mouse.move(heldBox.x+heldBox.width/2,heldBox.y+2);await page.mouse.down();await advanceFrame(page,17);
  const held=await readState(page);expect(held.inputs.at(-1).input.throttle).toBe(1);
  const events=await page.evaluate(()=>(window as unknown as {__acceptancePointerEvents:{id:number;trusted:boolean}[]}).__acceptancePointerEvents);const fontPointer=events.at(-1)!.id;
  expect(events.at(-1)!.trusted).toBe(true);expect(await page.locator('#throttle').evaluate((el,id)=>el.hasPointerCapture(id),fontPointer)).toBe(true);
  const scale=await text200(page);await expect.poll(()=>page.locator('#throttle').evaluate((el,id)=>el.hasPointerCapture(id),fontPointer),{timeout:5000}).toBe(false);
  const measured=await verifyText200(page);await advanceFrame(page,17);const fontCleared=await readState(page);
  expect(fontCleared.inputs.at(-1).input.throttle).toBe(0);expect(fontCleared.targetSpeed).toBe(held.targetSpeed);
  await page.mouse.up();evidence.observations.fontEnlargement={scale,measured,fontPointer,held,fontCleared};
 });
}));

test('S.blur',async({browser},info)=>runCase(browser,info,'S.blur',async h=>{
 const {page,evidence}=h,restorations:{page:string;restored:boolean;error?:string}[]=[],windowRestorations:WindowRestoration[]=[];
 evidence.observations.focusRestorations=restorations;evidence.observations.windowRestorations=windowRestorations;
 evidence.observations.focusSetup='S.blur only: disable verified Playwright forced-focus override; minimize the real browser window through CDP and restore its original bounds/state';
 evidence.observations.nativeWindowNote='Minimize may also dispatch visibilitychange; this proves neither isolated blur-only causality nor physical OS interaction';
 const primary=await page.context().newCDPSession(page);
 await withNativeFocus(primary,async()=>{
  await page.bringToFront();
  try{await expect.poll(()=>page.evaluate(()=>document.hasFocus()),{timeout:5000}).toBe(true);}
  catch{throw new EnvironmentBlocker('Native page focus did not become active after framework focus override was disabled');}
  let original:WindowBounds,windowId:number;
  try{const target=await primary.send('Browser.getWindowForTarget');windowId=target.windowId;original=checkedWindowBounds(target.bounds);}
  catch(error){throw new EnvironmentBlocker('Native window bounds are unavailable: '+String(error));}
  evidence.observations.originalWindow={windowId,bounds:original};
  // The pinned headless-shell ignores fullscreen-to-minimized. Do not normalize a different starting environment silently.
  if(original.windowState!=='normal')throw new EnvironmentBlocker('Native window must initially be normal for the bounded minimize probe');
  await start(page,'normal');await page.locator('#flight').focus();await page.keyboard.down('KeyW');await advanceFrame(page,17);
  const before=await readState(page);expect(before.inputs.at(-1).input.throttle).toBe(1);evidence.observations.beforeMinimize=before;
  try{
   await withRestoredWindow({
    setBounds:bounds=>primary.send('Browser.setWindowBounds',{windowId,bounds}),
    verifyRestored:async expected=>{
     let actual:WindowBounds|undefined;
     await expect.poll(async()=>{const result=await primary.send('Browser.getWindowBounds',{windowId});actual=checkedWindowBounds(result.bounds);return equalWindowBounds(actual,expected);},{timeout:5000,intervals:[20,50,100,250]}).toBe(true);
     return actual!;
    },
   },original,async()=>{
    await h.check('native-blur',async()=>{
     const beforeFocus=await page.evaluate(()=>({hasFocus:document.hasFocus(),visibilityState:document.visibilityState}));evidence.observations.beforeFocus=beforeFocus;
     if(!beforeFocus.hasFocus)throw new EnvironmentBlocker('Native focus was absent before the window action');
     await page.evaluate(()=>{
      const proof:{events:FocusWitness[];visibility:{trusted:boolean;state:string}[]}={events:[],visibility:[]};Object.defineProperty(window,'__acceptanceWindowBlur',{value:proof});
      window.addEventListener('blur',event=>proof.events.push({sequence:proof.events.length+1,trusted:event.isTrusted,hasFocus:document.hasFocus(),visibilityState:document.visibilityState}));
      document.addEventListener('visibilitychange',event=>proof.visibility.push({trusted:event.isTrusted,state:document.visibilityState}));
     });
     try{await primary.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});}
     catch(error){throw new EnvironmentBlocker('Native minimize command is unavailable: '+String(error));}
     try{await expect.poll(async()=>{
      const bounds=(await primary.send('Browser.getWindowBounds',{windowId})).bounds;
      const proof=await page.evaluate(()=>({...(window as unknown as {__acceptanceWindowBlur:{events:FocusWitness[];visibility:{trusted:boolean;state:string}[]}}).__acceptanceWindowBlur,hasFocus:document.hasFocus(),visibilityState:document.visibilityState}));
      evidence.observations.blurDelivery={windowId,bounds,...proof};
      return bounds.windowState==='minimized'&&deliveredNativeBlur(beforeFocus.hasFocus,proof.events,proof.hasFocus);
     },{timeout:5000,intervals:[20,50,100,250]}).toBe(true);}
     catch{throw new EnvironmentBlocker('Native minimized window did not deliver trusted blur plus actual focus loss');}
     // Read the product before restore, so a later restore/resize cannot manufacture the observed pause.
     const stopped=await readState(page);evidence.observations.minimizedProduct=stopped;
     expect(stopped.screen).toBe('paused');expect(stopped.phase).toBe('paused');expect(stopped.tick).toBe(before.tick);expect(stopped.targetSpeed).toBe(before.targetSpeed);expect(stopped.inputs).toEqual(before.inputs);
    });
   },result=>{windowRestorations.push(result);if(!result.restored)evidence.errors.push('Native window restoration failed: '+result.error);});
   await page.bringToFront();
   try{await expect.poll(async()=>{const proof=await page.evaluate(()=>({hasFocus:document.hasFocus(),visibilityState:document.visibilityState}));evidence.observations.restoredFocus=proof;return proof.hasFocus&&proof.visibilityState==='visible';},{timeout:5000}).toBe(true);}
   catch{throw new EnvironmentBlocker('Native focus/visibility did not return after exact window restoration');}
   await h.check('pause',async()=>{expect((await readState(page)).screen).toBe('paused');});
   await h.check('input-cleared',async()=>{
    const paused=await readState(page);await advanceFrame(page,100);const frozen=await readState(page);expect(frozen.tick).toBe(paused.tick);expect(frozen.hash).toBe(paused.hash);evidence.observations.frozen={paused,frozen};
   });
   await h.check('explicit-resume',async()=>{
    await clickDom(page,'#resume');await advanceFrame(page,0);await advanceFrame(page,17);const resumed=await readState(page);
    expect(resumed.screen).toBe('playing');expect(resumed.inputs.at(-1).input.throttle).toBe(0);expect(resumed.targetSpeed).toBe(before.targetSpeed);evidence.observations.resumed=resumed;
   });
  }finally{await page.keyboard.up('KeyW');}
 },result=>{restorations.push({page:'primary',...result});if(!result.restored)evidence.errors.push('Primary-page focus override restoration failed: '+result.error);});
}));

test('S.context-loss',async({browser},info)=>runCase(browser,info,'S.context-loss',async h=>{
 const {page,evidence}=h;await start(page,'normal');await advanceFrame(page,17);const before=await readState(page);
 await h.check('native-context-loss',async()=>{
  const available=await page.evaluate(()=>{const gl=document.querySelector<HTMLCanvasElement>('#flight')!.getContext('webgl2');const ext=gl?.getExtension('WEBGL_lose_context');if(!ext)return false;ext.loseContext();return true;});
  if(!available)throw new EnvironmentBlocker('Native WEBGL_lose_context extension is unavailable; fault gate not exercised');await expect(page.locator('#pause-reason')).toContainText('描画が停止');
 });
 await h.check('safe-stop',async()=>{const stopped=await readState(page);expect(stopped.screen).toBe('paused');expect(stopped.ready).toBe(false);expect(stopped.tick).toBe(before.tick);evidence.observations.stopped=stopped;});
 await h.check('no-auto-resume',async()=>{
  // After actual loss no GPU fence can complete. Pump only the queued real app callbacks.
  // This is an explicit fault observation, never a normal successful frame.
  await page.evaluate(()=>(window as unknown as {__acceptanceClock:{advance(ms:number):number}}).__acceptanceClock.advance(17));
  const stopped=await readState(page);expect(stopped.screen).toBe('paused');expect(stopped.ready).toBe(false);expect(stopped.tick).toBe(before.tick);
 });
 await h.check('reload-only',async()=>{
  await expect(page.locator('#resume')).toBeHidden();await expect(page.locator('#pause-reload')).toBeVisible();
  await Promise.all([page.waitForEvent('domcontentloaded'),clickDom(page,'#pause-reload')]);
  await prepareApp(page);const reloaded=await readState(page);expect(reloaded.ready).toBe(true);expect(reloaded.screen).toBe('home');expect(reloaded.tick).toBe(0);evidence.observations.reloaded=reloaded;
 });
}));
