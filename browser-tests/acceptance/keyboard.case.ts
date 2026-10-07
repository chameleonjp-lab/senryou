import { expect, test } from '@playwright/test';
import { runCase, openSettings, clickDom, storageState, start, advanceFrame, readState } from './harness';
test('C.keyboard',async({browser},info)=>runCase(browser,info,'C.keyboard',async h=>{
 const {page,evidence}=h;await clickDom(page,'input[name="game-mode"][value="normal"]');await openSettings(page);await clickDom(page,'#control-editor-keyboard');const before=await storageState(page);
 await h.check('duplicate-rejected',async()=>{
  await clickDom(page,'[data-key-action="accelerate"]');await page.keyboard.press('Space');await expect(page.locator('#keyboard-capture-note')).toContainText('使用中');expect(await storageState(page)).toEqual(before);
 });
 await h.check('cancel',async()=>{
  await page.keyboard.press('Escape');await expect(page.locator('[data-key-action="accelerate"]')).toHaveAttribute('aria-pressed','false');
  await clickDom(page,'#control-cancel');expect(await storageState(page)).toEqual(before);await openSettings(page);await clickDom(page,'#control-editor-keyboard');
 });
 await h.check('save',async()=>{
  await clickDom(page,'[data-key-action="accelerate"]');await page.keyboard.press('KeyE');await clickDom(page,'#control-save');
  const saved=await storageState(page);expect(JSON.parse(saved['senryou-keyboard-v1']).bindings.accelerate).toBe('KeyE');evidence.observations.saved=saved;
 });
 await h.check('consumed-bound-key',async()=>{
  await start(page,'normal');await page.locator('#flight').focus();await page.keyboard.down('KeyE');await advanceFrame(page,17);const consumed=await readState(page);await page.keyboard.up('KeyE');await advanceFrame(page,17);const released=await readState(page);
  expect(consumed.inputs.at(-1).input.throttle).toBe(1);expect(consumed.targetSpeed).toBeCloseTo(110.3,8);expect(released.inputs.at(-1).input.throttle).toBe(0);expect(released.targetSpeed).toBe(consumed.targetSpeed);evidence.observations.key={consumed,released};
 });
}));
