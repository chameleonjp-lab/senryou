import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const sizes = [{width:320,height:568},{width:393,height:852},{width:568,height:320},{width:852,height:393}];
async function setRange(page:Page,id:string,value:string) {
  await page.locator('#'+id).evaluate((element,value)=>{const input=element as HTMLInputElement;input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));},value);
}
async function settings(page:Page) {
  await page.locator('#home-controls').click();
  await page.locator('#control-editor-touch').click();
  await page.locator('#control-mode').selectOption('normal');
}
async function ready(page:Page) {
  await expect(page.locator('#start'), 'WebGL startup must actually finish').toBeEnabled({timeout:45000});
}
async function start(page:Page) {
  await ready(page); await page.locator('input[value="normal"]').check(); await page.locator('#start').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen','playing');
}
test('native slider keyup clears prior global handover blocking before a fresh press', async ({page}) => {
  await page.route('**/throttle-focus-harness', route => route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="app"><div id="surface" tabindex="0"></div><button id="fire">Fire</button><button id="loop">Loop</button><button id="bomb">Bomb</button><div id="throttle" role="slider" tabindex="0" style="width:64px;height:128px"></div></div></body></html>'}));
  await page.goto('/throttle-focus-harness');
  await page.evaluate(async () => {
    const { FlightControls } = await import('/src/input.ts');
    const get = (id:string) => document.getElementById(id)!;
    (window as any).focusControls = new FlightControls(get('surface'), {fire:get('fire') as HTMLButtonElement,loop:get('loop') as HTMLButtonElement,bomb:get('bomb') as HTMLButtonElement,throttle:get('throttle')}, () => true);
  });
  const climb = () => page.evaluate(() => (window as any).focusControls.sample(false).climb);
  await page.locator('#surface').focus(); await page.keyboard.down('ArrowUp'); expect(await climb()).toBe(1);
  await page.locator('#throttle').focus(); expect(await climb()).toBe(0);
  // The real keyup targets the slider and is stopped there in bubble phase.
  await page.keyboard.up('ArrowUp');
  await page.locator('#surface').focus(); await page.keyboard.down('ArrowUp'); expect(await climb()).toBe(1);
  await page.keyboard.up('ArrowUp'); expect(await climb()).toBe(0);
  await page.evaluate(() => (window as any).focusControls.dispose());
});
for (const size of sizes) {
  test(`lever preview and Cancel ${size.width}x${size.height}`, async({page},info)=>{
    await page.setViewportSize(size); await page.goto('/'); await settings(page);
    await page.locator('#control-target').selectOption('throttle');
    expect(await page.locator('#control-target option').allTextContents()).toEqual(['射撃','宙返り','速度レバー','爆弾']);
    const shape=await page.locator('.preview-throttle').evaluate(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height,border:getComputedStyle(e).borderRadius};});
    expect(shape.height).toBeGreaterThan(shape.width*1.9); expect(shape.border).not.toBe('50%');
    for (const id of ['control-x','control-y','control-size','control-opacity']) {
      await page.locator('#'+id).scrollIntoViewIfNeeded(); await expect(page.locator('#'+id)).toBeInViewport();
    }
    await page.locator('#control-preview').scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('settings-preview.png')});
    await page.locator('#control-cancel').click();
    expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);
  });
  test(`Normal live lever geometry and Easy ${size.width}x${size.height}`, async({page,browserName})=>{
    test.skip(browserName==='webkit', 'WebGL flight is verified in Chromium; Linux WebKit retains settings and production DOM-input coverage');
    await page.setViewportSize(size); await page.goto('/'); await start(page);
    const geometry=await page.locator('#throttle').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,hit:getComputedStyle(e).pointerEvents};});
    expect(geometry.width).toBeGreaterThanOrEqual(44);expect(geometry.height).toBeGreaterThanOrEqual(44);expect(geometry.height).toBeCloseTo(geometry.width*2,1);
    expect(geometry.x).toBeGreaterThanOrEqual(0);expect(geometry.y).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(size.width);expect(geometry.bottom).toBeLessThanOrEqual(size.height);
    expect(geometry.hit).toBe('auto'); await expect(page.locator('#throttle')).toHaveAttribute('aria-orientation','vertical');
    expect(await page.locator('#accelerate,#brake').count()).toBe(0);
    await page.evaluate(()=>{const q=(window as any).__senryou;q.home();q.fixture('easy');});
    await expect(page.locator('#throttle')).not.toBeVisible();await expect(page.locator('#throttle-layout-note')).not.toBeVisible();
  });
}
test('native pointer, focused short keys, PC binding, pause and release retain target speed',async({page,browserName})=>{
  test.skip(browserName==='webkit', 'Live WebGL target-speed integration is verified in Chromium; WebKit DOM input is covered separately');
  await page.goto('/');await start(page);
  const target=()=>page.evaluate(()=>(window as any).__senryou.game.controller?.playerTargetSpeed??110);
  const box=(await page.locator('#throttle').boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+22);await page.mouse.down();
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow','100');
  await expect.poll(target).toBeGreaterThan(110.3);
  await page.mouse.move(box.x+box.width/2,box.y+box.height+100);await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow','-100');
  await page.mouse.up();await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow','0');
  const held=await target();await page.waitForTimeout(120);expect(await target()).toBeCloseTo(held,6);
  await page.locator('#throttle').focus();const before=await target();await page.keyboard.press('ArrowUp');await expect.poll(target).toBeGreaterThan(before);
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow','0');
  await page.keyboard.down('ArrowDown');await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow','-100');
  await page.keyboard.press('Escape');await page.keyboard.up('ArrowDown');await expect(page.locator('#app')).toHaveAttribute('data-screen','paused');
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow','0');
  const stopped=await target();await page.waitForTimeout(120);expect(await target()).toBe(stopped);
  await page.locator('#resume').click();await page.keyboard.down('KeyW');await expect.poll(target).toBeGreaterThan(stopped);await page.keyboard.up('KeyW');
});
test('legacy bytes survive Save twice, reload, Cancel, future guard and session-only use',async({page})=>{
  await page.addInitScript(()=>{if(!localStorage.getItem('senryou-controls-v1'))localStorage.setItem('senryou-controls-v1','{"version":1,"controls":{"accelerate":{"x":0.75,"y":0.8,"size":70,"opacity":0.7},"brake":{"x":0.75,"y":0.6,"size":70,"opacity":0.7},"bomb":{"x":0.39,"y":0.72,"size":56,"opacity":0.88}}}');});
  await page.goto('/');const old=await page.evaluate(()=>localStorage.getItem('senryou-controls-v1'));
  for(const x of [24,30]){await settings(page);await page.locator('#control-target').selectOption('throttle');await setRange(page,'control-x',String(x));await page.locator('#control-save').click();await expect(page.locator('#control-settings')).not.toBeVisible();await page.reload();}
  expect(await page.evaluate(()=>localStorage.getItem('senryou-controls-v1'))).toBe(old);
  const saved=await page.evaluate(()=>localStorage.getItem('senryou-controls-v2'));
  expect(JSON.parse(saved!).controls.throttle.x).toBe(.3);expect(JSON.parse(saved!).controls.bomb.y).toBe(.72);
  await settings(page);await page.locator('#control-target').selectOption('throttle');await setRange(page,'control-x','40');await page.locator('#control-cancel').click();
  expect(await page.evaluate(()=>localStorage.getItem('senryou-controls-v2'))).toBe(saved);
  await page.evaluate(()=>localStorage.setItem('senryou-controls-v2','{"version":99,"controls":{"future":true}}'));await page.reload();
  await settings(page);await page.locator('#control-target').selectOption('throttle');await setRange(page,'control-x','40');await page.locator('#control-save').click();
  await expect(page.locator('#control-save')).toHaveText('今回だけ使う');expect(await page.evaluate(()=>localStorage.getItem('senryou-controls-v2'))).toBe('{"version":99,"controls":{"future":true}}');
  await page.locator('#control-save').click();await expect(page.locator('#control-settings')).not.toBeVisible();
});
for(const style of ['text','zoom'])test(`settings retain footer and scrolling at 200 percent ${style}`,async({page},info)=>{
  await page.goto('/');await settings(page);
  await page.addStyleTag({content: style==='zoom'?'html { zoom: 2; }':'#control-settings { font-size: 200%; } #control-settings p, #control-settings label, #control-settings button, #control-settings select { font-size: 1em !important; }'});
  await page.locator('#control-opacity').scrollIntoViewIfNeeded();await expect(page.locator('#control-opacity')).toBeInViewport();
  await page.locator('#control-save').scrollIntoViewIfNeeded();await expect(page.locator('#control-save')).toBeInViewport({ratio:1});
  const dialog=await page.locator('#control-settings').boundingBox(),viewport=page.viewportSize()!;expect(dialog!.x).toBeGreaterThanOrEqual(0);expect(dialog!.x+dialog!.width).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({path:info.outputPath(`settings-200-${style}.png`)});
  await page.locator('#control-cancel').click();await expect(page.locator('#control-settings')).not.toBeVisible();
});
for(const size of sizes)test(`same-condition before-after ${size.width}x${size.height}`,async({page,browserName},info)=>{
  test.skip(browserName==='webkit', 'WebGL baseline/candidate comparison is verified in Chromium only');
  test.skip(!process.env.THROTTLE_BASELINE_DIR,'Pinned baseline checkout is required for real comparison');
  await page.setViewportSize(size);
  await mkdir(info.outputPath('comparison'),{recursive:true});
  const records=[];
  for(const [label,url]of [['before','http://127.0.0.1:4177/'],['after','http://127.0.0.1:4178/']]){
    await page.goto(url);await ready(page);
    await page.screenshot({path:info.outputPath('comparison',`${label}-home.png`)});
    await page.evaluate(()=>{const q=(window as any).__senryou;q.fixture('normal');q.step(1);q.mission.phase='paused';document.getElementById('flight')!.focus();});
    // Both revisions use the same seed, single authoritative tick and stopped mission.
    await page.waitForTimeout(200);
    records.push(await page.evaluate(()=>{const q=(window as any).__senryou;return {url:location.origin,hash:q.snapshot().hash,tick:q.mission.tick,mode:q.snapshot().mode,dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],screen:document.getElementById('app')!.dataset.screen};}));
    await page.screenshot({path:info.outputPath('comparison',`${label}-normal.png`)});
    await page.evaluate(()=>(window as any).__senryou.home());await settings(page);await page.locator('#control-preview').scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('comparison',`${label}-settings.png`)});
  }
  expect(records[0].tick).toBe(1);expect(records[1].tick).toBe(1);expect(records[0].hash).toBe(records[1].hash);
  await writeFile(info.outputPath('comparison','conditions.json'),JSON.stringify({browserName,size,baseline:'71b0e5bc9ffbe2cbd1f295160b9e8e3c40ad6650',records},null,2));
});


/** Native DOM-input fixture uses the production adapter without requiring WebGL. */
async function controlsHarness(page:Page):Promise<void> {
  await page.route('**/throttle-native-harness', route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0"><div id="app" style="position:relative;width:393px;height:852px"><div id="surface" tabindex="0" style="position:absolute;left:120px;top:150px;width:220px;height:450px;touch-action:none"></div><button id="fire" style="position:absolute;left:20px;top:300px;width:64px;height:64px;touch-action:none">Fire</button><button id="loop">Loop</button><button id="bomb">Bomb</button><div id="throttle" role="slider" tabindex="0" style="position:absolute;left:20px;top:100px;width:64px;height:128px;touch-action:none"></div></div></body></html>'}));
  await page.goto('/throttle-native-harness');
  await page.evaluate(async()=>{
    const {FlightControls}=await import('/src/input.ts'); const get=(id:string)=>document.getElementById(id)!;
    (window as any).nativeControls=new FlightControls(get('surface'),{fire:get('fire') as HTMLButtonElement,loop:get('loop') as HTMLButtonElement,bomb:get('bomb') as HTMLButtonElement,throttle:get('throttle')},()=>true);
  });
}
test('native DOM input matches 200 percent zoom endpoints and clears focused PC keys',async({page})=>{
  await controlsHarness(page);
  await page.evaluate(()=>{document.documentElement.style.zoom='2';});
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const box=(await page.locator('#throttle').boundingBox())!;
  expect(box.width).toBeCloseTo(128,1);expect(box.height).toBeCloseTo(256,1);
  const axis=()=>page.evaluate(()=>(window as any).nativeControls.sampleThrottle());
  await page.mouse.move(box.x+box.width/2,box.y+44);await page.mouse.down();expect(await axis()).toBe(1);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);expect(await axis()).toBe(0);
  await page.mouse.move(box.x+box.width/2,box.y+box.height-44);expect(await axis()).toBe(-1);
  await page.mouse.up();expect(await axis()).toBe(0);
  await page.locator('#throttle').focus();await page.keyboard.down('KeyW');expect(await axis()).toBe(1);
  await page.locator('#surface').focus();expect(await axis()).toBe(0);await page.keyboard.up('KeyW');
  await page.locator('#throttle').focus();await page.keyboard.down('KeyS');expect(await axis()).toBe(-1);
  await page.keyboard.press('Escape');expect(await axis()).toBe(0);await page.keyboard.up('KeyS');
  await page.evaluate(()=>(window as any).nativeControls.dispose());
});
test('native touch steering and fire survive lever focus and release',async({page,context,browserName})=>{
  test.skip(browserName!=='chromium','Trusted multi-touch uses Chromium CDP; WebKit native pointer/keyboard coverage remains separate');
  await controlsHarness(page);const cdp=await context.newCDPSession(page);
  const steer={x:180,y:450,id:1},moved={x:198,y:450,id:1},fire={x:52,y:332,id:2},lever={x:52,y:122,id:3};
  let touchesActive=false;
  try {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[steer]});touchesActive=true;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[moved]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[moved,fire]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[moved,fire,lever]});
    const read=()=>page.evaluate(()=>({input:(window as any).nativeControls.sample(false),owners:(window as any).nativeControls.peek()}));
    const before=await read();expect(before.input.turn).toBeGreaterThan(0);expect(before.input.fire).toBe(true);expect(before.input.throttle).toBe(1);
    await page.locator('#throttle').focus();const focused=await read();expect(focused.owners.steerPointer).toBe(before.owners.steerPointer);expect(focused.input.turn).toBe(before.input.turn);expect(focused.input.fire).toBe(true);
    // Chromium WebTouch ends the named contact, not the remaining contacts.
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[lever]});
    const released=await read();expect(released.input.throttle).toBe(0);expect(released.input.fire).toBe(true);expect(released.owners.steerPointer).toBe(before.owners.steerPointer);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});touchesActive=false;
    const cancelled=await read();expect(cancelled.input.fire).toBe(false);expect(cancelled.input.turn).toBe(0);
  } finally { if(touchesActive) await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await cdp.detach();await page.evaluate(()=>(window as any).nativeControls.dispose()); }
});
for(const size of [{width:320,height:568},{width:568,height:320}])test(`hidden HUD utility obstacles survive migration ${size.width}x${size.height}`,async({page,browserName})=>{
  await page.setViewportSize(size);await page.goto('/');
  const measured=await page.evaluate(async()=>{
    const {measureHudObstacles,controlLayoutSize}=await import('/src/control-obstacles.ts');
    const app=document.getElementById('app')!;const before=app.outerHTML;const obstacles=measureHudObstacles(app);
    return {obstacles,unchanged:before===app.outerHTML,apps:document.querySelectorAll('#app').length,huds:document.querySelectorAll('#hud').length,...controlLayoutSize(app)};
  });
  expect(measured.unchanged).toBe(true);expect(measured.apps).toBe(1);expect(measured.huds).toBe(1);expect(measured.obstacles.length).toBeGreaterThan(0);
  for(const obstacle of measured.obstacles){
    const placement={x:obstacle.x/measured.width,y:obstacle.y/measured.height,size:64,opacity:.82};
    const old=JSON.stringify({version:1,controls:{accelerate:placement,brake:placement}});
    await page.evaluate(raw=>{localStorage.setItem('senryou-controls-v1',raw);localStorage.removeItem('senryou-controls-v2');},old);
    await page.reload();await settings(page);await page.locator('#control-target').selectOption('throttle');await page.locator('#control-preview').scrollIntoViewIfNeeded();
    await expect(page.locator('.preview-throttle')).not.toHaveAttribute('aria-disabled','true');await page.locator('#control-cancel').click();
    expect(await page.evaluate(()=>localStorage.getItem('senryou-controls-v1'))).toBe(old);
    if(browserName==='chromium'){
      await start(page);
      const reachable=await page.locator('#hud').evaluate(hud=>[...hud.querySelectorAll<HTMLElement>('button:not(.action-control):not(.flight-button):not([data-flight-control])')].every(button=>{
        const rect=button.getBoundingClientRect(),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);return hit===button||Boolean(hit&&button.contains(hit));
      }));expect(reachable).toBe(true);
      await page.locator('#pause').click();await page.locator('#pause-home').click();
    }
  }
});
