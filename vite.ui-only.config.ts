import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateProductModules } from './browser-tests/ui-only/extract-product.mjs';
export default defineConfig(({command,mode})=>{
 if(command!=='serve'||mode!=='ui-only')throw new Error('UI fixture requires explicit serve --mode ui-only; it cannot build/publish.');
 const modules=generateProductModules();
 return {server:{host:'127.0.0.1',port:4189,strictPort:true,ws:false},plugins:[{
  name:'senryou-private-ui-only',apply:'serve',
  resolveId(id){if(id==='virtual:senryou-ui'||id==='virtual:senryou-canvas')return '\0'+id;},
  load(id){if(id==='\0virtual:senryou-ui')return {code:modules.ui,map:null};if(id==='\0virtual:senryou-canvas')return {code:modules.canvas,map:null};},
  async transform(code,id){if(id.startsWith('\0virtual:senryou-')){const {transformWithOxc}=await import('vite');return transformWithOxc(code,'virtual-product.ts');}},
  configureServer(server){server.middlewares.use(async(req,res,next)=>{
   if(req.url?.split('?')[0]!=='/__ui_only__/')return next();
   const source=readFileSync(resolve('index.html'),'utf8'),needle='<script type="module" src="/src/main.ts"></script>';
   if(source.split(needle).length!==2){res.statusCode=500;res.end('Product entry identity drift');return;}
   const html=await server.transformIndexHtml('/__ui_only__/',source.replace(needle,'<script type="module" src="/browser-tests/ui-only/entry.ts"></script>'));
   res.statusCode=200;res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');res.end(html);
  });},
 }]};
});
