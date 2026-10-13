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
test('native slider keyup clears prior global handover blocking before a fresh press', async ({page}, info) => {
  await page.route('**/throttle-focus-harness', route => route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="app"><div id="surface" tabindex="0"></div><button id="fire">Fire</button><button id="loop">Loop</button><button id="bomb">Bomb</button><div id="throttle" role="slider" tabindex="0" style="width:64px;height:128px"></div></div></body></html>'}));
  await page.goto('/throttle-focus-harness');
  await page.evaluate(async () => {
    const { FlightControls } = await import('/src/input.ts');
    // Test-only, bounded evidence. Preserve the original clear() call/receiver/result.
    const evidence: any = { schema: 1, scope: 'webkit-initial-input-release', events: [], dropped: 0 };
    const record = (kind: string, extra: Record<string, unknown> = {}) => {
      if (evidence.events.length >= 128) { evidence.dropped += 1; return; }
      evidence.events.push({ kind, at: performance.now(), activeElement: document.activeElement?.id ?? '',
        documentFocused: document.hasFocus(), hidden: document.hidden,
        viewport: [innerWidth, innerHeight, visualViewport?.width ?? null, visualViewport?.height ?? null], ...extra });
    };
    const capture = (event: Event) => record('event', { type: event.type, trusted: event.isTrusted,
      target: (event.target as HTMLElement | null)?.id ?? '',
      code: event instanceof KeyboardEvent ? event.code : null,
      repeat: event instanceof KeyboardEvent ? event.repeat : null });
    const observed = ['blur', 'focus', 'pagehide', 'resize', 'orientationchange', 'keydown', 'keyup'];
    for (const type of observed) window.addEventListener(type, capture, true);
    document.addEventListener('visibilitychange', capture, true);
    visualViewport?.addEventListener('resize', capture, true);
    const originalClear = FlightControls.prototype.clear;
    FlightControls.prototype.clear = function (...args: []) {
      const self = this as any;
      record('clear-before', { keys: [...self.keys], physicalKeys: [...self.physicalKeys], blockedKeys: [...self.blockedKeys],
        stack: new Error('clear caller').stack?.split('\n').slice(0, 8).join('\n') ?? '' });
      const result = Reflect.apply(originalClear, this, args);
      record('clear-after', { keys: [...self.keys], physicalKeys: [...self.physicalKeys], blockedKeys: [...self.blockedKeys] });
      return result;
    };
    (window as any).inputReleaseEvidence = evidence;
    (window as any).finishInputReleaseEvidence = () => {
      record('finish', { keys: [...((window as any).focusControls?.keys ?? [])] });
      FlightControls.prototype.clear = originalClear;
      for (const type of observed) window.removeEventListener(type, capture, true);
      document.removeEventListener('visibilitychange', capture, true);
      visualViewport?.removeEventListener('resize', capture, true);
      return evidence;
    };
    const get = (id:string) => document.getElementById(id)!;
    (window as any).focusControls = new FlightControls(get('surface'), {fire:get('fire') as HTMLButtonElement,loop:get('loop') as HTMLButtonElement,bomb:get('bomb') as HTMLButtonElement,throttle:get('throttle')}, () => true);
  });
  try {
    // Ignore the browser's deferred startup resize before measuring input
    // release behavior. Any resize restarts the four-frame quiet window.
    await page.evaluate(()=>new Promise<void>(resolve=>{
      let quietFrames=0;
      const viewportKey=()=>[innerWidth,innerHeight,visualViewport?.width??null,visualViewport?.height??null].join('x');
      let viewport=viewportKey();
      const onResize=()=>{quietFrames=0;viewport=viewportKey();};
      const nextFrame=()=>{
        const current=viewportKey();
        if(current!==viewport){viewport=current;quietFrames=0;}else quietFrames++;
        if(quietFrames>=4){
          removeEventListener('resize',onResize);
          removeEventListener('orientationchange',onResize);
          visualViewport?.removeEventListener('resize',onResize);
          resolve();return;
        }
        requestAnimationFrame(nextFrame);
      };
      addEventListener('resize',onResize);
      addEventListener('orientationchange',onResize);
      visualViewport?.addEventListener('resize',onResize);
      requestAnimationFrame(nextFrame);
    }));
    const climb = () => page.evaluate(() => (window as any).focusControls.sample(false).climb);
    await page.locator('#surface').focus(); await page.keyboard.down('ArrowUp'); expect(await climb()).toBe(1);
    await page.locator('#throttle').focus(); expect(await climb()).toBe(0);
    // The real keyup targets the slider and is stopped there in bubble phase.
    await page.keyboard.up('ArrowUp');
    await page.locator('#surface').focus(); await page.keyboard.down('ArrowUp'); expect(await climb()).toBe(1);
    await page.keyboard.up('ArrowUp'); expect(await climb()).toBe(0);
    await page.evaluate(() => (window as any).focusControls.dispose());
  } finally {
    const evidence = await page.evaluate(() => (window as any).finishInputReleaseEvidence?.() ?? { unavailable: true });
    await info.attach('input-release-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  }
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
const expectedMapPoints = {
  before: [
    { id: 'HA', x: -2400, y: 12, z: 0 }, { id: 'P1', x: -1400, y: 12, z: 0 },
    { id: 'P2', x: 0, y: 12, z: -900 }, { id: 'P3', x: 0, y: 12, z: 0 },
    { id: 'P4', x: 0, y: 12, z: 900 }, { id: 'P5', x: 1400, y: 12, z: 0 },
    { id: 'HB', x: 2400, y: 12, z: 0 },
  ],
  after: [
    { id: 'HA', x: -1200, y: 12, z: 0 }, { id: 'P1', x: -700, y: 12, z: 0 },
    { id: 'P2', x: 0, y: 12, z: -450 }, { id: 'P3', x: 0, y: 12, z: 0 },
    { id: 'P4', x: 0, y: 12, z: 450 }, { id: 'P5', x: 700, y: 12, z: 0 },
    { id: 'HB', x: 1200, y: 12, z: 0 },
  ],
} as const;
const expectedSpawnAnchors = {
  before: {
    'A-aircraft-000': { x: -2850, y: 600, z: -720 }, 'B-aircraft-000': { x: 2850, y: 600, z: -720 },
    'A-infantry-000': { x: -1510, y: 12, z: -132.4 }, 'B-infantry-000': { x: 1510, y: 12, z: -132.4 },
    'A-tank-000': { x: -1590, y: 12, z: -67 }, 'B-tank-000': { x: 1590, y: 12, z: -67 },
    'A-aa-000': { x: -1550, y: 12, z: -305 }, 'B-aa-000': { x: 1550, y: 12, z: -305 },
  },
  after: {
    'A-aircraft-000': { x: -1425, y: 600, z: -720 }, 'B-aircraft-000': { x: 1425, y: 600, z: -720 },
    'A-infantry-000': { x: -755, y: 12, z: -67.4 }, 'B-infantry-000': { x: 755, y: 12, z: -67.4 },
    'A-tank-000': { x: -795, y: 12, z: -67 }, 'B-tank-000': { x: 795, y: 12, z: -67 },
    'A-aa-000': { x: -775, y: 12, z: -152.5 }, 'B-aa-000': { x: 775, y: 12, z: -152.5 },
  },
} as const;
// Send the same command through both the old button schema and the analog axis.
const comparisonInput = { turn: .25, climb: .12, fire: false, loop: false, bomb: false,
  throttle: 1, accelerate: true, brake: false };

for (const size of sizes) test('same-condition before-after ' + size.width + 'x' + size.height, async ({ page, browserName }, info) => {
  test.skip(browserName === 'webkit', 'WebGL baseline/candidate comparison is verified in Chromium only');
  test.skip(!process.env.THROTTLE_BASELINE_DIR, 'Pinned baseline checkout is required for real comparison');
  await page.setViewportSize(size);
  await mkdir(info.outputPath('comparison'), { recursive: true });
  const records: any[] = [];

  for (const { label, url } of [
    { label: 'before', url: 'http://127.0.0.1:4177/' },
    { label: 'after', url: 'http://127.0.0.1:4178/' },
  ]) {
    await page.goto(url);
    await ready(page);
    await page.screenshot({ path: info.outputPath('comparison', label + '-home.png') });
    records.push(await page.evaluate(async ({ label, input }: {
      label: string;
      input: typeof comparisonInput & { viewAspect: number };
    }) => {
      const [{ MAX_TICKS, TICK_RATE, RULES_VERSION }, { logicalHash }, { battleHash }, { MAP_POINTS, initialUnitPosition }] =
        await Promise.all([
          import('/src/battle/rules.ts'),
          import('/src/battle/mission.ts'),
          import('/src/battle/simulation.ts'),
          import('/src/battle/terrain.ts'),
        ]);
      const q = (window as any).__senryou;
      q.fixture('normal');
      const mission = q.mission, game = q.game;
      const initialTick = mission.tick;
      const serialize = (value: unknown) => JSON.stringify(value,
        (_key, item) => item instanceof Map ? [...item] : item instanceof Set ? [...item] : item);
      const hash = (text: string) => {
        let value = 2166136261;
        for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
        return (value >>> 0).toString(16).padStart(8, '0');
      };
      const changedTopLevel = (left: string, right: string) => {
        const a = JSON.parse(left), b = JSON.parse(right);
        return [...new Set([...Object.keys(a), ...Object.keys(b)])]
          .filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key])).sort();
      };
      const flight = (unit: any) => {
        const magnitude = Math.hypot(unit.velocity.x, unit.velocity.y, unit.velocity.z);
        return {
          id: unit.id, team: unit.team, kind: unit.kind, role: unit.role,
          position: { ...unit.position }, velocity: { ...unit.velocity },
          heading: unit.heading,
          pitch: unit.pitch ?? Math.atan2(unit.velocity.y, Math.hypot(unit.velocity.x, unit.velocity.z)),
          bank: unit.bank ?? 0, speed: unit.speed ?? (magnitude || 110),
          loopProgress: unit.loopProgress ?? 0, loopCooldown: unit.loopCooldown ?? 0,
          hp: unit.hp, hpFixed: unit.hpFixed, ammo: unit.ammo, cannonAmmo: unit.cannonAmmo, bombs: unit.bombs,
        };
      };

      const missionTextBefore = serialize(mission), combatTextBefore = serialize(game.combat);
      const sourcePoints = MAP_POINTS.map(({ id, position }: any) =>
        ({ id, x: position.x, y: position.y, z: position.z }));
      const missionPoints = mission.points.map((point: any) =>
        ({ id: point.id, x: point.position.x, y: point.position.y, z: point.position.z }));
      const counts: Record<string, number> = {};
      const activeStarts = mission.units.filter((unit: any) => unit.state === 'active')
        .sort((a: any, b: any) => a.id.localeCompare(b.id)).map((unit: any) => {
          const key = unit.team + '/' + unit.kind, index = counts[key] ?? 0;
          counts[key] = index + 1;
          const expected = initialUnitPosition(unit.team, unit.kind, index);
          return {
            id: unit.id, team: unit.team, kind: unit.kind, position: { ...unit.position }, expected: { ...expected },
            matchesSource: unit.position.x === expected.x && unit.position.y === expected.y && unit.position.z === expected.z,
          };
        });
      const pilotBeforeUnit = mission.units.find((unit: any) => unit.id === mission.controlledAircraftId)!;
      const pilotBefore = flight(pilotBeforeUnit);
      const initialRaw = {
        mission: hash(missionTextBefore), combat: hash(combatTextBefore),
        battle: q.snapshot().hash, logicalMission: logicalHash(mission),
      };

      q.step(1, input);
      mission.phase = 'paused';
      document.getElementById('flight')!.focus();
      const pilotAfterUnit = mission.units.find((unit: any) => unit.id === mission.controlledAircraftId)!;
      const pilotAfter = flight(pilotAfterUnit);
      const missionTextAfter = serialize(mission), combatTextAfter = serialize(game.combat);
      const { targetLock, ...inheritedController } = game.controller;
      const inheritedControllerState = Object.fromEntries(Object.entries(inheritedController).map(([key, value]) =>
        [key, value === undefined ? { $type: 'undefined' } : value]));
      const displacement = {
        x: pilotAfter.position.x - pilotBefore.position.x,
        y: pilotAfter.position.y - pilotBefore.position.y,
        z: pilotAfter.position.z - pilotBefore.position.z,
      };
      const pilotMotion = {
        displacement,
        attitude: { heading: pilotAfter.heading, pitch: pilotAfter.pitch, bank: pilotAfter.bank },
        attitudeDelta: {
          heading: pilotAfter.heading - pilotBefore.heading,
          pitch: pilotAfter.pitch - pilotBefore.pitch,
          bank: pilotAfter.bank - pilotBefore.bank,
        },
        velocity: { ...pilotAfter.velocity },
        speed: pilotAfter.speed,
        speedDelta: pilotAfter.speed - pilotBefore.speed,
        resources: {
          hp: pilotAfter.hp, hpFixed: pilotAfter.hpFixed, ammo: pilotAfter.ammo,
          cannonAmmo: pilotAfter.cannonAmmo, bombs: pilotAfter.bombs,
        },
        loop: { progress: pilotAfter.loopProgress, cooldown: pilotAfter.loopCooldown },
      };
      const initialShared = { ...pilotBefore };
      delete (initialShared as any).position;
      const afterShared = { ...pilotAfter };
      delete (afterShared as any).position;
      delete (afterShared as any).velocity;
      const afterBattleHash = q.snapshot().hash;

      return {
        label, url: location.origin, input: { ...input },
        rules: {
          maxTicks: MAX_TICKS, tickRate: TICK_RATE, seconds: MAX_TICKS / TICK_RATE,
          version: RULES_VERSION, missionVersion: mission.rulesVersion,
        },
        initial: {
          tick: initialTick, missionPoints, sourcePoints, activeStartCount: activeStarts.length,
          activeStarts, allActiveStartsMatchSource: activeStarts.every(start => start.matchesSource),
          pilot: pilotBefore, pilotShared: initialShared,
          rawMissionHash: initialRaw.mission, rawCombatHash: initialRaw.combat,
          battleHash: initialRaw.battle, logicalMissionHash: initialRaw.logicalMission,
        },
        after: {
          tick: mission.tick, mode: game.mode,
          missionPoints: mission.points.map((point: any) =>
            ({ id: point.id, x: point.position.x, y: point.position.y, z: point.position.z })),
          pilot: pilotAfter, pilotShared: afterShared, pilotMotion,
          controllerFields: Object.keys(game.controller).sort(), inheritedControllerState,
          hasTargetLock: Object.hasOwn(game.controller, 'targetLock'), targetLock: targetLock ?? null,
          terrainAvoidanceActive: game.terrainAvoidanceActive ?? null,
          screen: document.getElementById('app')!.dataset.screen,
        },
        raw: {
          initial: initialRaw,
          after: {
            mission: hash(missionTextAfter), combat: hash(combatTextAfter), battle: afterBattleHash,
            battleHashFunction: battleHash(game), logicalMission: logicalHash(mission),
            missionBytes: missionTextAfter.length, combatBytes: combatTextAfter.length,
            combatJson: combatTextAfter,
            missionChangedTopLevel: changedTopLevel(missionTextBefore, missionTextAfter),
            combatChangedTopLevel: changedTopLevel(combatTextBefore, combatTextAfter),
          },
        },
        dpr: devicePixelRatio, viewport: [innerWidth, innerHeight],
      };
    }, { label, input: { ...comparisonInput, viewAspect: size.width / size.height } }));

    // Preserve the original settling window before capturing the live normal-mode screen.
    await page.waitForTimeout(200);
    await page.screenshot({ path: info.outputPath('comparison', label + '-normal.png') });
    await page.evaluate(() => (window as any).__senryou.home());
    await settings(page);
    await page.locator('#control-preview').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('comparison', label + '-settings.png') });
  }

  const startPositionDiffs = records[0].initial.activeStarts.map((before: any) => {
    const after = records[1].initial.activeStarts.find((item: any) => item.id === before.id);
    return {
      id: before.id, before: before.position, after: after?.position,
      delta: after ? {
        x: after.position.x - before.position.x,
        y: after.position.y - before.position.y,
        z: after.position.z - before.position.z,
      } : null,
    };
  });
  const pointPositionDiffs = records[0].initial.missionPoints.map((before: any) => {
    const after = records[1].initial.missionPoints.find((item: any) => item.id === before.id);
    return {
      id: before.id, before, after,
      delta: after ? { x: after.x - before.x, y: after.y - before.y, z: after.z - before.z } : null,
    };
  });
  const evidence = {
    browserName, size, baseline: '71b0e5bc9ffbe2cbd1f295160b9e8e3c40ad6650',
    comparison: {
      expectedRuleAndMapChanges: { seconds: { before: 1200, after: 600 }, points: pointPositionDiffs },
      rawHashDiffs: {
        battleChanged: records[0].raw.after.battle !== records[1].raw.after.battle,
        initialMissionChanged: records[0].raw.initial.mission !== records[1].raw.initial.mission,
        afterMissionChanged: records[0].raw.after.mission !== records[1].raw.after.mission,
        initialCombatChanged: records[0].raw.initial.combat !== records[1].raw.initial.combat,
        afterCombatChanged: records[0].raw.after.combat !== records[1].raw.after.combat,
      },
      activeStartPositionDiffs: startPositionDiffs,
      pilotStartDelta: {
        x: records[1].initial.pilot.position.x - records[0].initial.pilot.position.x,
        y: records[1].initial.pilot.position.y - records[0].initial.pilot.position.y,
        z: records[1].initial.pilot.position.z - records[0].initial.pilot.position.z,
      },
    },
    records,
  };
  await writeFile(info.outputPath('comparison', 'conditions.json'), JSON.stringify(evidence, null, 2));
  expect(evidence.comparison.rawHashDiffs.battleChanged).toBe(true);
  expect(evidence.comparison.rawHashDiffs.initialMissionChanged).toBe(true);
  expect(evidence.comparison.rawHashDiffs.afterMissionChanged).toBe(true);
  expect(evidence.comparison.pilotStartDelta).toEqual({ x: 1425, y: 0, z: 0 });

  const inheritedFields = [
    'playerTargetSpeed', 'loopHeld', 'playerLoopActive', 'loopStartYaw', 'loopStartPitch',
    'loopStartSteeringRevision', 'loopStartTurn', 'loopStartClimb', 'assistTurn', 'assistClimb', 'responseMultiplier',
  ].sort();
  const initialUnitCounts = {
    'A/aircraft': 6, 'A/aa': 4, 'A/infantry': 72, 'A/tank': 8,
    'B/aircraft': 6, 'B/aa': 4, 'B/infantry': 72, 'B/tank': 8,
  };

  for (let index = 0; index < records.length; index++) {
    const record = records[index], label = index === 0 ? 'before' : 'after';
    expect(record.rules).toEqual({
      maxTicks: label === 'before' ? 72000 : 36000, tickRate: 60,
      seconds: label === 'before' ? 1200 : 600,
      version: label === 'before' ? 'senryou-rules-v1' : 'senryou-rules-v2-10min',
      missionVersion: label === 'before' ? 'senryou-rules-v1' : 'senryou-rules-v2-10min',
    });
    expect(record.initial.missionPoints).toEqual(expectedMapPoints[label]);
    expect(record.initial.sourcePoints).toEqual(expectedMapPoints[label]);
    expect(record.after.missionPoints).toEqual(expectedMapPoints[label]);
    expect(record.initial.activeStartCount).toBe(180);
    expect(record.initial.tick).toBe(0);
    expect(record.initial.allActiveStartsMatchSource).toBe(true);
    const startCounts = Object.fromEntries(record.initial.activeStarts.reduce((counts: Map<string, number>, unit: any) => {
      counts.set(unit.team + '/' + unit.kind, (counts.get(unit.team + '/' + unit.kind) ?? 0) + 1);
      return counts;
    }, new Map()));
    expect(startCounts).toEqual(initialUnitCounts);
    for (const [id, position] of Object.entries(expectedSpawnAnchors[label])) {
      expect(record.initial.activeStarts.find((unit: any) => unit.id === id)?.position).toEqual(position);
    }
    expect(record.initial.pilotShared).toEqual(records[0].initial.pilotShared);
    expect(record.initial.pilot.position).toEqual(label === 'before'
      ? { x: -2850, y: 600, z: -720 } : { x: -1425, y: 600, z: -720 });
    expect(record.initial.rawMissionHash).toMatch(/^[a-f0-9]{8}$/);
    expect(record.initial.rawCombatHash).toMatch(/^[a-f0-9]{8}$/);
    expect(record.after.tick).toBe(1);
    expect(record.after.mode).toBe('normal');
    expect(record.after.controllerFields).toEqual(label === 'before' ? inheritedFields : [...inheritedFields, 'targetLock'].sort());
    expect(record.after.hasTargetLock).toBe(label === 'after');
    expect(record.after.targetLock).toEqual(label === 'before' ? null : { key: null, manual: false, changed: false });
    expect(record.after.inheritedControllerState.playerTargetSpeed).toBe(110.3);
    expect(record.after.terrainAvoidanceActive).toBe(label === 'before' ? null : false);
    expect(record.after.screen).toBe('playing');
    expect(record.raw.after.battle).toBe(record.raw.after.battleHashFunction);
    expect(record.raw.after.mission).toMatch(/^[a-f0-9]{8}$/);
    expect(record.raw.after.combat).toMatch(/^[a-f0-9]{8}$/);
    expect(record.raw.after.combatJson.length).toBe(record.raw.after.combatBytes);
    expect(record.dpr).toBe(1);
    expect(record.viewport).toEqual([size.width, size.height]);
    expect(record.input).toEqual({ ...comparisonInput, viewAspect: size.width / size.height });
    const initialResources = {
      hp: record.initial.pilot.hp, hpFixed: record.initial.pilot.hpFixed,
      ammo: record.initial.pilot.ammo, cannonAmmo: record.initial.pilot.cannonAmmo, bombs: record.initial.pilot.bombs,
    };
    expect(record.after.pilotMotion.resources).toEqual(initialResources);
  }

  expect(records[0].initial.pilotShared).toEqual(records[1].initial.pilotShared);
  expect(records[0].after.inheritedControllerState).toEqual(records[1].after.inheritedControllerState);
  expect(records[0].after.pilotMotion.attitude).toEqual(records[1].after.pilotMotion.attitude);
  expect(records[0].after.pilotMotion.attitudeDelta).toEqual(records[1].after.pilotMotion.attitudeDelta);
  expect(records[0].after.pilotMotion.speed).toBe(records[1].after.pilotMotion.speed);
  expect(records[0].after.pilotMotion.speedDelta).toBe(records[1].after.pilotMotion.speedDelta);
  expect(records[0].after.pilotMotion.resources).toEqual(records[1].after.pilotMotion.resources);
  expect(records[0].after.pilotMotion.loop).toEqual(records[1].after.pilotMotion.loop);
  expect(records[0].after.pilotShared).toEqual(records[1].after.pilotShared);

  // Absolute coordinates differ after the layout change; the start-position
  // delta is kept as evidence. Bound only subtraction's unavoidable ULP error.
  for (const axis of ['x', 'y', 'z'] as const) {
    const startScale = Math.max(1,
      Math.abs(records[0].initial.pilot.position[axis]), Math.abs(records[1].initial.pilot.position[axis]));
    const displacementTolerance = Number.EPSILON * startScale * 4;
    expect(Math.abs(records[0].after.pilotMotion.displacement[axis] - records[1].after.pilotMotion.displacement[axis]))
      .toBeLessThanOrEqual(displacementTolerance);
    expect(Math.abs(records[0].after.pilotMotion.velocity[axis] - records[1].after.pilotMotion.velocity[axis]))
      .toBeLessThanOrEqual(displacementTolerance * 60);
  }
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

