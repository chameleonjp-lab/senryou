export interface ResizeWitness { sequence:number; trusted:boolean; width:number; height:number; captured:boolean }
export function deliveredResize(events:readonly ResizeWitness[],expected:{width:number;height:number},afterSequence=0):ResizeWitness|undefined {
 if(!Number.isSafeInteger(afterSequence)||afterSequence<0||![expected.width,expected.height].every(n=>Number.isFinite(n)&&n>0))return undefined;
 return events.find(e=>Number.isSafeInteger(e.sequence)&&e.sequence>afterSequence&&e.trusted===true&&e.width===expected.width&&e.height===expected.height);
}
export interface FocusWitness { sequence:number; trusted:boolean; hasFocus:boolean; visibilityState:string }
export function deliveredNativeBlur(beforeHasFocus:boolean,events:readonly FocusWitness[],afterHasFocus:boolean):boolean {
 return beforeHasFocus===true&&afterHasFocus===false&&events.some(e=>Number.isSafeInteger(e.sequence)&&e.sequence>0&&e.trusted===true&&e.hasFocus===false);
}
export interface FocusSession {send(method:'Emulation.setFocusEmulationEnabled',params:{enabled:boolean}):Promise<unknown>}
export interface FocusRestoration { restored:boolean; error?:string }
/** Playwright 1.61.1 establishes true on every main frame. Restore that verified default even on failure. */
export async function withNativeFocus<T>(session:FocusSession,action:()=>Promise<T>,onRestore:(result:FocusRestoration)=>void):Promise<T> {
 let actionFailed=false;
 try {await session.send('Emulation.setFocusEmulationEnabled',{enabled:false});return await action();}
 catch(error){actionFailed=true;throw error;}
 finally {
  try {await session.send('Emulation.setFocusEmulationEnabled',{enabled:true});onRestore({restored:true});}
  catch(error){onRestore({restored:false,error:String(error)});if(!actionFailed)throw error;}
 }
}
