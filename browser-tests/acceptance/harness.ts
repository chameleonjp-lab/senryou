import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import type { BattleGame } from '../../src/battle/simulation';
import { createAssetManifest } from '../asset-manifest.mjs';
import { assertNoForbiddenTraffic, installNetworkGuard, SMOKE_ORIGIN } from '../network-guard';
import { installFrameDriver, prepareApp, advanceFrame, clickDom, readState } from '../native-frame-driver';
import { CASES, type CaseEvidence, type CaseId } from './contracts';
export { advanceFrame, clickDom, readState };
export class EnvironmentBlocker extends Error { constructor(message:string){super(message);this.name='EnvironmentBlocker';} }
export async function missionId(page:Page):Promise<string> {
  return page.evaluate(()=>(window as unknown as {__senryou:{game:BattleGame}}).__senryou.game.mission.id);
}
export interface Harness { page:Page; evidence:CaseEvidence & {observations:Record<string,unknown>}; check(name:string, action:()=>Promise<void>):Promise<void> }
export async function runCase(browser:Browser,info:TestInfo,id:CaseId,action:(h:Harness)=>Promise<void>,viewport={width:1280,height:720},storage:Record<string,string>={}) {
  // Total test budget is distinct from unchanged 15s per-fence and 35s preparation watchdogs.
  const budgetMs=id.startsWith('D.')?480_000:id.startsWith('F.')?360_000:id.startsWith('C.')?300_000:240_000;
  info.setTimeout(budgetMs);
  const record:Harness['evidence']={id,status:'failed',checks:[],errors:[],observations:{viewport,clock:'controlled',gpu:'native WebGL2 fence',totalCaseBudgetMs:budgetMs,perFenceWatchdogMs:15_000,preparationWatchdogMs:35_000}};
  const context=await browser.newContext({viewport,serviceWorkers:'block'});
  const blocked=await installNetworkGuard(context,createAssetManifest());let failure:unknown;
  try {
    const page=await context.newPage();
    page.on('pageerror',error=>record.errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')record.errors.push(message.text());});
    if(Object.keys(storage).length)await page.addInitScript(entries=>{
      // Seed once per fresh browser context; reload must observe the product's writes.
      if(sessionStorage.getItem('acceptance-seeded')===null){for(const [key,value] of Object.entries(entries))localStorage.setItem(key,value);sessionStorage.setItem('acceptance-seeded','1');}
    },storage);
    await installFrameDriver(page);await page.goto(SMOKE_ORIGIN+'/',{waitUntil:'domcontentloaded'});await prepareApp(page);
    const h:Harness={page,evidence:record,check:async(name,fn)=>{
      const spec=CASES.find(c=>c.id===id)!;
      if(!(spec.required as readonly string[]).includes(name)||record.checks.includes(name))throw new Error(`Invalid check ${id}:${name}`);
      await fn();record.checks.push(name);
    }};
    await action(h);
    expect([...record.checks].sort()).toEqual([...CASES.find(c=>c.id===id)!.required].sort());
  }catch(error){failure=error;record.errors.push(String(error));}
  try {await context.close();assertNoForbiddenTraffic(blocked);}catch(error){failure??=error;record.errors.push(String(error));}
  record.observations.blocked=blocked;
  if(record.errors.length&&!failure)failure=new Error(record.errors.join('\n'));
  record.status=failure instanceof EnvironmentBlocker?'blocked':failure?'failed':'passed';
  await info.attach('acceptance-case.json',{body:JSON.stringify(record,null,2),contentType:'application/json'});
  if(failure)throw failure;
}
export async function start(page:Page,mode:'easy'|'normal') {
  await clickDom(page,`input[name="game-mode"][value="${mode}"]`);await clickDom(page,'#start');await advanceFrame(page,0);
  expect((await readState(page)).screen).toBe('playing');expect((await readState(page)).tick).toBe(0);
}
export async function openSettings(page:Page,button='#home-controls') {await clickDom(page,button);await expect(page.locator('#control-settings')).toBeVisible();}
export async function rangeKey(page:Page,selector:string,key:string) {
  await page.locator(selector).focus();await page.keyboard.press(key);
}
export async function storageState(page:Page) {
  return page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('senryou-')).sort()));
}
