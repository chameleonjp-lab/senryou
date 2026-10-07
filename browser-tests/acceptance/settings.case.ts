import { expect, test, type Page } from '@playwright/test';
import { runCase, clickDom, openSettings, rangeKey, storageState } from './harness';
import { prepareApp } from '../native-frame-driver';
import { appliedControlOpacity } from './control-opacity-observation';
async function normalEditor(page:Page) {
  await clickDom(page,'input[name="game-mode"][value="normal"]');await openSettings(page);await clickDom(page,'#control-editor-touch');
}
async function changeOpacity(page:Page) {await rangeKey(page,'#control-opacity','Home');await page.keyboard.press('ArrowRight');expect(await page.locator('#control-opacity').inputValue()).toBe('21');}
async function reload(page:Page) {await page.reload({waitUntil:'domcontentloaded'});await prepareApp(page);}
const activeOpacity=async(page:Page)=>appliedControlOpacity(await page.locator('#fire').evaluate(e=>({
 customProperty:(e as HTMLElement).style.getPropertyValue('--control-opacity'),computedOpacity:getComputedStyle(e).opacity,
})));

test('C.v2.persist',async({browser},info)=>runCase(browser,info,'C.v2.persist',async h=>{
 const {page,evidence}=h;const before=await storageState(page);await normalEditor(page);
 await h.check('four-controls',async()=>{
  expect(await page.locator('#control-target option').evaluateAll(options=>options.map(o=>o as HTMLOptionElement).filter(o=>!o.hidden&&!o.disabled).map(o=>o.value))).toEqual(['fire','loop','throttle','bomb']);
  await page.locator('#control-mode').focus();await page.keyboard.press('End');await expect(page.locator('#control-mode')).toHaveValue('easy');
  expect(await page.locator('#control-target option').evaluateAll(options=>options.map(o=>o as HTMLOptionElement).filter(o=>!o.hidden&&!o.disabled).map(o=>o.value))).toEqual(['loop','bomb']);
  await page.locator('#control-mode').focus();await page.keyboard.press('Home');await expect(page.locator('#control-mode')).toHaveValue('normal');
 });
 await h.check('draft-cancel',async()=>{
  const original=await page.locator('#control-opacity').inputValue();await changeOpacity(page);expect(await storageState(page)).toEqual(before);
  await clickDom(page,'#control-cancel');expect(await storageState(page)).toEqual(before);await normalEditor(page);
  expect(await page.locator('#control-opacity').inputValue()).toBe(original);
 });
 await h.check('save-reload',async()=>{
  await changeOpacity(page);await clickDom(page,'#control-save');await expect(page.locator('#control-settings')).not.toBeVisible();
  const saved=await storageState(page);const raw=saved['senryou-controls-v2'];expect(raw).toBeTruthy();const decoded=JSON.parse(raw);
  expect(decoded.version).toBe(2);expect(decoded.controls.fire.opacity).toBe(.21);expect(Object.keys(decoded.controls).sort()).toEqual(['bomb','fire','loop','throttle']);
  await normalEditor(page);expect(await page.locator('#control-opacity').inputValue()).toBe('21');await clickDom(page,'#control-close');
  await reload(page);expect(await storageState(page)).toEqual(saved);await normalEditor(page);expect(await page.locator('#control-opacity').inputValue()).toBe('21');
  evidence.observations.saved=saved;
 });
 await h.check('reset-draft',async()=>{
  const saved=await storageState(page);await clickDom(page,'#control-reset');expect(await page.locator('#control-opacity').inputValue()).toBe('90');
  expect(await storageState(page)).toEqual(saved);await clickDom(page,'#control-cancel');await normalEditor(page);
  expect(await page.locator('#control-opacity').inputValue()).toBe('21');expect(await storageState(page)).toEqual(saved);
 });
}));

const legacyRaw=JSON.stringify({version:1,controls:{fire:{x:.83,y:.84,size:96,opacity:.74},loop:{x:.83,y:.66,size:72,opacity:.78},bomb:{x:.39,y:.94,size:52,opacity:.88},accelerate:{x:.17,y:.65,size:64,opacity:.8},brake:{x:.17,y:.85,size:64,opacity:.84}}});
test('C.v1.migration',async({browser},info)=>runCase(browser,info,'C.v1.migration',async h=>{
 const {page,evidence}=h;const before=await storageState(page);await normalEditor(page);
 await h.check('legacy-raw-preserved',async()=>{expect(await page.locator('#control-opacity').inputValue()).toBe('74');expect((await storageState(page))['senryou-controls-v1']).toBe(legacyRaw);});
 await h.check('no-implicit-write',async()=>{
  expect((await storageState(page))['senryou-controls-v2']).toBeUndefined();await clickDom(page,'#control-cancel');expect(await storageState(page)).toEqual(before);
  await normalEditor(page);await clickDom(page,'#control-save');expect(await storageState(page)).toEqual(before);
 });
 await h.check('changed-v2-save',async()=>{
  await normalEditor(page);await changeOpacity(page);await clickDom(page,'#control-save');const saved=await storageState(page);
  expect(saved['senryou-controls-v1']).toBe(legacyRaw);expect(JSON.parse(saved['senryou-controls-v2']).version).toBe(2);expect(JSON.parse(saved['senryou-controls-v2']).controls.fire.opacity).toBe(.21);
  await reload(page);expect((await storageState(page))['senryou-controls-v1']).toBe(legacyRaw);await normalEditor(page);expect(await page.locator('#control-opacity').inputValue()).toBe('21');evidence.observations.storage=saved;
 });
},undefined,{'senryou-controls-v1':legacyRaw}));

const futureRaw=JSON.stringify({version:99,controls:{fire:{x:.6,y:.6,size:100,opacity:.42}},futureData:'preserve-exact'});
test('C.future.session',async({browser},info)=>runCase(browser,info,'C.future.session',async h=>{
 const {page,evidence}=h;await normalEditor(page);const oldActive=await activeOpacity(page);
 await h.check('future-raw-preserved',async()=>{
  expect(await page.locator('#control-opacity').inputValue()).toBe('90');expect(oldActive).toBe(.9);expect((await storageState(page))['senryou-controls-v2']).toBe(futureRaw);
 });
 await h.check('failed-save-old-active',async()=>{
  await changeOpacity(page);await clickDom(page,'#control-save');await expect(page.locator('#control-settings')).toBeVisible();
  await expect(page.locator('#control-save')).toHaveText('今回だけ使う');await expect(page.locator('#control-storage-note')).toContainText('以前の設定');
  expect(await activeOpacity(page)).toBe(oldActive);expect((await storageState(page))['senryou-controls-v2']).toBe(futureRaw);
 });
 await h.check('explicit-session',async()=>{
  await clickDom(page,'#control-save');await expect(page.locator('#control-settings')).not.toBeVisible();expect(await activeOpacity(page)).toBe(.21);
  expect((await storageState(page))['senryou-controls-v2']).toBe(futureRaw);evidence.observations.sessionOpacity=await activeOpacity(page);
 });
 await h.check('reload-old',async()=>{
  await reload(page);await normalEditor(page);expect(await page.locator('#control-opacity').inputValue()).toBe('90');expect(await activeOpacity(page)).toBe(oldActive);
  expect((await storageState(page))['senryou-controls-v2']).toBe(futureRaw);evidence.observations.futureRaw=futureRaw;
 });
},undefined,{'senryou-controls-v2':futureRaw,'senryou-controls-v1':legacyRaw}));
