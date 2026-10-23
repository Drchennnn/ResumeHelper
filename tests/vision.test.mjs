import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {parseResumeImages,requestJSON} from '../extension/lib/ai.js';

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
