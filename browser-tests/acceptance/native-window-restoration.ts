export type WindowState='normal'|'minimized'|'maximized'|'fullscreen';
export interface WindowBounds {left:number;top:number;width:number;height:number;windowState:WindowState}
export interface BoundsLike {left?:number;top?:number;width?:number;height?:number;windowState?:string}
export function checkedWindowBounds(value:BoundsLike):WindowBounds {
 const {left,top,width,height,windowState}=value;
 if(![left,top,width,height].every(n=>typeof n==='number'&&Number.isSafeInteger(n))||width!<=0||height!<=0||!['normal','minimized','maximized','fullscreen'].includes(windowState??''))throw new Error('Incomplete native window bounds');
 return {left:left!,top:top!,width:width!,height:height!,windowState:windowState as WindowState};
}
export function equalWindowBounds(actual:BoundsLike,expected:WindowBounds):boolean {
 return actual.left===expected.left&&actual.top===expected.top&&actual.width===expected.width&&actual.height===expected.height&&actual.windowState===expected.windowState;
}
export interface WindowPort {
 setBounds(bounds:Partial<WindowBounds>):Promise<unknown>;
 verifyRestored(expected:WindowBounds):Promise<WindowBounds>;
}
export interface WindowRestoration {restored:boolean;actual?:WindowBounds;error?:string}
/** CDP forbids state changes combined with geometry. Restore both in separate commands and verify. */
export async function withRestoredWindow<T>(port:WindowPort,original:WindowBounds,action:()=>Promise<T>,onRestore:(result:WindowRestoration)=>void):Promise<T> {
 let failed=false;
 try{return await action();}catch(error){failed=true;throw error;}
 finally{
  try{
   await port.setBounds({windowState:'normal'});
   await port.setBounds({left:original.left,top:original.top,width:original.width,height:original.height});
   if(original.windowState!=='normal')await port.setBounds({windowState:original.windowState});
   const actual=await port.verifyRestored(original);
   if(!equalWindowBounds(actual,original))throw new Error('Native window restoration did not reproduce original bounds/state');
   onRestore({restored:true,actual});
  }catch(error){onRestore({restored:false,error:String(error)});if(!failed)throw error;}
 }
}
