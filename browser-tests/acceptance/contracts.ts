/** Browser acceptance observations, independent from product geometry algorithms. */
export interface Rect { x: number; y: number; width: number; height: number }
export interface TextFragment { text: string; rect: Rect; clip: Rect; visible: boolean }
export interface TargetObservation {
  selector: string; owner: number; batch: number; connected: boolean; displayed: boolean;
  rect: Rect; clip: Rect; viewport: Rect; hitPoints: boolean[];
  fragments: TextFragment[]; accessibleName: string;
  nativeWidget?: {kind:'select';value:string;selectedLabels:string[];disabled:boolean;glyphStatus:'not-measurable-with-DOM-Range'};
}
const finite = (r: Rect) => [r.x, r.y, r.width, r.height].every(Number.isFinite);
export function positiveRect(r: Rect): boolean { return finite(r) && r.width > 0 && r.height > 0; }
export function contained(inner: Rect, outer: Rect, tolerance = 0.5): boolean {
  return positiveRect(inner) && positiveRect(outer) && inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance && inner.y + inner.height <= outer.y + outer.height + tolerance;
}
export function overlaps(a: Rect, b: Rect): boolean {
  return positiveRect(a) && positiveRect(b) && Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5
    && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
}
export function inspectTarget(o: TargetObservation, batch: number, options: { interactive: boolean; minHit?: number; requireText?: boolean }): string[] {
  const issues: string[] = [];
  if (!Number.isSafeInteger(batch) || batch < 1 || o.batch !== batch) issues.push('stale-or-invalid-batch');
  if (!o.connected || !o.displayed) issues.push('hidden-or-disconnected');
  if (!contained(o.rect, o.viewport) || !contained(o.rect, o.clip)) issues.push('target-clipped-or-empty');
  if (options.interactive) {
    const min = options.minHit ?? 44;
    if (!positiveRect(o.rect) || o.rect.width < min || o.rect.height < min) issues.push('hit-target-too-small');
    if (o.hitPoints.length !== 5 || o.hitPoints.some(hit => !hit)) issues.push('occluded-or-unsampled');
    if (!o.accessibleName.trim()) issues.push('missing-accessible-name');
  }
  const meaningful = o.fragments.filter(f => f.text.trim().length > 0);
  if (options.requireText !== false && meaningful.length === 0) issues.push('missing-visible-text');
  // All fragments count, including a bad zero-width fragment. Never filter it into a pass.
  if (meaningful.some(f => !f.visible || !contained(f.rect, f.clip) || !contained(f.rect, o.clip) || !contained(f.rect, o.viewport))) issues.push('text-clipped-hidden-or-empty');
  return issues;
}
export function inspectIndependentTargets(targets: TargetObservation[], batch: number): string[] {
  const issues = targets.flatMap(t => inspectTarget(t, batch, { interactive: true }).map(i => `${t.selector}:${i}`));
  const seen = new Set<number>();
  for (let i = 0; i < targets.length; i++) {
    if (seen.has(targets[i].owner)) issues.push('duplicate-owner');
    seen.add(targets[i].owner);
    for (let j = i + 1; j < targets.length; j++) {
      if (overlaps(targets[i].rect, targets[j].rect)) issues.push(`overlap:${targets[i].selector}:${targets[j].selector}`);
    }
  }
  return issues;
}
export const CASES = [
  { id: 'F.easy.lifecycle', category: 'functional', required: ['real-input', 'gpu-completion', 'pause-resume', 'aborted-result', 'restart-home'] },
  { id: 'F.normal.lifecycle', category: 'functional', required: ['real-input', 'gpu-completion', 'pause-resume', 'aborted-result', 'restart-home'] },
  { id: 'C.v2.persist', category: 'settings', required: ['four-controls', 'draft-cancel', 'save-reload', 'reset-draft'] },
  { id: 'C.v1.migration', category: 'settings', required: ['legacy-raw-preserved', 'no-implicit-write', 'changed-v2-save'] },
  { id: 'C.future.session', category: 'settings', required: ['future-raw-preserved', 'failed-save-old-active', 'explicit-session', 'reload-old'] },
  { id: 'C.keyboard', category: 'settings', required: ['duplicate-rejected', 'cancel', 'save', 'consumed-bound-key'] },
  { id: 'S.pointer.resize', category: 'safety', required: ['native-capture', 'outside-drag', 'resize-release', 'fresh-press'] },
  { id: 'S.blur', category: 'safety', required: ['native-blur', 'pause', 'input-cleared', 'explicit-resume'] },
  { id: 'S.context-loss', category: 'safety-fault', required: ['native-context-loss', 'safe-stop', 'reload-only', 'no-auto-resume'] },
  { id: 'D.phone-portrait', category: 'dom', required: ['fixed-critical', 'details-reachable', 'eight-screens', 'fresh-fragments'] },
  { id: 'D.phone-landscape', category: 'dom', required: ['fixed-critical', 'details-reachable', 'eight-screens', 'fresh-fragments'] },
  { id: 'D.pc', category: 'dom', required: ['fixed-critical', 'details-reachable', 'eight-screens', 'fresh-fragments'] },
  { id: 'D.text-200', category: 'dom', required: ['measured-text-200', 'fixed-critical', 'details-reachable', 'fresh-fragments'] },
] as const;
export type CaseId = typeof CASES[number]['id'];
export interface CaseEvidence { id: string; status: 'passed' | 'failed' | 'blocked' | 'not-run'; checks: string[]; errors: string[] }
export const SEPARATE_GATES = [
  'native select selected-option glyph clipping (native value/label/geometry/hit checked; DOM Range cannot prove internal glyph paint)',
  'atomic partial-write/rollback/recovery-journal matrix retained in original logical unit suite; no new native completeness claim',
  'native-browser-zoom-200 (must verify actual DPR/layout change; CSS zoom/pinch is not this gate)',
  'multi-touch owner isolation and native cancel/visibility/orientation lifecycle',
  'full-campaign natural victory/defeat, 30 seeds and physical team mirror',
  'normal-clock execution without clock/fault injection',
  'real-device performance, maximum-combat and repeated-mission resource stability',
  'fixed Kaisen/FF visual/aircraft comparisons and every render-queue fault boundary',
] as const;
export function inspectCampaign(records: CaseEvidence[]): { complete: boolean; issues: string[]; separateGates: readonly string[] } {
  const issues: string[] = [], seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.id)) issues.push(`duplicate:${r.id}`); seen.add(r.id);
    const spec = CASES.find(c => c.id === r.id);
    if (!spec) { issues.push(`unknown:${r.id}`); continue; }
    if (r.status !== 'passed' || r.errors.length) issues.push(`not-passed:${r.id}`);
    if (new Set(r.checks).size !== r.checks.length) issues.push(`duplicate-check:${r.id}`);
    for (const c of spec.required) if (!r.checks.includes(c)) issues.push(`missing-check:${r.id}:${c}`);
    for (const c of r.checks) if (!(spec.required as readonly string[]).includes(c)) issues.push(`unknown-check:${r.id}:${c}`);
  }
  for (const c of CASES) if (!seen.has(c.id)) issues.push(`missing-case:${c.id}`);
  return { complete: issues.length === 0, issues, separateGates: SEPARATE_GATES };
}
/** Text owners are explicit independent product nodes, never duplicated aliases. */
export function inspectTextOwners(targets:TargetObservation[],batch:number):string[] {
 const issues=targets.flatMap(t=>inspectTarget(t,batch,{interactive:false}).map(i=>`${t.selector}:${i}`));
 const owners=new Set<number>();
 for(let i=0;i<targets.length;i++){
  if(owners.has(targets[i].owner))issues.push('duplicate-text-owner');owners.add(targets[i].owner);
  const fragments=targets[i].fragments;
  for(let a=0;a<fragments.length;a++)for(let b=a+1;b<fragments.length;b++)if(fragments[a].text.trim()&&fragments[b].text.trim()&&overlaps(fragments[a].rect,fragments[b].rect))issues.push(`self-text-overlap:${targets[i].selector}:${a}:${b}`);
  for(let j=i+1;j<targets.length;j++)if(targets[i].fragments.some(a=>a.text.trim()&&targets[j].fragments.some(b=>b.text.trim()&&overlaps(a.rect,b.rect))))issues.push(`text-overlap:${targets[i].selector}:${targets[j].selector}`);
 }
 return issues;
}
/** Every original fragment needs a fresh positive, visible viewport/clip observation. */
export function inspectReachableFragments(samples:TargetObservation[]):string[] {
 if(!samples.length)return ['no-detail-samples'];
 const expected=samples[0].fragments.map(f=>f.text);if(!expected.length)return ['no-detail-fragments'];
 const visited=new Set<number>(),batches=new Set<number>(),issues:string[]=[];
 for(const o of samples){
  if(batches.has(o.batch)||o.batch<1)issues.push('duplicate-or-invalid-detail-batch');batches.add(o.batch);
  if(!o.connected||!o.displayed||!positiveRect(o.rect))issues.push('hidden-or-empty-detail-owner');
  if(o.selector!==samples[0].selector||JSON.stringify(o.fragments.map(f=>f.text))!==JSON.stringify(expected))issues.push('detail-content-or-wrapping-changed');
  o.fragments.forEach((f,index)=>{if(f.text.trim()&&f.visible&&contained(f.rect,f.clip)&&contained(f.rect,o.clip)&&contained(f.rect,o.viewport))visited.add(index);});
 }
 for(let i=0;i<expected.length;i++)if(!visited.has(i))issues.push(`unreached-fragment:${i}`);
 return issues;
}
/** Derive stop positions from actual fragment centers so a fixed scroll step cannot skip a short legal visibility interval. */
export function planDetailPositions(fragments:TextFragment[],clip:Rect,maxScroll:number):number[] {
 if(!positiveRect(clip)||!Number.isFinite(maxScroll)||maxScroll<0)throw new Error('Invalid scroll planning geometry');
 const positions=new Set<number>([0,maxScroll]);
 for(const fragment of fragments){
  if(!fragment.text.trim()||!positiveRect(fragment.rect))continue;
  const center=fragment.rect.y+fragment.rect.height/2-(clip.y+clip.height/2);
  positions.add(Math.round(Math.min(maxScroll,Math.max(0,center))*1000)/1000);
 }
 return [...positions].sort((a,b)=>a-b);
}
export function inspectHud(controls:TargetObservation[],text:TargetObservation[],batch:number):string[] {
 const issues=[...inspectIndependentTargets(controls,batch),...inspectTextOwners([...controls,...text],batch)];
 for(const control of controls)for(const owner of [...controls,...text])if(control.owner!==owner.owner)
  for(const f of owner.fragments)if(f.text.trim()&&overlaps(control.rect,f.rect))issues.push(`control-covers-text:${control.selector}:${owner.selector}`);
 return issues;
}
export function inspectAction(o:TargetObservation,batch:number):string[] {
 const issues=inspectTarget(o,batch,{interactive:true,requireText:!o.nativeWidget});
 if(o.nativeWidget&&(!o.nativeWidget.value||o.nativeWidget.selectedLabels.length!==1||!o.nativeWidget.selectedLabels[0].trim()))issues.push('native-select-value-or-label-missing');
 return issues;
}
