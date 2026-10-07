import { expect, test } from '@playwright/test';
import { runCase, start, clickDom, advanceFrame, readState, missionId, openSettings } from './harness';
for(const mode of ['easy','normal'] as const) test(`F.${mode}.lifecycle`,async({browser},info)=>{
  await runCase(browser,info,`F.${mode}.lifecycle`,async h=>{
    const {page,evidence}=h;await start(page,mode);
    const firstMission=await missionId(page);
    let before=await readState(page),consumed=before,drained=before,after=before;
    await h.check('real-input',async()=>{
      await clickDom(page,'#bomb');await advanceFrame(page,0);
      expect((await readState(page)).tick).toBe(0);before=await readState(page);
      if(mode==='normal'){await page.locator('#throttle').focus();await page.keyboard.press('ArrowUp');}
      else await page.keyboard.down('ArrowRight');
      await advanceFrame(page,17);consumed=await readState(page);
      expect(consumed.tick).toBe(1);expect(consumed.inputs).toHaveLength(1);
      expect(consumed.inputs[0].input.bomb).toBe(true);expect(consumed.bombs).toBe(before.bombs-1);
      if(mode==='normal'){expect(consumed.inputs[0].input.throttle).toBe(1);expect(consumed.targetSpeed).toBeCloseTo(110.3,8);}
      else {expect(consumed.inputs[0].input.turn).toBe(1);await page.keyboard.up('ArrowRight');}
      await advanceFrame(page,0);drained=await readState(page);await advanceFrame(page,34);after=await readState(page);
      expect(after.inputs.map((i:{tick:number})=>i.tick)).toEqual([1,2,3]);
      expect(after.inputs.slice(1).every((i:{input:{bomb:boolean;turn:number;throttle:number}})=>!i.input.bomb&&i.input.turn===0&&i.input.throttle===0)).toBe(true);
      expect(after.bombs).toBe(consumed.bombs);if(mode==='normal')expect(after.targetSpeed).toBe(consumed.targetSpeed);
      evidence.observations.input={before,consumed,drained,after};
    });
    await h.check('gpu-completion',async()=>{
      expect(consumed.queue.submittedCount).toBeGreaterThan(before.queue.submittedCount);
      expect(consumed.queue.submittedCount-consumed.queue.completedCount).toBe(1);
      expect(drained.queue.completedCount).toBeGreaterThanOrEqual(consumed.queue.submittedCount);
      expect(drained.tick).toBe(consumed.tick);expect(drained.hash).toBe(consumed.hash);
      expect(after.queue.completedCount).toBeGreaterThan(drained.queue.completedCount);
      expect(after.queue.submittedCount).toBeGreaterThan(drained.queue.submittedCount);
      expect(consumed.calls).toBeGreaterThan(0);expect(after.calls).toBeGreaterThan(0);expect(after.queue.failure).toBeNull();
    });
    await h.check('pause-resume',async()=>{
      await clickDom(page,'#pause');const paused=await readState(page);
      await openSettings(page,'#pause-controls');await expect(page.locator('#control-mode')).toBeDisabled();
      await clickDom(page,'#control-cancel');await advanceFrame(page,0);await expect(page.locator('#pause-controls')).toBeFocused();
      await clickDom(page,'#pause-rules');await expect(page.locator('#rules-guide')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#pause-rules')).toBeFocused();
      for(let i=0;i<3;i++)await advanceFrame(page,100);
      const frozen=await readState(page);expect(frozen.screen).toBe('paused');expect(frozen.hash).toBe(paused.hash);expect(frozen.tick).toBe(paused.tick);
      await clickDom(page,'#resume');await advanceFrame(page,0);await advanceFrame(page,17);const resumed=await readState(page);
      expect(resumed.tick).toBe(paused.tick+1);expect(resumed.screen).toBe('playing');
      evidence.observations.pause={paused,frozen,resumed};
    });
    await h.check('aborted-result',async()=>{
      await clickDom(page,'#pause');await clickDom(page,'#pause-end');
      expect((await readState(page)).screen).toBe('result');await expect(page.locator('#result-title')).toHaveText('作戦中断');
      await expect(page.locator('#result-mode')).toHaveText(mode==='easy'?'イージー':'ノーマル');
      await expect(page.locator('#result-score')).toHaveText(/^-?\d+$/);await expect(page.locator('#result-ownership')).toContainText('HB');
      evidence.observations.result={kind:'DOM requested abort, not natural victory or defeat',state:await readState(page)};
    });
    await h.check('restart-home',async()=>{
      await clickDom(page,'#retry');await advanceFrame(page,0);const retryMission=await missionId(page);
      expect(retryMission).not.toBe(firstMission);expect((await readState(page)).tick).toBe(0);expect((await readState(page)).inputs).toEqual([]);
      await clickDom(page,'#pause');await clickDom(page,'#pause-restart');await advanceFrame(page,0);
      expect(await missionId(page)).not.toBe(retryMission);expect((await readState(page)).inputs).toEqual([]);
      // Fresh mission has zero accumulator. Drain real GPU before injecting 501 ms.
      const fresh=await readState(page);await advanceFrame(page,501);const overload=await readState(page);
      expect(overload.screen).toBe('paused');expect(overload.tick).toBe(fresh.tick);expect(overload.ready).toBe(true);
      await expect(page.locator('#pause-reason')).toContainText('処理が遅れたため停止');
      await advanceFrame(page,17);expect((await readState(page)).screen).toBe('paused');
      await clickDom(page,'#pause-home');expect((await readState(page)).screen).toBe('home');
      evidence.observations.restart={firstMission,retryMission,fresh,overload};
    });
  });
});
