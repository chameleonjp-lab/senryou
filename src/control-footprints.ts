/** Render-only placement: never mutate persisted normalized coordinates or sizes. */
export interface Footprint { x:number; y:number; width:number; height:number }
export interface NamedFootprint extends Footprint { id:string }
export interface SafeFrame { width:number; height:number; top:number; right:number; bottom:number; left:number }
export interface CachedControlLayout<T> { placements:T; fits:boolean }
export function getCachedControlLayoutAndSyncFits<T>(
 cache:ReadonlyMap<string,CachedControlLayout<T>>,
 key:string,
 dataset:{controlLayoutFits?:string},
):CachedControlLayout<T>|undefined {
 const cached=cache.get(key);
 if(!cached)return undefined;
 dataset.controlLayoutFits=String(cached.fits);
 return cached;
}
export function controlLayoutCacheKey(
 mode:string,
 layout:unknown,
 environmentKey:string,
 obstacles:readonly Footprint[],
 controls:Readonly<Record<string,{width:number;height:number}>>,
 geometryReady:boolean,
):string {
 return JSON.stringify([mode,layout,environmentKey,controls,obstacles,geometryReady]);
}
export function separated(a:Footprint,b:Footprint,gap=4):boolean {
 return Math.abs(a.x-b.x)>=(a.width+b.width)/2+gap || Math.abs(a.y-b.y)>=(a.height+b.height)/2+gap;
}
export function placeControlFootprints(items:readonly NamedFootprint[],frame:SafeFrame,obstacles:readonly Footprint[],gap=4,pinnedIds:readonly string[]=[]):{placements:NamedFootprint[];fits:boolean} {
 const valid=(v:number)=>Number.isFinite(v);
 if(!Object.values(frame).every(valid)||frame.width<=0||frame.height<=0||items.some(i=>![i.x,i.y,i.width,i.height].every(valid)||i.width<44||i.height<44))throw new Error('Invalid control footprint geometry');
 const bounded=(item:NamedFootprint,x=item.x,y=item.y):NamedFootprint=>({...item,x:Math.max(frame.left+item.width/2,Math.min(frame.width-frame.right-item.width/2,x)),y:Math.max(frame.top+item.height/2,Math.min(frame.height-frame.bottom-item.height/2,y))});
 const fitsFrame=(p:Footprint)=>p.x-p.width/2>=frame.left&&p.y-p.height/2>=frame.top&&p.x+p.width/2<=frame.width-frame.right&&p.y+p.height/2<=frame.height-frame.bottom;
 const wanted=items.map(i=>pinnedIds.includes(i.id)?{...i}:bounded(i));
 const validAll=(list:readonly NamedFootprint[])=>list.every((p,i)=>fitsFrame(p)&&obstacles.every(o=>separated(p,o,gap))&&list.slice(0,i).every(o=>separated(p,o,gap)));
 if(validAll(wanted))return {placements:wanted,fits:true};
 // At most four controls. Try deterministic priority orders only when the
 // desired layout cannot fit the actual labels; no saved values are changed.
 const orders=(xs:readonly NamedFootprint[]):NamedFootprint[][]=>xs.length?xs.flatMap((x,i)=>orders(xs.filter((_,j)=>i!==j)).map(t=>[x,...t])):[[]];
 const pinned=wanted.filter(p=>pinnedIds.includes(p.id));
 for(const order of orders(wanted.filter(p=>!pinnedIds.includes(p.id)))){
  const placed:NamedFootprint[]=[...pinned];
  for(const item of order){
   const occupied=[...obstacles,...placed];
   const xs=[item.x,frame.left+item.width/2,frame.width-frame.right-item.width/2];
   const ys=[item.y,frame.top+item.height/2,frame.height-frame.bottom-item.height/2];
   for(const o of occupied){xs.push(o.x-(o.width+item.width)/2-gap,o.x+(o.width+item.width)/2+gap);ys.push(o.y-(o.height+item.height)/2-gap,o.y+(o.height+item.height)/2+gap);}
   const choices=xs.flatMap(x=>ys.map(y=>bounded(item,x,y))).filter(p=>fitsFrame(p)&&occupied.every(o=>separated(p,o,gap))).sort((a,b)=>Math.hypot(a.x-item.x,a.y-item.y)-Math.hypot(b.x-item.x,b.y-item.y));
   if(!choices.length)break;
   placed.push(choices[0]);
  }
  if(placed.length===items.length&&validAll(placed))return {placements:items.map(i=>placed.find(p=>p.id===i.id)!),fits:true};
 }
 // No false fit and no hidden control: retain a visible bounded layout so the
 // unresolved space constraint is observable rather than removing information.
 return {placements:wanted,fits:false};
}

export function layoutRefreshPolicy(previous:string,next:string,captured:boolean):'apply'|'defer'|'clear-and-apply' {
 return !captured?'apply':previous===next?'defer':'clear-and-apply';
}
