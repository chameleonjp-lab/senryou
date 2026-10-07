import { expect, test } from '@playwright/test';
import { runCase, start, advanceFrame, clickDom, readState, EnvironmentBlocker } from './harness';
import { prepareApp } from '../native-frame-driver';

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
  const before=await readState(page);await page.setViewportSize({width:1000,height:700});
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
 const {page,evidence}=h;await start(page,'normal');await page.locator('#flight').focus();await page.keyboard.down('KeyW');await advanceFrame(page,17);
 const before=await readState(page);expect(before.inputs.at(-1).input.throttle).toBe(1);
 await h.check('native-blur',async()=>{
  await page.evaluate(()=>{Object.defineProperty(window,'__acceptanceBlur',{value:[]});window.addEventListener('blur',e=>(window as unknown as {__acceptanceBlur:boolean[]}).__acceptanceBlur.push(e.isTrusted));});
  const other=await page.context().newPage();await other.bringToFront();
  try{await expect.poll(()=>page.evaluate(()=>(window as unknown as {__acceptanceBlur:boolean[]}).__acceptanceBlur.includes(true))).toBe(true);}
  catch{throw new EnvironmentBlocker('Headless browser did not produce trusted window blur; product blur response was not exercised');}
  await page.bringToFront();await other.close();await page.keyboard.up('KeyW');
 });
 await h.check('pause',async()=>{expect((await readState(page)).screen).toBe('paused');});
 await h.check('input-cleared',async()=>{
  const paused=await readState(page);await advanceFrame(page,100);const frozen=await readState(page);expect(frozen.tick).toBe(paused.tick);expect(frozen.hash).toBe(paused.hash);evidence.observations.frozen={paused,frozen};
 });
 await h.check('explicit-resume',async()=>{
  await clickDom(page,'#resume');await advanceFrame(page,0);await advanceFrame(page,17);const resumed=await readState(page);
  expect(resumed.screen).toBe('playing');expect(resumed.inputs.at(-1).input.throttle).toBe(0);expect(resumed.targetSpeed).toBe(before.targetSpeed);evidence.observations.resumed=resumed;
 });
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
