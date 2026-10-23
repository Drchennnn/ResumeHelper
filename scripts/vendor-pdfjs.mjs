import {cp,copyFile,mkdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'node_modules','pdfjs-dist');
const target=path.join(root,'extension','vendor','pdfjs');
const pkg=JSON.parse(await readFile(path.join(source,'package.json'),'utf8'));

if(pkg.version!=='6.4.299')throw new Error(`Expected pdfjs-dist 6.4.299, found ${pkg.version}`);

await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
await mkdir(path.join(target,'wasm'),{recursive:true});
await Promise.all([
 copyFile(path.join(source,'build','pdf.min.mjs'),path.join(target,'pdf.min.mjs')),
 copyFile(path.join(source,'build','pdf.worker.min.mjs'),path.join(target,'pdf.worker.min.mjs')),
 copyFile(path.join(source,'LICENSE'),path.join(target,'LICENSE')),
 cp(path.join(source,'cmaps'),path.join(target,'cmaps'),{recursive:true}),
 cp(path.join(source,'standard_fonts'),path.join(target,'standard_fonts'),{recursive:true}),
 copyFile(path.join(source,'wasm','openjpeg_nowasm_fallback.js'),path.join(target,'wasm','openjpeg_nowasm_fallback.js')),
 copyFile(path.join(source,'wasm','jbig2_nowasm_fallback.js'),path.join(target,'wasm','jbig2_nowasm_fallback.js')),
 ...['LICENSE_OPENJPEG','LICENSE_PDFJS_OPENJPEG','LICENSE_JBIG2','LICENSE_PDFJS_JBIG2'].map(name=>copyFile(path.join(source,'wasm',name),path.join(target,'wasm',name)))
]);

console.log(`Vendored pdfjs-dist ${pkg.version} into extension/vendor/pdfjs`);
