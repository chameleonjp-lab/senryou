export const PROFILES=[{id:'portrait',width:393,height:648,text:false},{id:'landscape',width:568,height:320,text:false},{id:'pc',width:1280,height:720,text:false},{id:'text200',width:393,height:648,text:true}] as const;
export const REGISTRY=PROFILES.flatMap(p=>['easy','normal'].map(mode=>`${p.id}:${mode}`));
export const SCENARIOS=['current','flying-envelope','waiting-envelope'] as const;
/** Source-format envelopes, not proof that these warnings naturally co-occur. */
export const ENVELOPES={
 flying:{warning:'対空 照準予告 4門 · 方位360° / 低空注意 · 機首を上げて / 空域境界 · 内側へ旋回',reload:'機銃・機関砲 装填 6.0秒',payload:'爆弾予測：敵地上軍の60m内 · 命中保証ではありません',status:' 経路待機 272体 · 閉塞辺を30秒回避'},
 waiting:{warning:'',reload:'',payload:'',status:'復帰待ち · 安全な出撃回廊を確認中 · 5.0秒 経路待機 272体 · 閉塞辺を30秒回避'},
 controls:{loop:'待ち 2.0秒',bombAmmo:'装填 20.0秒',bombHint:'地形着弾 15.0秒'},
 limitations:['Four dynamic notification fields are modeled as the top-band alternative','ally-announcements has no runtime writer in the current source; its current empty node is retained, no fictional maximum is invented','Envelopes are source-format bounds, not naturally co-occurring campaign states'],
 sources:['src/main.ts hud(): formatting and three-warning join','src/battle/rules.ts CAP: 4 enemy AA, 272 total active ground units','src/battle/weapons.ts: aircraft reload 360/60 = 6s; bomb reload 1200/60 = 20s','src/battle/scoring.ts: respawn 300/60 = 5s','src/battle/ground-nav.ts: longest recovery message','src/battle/projectiles.ts: prediction 1800 * 1/120 = 15s','src/flight.ts: LOOP_COOLDOWN=2'],
};

export const STYLE_PROPERTIES=['font-family','font-size','font-weight','font-style','font-stretch','font-variant','font-variant-numeric','line-height','letter-spacing','word-spacing','text-transform','text-indent','text-align','white-space','overflow-wrap','word-break','hyphens','box-sizing','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','border-top-width','border-right-width','border-bottom-width','border-left-width','border-top-style','border-right-style','border-bottom-style','border-left-style','border-top-color','border-right-color','border-bottom-color','border-left-color','color','text-shadow','font-kerning','font-feature-settings','font-variation-settings','font-synthesis','direction','writing-mode','text-orientation'] as const;
export function styleDifferences(before:Record<string,string>,after:Record<string,string>):string[]{return STYLE_PROPERTIES.filter(k=>typeof before[k]!=='string'||typeof after[k]!=='string'||before[k]!==after[k]);}
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const array=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const rect=(v:unknown):boolean=>{const r=object(v);return !!r&&['x','y','width','height'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k]))&&Number(r.width)>=0&&Number(r.height)>=0;};
export function inspectDiagnostic(value:unknown){
 const issues:string[]=[];const d=object(value);if(!d)return {complete:false,issues:['missing-diagnostic'],productAcceptance:false};
 const records=array(d.records).map(object).filter((r):r is Record<string,unknown>=>!!r);
 for(const id of REGISTRY){
  const matching=records.filter(r=>r.id===id);if(matching.length!==1){issues.push(`missing-or-duplicate:${id}`);continue;}
  const r=matching[0],profile=PROFILES.find(p=>id.startsWith(p.id+':'))!;
  if(r.error||!Array.isArray(r.pageErrors)||!Array.isArray(r.consoleErrors)||array(r.pageErrors).length||array(r.consoleErrors).length)issues.push(`environment:${id}`);
  const native=object(r.nativeState),queue=object(native?.queue);if(native?.screen!=='playing'||typeof native.tick!=='number'||native.tick<1||typeof queue?.completedCount!=='number'||queue.completedCount<1||typeof r.gpuTargetSubmitted!=='number'||r.gpuTargetSubmitted<1||Number(queue?.completedCount)<r.gpuTargetSubmitted)issues.push(`missing-native-precondition:${id}`);
  for(const name of SCENARIOS){
   const scenarios=array(r.scenarios).map(object).filter((s):s is Record<string,unknown>=>!!s&&s.name===name);
   if(scenarios.length!==1){issues.push(`missing-measurement:${id}:${name}`);continue;}
   const s=scenarios[0];
   if(name!=='current'){const identities=array(s.styleIdentity).map(object);for(const id of ['warning','reload-status','payload-status','control-status']){const found=identities.filter(x=>x?.id===id);if(found.length!==1||!object(found[0]?.before)||!object(found[0]?.after)||styleDifferences(found[0]!.before as Record<string,string>,found[0]!.after as Record<string,string>).length)issues.push(`clone-style-drift:${r.id}:${name}:${id}`);}}
   if(!Array.isArray(s.visualConflicts)||s.copiedFitIsCloneVerdict!==false)issues.push(`missing-visual-classification:${id}:${name}`);
   const nodes=array(s.nodes).map(object),controls=array(s.controls).map(object),sight=object(s.sight),viewport=object(s.viewport);
   if(!nodes.length||s.nodeCount!==nodes.length||nodes.some(n=>!n||typeof n.id!=='string'||typeof n.text!=='string'||typeof n.hiddenByAncestor!=='boolean'||typeof n.fontSize!=='string'||!rect(n.box)||!rect(n.clientBox)||!Array.isArray(n.fragments)||!Array.isArray(n.textNodes)||!Array.isArray(n.clipAncestors)))issues.push(`incomplete-node-geometry:${id}:${name}`);
   for(const required of ['warning','reload-status','payload-status','control-status','ally-announcements','loop-status','bomb-ammo','bomb-hint'])if(nodes.filter(n=>n?.id===required).length!==1)issues.push(`missing-node:${id}:${name}:${required}`);
   if(name!=='current'){
    const envelope=name==='flying-envelope'?ENVELOPES.flying:ENVELOPES.waiting;
    const requiredText:Record<string,string>={'warning':envelope.warning,'reload-status':envelope.reload,'payload-status':envelope.payload,'control-status':envelope.status,'loop-status':ENVELOPES.controls.loop,'bomb-ammo':ENVELOPES.controls.bombAmmo,'bomb-hint':ENVELOPES.controls.bombHint};
    for(const [target,text]of Object.entries(requiredText))if(text){
     const n=nodes.find(n=>n?.id===target),box=object(n?.box),fragments=array(n?.fragments).map(object),textNodes=array(n?.textNodes).map(object);
     const positive=(r:unknown)=>rect(r)&&Number(object(r)?.width)>0&&Number(object(r)?.height)>0;
     if(!n||n.text!==text||n.display==='none'||n.visibility!=='visible'||!['visible-equivalent','fully-clipped'].includes(String(n.visualState))||!positive(box)||!fragments.length||!fragments.every(f=>positive(f?.rect)&&rect(f?.visibleRect))||!textNodes.length||textNodes.some(t=>t?.zeroRange!==false||typeof t.rangeCount!=='number'||t.rangeCount<1))issues.push(`unmeasured-envelope-text:${id}:${name}:${target}`);
    }
   }
   for(const required of ['pause','game-sound','fire','loop','throttle','bomb'])if(controls.filter(c=>c?.id===required&&rect(c.box)&&typeof c.hidden==='boolean').length!==1)issues.push(`missing-control:${id}:${name}:${required}`);
   if(!sight||!['x','y','radius','margin'].every(k=>typeof sight[k]==='number'&&Number.isFinite(sight[k]))||Number(sight.radius)<=0||viewport?.width!==profile.width||viewport?.height!==profile.height||!Array.isArray(s.conflicts))issues.push(`missing-frame-geometry:${id}:${name}`);
  }
 }
 if(records.some(r=>typeof r.id!=='string'||!REGISTRY.includes(r.id)))issues.push('unexpected-profile');return {complete:issues.length===0,issues,productAcceptance:false};
}
export function inspectBrowserEnvelope(value:unknown):string[]{
 const issues:string[]=[];const root=object(value),stats=object(root?.stats);
 if(!root||!stats||stats.expected!==1||stats.unexpected!==0||stats.skipped!==0||stats.flaky!==0)issues.push('diagnostic-browser-counts');
 if(!Array.isArray(root?.errors)||array(root?.errors).length)issues.push('top-level-browser-errors');
 const specs:Record<string,unknown>[]=[];const visit=(v:unknown)=>{const s=object(v);if(!s)return;for(const spec of array(s.specs)){const o=object(spec);if(o)specs.push(o);}for(const child of array(s.suites))visit(child);};for(const s of array(root?.suites))visit(s);
 if(specs.length!==1||specs[0]?.title!=='layout-reservation-diagnostic')issues.push('unexpected-diagnostic-test');
 const tests=specs.flatMap(s=>array(s.tests)).map(object),results=tests.flatMap(t=>array(t?.results)).map(object);
 if(tests.length!==1||results.length!==1||results[0]?.status!=='passed'||array(results[0]?.errors).length)issues.push('diagnostic-result-or-retry-error');
 return issues;
}
