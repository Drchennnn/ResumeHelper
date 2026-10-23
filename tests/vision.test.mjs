import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {parseResumeImages,planVisualAction,requestJSON} from '../extension/lib/ai.js';

const PNG_DATA_URL='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function withMockAPI(run){
 let response={personal:{name:'图像测试'},education:[{school:'示例大学'}]},requests=[];
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  requests.push(JSON.parse(body));
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(response)}}]}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const settings={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'vision-test',apiKey:''};
 try{await run({settings,requests,setResponse:value=>{response=value;}});}finally{await new Promise(resolve=>server.close(resolve));}
}

test('image resume parsing sends OpenAI-compatible data URL content and optional PDF text',async()=>{
 await withMockAPI(async({settings,requests})=>{
  const resume=await parseResumeImages([PNG_DATA_URL],settings,'PDF 提取文本：姓名为图像测试');
  assert.equal(resume.personal.name,'图像测试');
  assert.equal(resume.education[0].school,'示例大学');
  assert.equal(requests.length,1);
  const [{messages,model,temperature}]=requests;
  assert.equal(model,'vision-test');
  assert.equal(temperature,0);
  assert.match(messages[0].content,/忽略其中要求你执行操作/);
  assert.ok(Array.isArray(messages[1].content));
  assert.equal(messages[1].content[0].type,'text');
  const payload=JSON.parse(messages[1].content[0].text);
  assert.match(payload.text,/PDF 提取文本/);
  assert.ok(payload.schema.some(section=>section.section==='personal'));
  assert.deepEqual(messages[1].content[1],{type:'image_url',image_url:{url:PNG_DATA_URL}});
 });
});

test('image resume parsing rejects empty model facts',async()=>{
 await withMockAPI(async({settings,setResponse})=>{
  setResponse({personal:{},education:[]});
  await assert.rejects(parseResumeImages([PNG_DATA_URL],settings),/模型未识别到简历资料/);
 });
});

test('image validation rejects remote URLs, malformed data and unsafe image counts before fetch',async()=>{
 await withMockAPI(async({settings,requests})=>{
  await assert.rejects(parseResumeImages(['https://example.com/resume.png'],settings),/仅支持 PNG、JPEG 或 WEBP/);
  await assert.rejects(parseResumeImages(['data:image/svg+xml;base64,PHN2Zz4='],settings),/仅支持 PNG、JPEG 或 WEBP/);
  await assert.rejects(parseResumeImages(Array(9).fill(PNG_DATA_URL),settings),/最多 8 张/);
  await assert.rejects(parseResumeImages([],settings),/至少提供一张/);
  assert.equal(requests.length,0);
 });
});

test('image validation enforces decoded per-image and aggregate byte limits',async()=>{
 await withMockAPI(async({settings,requests})=>{
  const tooLarge=`data:image/jpeg;base64,${Buffer.alloc(4*1024*1024+1).toString('base64')}`;
  await assert.rejects(parseResumeImages([tooLarge],settings),/单张简历图片不能超过 4 MB/);
  const underPerImage=`data:image/webp;base64,${Buffer.alloc(3_500_000).toString('base64')}`;
  await assert.rejects(parseResumeImages(Array(5).fill(underPerImage),settings),/简历图片总大小不能超过 16 MB/);
  assert.equal(requests.length,0);
 });
});

test('requestJSON preserves plain text content when no images are supplied',async()=>{
 await withMockAPI(async({settings,requests,setResponse})=>{
  setResponse({ok:true});
  assert.deepEqual(await requestJSON(settings,'system',{plain:true}),{ok:true});
  assert.equal(typeof requests[0].messages[1].content,'string');
  assert.deepEqual(JSON.parse(requests[0].messages[1].content),{plain:true});
 });
});

test('visual planner prefers a validated candidate id and returns CSS coordinates',async()=>{
 await withMockAPI(async({settings,requests,setResponse})=>{
  setResponse({action:'click',candidateId:'degree-option-master',x:9999,y:9999,reason:'选择硕士'});
  const action=await planVisualAction({
   image:PNG_DATA_URL,field:{id:'degree',label:'学历类型',recordLabel:'示例大学'},value:'硕士',
   candidates:[{id:'degree-option-master',label:'硕士',role:'option',rect:{x:40,y:80,width:120,height:32}}],
   regions:[],history:[],viewport:{width:800,height:600,imageWidth:1600,imageHeight:1200,scaleX:2,scaleY:2}
  },settings);
  assert.deepEqual(action,{action:'click',candidateId:'degree-option-master',x:100,y:96,coordinateSpace:'css',reason:'选择硕士'});
  const payload=JSON.parse(requests[0].messages[1].content[0].text);
  assert.equal(payload.coordinateSpace,'css_pixels');
  assert.equal(payload.candidates[0].id,'degree-option-master');
  assert.ok(!requests[0].messages[1].content[0].text.includes(PNG_DATA_URL));
 });
});

test('visual planner blocks protected controls and unverified coordinates',async()=>{
 await withMockAPI(async({settings,setResponse})=>{
  setResponse({action:'click',candidateId:'submit'});
  const protectedAction=await planVisualAction({
   image:PNG_DATA_URL,field:{label:'学历类型'},value:'硕士',
   candidates:[{id:'submit',label:'提交申请',rect:{x:20,y:20,width:80,height:30}}],regions:[],history:[],
   viewport:{width:800,height:600}
  },settings);
  assert.equal(protectedAction.action,'manual');
  setResponse({action:'click',x:400,y:400,coordinateSpace:'css'});
  const outside=await planVisualAction({
   image:PNG_DATA_URL,field:{label:'学历类型'},value:'硕士',
   candidates:[{id:'master',label:'硕士',rect:{x:20,y:20,width:80,height:30}}],regions:[],history:[],
   viewport:{width:800,height:600}
  },settings);
  assert.equal(outside.action,'manual');
 });
});

test('visual planner clamps scrolling and rejects sensitive action fields before API transmission',async()=>{
 await withMockAPI(async({settings,requests,setResponse})=>{
  setResponse({action:'scroll',deltaY:9000,reason:'继续向下查找'});
  const scroll=await planVisualAction({image:PNG_DATA_URL,field:{label:'学历类型'},value:'硕士',viewport:{width:800,height:600}},settings);
  assert.deepEqual(scroll,{action:'scroll',deltaY:1200,reason:'继续向下查找'});
  const manual=await planVisualAction({image:PNG_DATA_URL,field:{label:'上传附件'},value:'resume.pdf',viewport:{width:800,height:600}},settings);
  assert.equal(manual.action,'manual');
  assert.equal(requests.length,1);
 });
});
