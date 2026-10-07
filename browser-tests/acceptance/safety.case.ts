import { expect, test } from '@playwright/test';
import { runCase, start, advanceFrame, clickDom, readState, EnvironmentBlocker } from './harness';
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
 });
}));

test('S.blur',async({browser},info)=>runCase(browser,info,'S.blur',async h=>{
 const {page,evidence}=h,restorations:{page:string;restored:boolean;error?:string}[]=[];
 evidence.observations.focusRestorations=restorations;
 evidence.observations.focusSetup='Only this case disables Playwright 1.61.1 forced-focus emulation; native tab activation must then supply real focus/blur';
 const primary=await page.context().newCDPSession(page);
 await withNativeFocus(primary,async()=>{
  await page.bringToFront();
  try{await expect.poll(()=>page.evaluate(()=>document.hasFocus()),{timeout:5000}).toBe(true);}
  catch{throw new EnvironmentBlocker('Native page focus did not become active after framework focus override was disabled');}
  await start(page,'normal');await page.locator('#flight').focus();await page.keyboard.down('KeyW');await advanceFrame(page,17);
  const before=await readState(page);expect(before.inputs.at(-1).input.throttle).toBe(1);
  let other:import('@playwright/test').Page|undefined;
  try {
   await h.check('native-blur',async()=>{
    const beforeFocus=await page.evaluate(()=>({hasFocus:document.hasFocus(),visibilityState:document.visibilityState}));
    evidence.observations.beforeFocus=beforeFocus;
    if(!beforeFocus.hasFocus)throw new EnvironmentBlocker('Native focus was absent before the tab action');
    await page.evaluate(()=>{const events:FocusWitness[]=[];Object.defineProperty(window,'__acceptanceBlur',{value:events});window.addEventListener('blur',event=>events.push({sequence:events.length+1,trusted:event.isTrusted,hasFocus:document.hasFocus(),visibilityState:document.visibilityState}));});
    other=await page.context().newPage();const secondary=await page.context().newCDPSession(other);
    await withNativeFocus(secondary,async()=>{
     await other!.bringToFront();
     try{await expect.poll(async()=>{
      const proof=await page.evaluate(()=>({events:(window as unknown as {__acceptanceBlur:FocusWitness[]}).__acceptanceBlur,hasFocus:document.hasFocus(),visibilityState:document.visibilityState}));
      evidence.observations.blurDelivery=proof;return deliveredNativeBlur(beforeFocus.hasFocus,proof.events,proof.hasFocus);
     },{timeout:5000,intervals:[20,50,100,250]}).toBe(true);}
     catch{throw new EnvironmentBlocker('Native tab action did not deliver trusted blur plus actual focus loss with the framework override disabled');}
     evidence.observations.nativeTabNote='Tab visibility may change with focus; this does not claim isolated window-blur-only causality';
     await page.bringToFront();
     try{await expect.poll(()=>page.evaluate(()=>document.hasFocus()),{timeout:5000}).toBe(true);}
     catch{throw new EnvironmentBlocker('Native focus did not return for explicit recovery');}
     await page.keyboard.up('KeyW');
    },result=>{restorations.push({page:'other',...result});if(!result.restored)evidence.errors.push('Other-page focus override restoration failed: '+result.error);});
   });
   await h.check('pause',async()=>{expect((await readState(page)).screen).toBe('paused');});
   await h.check('input-cleared',async()=>{
    const paused=await readState(page);await advanceFrame(page,100);const frozen=await readState(page);expect(frozen.tick).toBe(paused.tick);expect(frozen.hash).toBe(paused.hash);evidence.observations.frozen={paused,frozen};
   });
   await h.check('explicit-resume',async()=>{
    await clickDom(page,'#resume');await advanceFrame(page,0);await advanceFrame(page,17);const resumed=await readState(page);
    expect(resumed.screen).toBe('playing');expect(resumed.inputs.at(-1).input.throttle).toBe(0);expect(resumed.targetSpeed).toBe(before.targetSpeed);evidence.observations.resumed=resumed;
   });
  } finally {if(other&&!other.isClosed())await other.close();}
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
