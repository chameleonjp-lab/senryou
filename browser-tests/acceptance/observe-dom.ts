import type { Page } from '@playwright/test';
import { inspectIndependentTargets, type TargetObservation } from './contracts';
let batchSequence = 0;
/** A single browser evaluation owns every rect, clip, fragment and hit-test in this batch. */
export async function observe(page: Page, selectors: string[]): Promise<{batch:number; targets:TargetObservation[]}> {
  const batch = ++batchSequence;
  const targets = await page.evaluate(({ selectors, batch }) => {
    const rect = (r: DOMRect | DOMRectReadOnly) => ({x:r.x,y:r.y,width:r.width,height:r.height});
    const v = window.visualViewport;
    const viewport = {x:v?.offsetLeft??0,y:v?.offsetTop??0,width:v?.width??innerWidth,height:v?.height??innerHeight};
    const visible = (element: Element) => {
      for (let p: Element|null = element; p; p=p.parentElement) {
        const s=getComputedStyle(p);
        if (s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0||p.hasAttribute('hidden')) return false;
      }
      return true;
    };
    const clipOf=(element:Element)=>{
      let clip={...viewport};
      for(let p:Element|null=element;p;p=p.parentElement) {
        const s=getComputedStyle(p),r=p.getBoundingClientRect();
        const overflowApplies=s.display!=='inline'&&s.display!=='contents';
        const horizontal=overflowApplies&&/(hidden|clip|auto|scroll)/.test(s.overflowX),vertical=overflowApplies&&/(hidden|clip|auto|scroll)/.test(s.overflowY);
        if(horizontal) { const left=Math.max(clip.x,r.left+p.clientLeft),right=Math.min(clip.x+clip.width,r.left+p.clientLeft+p.clientWidth);clip.x=left;clip.width=Math.max(0,right-left); }
        if(vertical) { const top=Math.max(clip.y,r.top+p.clientTop),bottom=Math.min(clip.y+clip.height,r.top+p.clientTop+p.clientHeight);clip.y=top;clip.height=Math.max(0,bottom-top); }
      }
      return clip;
    };
    const owners = new Map<Element,number>();
    return selectors.map(selector => {
      const matches=document.querySelectorAll<HTMLElement>(selector);
      if(matches.length!==1) throw new Error(`Expected one DOM owner ${selector}, found ${matches.length}`);
      const element=matches[0], box=rect(element.getBoundingClientRect());
      if(!owners.has(element))owners.set(element,owners.size+1);
      const clip=clipOf(element);
      const fragments: {text:string;rect:ReturnType<typeof rect>;clip:ReturnType<typeof clipOf>;visible:boolean}[]=[];
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
      let node:Node|null;
      while((node=walker.nextNode())) {
        const parent=node.parentElement,text=node.textContent??'';
        if(!parent||parent.closest('option,optgroup')||!text.trim())continue;
        const intentionallyHidden=parent.closest('[hidden]');
        // Explicit required owner stays fail-closed; inactive descendant UI is not visible copy.
        if(intentionallyHidden&&intentionallyHidden!==element&&element.contains(intentionallyHidden))continue;
        // Preserve every non-whitespace run and every wrapped fragment.
        for(const match of text.matchAll(/\S+/gu)) {
          const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);
          const rs=[...range.getClientRects()];
          if(!rs.length)fragments.push({text:match[0],rect:{x:0,y:0,width:0,height:0},clip:clipOf(parent),visible:false});
          else for(const r of rs)fragments.push({text:match[0],rect:rect(r),clip:clipOf(parent),visible:visible(parent)});
        }
      }
      const points=[[.5,.5],[.2,.2],[.8,.2],[.2,.8],[.8,.8]];
      const labels=(element.getAttribute('aria-labelledby')??'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent??'').join(' ');
      const accessibleName=element.getAttribute('aria-label')||labels||('labels'in element?[...(element as HTMLInputElement).labels??[]].map(x=>x.textContent).join(' '):'')||element.textContent||'';
      const nativeWidget=element instanceof HTMLSelectElement?{kind:'select' as const,value:element.value,selectedLabels:[...element.selectedOptions].map(o=>o.label),disabled:element.disabled,glyphStatus:'not-measurable-with-DOM-Range' as const}:undefined;
      return {selector,nativeWidget,owner:owners.get(element)!,batch,connected:element.isConnected,displayed:visible(element),rect:box,clip,viewport,fragments,accessibleName,
        hitPoints:points.map(([x,y])=>{const hit=document.elementFromPoint(box.x+box.width*x,box.y+box.height*y);return !!hit&&(hit===element||element.contains(hit));})};
    });
  }, {selectors,batch});
  return {batch,targets};
}
export async function fixedTargets(page:Page, selectors:string[]) {
  const observation=await observe(page,selectors);
  const issues=inspectIndependentTargets(observation.targets,observation.batch);
  if(issues.length)throw new Error(`Fixed target acceptance failed: ${JSON.stringify({issues,observation})}`);
  return observation;
}
/** Detail-only traversal of a real product scroll container; no HUD fallback. */
export async function walkDetail(page:Page,selector:string,ownerSelector:string) {
 const {inspectReachableFragments,planDetailPositions}=await import('./contracts');
 const owner=await page.locator(ownerSelector).evaluate((element,selector)=>{
  const target=document.querySelector(selector),e=element as HTMLElement,c=getComputedStyle(e),b=e.getBoundingClientRect();
  if(!target||!e.contains(target))throw new Error('Detail not in declared scroll owner');
  if(!/(auto|scroll)/.test(c.overflowY))throw new Error('Declared owner has no scroll route');
  if(b.width<=0||b.height<=0||e.clientHeight<=0)throw new Error('Scroll owner has no positive geometry');
  return {max:Math.max(0,e.scrollHeight-e.clientHeight),step:Math.max(1,Math.floor(e.clientHeight/2))};
 },selector);
 await page.locator(ownerSelector).evaluate(e=>e.scrollTo({top:0,behavior:'instant'}));
 await page.waitForTimeout(25);const planning=await observe(page,[selector]);
 const positions=planDetailPositions(planning.targets[0].fragments,planning.targets[0].clip,owner.max);
 if(positions.length>200)throw new Error('Detail route exceeds bounded 200-position inspection');
 const samples:TargetObservation[]=[];
 for(const top of positions){
  await page.locator(ownerSelector).evaluate((e,top)=>e.scrollTo({top,behavior:'instant'}),top);
  await page.waitForTimeout(25);const first=await observe(page,[selector]);await page.waitForTimeout(25);const current=await observe(page,[selector]);
  const spatial=(o:TargetObservation)=>JSON.stringify({rect:o.rect,clip:o.clip,fragments:o.fragments,hitPoints:o.hitPoints});
  if(spatial(first.targets[0])!==spatial(current.targets[0]))throw new Error(`Unsettled detail geometry: ${JSON.stringify({top,first,current,samples})}`);
  samples.push(current.targets[0]);
 }
 const issues=inspectReachableFragments(samples);
 if(issues.length)throw new Error(`Unreachable detail fragments: ${JSON.stringify({selector,ownerSelector,issues,samples})}`);
 return {selector,ownerSelector,samples};
}

/** Measured text enlargement, explicitly NOT browser zoom or physical-device proof. */
export async function text200(page:Page) {
 const result=await page.evaluate(()=>{
  type Saved={element:HTMLElement;inline:string;priority:string;pixels:number};type Host={__acceptanceFonts?:Saved[]};const host=window as unknown as Host;
  for(const s of host.__acceptanceFonts??[])if(s.element.isConnected)s.element.style.setProperty('font-size',s.inline,s.priority);
  const nodes=[...document.querySelectorAll<HTMLElement>('#app, #app *')].filter(e=>!(e instanceof HTMLCanvasElement));
  const base=nodes.map(element=>({element,inline:element.style.fontSize,priority:element.style.getPropertyPriority('font-size'),pixels:Number.parseFloat(getComputedStyle(element).fontSize)}));
  host.__acceptanceFonts=base.map(({element,inline,priority,pixels})=>({element,inline,priority,pixels}));
  for(const s of base)s.element.style.setProperty('font-size',`${s.pixels*2}px`,'important');
  const ratios=base.filter(s=>s.pixels>0&&[...s.element.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent?.trim())).map(s=>Number.parseFloat(getComputedStyle(s.element).fontSize)/s.pixels);
  return {count:ratios.length,min:Math.min(...ratios),max:Math.max(...ratios),method:'measured text font sizes; not browser zoom'};
 });
 if(!result.count||Math.abs(result.min-2)>.001||Math.abs(result.max-2)>.001)throw new Error(`Text scale not 200%: ${JSON.stringify(result)}`);
 return result;
}
export async function verifyText200(page:Page) {
 const observation=await page.evaluate(()=>{
  const saved=(window as unknown as {__acceptanceFonts?:{element:HTMLElement;pixels:number}[]}).__acceptanceFonts??[];
  const measured=new Map(saved.map(s=>[s.element,s.pixels]));
  const nodes=[...document.querySelectorAll<HTMLElement>('#app, #app *')].filter(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&[...e.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent?.trim()));
  return nodes.map(element=>({tag:element.tagName,id:element.id,baseline:measured.get(element)??null,current:Number.parseFloat(getComputedStyle(element).fontSize)}));
 });
 const invalid=observation.filter(o=>o.baseline===null||!Number.isFinite(o.current)||Math.abs(o.current/o.baseline-2)>.001);
 if(!observation.length||invalid.length)throw new Error(`Text scale observation stale or not 200%: ${JSON.stringify(invalid)}`);
 return {count:observation.length,verifiedAtObservation:true};
}

/** Prove each major action is reachable, named, 44px and unobstructed on its actual document route. */
export async function walkActions(page:Page,selectors:string[],ownerSelector:string) {
 const {inspectAction,overlaps,planDetailPositions}=await import('./contracts');
 const reached=new Set<string>(),samples:Awaited<ReturnType<typeof observe>>[]=[];
 const accept=(batch:Awaited<ReturnType<typeof observe>>)=>{
  for(const target of batch.targets){
   const issues=inspectAction(target,batch.batch);
   if(batch.targets.some(other=>other!==target&&other.owner===target.owner))issues.push('duplicate-action-owner');
   if(batch.targets.some(other=>other.owner!==target.owner&&other.displayed&&overlaps(target.rect,other.rect)))issues.push('other-action-overlap');
   if(!issues.length)reached.add(target.selector);
  }
  samples.push(batch);
 };
 accept(await observe(page,selectors));
 if(reached.size===selectors.length)return {ownerSelector,reached:[...reached],samples};
 const route=await page.locator(ownerSelector).evaluate((e,selectors)=>{
  const element=e as HTMLElement;
  for(const selector of selectors){const target=document.querySelector(selector);if(!target||!element.contains(target))throw new Error('Action is outside declared document scroll owner');}
  if(!/(auto|scroll)/.test(getComputedStyle(element).overflowY)||element.clientHeight<=0)throw new Error('Missing actual action scroll route');
  element.scrollTo({top:0,behavior:'instant'});
  return {max:Math.max(0,element.scrollHeight-element.clientHeight)};
 },selectors);
 await page.waitForTimeout(25);const planning=await observe(page,[ownerSelector,...selectors]);
 const clip=planning.targets[0].clip;
 const positions=planDetailPositions(planning.targets.slice(1).map(t=>({text:t.selector,rect:t.rect,clip,visible:t.displayed})),clip,route.max);
 if(positions.length>200)throw new Error('Action traversal exceeds bounded observation budget');
 for(const top of positions){
  await page.locator(ownerSelector).evaluate((e,top)=>e.scrollTo({top,behavior:'instant'}),top);
  await page.waitForTimeout(25);const before=await observe(page,selectors);await page.waitForTimeout(25);const current=await observe(page,selectors);
  const spatial=(o:TargetObservation)=>({rect:o.rect,clip:o.clip,fragments:o.fragments,hitPoints:o.hitPoints,nativeWidget:o.nativeWidget});
  if(JSON.stringify(before.targets.map(spatial))!==JSON.stringify(current.targets.map(spatial)))throw new Error(`Unsettled action observation: ${JSON.stringify({top,before,current,samples})}`);
  accept(current);
 }
 const missing=selectors.filter(s=>!reached.has(s));
 if(missing.length)throw new Error(`Major actions unreachable: ${JSON.stringify({ownerSelector,missing,samples})}`);
 return {ownerSelector,reached:[...reached],samples};
}
