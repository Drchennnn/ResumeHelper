import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Canvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {normalizePdfText,prepareResumeFiles} from '../extension/lib/documents.js';

const fixture=async name=>new File([await readFile(new URL(`../fixtures/${name}`,import.meta.url))],name);

async function withPdfCanvas(callback){
 const originals={OffscreenCanvas:globalThis.OffscreenCanvas,DOMMatrix:globalThis.DOMMatrix,ImageData:globalThis.ImageData,Path2D:globalThis.Path2D};
 Object.assign(globalThis,{OffscreenCanvas:Canvas,DOMMatrix,ImageData,Path2D});
 try{return await callback();}finally{Object.assign(globalThis,originals);}
}

function createPdf(pageCount){
 const pageStart=3,fontRef=pageStart+pageCount,contentRef=fontRef+1;
 const kids=Array.from({length:pageCount},(_,index)=>`${pageStart+index} 0 R`).join(' ');
 const stream='BT /F1 12 Tf 72 720 Td (Synthetic page for page limit validation.) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`];
 for(let index=0;index<pageCount;index++)objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${contentRef} 0 R >>`);
 objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
 let output='%PDF-1.4\n',offsets=[];
 for(let index=0;index<objects.length;index++){offsets.push(Buffer.byteLength(output));output+=`${index+1} 0 obj\n${objects[index]}\nendobj\n`;}
 const xref=Buffer.byteLength(output);output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
 for(const offset of offsets)output+=`${String(offset).padStart(10,'0')} 00000 n \n`;
 return Buffer.from(output+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

test('normalizes PDF glyph spacing only between Han characters on the same line',()=>{
 const extracted=[
  '教 育 背 景  ',
  '香港 城 市大学',
  '张 小 明',
  'AI  Agent 2026 年',
  'City University of Hong Kong',
 ].join('\n');
 assert.equal(normalizePdfText(extracted),[
  '教育背景',
  '香港城市大学',
  '张小明',
  'AI Agent 2026 年',
  'City University of Hong Kong',
 ].join('\n'));
});

test('extracts text and page metadata from a real local PDF without rendering text pages',async()=>{
 const result=await prepareResumeFiles([await fixture('fictional-resume.pdf')]);
 assert.equal(result.kind,'document');
 assert.equal(result.pageCount,1);
 assert.equal(result.needsVision,false);
 assert.deepEqual(result.images,[]);
 assert.match(result.text,/Fictional Candidate\ndemo@example\.com\nJavaScript and Python/);
 assert.equal(typeof result.renderImages,'function');
});

test('detects and renders a real image-only scanned PDF',async()=>withPdfCanvas(async()=>{
 const events=[];
 const result=await prepareResumeFiles([await fixture('fictional-resume-scanned.pdf')],event=>events.push(event));
 assert.equal(result.kind,'document');
 assert.equal(result.pageCount,1);
 assert.equal(result.text,'');
 assert.equal(result.needsVision,true);
 assert.equal(result.images.length,1);
 assert.match(result.images[0],/^data:image\/jpeg;base64,/);
 assert.ok(events.some(event=>event.stage==='pdf-text'&&event.current===1));
 assert.ok(events.some(event=>event.stage==='pdf-render'&&event.current===1));
}));

test('keeps text-layer content while rendering only the scan page of a mixed PDF',async()=>withPdfCanvas(async()=>{
 const result=await prepareResumeFiles([await fixture('fictional-resume-mixed.pdf')]);
 assert.equal(result.kind,'document');
 assert.equal(result.pageCount,2);
 assert.equal(result.needsVision,true);
 assert.equal(result.images.length,1);
 assert.match(result.images[0],/^data:image\/jpeg;base64,/);
 assert.match(result.text,/Fictional Candidate\ndemo@example\.com\nJavaScript and Python/);
 const allPages=await result.renderImages();
 assert.equal(allPages.length,2);
 assert.ok(allPages.every(image=>image.startsWith('data:image/jpeg;base64,')));
}));

test('rejects over-page PDF before extracting its page contents',async()=>{
 const events=[];
 const file=new File([createPdf(9)],'nine-pages.pdf',{type:'application/pdf'});
 await assert.rejects(prepareResumeFiles([file],event=>events.push(event)),/最多支持 8 页.*9 页/);
 assert.deepEqual(events,[]);
});

test('enforces document size and file-set boundaries without truncation',async()=>{
 await assert.rejects(prepareResumeFiles([new File([new Uint8Array(500_001)],'resume.md')]),/不能超过 500 KB/);
 await assert.rejects(prepareResumeFiles([new File([new Uint8Array(10*1024*1024+1)],'resume.pdf')]),/不能超过 10 MB/);
 await assert.rejects(prepareResumeFiles([new File(['hello'],'resume.txt'),new File(['world'],'more.md')]),/每次只能导入一个文件/);
 await assert.rejects(prepareResumeFiles([new File(['{bad'],'resume.json')]),/JSON 文件格式无效/);
 await assert.rejects(prepareResumeFiles([new File([Uint8Array.from([0xc3,0x28])],'resume.txt')]),/UTF-8/);
});

test('validates image signatures and preprocesses a local image to bounded JPEG data',async()=>{
 const originalBitmap=globalThis.createImageBitmap,originalCanvas=globalThis.OffscreenCanvas;
 let closed=false,canvasSize;
 globalThis.createImageBitmap=async()=>({width:2400,height:1200,close(){closed=true;}});
 globalThis.OffscreenCanvas=class{
  constructor(width,height){this.width=width;this.height=height;canvasSize=[width,height];}
  getContext(){return {fillStyle:'',fillRect(){},drawImage(){}};}
  async convertToBlob(options){assert.equal(options.type,'image/jpeg');assert.equal(options.quality,.85);return new Blob(['jpeg fixture'],{type:'image/jpeg'});}
 };
 try{
  const source=await fixture('fictional-resume.png');
  const result=await prepareResumeFiles([new File([source],'fictional-resume.png',{type:'image/png'})]);
  assert.deepEqual(canvasSize,[1600,800]);
  assert.equal(result.kind,'document');
  assert.equal(result.needsVision,true);
  assert.equal(result.pageCount,1);
  assert.match(result.images[0],/^data:image\/jpeg;base64,/);
  assert.equal(closed,true);
 }finally{globalThis.createImageBitmap=originalBitmap;globalThis.OffscreenCanvas=originalCanvas;}
});

test('rejects disguised, oversized and excessive image inputs before decoding',async()=>{
 await assert.rejects(prepareResumeFiles([new File(['not a png'],'resume.png',{type:'image/png'})]),/仅支持 PNG/);
 const pngHeader=Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
 await assert.rejects(prepareResumeFiles([new File([pngHeader],'resume.jpg',{type:'image/jpeg'})]),/扩展名与文件内容不一致/);
 await assert.rejects(prepareResumeFiles([new File([new Uint8Array(10*1024*1024+1)],'resume.png',{type:'image/png'})]),/不能超过 10 MB/);
 await assert.rejects(prepareResumeFiles(Array.from({length:9},(_,i)=>new File([pngHeader],`resume-${i}.png`,{type:'image/png'}))),/最多 8 张/);
});
