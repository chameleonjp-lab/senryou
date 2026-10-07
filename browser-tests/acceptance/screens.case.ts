import { expect, test } from '@playwright/test';
import { inspectHud, type CaseId } from './contracts';
import { fixedTargets, observe, text200, verifyText200, walkDetail, walkActions } from './observe-dom';
import { runCase, start, clickDom, advanceFrame } from './harness';
const profiles=[
 {id:'D.phone-portrait',width:393,height:648,text:false},
 {id:'D.phone-landscape',width:568,height:320,text:false},
 {id:'D.pc',width:1280,height:720,text:false},
 {id:'D.text-200',width:393,height:648,text:true},
] as const;
for(const profile of profiles)test(profile.id,async({browser},info)=>runCase(browser,info,profile.id as CaseId,async h=>{
 const {page,evidence}=h;const screens:string[]=[],observations:unknown[]=[],scales:unknown[]=[];evidence.observations.screens=screens;evidence.observations.geometry=observations;evidence.observations.textScale=scales;
 const settle=async()=>{if(profile.text)scales.push(await text200(page));await advanceFrame(page,0);if(profile.text)scales.push(await verifyText200(page));};
 const documentScreen=async(name:string,detail:string,owner:string)=>{await settle();screens.push(name);observations.push(await walkDetail(page,detail,owner));};
 const hud=async(mode:'easy'|'normal')=>{
  await settle();screens.push(`${mode}-hud`);
  const controls=mode==='normal'?['#pause','#game-sound','#fire','#loop','#throttle','#bomb']:['#pause','#game-sound','#loop','#bomb'];
  if(mode==='easy'){await expect(page.locator('#throttle')).toBeHidden();await expect(page.locator('#fire')).toBeHidden();}
  const targets=['.time-block','.target-tally:first-child','.target-tally:last-child','.flight-data','#support-target',...['HA','P1','P2','P3','P4','P5','HB'].map(id=>`[data-point="${id}"]`)];
  const batch=await observe(page,[...controls,...targets]);observations.push(batch);const issues=inspectHud(batch.targets.slice(0,controls.length),batch.targets.slice(controls.length),batch.batch);
  // No hidden/scroll-detail exemption exists for the fixed Senryou HUD.
  if(issues.length)throw new Error(`Required fixed HUD text failed: ${JSON.stringify({mode,issues,observationIndex:observations.length-1})}`);
 };
 await h.check('fixed-critical',async()=>{
  await documentScreen('home','#home','#home');
  observations.push(await walkActions(page,['#start','#home-rules','#home-controls','#home-sound','.mode-picker label:first-of-type','.mode-picker label:last-of-type'],'#home'));
  await start(page,'easy');await hud('easy');await clickDom(page,'#pause');await clickDom(page,'#pause-home');
  await start(page,'normal');await hud('normal');await clickDom(page,'#pause');await settle();screens.push('pause');
  // Pause is a real scrolling screen; only the flight HUD is treated as fixed.
  observations.push(await walkDetail(page,'#pause-screen .panel','#pause-screen'));
  observations.push(await walkActions(page,['#resume','#pause-restart','#pause-home','#pause-rules','#pause-controls','#pause-end'],'#pause-screen'));
  await clickDom(page,'#pause-controls');await clickDom(page,'#control-editor-touch');await documentScreen('touch-settings','#control-touch-editor','#control-settings .settings-main');
  observations.push(await fixedTargets(page,['#control-close','#control-save','#control-cancel']));
  observations.push(await walkActions(page,['#control-mode','#control-target','#control-reset'],'#control-settings .settings-main'));
  await clickDom(page,'#control-editor-keyboard');await documentScreen('keyboard-settings','#control-keyboard-editor','#control-settings .settings-main');
  observations.push(await fixedTargets(page,['#control-close','#control-save','#control-cancel']));
  observations.push(await walkActions(page,[...['left','right','up','down','fire','loop','accelerate','brake','bomb','pause'].map(action=>`[data-key-action="${action}"]`),'#keyboard-reset'],'#control-settings .settings-main'));await clickDom(page,'#control-cancel');
  await clickDom(page,'#pause-rules');await documentScreen('rules','#rules-content','#rules-content');observations.push(await fixedTargets(page,['#rules-close','#rules-back']));await clickDom(page,'#rules-back');
  await clickDom(page,'#pause-end');await documentScreen('aborted-result','#result .result-panel','#result');
  observations.push(await walkActions(page,['#retry','#result-home','#result-controls'],'#result'));
 });
 await h.check('details-reachable',async()=>{expect(screens).toContain('touch-settings');expect(screens).toContain('keyboard-settings');expect(screens).toContain('rules');expect(screens).toContain('aborted-result');});
 if(profile.text)await h.check('measured-text-200',async()=>{expect(scales.length).toBeGreaterThanOrEqual(8);});
 else await h.check('eight-screens',async()=>{expect(new Set(screens).size).toBe(8);});
 await h.check('fresh-fragments',async()=>{expect(observations.length).toBeGreaterThanOrEqual(8);});
},{width:profile.width,height:profile.height}));
