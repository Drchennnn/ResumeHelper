import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Canvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {prepareResumeFiles} from '../extension/lib/documents.js';

function uint16(bytes,offset,value){bytes[offset]=value>>>8;bytes[offset+1]=value&0xff;}
function uint24le(bytes,offset,value){bytes[offset]=value&0xff;bytes[offset+1]=value>>>8&0xff;bytes[offset+2]=value>>>16&0xff;}
function uint32be(bytes,offset,value){bytes[offset]=value>>>24;bytes[offset+1]=value>>>16&0xff;bytes[offset+2]=value>>>8&0xff;bytes[offset+3]=value&0xff;}
function uint32le(bytes,offset,value){bytes[offset]=value&0xff;bytes[offset+1]=value>>>8&0xff;bytes[offset+2]=value>>>16&0xff;bytes[offset+3]=value>>>24&0xff;}

function pngHeader(width,height){
 const bytes=new Uint8Array(24);
 bytes.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],0);
 bytes.set([0x49,0x48,0x44,0x52],12);
 uint32be(bytes,16,width);uint32be(bytes,20,height);
 return bytes;
}
function jpegHeader(width,height){
 const bytes=new Uint8Array(21);
 bytes.set([0xff,0xd8,0xff,0xc0,0x00,0x11,0x08],0);
 uint16(bytes,7,height);uint16(bytes,9,width);
 return bytes;
}
function webpChunk(kind,data){
 const bytes=new Uint8Array(20+data.length+(data.length&1));
 bytes.set([0x52,0x49,0x46,0x46],0);uint32le(bytes,4,bytes.length-8);bytes.set([0x57,0x45,0x42,0x50],8);
 bytes.set([...kind].map(value=>value.charCodeAt(0)),12);uint32le(bytes,16,data.length);bytes.set(data,20);
 return bytes;
}
function webpExtended(width,height){
 const data=new Uint8Array(10);uint24le(data,4,width-1);uint24le(data,7,height-1);
 return webpChunk('VP8X',data);
}
function webpLossy(width,height){
 const data=new Uint8Array(10);data.set([0,0,0,0x9d,0x01,0x2a],0);data[6]=width&0xff;data[7]=width>>>8;data[8]=height&0xff;data[9]=height>>>8;
 return webpChunk('VP8 ',data);
}
function webpLossless(width,height){
 const data=new Uint8Array(5),bits=(width-1)|((height-1)<<14);data[0]=0x2f;uint32le(data,1,bits);
 return webpChunk('VP8L',data);
}

function pdf(objects){
 let output=Buffer.from('%PDF-1.4\n'),offsets=[];
 for(let index=0;index<objects.length;index++){
  offsets.push(output.length);
  output=Buffer.concat([output,Buffer.from(`${index+1} 0 obj\n`),Buffer.isBuffer(objects[index])?objects[index]:Buffer.from(objects[index]),Buffer.from('\nendobj\n')]);
 }
 const xref=output.length;
 let trailer=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
 for(const offset of offsets)trailer+=`${String(offset).padStart(10,'0')} 00000 n \n`;
 trailer+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.concat([output,Buffer.from(trailer)]);
}
function textPdf(text){
 const runs=[];for(let offset=0;offset<text.length;offset+=100)runs.push(`1 0 0 1 72 720 Tm (${text.slice(offset,offset+100)}) Tj`);
 const stream=`BT /F1 1 Tf ${runs.join(' ')} ET`;
 return pdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
 ]);
}
function oversizedImagePdf(){
 const content='q 100 0 0 100 0 0 cm /Im1 Do Q';
 const image=Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 8000 /Height 5000 /ColorSpace /DeviceGray /BitsPerComponent 1 /Length 1 >>\nstream\n'),Buffer.from([0]),Buffer.from('\nendstream')]);
 return pdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  image,
 ]);
}

async function withImageMocks(run){
 const originals={createImageBitmap:globalThis.createImageBitmap,OffscreenCanvas:globalThis.OffscreenCanvas};let decoded=0;
 globalThis.createImageBitmap=async()=>{decoded++;return {width:100,height:50,close(){}};};
 globalThis.OffscreenCanvas=class{
  constructor(width,height){this.width=width;this.height=height;}
  getContext(){return {fillStyle:'',fillRect(){},drawImage(){}};}
  async convertToBlob(){return new Blob(['bounded'],{type:'image/jpeg'});}
 };
 try{return await run(()=>decoded);}finally{Object.assign(globalThis,originals);}
}
async function withPdfCanvas(run){
 const originals={OffscreenCanvas:globalThis.OffscreenCanvas,DOMMatrix:globalThis.DOMMatrix,ImageData:globalThis.ImageData,Path2D:globalThis.Path2D};
 Object.assign(globalThis,{OffscreenCanvas:Canvas,DOMMatrix,ImageData,Path2D});
 try{return await run();}finally{Object.assign(globalThis,originals);}
}

test('validates PNG, JPEG and common WebP dimensions before decoding',async()=>withImageMocks(async decoded=>{
 const files=[
  new File([pngHeader(1200,800)],'resume.png',{type:'image/png'}),
  new File([jpegHeader(1200,800)],'resume.jpg',{type:'image/jpeg'}),
  new File([webpExtended(1200,800)],'extended.webp',{type:'image/webp'}),
  new File([webpLossy(1200,800)],'lossy.webp',{type:'image/webp'}),
  new File([webpLossless(1200,800)],'lossless.webp',{type:'image/webp'}),
 ];
 for(const file of files){const result=await prepareResumeFiles([file]);assert.equal(result.images.length,1);}
 assert.equal(decoded(),files.length);
}));

test('rejects excessive image edges and pixels before decoder allocation',async()=>withImageMocks(async decoded=>{
 await assert.rejects(prepareResumeFiles([new File([pngHeader(8000,5000)],'huge.png',{type:'image/png'})]),/总像素不能超过/);
 await assert.rejects(prepareResumeFiles([new File([jpegHeader(16001,1)],'wide.jpg',{type:'image/jpeg'})]),/边长不能超过 16000/);
 await assert.rejects(prepareResumeFiles([new File([webpExtended(10000,4000)],'huge.webp',{type:'image/webp'})]),/总像素不能超过/);
 await assert.rejects(prepareResumeFiles([new File([webpChunk('VP8X',new Uint8Array(4))],'broken.webp',{type:'image/webp'})]),/缺少尺寸信息/);
 assert.equal(decoded(),0);
}));

test('stops PDF text extraction at the document budget and rejects corrupt PDF data',async()=>{
 await assert.rejects(prepareResumeFiles([new File([textPdf('A'.repeat(100_001))],'huge-text.pdf',{type:'application/pdf'})]),/PDF 文字内容超过 10 万字符/);
 await assert.rejects(prepareResumeFiles([new File(['%PDF-1.7\ninvalid'],'broken.pdf',{type:'application/pdf'})]),/无法读取 PDF/);
});

test('turns an oversized embedded PDF image into a visible import error',async()=>withPdfCanvas(async()=>{
 await assert.rejects(prepareResumeFiles([new File([oversizedImagePdf()],'huge-image.pdf',{type:'application/pdf'})]),/PDF 页面为空或包含超过 33554432 像素的图片/);
}));
