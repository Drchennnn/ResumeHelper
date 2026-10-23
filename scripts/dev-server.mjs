import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mock=process.argv.includes('--mock-api');
const port=Number(process.env.RESUMEHELPER_PORT||8767);
let requests=[];
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.bcmap':'application/octet-stream','.pfb':'application/octet-stream','.ttf':'font/ttf'};
http.createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(mock&&pathname==='/__test__/requests'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(requests));return;}
  if(mock&&pathname==='/__test__/v1/chat/completions'&&req.method==='POST'){
   let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>25*1024*1024){res.writeHead(413).end();return;}chunks.push(chunk);}
   const body=JSON.parse(Buffer.concat(chunks));const content=body.messages?.[1]?.content;
   const images=Array.isArray(content)?content.filter(c=>c.type==='image_url').length:0;
   requests.push({model:body.model,images,mode:images?'vision':'text'});
   const result={name:images?'虚构图片导入':'虚构PDF导入',personal:{name:'Fictional Candidate',email:'demo@example.com'},skills:{technical:'JavaScript, Python'},education:[{school:'Example University'}]};
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  const relative=decodeURIComponent(pathname).replace(/^\/+/, '')||'extension/workbench.html';
  if(relative.split('/').some(part=>part.startsWith('.')||part==='node_modules')){res.writeHead(404).end();return;}
  const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)||!(await stat(file)).isFile()){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
  // Match the installed extension page CSP while testing local modules/workers.
  if(relative.startsWith('extension/')||relative==='fixtures/document-test.html')res.setHeader('Content-Security-Policy',"script-src 'self'; object-src 'self'");
  res.setHeader('Cache-Control','no-store');res.end(req.method==='HEAD'?undefined:await readFile(file));
 }catch{res.writeHead(404).end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`ResumeHelper: http://127.0.0.1:${port}/extension/workbench.html${mock?' (fictional mock API enabled)':''}`));
