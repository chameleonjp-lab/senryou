/** Measurement-only helpers. Product runtime does not import this module. */
export interface DiagnosticRect {x:number;y:number;width:number;height:number}
export const DIAGNOSTIC_TOLERANCE=0.05;
export function intersection(a:DiagnosticRect,b:DiagnosticRect):DiagnosticRect {
 const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);return {x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};
}
export function overflowClip(current:DiagnosticRect,boundary:DiagnosticRect,x:string,y:string):DiagnosticRect {
 const clips=(v:string)=>['hidden','clip','scroll','auto'].includes(v),bx=clips(x),by=clips(y);
 return intersection(current,{x:bx?boundary.x:current.x,y:by?boundary.y:current.y,width:bx?boundary.width:current.width,height:by?boundary.height:current.height});
}
export function insetClip(value:string,box:DiagnosticRect):DiagnosticRect|null {
 const m=/^inset\(([^()]+)\)$/.exec(value);if(!m)return null;
 const tokens=m[1].trim().split(/\s+/);if(tokens.length<1||tokens.length>4||tokens.some(v=>!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:px|%)$/.test(v)))return null;
 const expanded=tokens.length===1?[tokens[0],tokens[0],tokens[0],tokens[0]]:tokens.length===2?[tokens[0],tokens[1],tokens[0],tokens[1]]:tokens.length===3?[tokens[0],tokens[1],tokens[2],tokens[1]]:tokens;
 const n=expanded.map((v,i)=>parseFloat(v)*(v.endsWith('%')?(i%2?box.width:box.height)/100:1));
 return {x:box.x+n[3],y:box.y+n[0],width:Math.max(0,box.width-n[1]-n[3]),height:Math.max(0,box.height-n[0]-n[2])};
}
export function circleRelation(rect:DiagnosticRect,sight:{x:number;y:number;radius:number;margin:number},tolerance=DIAGNOSTIC_TOLERANCE){
 const nearestX=Math.max(rect.x,Math.min(sight.x,rect.x+rect.width)),nearestY=Math.max(rect.y,Math.min(sight.y,rect.y+rect.height));
 const distance=Math.hypot(nearestX-sight.x,nearestY-sight.y),r=sight.radius+sight.margin;
 const boxIntersection=intersection(rect,{x:sight.x-r,y:sight.y-r,width:2*r,height:2*r});
 const actualPenetration=sight.radius-distance,marginPenetration=r-distance;
 const classification=rect.width<=0||rect.height<=0?'empty':actualPenetration>tolerance?'actual-circle-intersection':Math.abs(actualPenetration)<=tolerance?'actual-circle-subpixel-boundary':marginPenetration>tolerance?'margin-circle-intersection':Math.abs(marginPenetration)<=tolerance?'margin-circle-subpixel-boundary':boxIntersection.width>0&&boxIntersection.height>0?(Math.min(boxIntersection.width,boxIntersection.height)<=tolerance?'margin-box-subpixel-contact':'margin-box-only-contact'):'outside';
 return {classification,distance,actualPenetration,marginPenetration,boxIntersection,tolerance};
}
