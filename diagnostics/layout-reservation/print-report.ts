import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {createHash,randomUUID} from 'node:crypto';import {inspectDiagnostic,inspectBrowserEnvelope,REGISTRY} from './contracts';
const token=randomUUID();process.stdout.write(`::stop-commands::${token}\n`);
try{
 let raw:Buffer|null=null;const issues:string[]=[];const index:{pointer:string;bytes:number;sha256:string}[]=[];let diagnosis:ReturnType<typeof inspectDiagnostic>|undefined;
 try{
  raw=readFileSync('test-results/layout-diagnostic-results.json');const parsed:unknown=JSON.parse(raw.toString('utf8'));
  const visit=(v:unknown,pointer:string)=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>visit(x,`${pointer}/${i}`));return;}const o=v as Record<string,unknown>;
   if(o.name==='layout-reservation-diagnostic.json'&&o.contentType==='application/json'){
    if(typeof o.body!=='string')throw new Error('Missing inline diagnostic attachment');const bytes=Buffer.from(o.body,'base64');if(bytes.toString('base64')!==o.body)throw new Error('Invalid base64');index.push({pointer:pointer+'/body',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});diagnosis=inspectDiagnostic(JSON.parse(bytes.toString('utf8')));
   }for(const [k,x]of Object.entries(o))visit(x,`${pointer}/${k.replace(/~/g,'~0').replace(/\//g,'~1')}`);
  };visit(parsed,'');if(index.length!==1)throw new Error('Expected exactly one diagnostic attachment');
  issues.push(...inspectBrowserEnvelope(parsed));
 }catch(error){issues.push(String(error));}
 const output={schemaVersion:1,kind:'layout-reservation-measurement-only',registry:REGISTRY,raw:raw?{bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')}:null,index,diagnosis:diagnosis??inspectDiagnostic(null),issues,formal13:'not executed by this diagnostic',productAcceptance:false,naturalWarningOccurrence:false,imagesTraces:'not saved'};
 const emit=(label:string,b:Buffer)=>{const sha256=createHash('sha256').update(b).digest('hex');process.stdout.write(`JSON_EVIDENCE_BEGIN ${JSON.stringify({label,bytes:b.length,sha256})}\n`);process.stdout.write(b);process.stdout.write(`\nJSON_EVIDENCE_END ${JSON.stringify({label,sha256})}\n`);};
 if(raw)emit('layout-diagnostic-results.json',raw);const summary=Buffer.from(JSON.stringify(output));mkdirSync('test-results',{recursive:true});writeFileSync('test-results/layout-diagnostic-index.json',summary);emit('layout-diagnostic-index.json',summary);
 if(issues.length||!output.diagnosis.complete)process.exitCode=1;
}finally{process.stdout.write(`::${token}::\n`);}
