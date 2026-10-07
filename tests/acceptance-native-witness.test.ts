import test from 'node:test';import assert from 'node:assert/strict';
import {deliveredResize,deliveredNativeBlur,withNativeFocus,type ResizeWitness,type FocusRestoration} from '../browser-tests/acceptance/native-environment-witness';
const event:ResizeWitness={sequence:1,trusted:true,width:1000,height:700,captured:false};
test('resize needs both a newly delivered trusted event and actual expected dimensions',()=>{
 assert.equal(deliveredResize([event],{width:1000,height:700}),event);
 for(const e of [{...event,trusted:false},{...event,sequence:0},{...event,width:1280},{...event,height:720}])assert.equal(deliveredResize([e],{width:1000,height:700}),undefined);
 assert.equal(deliveredResize([event],{width:1000,height:700},1),undefined);assert.equal(deliveredResize([],{width:1000,height:700}),undefined);
});
test('delivered resize with retained capture remains a product assertion, not missing environmental evidence',()=>{assert.equal(deliveredResize([{...event,captured:true}],{width:1000,height:700})?.captured,true);});
test('native blur cannot be manufactured from a synthetic event, preexisting unfocused state or focus that never left',()=>{
 const e={sequence:1,trusted:true,hasFocus:false,visibilityState:'hidden'};
 assert.equal(deliveredNativeBlur(true,[e],false),true);
 for(const [before,events,after] of [[false,[e],false],[true,[{...e,trusted:false}],false],[true,[],false],[true,[e],true],[true,[{...e,hasFocus:true}],false]] as const)assert.equal(deliveredNativeBlur(before,events,after),false);
});
test('focus framework override is restored after success',async()=>{
 const sent:boolean[]=[],restored:FocusRestoration[]=[];const result=await withNativeFocus({send:async(_m,p)=>{sent.push(p.enabled);}},async()=>42,r=>restored.push(r));assert.equal(result,42);assert.deepEqual(sent,[false,true]);assert.deepEqual(restored,[{restored:true}]);
});
test('focus override is restored when the native operation is blocked',async()=>{
 const sent:boolean[]=[],original=new Error('environment blocked');await assert.rejects(withNativeFocus({send:async(_m,p)=>{sent.push(p.enabled);}},async()=>{throw original;},()=>{}),e=>e===original);assert.deepEqual(sent,[false,true]);
});
test('setup failure still attempts restoration',async()=>{
 const sent:boolean[]=[];await assert.rejects(withNativeFocus({send:async(_m,p)=>{sent.push(p.enabled);if(!p.enabled)throw new Error('setup rejected');}},async()=>42,()=>{}),/setup rejected/);assert.deepEqual(sent,[false,true]);
});
test('restore failure cannot turn a successful body into a pass',async()=>{
 const reports:FocusRestoration[]=[];await assert.rejects(withNativeFocus({send:async(_m,p)=>{if(p.enabled)throw new Error('restore failed');}},async()=>42,r=>reports.push(r)),/restore failed/);assert.equal(reports[0].restored,false);
});
test('original failed operation is preserved alongside restore failure evidence',async()=>{
 const original=new Error('native unavailable'),reports:FocusRestoration[]=[];await assert.rejects(withNativeFocus({send:async(_m,p)=>{if(p.enabled)throw new Error('restore failed');}},async()=>{throw original;},r=>reports.push(r)),e=>e===original);assert.equal(reports[0].restored,false);
});
