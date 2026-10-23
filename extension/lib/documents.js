import {getDocument,GlobalWorkerOptions,PDFWorker} from '../vendor/pdfjs/pdf.min.mjs';

const TEXT_LIMIT=500_000;
const PDF_LIMIT=10*1024*1024;
const IMAGE_LIMIT=10*1024*1024;
const IMAGE_OUTPUT_LIMIT=4*1024*1024;
const IMAGE_TOTAL_LIMIT=16*1024*1024;
const MAX_PDF_PAGES=8;
const MAX_IMAGES=8;
const MAX_EDGE=1600;
const MAX_SOURCE_EDGE=16_000;
const MAX_SOURCE_PIXELS=32*1024*1024;
const PDF_TEXT_LIMIT=100_000;
const PDF_CANVAS_LIMIT=64*1024*1024;
if(typeof Worker!=='function')GlobalWorkerOptions.workerSrc=new URL('../vendor/pdfjs/pdf.worker.min.mjs',import.meta.url).href;
const PDF_OPTIONS={
 cMapUrl:new URL('../vendor/pdfjs/cmaps/',import.meta.url).href,
 cMapPacked:true,
 standardFontDataUrl:new URL('../vendor/pdfjs/standard_fonts/',import.meta.url).href,
 wasmUrl:new URL('../vendor/pdfjs/wasm/',import.meta.url).href,
 useWorkerFetch:true,
 useWasm:false,
 useSystemFonts:true,
 stopAtErrors:true,
 maxImageSize:MAX_SOURCE_PIXELS,
 canvasMaxAreaInBytes:PDF_CANVAS_LIMIT,
};

function progress(callback,stage,current,total,name){callback?.({stage,current,total,name});}
function ext(name=''){const match=/\.([^.]+)$/.exec(name.toLowerCase());return match?.[1]||'';}
function assertFile(file){if(!file||typeof file.arrayBuffer!=='function'||typeof file.size!=='number')throw new Error('请选择有效的本地文件');}
function startsWith(bytes,signature){return signature.every((value,index)=>bytes[index]===value);}
function imageFormat(bytes){
 if(startsWith(bytes,[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))return 'png';
 if(startsWith(bytes,[0xff,0xd8,0xff]))return 'jpeg';
 if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'webp';
 return '';
}
function uint16be(bytes,offset){return bytes[offset]*256+bytes[offset+1];}
function uint24le(bytes,offset){return bytes[offset]+bytes[offset+1]*256+bytes[offset+2]*65536;}
function uint32be(bytes,offset){return bytes[offset]*0x1000000+bytes[offset+1]*0x10000+bytes[offset+2]*0x100+bytes[offset+3];}
function uint32le(bytes,offset){return bytes[offset]+bytes[offset+1]*0x100+bytes[offset+2]*0x10000+bytes[offset+3]*0x1000000;}
function pngDimensions(bytes){
 if(bytes.length<24||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')return null;
 return {width:uint32be(bytes,16),height:uint32be(bytes,20)};
}
function jpegDimensions(bytes){
 let offset=2;
 while(offset<bytes.length){
  if(bytes[offset]!==0xff)return null;
  while(bytes[offset]===0xff)offset++;
  const marker=bytes[offset++];
  if(marker===0xd9||marker===0xda)return null;
  if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
  if(offset+2>bytes.length)return null;
  const size=uint16be(bytes,offset);
  if(size<2||offset+size>bytes.length)return null;
  if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
   if(size<7)return null;
   return {width:uint16be(bytes,offset+5),height:uint16be(bytes,offset+3)};
  }
  offset+=size;
 }
 return null;
}
function webpDimensions(bytes){
 let offset=12;
 while(offset+8<=bytes.length){
  const chunk=String.fromCharCode(...bytes.slice(offset,offset+4));
  const size=uint32le(bytes,offset+4),data=offset+8;
  if(size<0||data+size>bytes.length)return null;
  if(chunk==='VP8X'){
   if(size<10)return null;
   return {width:uint24le(bytes,data+4)+1,height:uint24le(bytes,data+7)+1};
  }
  if(chunk==='VP8 '){
   if(size<10||bytes[data+3]!==0x9d||bytes[data+4]!==0x01||bytes[data+5]!==0x2a)return null;
   return {width:(bytes[data+6]+bytes[data+7]*256)&0x3fff,height:(bytes[data+8]+bytes[data+9]*256)&0x3fff};
  }
  if(chunk==='VP8L'){
   if(size<5||bytes[data]!==0x2f)return null;
   const bits=uint32le(bytes,data+1);
   return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};
  }
  offset=data+size+(size&1);
 }
 return null;
}
function imageDimensions(bytes,format){return format==='png'?pngDimensions(bytes):format==='jpeg'?jpegDimensions(bytes):webpDimensions(bytes);}
function assertImageDimensions(bytes,format,name){
 const dimensions=imageDimensions(bytes,format);
 if(!dimensions?.width||!dimensions?.height)throw new Error(`图片已损坏或缺少尺寸信息：${name}`);
 if(dimensions.width>MAX_SOURCE_EDGE||dimensions.height>MAX_SOURCE_EDGE)throw new Error(`图片边长不能超过 ${MAX_SOURCE_EDGE} 像素：${name}`);
 if(dimensions.width*dimensions.height>MAX_SOURCE_PIXELS)throw new Error(`图片总像素不能超过 ${MAX_SOURCE_PIXELS}：${name}`);
 return dimensions;
}
function base64Bytes(dataUrl){const value=dataUrl.slice(dataUrl.indexOf(',')+1);return Math.floor(value.length*3/4)-(value.endsWith('==')?2:value.endsWith('=')?1:0);}
function ensureImageBudget(images){
 let total=0;
 for(const image of images){const bytes=base64Bytes(image);if(bytes>IMAGE_OUTPUT_LIMIT)throw new Error('处理后的单张图片超过 4 MB，请降低图片分辨率');total+=bytes;}
 if(total>IMAGE_TOTAL_LIMIT)throw new Error('处理后的图片总大小超过 16 MB，请减少图片数量或分辨率');
 return images;
}
function canvasFor(width,height){
 if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(width,height);
 if(globalThis.document?.createElement){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;}
 throw new Error('当前环境不支持本地图片处理');
}
async function canvasBlob(canvas,quality=.85){
 if(typeof canvas.convertToBlob==='function'){
  const blob=await canvas.convertToBlob({type:'image/jpeg',quality});
  if(blob.type==='image/jpeg'||typeof canvas.toBlob!=='function')return blob;
 }
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('图片压缩失败')),'image/jpeg',quality));
}
async function blobDataUrl(blob){
 if(typeof FileReader==='function')return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('图片读取失败'));reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);});
 const bytes=new Uint8Array(await blob.arrayBuffer());
 if(typeof Buffer!=='undefined')return `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
 let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
 return `data:${blob.type};base64,${btoa(binary)}`;
}
async function jpegDataUrl(canvas){
 let blob=await canvasBlob(canvas,.85);
 if(blob.size>IMAGE_OUTPUT_LIMIT)blob=await canvasBlob(canvas,.72);
 if(blob.size>IMAGE_OUTPUT_LIMIT)throw new Error('处理后的单张图片超过 4 MB，请降低图片分辨率');
 return blobDataUrl(blob);
}
async function bitmapFrom(blob){
 if(typeof createImageBitmap!=='function')throw new Error('当前浏览器不支持本地图片解码');
 try{return await createImageBitmap(blob,{imageOrientation:'from-image'});}catch{throw new Error('图片已损坏或编码不受支持');}
}
async function prepareImage(file,index,total,onProgress){
 if(file.size<=0)throw new Error(`${file.name||'图片'}为空文件`);
 if(file.size>IMAGE_LIMIT)throw new Error(`单张图片不能超过 10 MB：${file.name||'未命名图片'}`);
 const bytes=new Uint8Array(await file.arrayBuffer());
 const format=imageFormat(bytes),extension=ext(file.name);
 if(!format||!['png','jpg','jpeg','webp'].includes(extension))throw new Error('仅支持 PNG、JPG、JPEG 或 WEBP 图片');
 if((extension==='jpg'||extension==='jpeg'? 'jpeg':extension)!==format)throw new Error(`图片扩展名与文件内容不一致：${file.name}`);
 if(file.type&&!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error(`图片 MIME 类型不受支持：${file.name}`);
 assertImageDimensions(bytes,format,file.name||'未命名图片');
 progress(onProgress,'image',index,total,file.name);
 const bitmap=await bitmapFrom(new Blob([bytes],{type:file.type||`image/${format}`}));
 try{
  if(!bitmap.width||!bitmap.height)throw new Error('图片尺寸无效');
  const scale=Math.min(1,MAX_EDGE/Math.max(bitmap.width,bitmap.height));
  const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=canvasFor(width,height),context=canvas.getContext('2d',{alpha:false});
  if(!context)throw new Error('无法创建图片画布');
  context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(bitmap,0,0,width,height);
  return await jpegDataUrl(canvas);
 }finally{bitmap.close?.();}
}

function createWorker(){
 if(typeof Worker!=='function')return {worker:null,port:null};
 let port;
 try{
  port=new Worker(new URL('../vendor/pdfjs/pdf.worker.min.mjs',import.meta.url),{type:'module'});
  return {port,worker:new PDFWorker({port})};
 }catch(error){port?.terminate();throw error;}
}
async function withPdf(bytes,callback){
 let worker=null,port=null,task=null;
 try{
  ({worker,port}=createWorker());
  task=getDocument({...PDF_OPTIONS,data:bytes.slice(),...(worker?{worker}:{})});
  return await callback(await task.promise);
 }catch(error){
  if(error?.name==='PasswordException')throw new Error('PDF 已加密，请先移除密码后再导入');
  if(/password/i.test(error?.message||''))throw new Error('PDF 已加密，请先移除密码后再导入');
  if(/Image exceeded maximum allowed size/i.test(error?.message||''))throw new Error(`PDF 包含超过 ${MAX_SOURCE_PIXELS} 像素的图片，请先压缩后再导入`);
  if(error instanceof Error&&/^PDF /.test(error.message))throw error;
  throw new Error(`无法读取 PDF：${error?.message||'文件已损坏或格式不受支持'}`);
 }finally{
  try{await task?.destroy();}catch{}
  try{await worker?.destroy();}catch{}
  port?.terminate();
 }
}
function appendPageItems(output,items,remaining){
 let used=0;
 for(const item of items){
  if(typeof item.str!=='string')continue;
  const suffix=item.hasEOL?'\n':item.str&&!/\s$/.test(item.str)?' ':'';
  const addition=item.str+suffix;
  if(used+addition.length>remaining)throw new Error('PDF 文字内容超过 10 万字符，请拆分或精简后导入');
  output.push(addition);used+=addition.length;
 }
 return used;
}
export function normalizePdfText(text){
 return String(text||'')
  .replace(/[ \t]+\n/g,'\n')
  .replace(/[ \t]{2,}/g,' ')
  .replace(/(\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu,'$1')
  .trim();
}
async function pageText(page,remaining){
 const reader=page.streamTextContent({disableNormalization:false}).getReader(),output=[];
 let used=0,done=false;
 try{
  while(true){
   const chunk=await reader.read();
   if(chunk.done){done=true;break;}
   used+=appendPageItems(output,chunk.value.items,remaining-used);
  }
 }finally{if(!done)reader.cancel(new Error('PDF text budget reached')).catch(()=>{});}
 const text=output.join('');
 return {text:normalizePdfText(text),used};
}
async function renderPage(page){
 const operators=await page.getOperatorList();
 if(!operators.fnArray.length)throw new Error(`PDF 页面为空或包含超过 ${MAX_SOURCE_PIXELS} 像素的图片，请先检查或压缩后再导入`);
 const initial=page.getViewport({scale:1});
 const scale=Math.min(2,MAX_EDGE/Math.max(initial.width,initial.height));
 const viewport=page.getViewport({scale});
 const canvas=canvasFor(Math.ceil(viewport.width),Math.ceil(viewport.height));
 const context=canvas.getContext('2d',{alpha:false});
 if(!context)throw new Error('无法创建 PDF 页面画布');
 context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
 await page.render({canvasContext:context,viewport,canvas}).promise;
 return jpegDataUrl(canvas);
}
async function renderPdf(bytes,pages,onProgress){
 const images=await withPdf(bytes,async pdf=>{
  if(pdf.numPages>MAX_PDF_PAGES)throw new Error(`PDF 最多支持 ${MAX_PDF_PAGES} 页，当前文件有 ${pdf.numPages} 页`);
  const output=[];
  for(let i=0;i<pages.length;i++){
   const number=pages[i];progress(onProgress,'pdf-render',i+1,pages.length,`第 ${number} 页`);
   const page=await pdf.getPage(number);
   try{output.push(await renderPage(page));}finally{page.cleanup();}
  }
  return output;
 });
 return ensureImageBudget(images);
}
async function preparePdf(file,onProgress){
 if(file.size<=0)throw new Error('PDF 为空文件');
 if(file.size>PDF_LIMIT)throw new Error('PDF 不能超过 10 MB');
 if(ext(file.name)!=='pdf')throw new Error('PDF 文件扩展名必须为 .pdf');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(!startsWith(bytes,[0x25,0x50,0x44,0x46,0x2d]))throw new Error('文件内容不是有效的 PDF');
 const parsed=await withPdf(bytes,async pdf=>{
  if(pdf.numPages>MAX_PDF_PAGES)throw new Error(`PDF 最多支持 ${MAX_PDF_PAGES} 页，当前文件有 ${pdf.numPages} 页`);
  const pageTexts=[],scanPages=[];let used=0;
  for(let number=1;number<=pdf.numPages;number++){
   progress(onProgress,'pdf-text',number,pdf.numPages,`第 ${number} 页`);
   const page=await pdf.getPage(number);
   try{
    const separator=pageTexts.length?2:0;
    if(used+separator>PDF_TEXT_LIMIT)throw new Error('PDF 文字内容超过 10 万字符，请拆分或精简后导入');
    const result=await pageText(page,PDF_TEXT_LIMIT-used-separator),text=result.text;
    used+=result.used+separator;
    pageTexts.push(text);
    if(text.replace(/\s/g,'').length<20)scanPages.push(number);
   }finally{page.cleanup();}
  }
  return {pageCount:pdf.numPages,text:pageTexts.join('\n\n'),scanPages};
 });
 const images=parsed.scanPages.length?await renderPdf(bytes,parsed.scanPages,onProgress):[];
 return {
  kind:'document',name:file.name,text:parsed.text,images,pageCount:parsed.pageCount,
  needsVision:parsed.scanPages.length>0,
  renderImages:()=>renderPdf(bytes,Array.from({length:parsed.pageCount},(_,i)=>i+1),onProgress)
 };
}

export async function prepareResumeFiles(input,onProgress){
 const files=Array.from(input||[]);if(!files.length)throw new Error('请选择简历文件');
 files.forEach(assertFile);
 const extensions=files.map(file=>ext(file.name));
 const allImages=extensions.every(value=>['png','jpg','jpeg','webp'].includes(value));
 if(allImages){
  if(files.length>MAX_IMAGES)throw new Error(`简历图片最多 ${MAX_IMAGES} 张`);
  const images=[];for(let i=0;i<files.length;i++)images.push(await prepareImage(files[i],i+1,files.length,onProgress));
  return {kind:'document',name:files.length===1?files[0].name:`${files[0].name} 等 ${files.length} 张`,text:'',images:ensureImageBudget(images),pageCount:files.length,needsVision:true};
 }
 if(files.length!==1)throw new Error('PDF、JSON、TXT 或 Markdown 每次只能导入一个文件，且不能与图片混合');
 const [file]=files,[extension]=extensions;
 if(extension==='pdf')return preparePdf(file,onProgress);
 if(['json','txt','md'].includes(extension)){
  if(file.size<=0)throw new Error(`${file.name} 为空文件`);
  if(file.size>TEXT_LIMIT)throw new Error('JSON、TXT 或 Markdown 文件不能超过 500 KB');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}catch{throw new Error('文本文件必须使用 UTF-8 编码');}
  if(extension==='json'){try{JSON.parse(text);}catch{throw new Error('JSON 文件格式无效');}}
  return {kind:extension==='json'?'json':'text',name:file.name,text,images:[],pageCount:0,needsVision:false};
 }
 throw new Error('支持 PDF、PNG、JPG、JPEG、WEBP、JSON、TXT 和 Markdown 文件');
}
