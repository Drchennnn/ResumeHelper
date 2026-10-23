import {prepareResumeFiles} from '../extension/lib/documents.js';

const result=document.getElementById('result');
try{
 const load=async name=>new File([await (await fetch(name)).blob()],name,{type:name.endsWith('.pdf')?'application/pdf':'image/png'});
 const pdf=await prepareResumeFiles([await load('fictional-resume.pdf')]);
 const rendered=await pdf.renderImages();
 const scanned=await prepareResumeFiles([await load('fictional-resume-scanned.pdf')]);
 const mixed=await prepareResumeFiles([await load('fictional-resume-mixed.pdf')]);
 const mixedRendered=await mixed.renderImages();
 const image=await prepareResumeFiles([await load('fictional-resume.png')]);
 result.dataset.status='passed';
 result.textContent=JSON.stringify({
  ok:true,
  pdf:{pageCount:pdf.pageCount,text:pdf.text,needsVision:pdf.needsVision,rendered:rendered.length,renderType:rendered[0]?.slice(0,23)},
  scanned:{pageCount:scanned.pageCount,text:scanned.text,needsVision:scanned.needsVision,images:scanned.images.length,renderType:scanned.images[0]?.slice(0,23)},
  mixed:{pageCount:mixed.pageCount,text:mixed.text,needsVision:mixed.needsVision,scanImages:mixed.images.length,rendered:mixedRendered.length,renderType:mixed.images[0]?.slice(0,23)},
  image:{count:image.images.length,pageCount:image.pageCount,renderType:image.images[0]?.slice(0,23)}
 },null,2);
}catch(error){result.dataset.status='failed';result.textContent=JSON.stringify({ok:false,error:error.message,stack:error.stack},null,2);}

// This button sends fictional fixtures only to our explicit localhost mock route.
import {parseResumeText,parseResumeImages} from '../extension/lib/ai.js';
const mockButton=document.getElementById('mock-run'),mockResult=document.getElementById('mock-result');
mockButton.disabled=result.dataset.status!=='passed';
mockButton.onclick=async()=>{
 mockButton.disabled=true;
 try{
  if(!['localhost','127.0.0.1'].includes(location.hostname))throw new Error('仅限本机测试');
  const settings={baseUrl:location.origin+'/__test__/v1',model:'fictional-vision-mock',apiKey:''};
  const load=async name=>new File([await(await fetch(name)).blob()],name);
  const baseline=await(await fetch('/__test__/requests')).json();
  const textPdf=await prepareResumeFiles([await load('fictional-resume.pdf')]);
  const image=await prepareResumeFiles([await load('fictional-resume.png')]);
  const mixedPdf=await prepareResumeFiles([await load('fictional-resume-mixed.pdf')]);
  const before=await(await fetch('/__test__/requests')).json();
  const textResume=await parseResumeText(textPdf.text,settings);
  const imageResume=await parseResumeImages(image.images,settings,image.text);
  const mixedResume=await parseResumeImages(mixedPdf.images,settings,mixedPdf.text);
  const after=await(await fetch('/__test__/requests')).json();
  const summary={ok:true,prepareSentNoRequests:baseline.length===before.length,textName:textResume.personal.name,imageName:imageResume.personal.name,mixedName:mixedResume.personal.name,requests:after.slice(before.length)};
  mockResult.textContent=JSON.stringify(summary,null,2);mockResult.dataset.status='passed';
 }catch(error){mockResult.textContent=error.message;mockResult.dataset.status='failed';}
 finally{mockButton.disabled=false;}
};
