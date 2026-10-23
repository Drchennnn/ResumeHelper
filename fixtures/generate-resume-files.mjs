import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCanvas} from '@napi-rs/canvas';

const target=path.dirname(fileURLToPath(import.meta.url));

function asBuffer(value){return Buffer.isBuffer(value)?value:Buffer.from(value);}
function streamObject(data,dictionary=''){const body=asBuffer(data);return Buffer.concat([Buffer.from(`<< ${dictionary}${dictionary?' ':''}/Length ${body.length} >>\nstream\n`),body,Buffer.from('\nendstream')]);}
function pdf(objects){
 const parts=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','binary')],offsets=[0];
 let length=parts[0].length;
 for(let i=0;i<objects.length;i++){
  offsets.push(length);
  const object=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),asBuffer(objects[i]),Buffer.from('\nendobj\n')]);
  parts.push(object);length+=object.length;
 }
 const xref=length;
 let trailer=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
 for(const offset of offsets.slice(1))trailer+=`${String(offset).padStart(10,'0')} 00000 n \n`;
 parts.push(Buffer.from(`${trailer}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
 return Buffer.concat(parts);
}

const textStream='BT /F1 18 Tf 72 720 Td (Fictional Candidate) Tj 0 -26 Td /F1 12 Tf (demo@example.com) Tj 0 -20 Td (JavaScript and Python) Tj ET';
const resumePdf=pdf([
 '<< /Type /Catalog /Pages 2 0 R >>',
 '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
 '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
 streamObject(textStream)
]);

const canvas=createCanvas(900,1200),context=canvas.getContext('2d');
context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
context.fillStyle='#10233f';context.font='bold 52px sans-serif';context.fillText('Fictional Candidate',70,120);
context.font='30px sans-serif';context.fillText('demo@example.com',70,185);
context.fillStyle='#246b61';context.font='bold 34px sans-serif';context.fillText('Skills',70,290);
context.fillStyle='#10233f';context.font='28px sans-serif';context.fillText('JavaScript, Python, SQL',70,345);
context.fillStyle='#246b61';context.font='bold 34px sans-serif';context.fillText('Education',70,455);
context.fillStyle='#10233f';context.font='28px sans-serif';context.fillText('Example University, 2024 - 2026',70,510);
context.fillStyle='#6b7280';context.font='24px sans-serif';context.fillText('Synthetic fixture for local import tests only.',70,1120);

const png=canvas.toBuffer('image/png');
const jpeg=canvas.toBuffer('image/jpeg',88);
const drawScan='q 540 0 0 720 36 36 cm /Im0 Do Q';
const imageObject=()=>streamObject(jpeg,`/Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`);
const scannedPdf=pdf([
 '<< /Type /Catalog /Pages 2 0 R >>',
 '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
 imageObject(),
 streamObject(drawScan)
]);
const mixedPdf=pdf([
 '<< /Type /Catalog /Pages 2 0 R >>',
 '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 7 0 R >> >> /Contents 8 0 R >>',
 '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
 streamObject(textStream),
 imageObject(),
 streamObject(drawScan)
]);

await mkdir(target,{recursive:true});
await Promise.all([
 writeFile(path.join(target,'fictional-resume.pdf'),resumePdf),
 writeFile(path.join(target,'fictional-resume.png'),png),
 writeFile(path.join(target,'fictional-resume-scanned.pdf'),scannedPdf),
 writeFile(path.join(target,'fictional-resume-mixed.pdf'),mixedPdf)
]);
console.log('Generated text, image-only scan, and mixed fictional resume fixtures');
