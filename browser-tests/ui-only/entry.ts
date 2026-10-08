// Direct URL requests under ordinary dev/production never install a fixture API.
if(!import.meta.env.DEV||import.meta.env.MODE!=='ui-only'||location.pathname!=='/__ui_only__/')throw new Error('Private UI fixture entry is disabled outside its explicit development route.');
const original=HTMLCanvasElement.prototype.getContext;
const telemetry={webglRequests:0,canvas2dRequests:0};
HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,kind:string,...args:unknown[]){
 if(kind==='webgl'||kind==='webgl2'||kind==='experimental-webgl'){telemetry.webglRequests++;throw new Error('UI fixture must never request WebGL');}
 if(kind==='2d')telemetry.canvas2dRequests++;
 return Reflect.apply(original,this,[kind,...args]);
} as typeof original;
const {mountProductUi}=await import('virtual:senryou-ui');
const ui=mountProductUi();
Object.defineProperty(window,'__senryouUiOnly',{value:{...ui,telemetry},configurable:false});
document.documentElement.dataset.uiOnlyReady='true';
