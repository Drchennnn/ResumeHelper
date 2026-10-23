import {test} from 'node:test';import assert from 'node:assert/strict';
import {SECTIONS,normalizeResume,flattenResume,completionStats,resolvePlan,localPlan} from '../extension/lib/model.js';
import {endpoint,parseJSON,requestJSON,matchFields,parseResumeText} from '../extension/lib/ai.js';
import http from 'node:http';
test('normalize imports only defined fields, preserves repeated sections and strips executable properties',()=>{const r=normalizeResume({personal:{name:'林测试',evil:'bad'},education:[{school:'示例大学',major:'计算机'}],projects:[{name:'演示项目'}],__proto__:{admin:true}});assert.equal(r.personal.name,'林测试');assert.equal(r.personal.evil,undefined);assert.equal(flattenResume(r).find(f=>f.path==='education.0.school').value,'示例大学');assert.equal(r.admin,undefined);});
test('AI mappings cannot inject arbitrary values, unknown paths or selectors',()=>{const r=normalizeResume({personal:{name:'林测试'},extras:'未分类原文'});const fields=[{id:'a',label:'姓名'},{id:'raw',label:'其他信息'},{id:'notes',label:'补充说明'}];assert.deepEqual(resolvePlan({mappings:[{fieldId:'a',sourcePath:'personal.name',value:'攻击值',selector:'body'},{fieldId:'x',sourcePath:'personal.name'},{fieldId:'raw',sourcePath:'extras'},{fieldId:'notes',sourcePath:'extras'}]},fields,r).map(x=>[x.fieldId,x.value]),[['a','林测试'],['notes','未分类原文']]);});
test('AI mappings must honor known field metadata, repeated rows and option semantics',()=>{
 const r=normalizeResume({personal:{name:'林测试',phone:'13800000000'},education:[{school:'本科大学',degree:'本科'},{school:'硕士大学',degree:'硕士'}]});
 const fields=[
  {id:'phone',label:'手机号',section:'个人信息',fieldKey:'phone',type:'text'},
  {id:'school-1',label:'学校',section:'教育经历',fieldKey:'school',groupIndex:1,type:'text'},
  {id:'degree-0',label:'学历',section:'education',fieldKey:'degree',groupIndex:0,type:'select-one',options:[{value:'bachelor',label:'本科'},{value:'master',label:'硕士研究生'}]},
  {id:'generic',label:'自定义语义字段',type:'text'}
 ];
 const raw={mappings:[
  {fieldId:'phone',sourcePath:'personal.name'},
  {fieldId:'school-1',sourcePath:'education.0.school'},
  {fieldId:'degree-0',sourcePath:'education.0.degree',optionValue:'master'},
  {fieldId:'generic',sourcePath:'personal.name'}
 ]};
 assert.deepEqual(resolvePlan(raw,fields,r).map(item=>[item.fieldId,item.sourcePath]),[['generic','personal.name']]);
 assert.deepEqual(resolvePlan({mappings:[
  {fieldId:'phone',sourcePath:'personal.phone'},
  {fieldId:'school-1',sourcePath:'education.1.school'},
  {fieldId:'degree-0',sourcePath:'education.0.degree',optionValue:'bachelor'}
 ]},fields,r).map(item=>[item.fieldId,item.sourcePath,item.value]),[
  ['phone','personal.phone','13800000000'],
  ['school-1','education.1.school','硕士大学'],
  ['degree-0','education.0.degree','bachelor']
 ]);
});
test('project scanner metadata aliases project_name to the canonical project name',()=>{
 const r=normalizeResume({projects:[{name:'通用表单助手'}]});
 const fields=[
  {id:'qualified',label:'项目名称',section:'项目经历',fieldKey:'projects.project_name',groupIndex:0,type:'text'},
  {id:'sectioned',label:'项目名称',section:'projects',fieldKey:'project_name',groupIndex:0,type:'text'}
 ];
 assert.deepEqual(localPlan(fields,r).map(item=>[item.fieldId,item.sourcePath]),[
  ['qualified','projects.0.name'],['sectioned','projects.0.name']
 ]);
});
test('only explicit intention locations map to preferred city inside a broad personal section',()=>{
 const r=normalizeResume({job_intention:{preferred_city:'深圳'}});
 const fields=[
  {id:'explicit',label:'期望工作地点',section:'基本信息',type:'combobox'},
  {id:'ambiguous',label:'工作地点',section:'基本信息',type:'combobox'},
  {id:'residence',label:'现居城市',section:'基本信息',type:'combobox'}
 ];
 assert.deepEqual(localPlan(fields,r).map(item=>item.fieldId),['explicit']);
 assert.deepEqual(resolvePlan({mappings:fields.map(field=>({fieldId:field.id,sourcePath:'job_intention.preferred_city'}))},fields,r).map(item=>item.fieldId),['explicit']);
});
test('ambiguous repeated names stay unmatched locally; select choices require exact match',()=>{const r=normalizeResume({personal:{name:'林测试'},education:[{school:'A'},{school:'B'}]});assert.equal(localPlan([{id:'s',label:'学校'}],r).length,0);assert.equal(localPlan([{id:'s',label:'姓名 *'}],r)[0].value,'林测试');assert.equal(resolvePlan({mappings:[{fieldId:'s',sourcePath:'personal.name',optionValue:'unknown'}]},[{id:'s',label:'姓名',options:[{value:'a',label:'A'}]}],r).length,0);});
test('group metadata maps repeated education rows deterministically and preserves date aliases',()=>{
 const r=normalizeResume({education:[
  {school:'本科大学',degree:'本科',start_date:'2020-09'},
  {school:'硕士大学',degree:'硕士',start_date:'2024-09'}
 ]});
 const fields=[
  {id:'school-0',label:'学校名称',section:'教育经历',groupIndex:0,fieldKey:'school',type:'text'},
  {id:'school-1',label:'院校名称',section:'education',groupIndex:1,fieldKey:'school',type:'text'},
  {id:'degree-1',label:'学历层次',section:'教育背景 2',groupIndex:1,fieldKey:'degree',type:'select-one',options:[{value:'master',label:'硕士研究生'},{value:'bachelor',label:'本科'}]},
  {id:'start-1',label:'开始日期',section:'教育经历',groupIndex:1,fieldKey:'start_date',type:'date-picker'}
 ];
 assert.deepEqual(Object.fromEntries(localPlan(fields,r).map(item=>[item.fieldId,[item.sourcePath,item.value]])),{
  'school-0':['education.0.school','本科大学'],
  'school-1':['education.1.school','硕士大学'],
  'degree-1':['education.1.degree','master'],
  'start-1':['education.1.start_date','2024-09']
 });
 assert.equal(localPlan([{id:'bad',label:'学校',section:'education',groupIndex:7,fieldKey:'school'}],r).length,0);
});
test('local aliases cover common recruiting labels without weakening repeated-row safety',()=>{
 const r=normalizeResume({job_intention:{preferred_city:'深圳'},education:[{school:'示例大学',department:'计算机学院',advisor_name:'陈老师',research_focus:'智能系统'}]});
 const fields=[
  {id:'school',label:'学校名称'},{id:'department',label:'学院'},{id:'advisor',label:'导师'},
  {id:'focus',label:'领域方向'},{id:'city',label:'期望工作地点'}
 ];
 assert.deepEqual(Object.fromEntries(localPlan(fields,r).map(item=>[item.fieldId,item.sourcePath])),{
  school:'education.0.school',department:'education.0.department',advisor:'education.0.advisor_name',
  focus:'education.0.research_focus',city:'job_intention.preferred_city'
 });
});
test('prompt-like labels and placeholders match aliases while record identity overrides page order',()=>{
 const r=normalizeResume({education:[
  {school:'本科大学',department:'本科书院',major:'电子工程'},
  {school:'硕士大学',department:'计算机学院',major:'人工智能'}
 ]});
 const fields=[
  {id:'department',label:'请填写学院名称',section:'教育经历',fieldKey:'department',groupIndex:0,groupCount:2,recordLabel:'硕士大学'},
  {id:'major',label:'',placeholder:'请输入专业名称',section:'教育经历',fieldKey:'major',groupIndex:0,groupCount:2,recordLabel:'硕士大学'}
 ];
 assert.deepEqual(localPlan(fields,r).map(item=>[item.fieldId,item.sourcePath,item.value]),[
  ['department','education.1.department','计算机学院'],['major','education.1.major','人工智能']
 ]);
});
test('unknown or ambiguous record labels cannot be mapped by array order or an AI sourcePath',()=>{
 const r=normalizeResume({education:[{school:'甲大学',major:'甲专业'},{school:'乙大学',major:'乙专业'}]});
 const field={id:'major',label:'专业名称',section:'education',fieldKey:'major',groupIndex:0,recordLabel:'页面未说明学校'};
 assert.equal(localPlan([field],r).length,0);
 assert.equal(resolvePlan({mappings:[{fieldId:'major',sourcePath:'education.0.major'}]},[field],r).length,0);
 const duplicate={...field,recordLabel:'大学'};
 assert.equal(resolvePlan({mappings:[{fieldId:'major',sourcePath:'education.0.major'}]},[duplicate],r).length,0);
});
test('existing page record identities reserve their source rows before blank records are assigned',()=>{
 const r=normalizeResume({education:[
  {school:'香港城市大学',department:'计算机科学系',major:'人工智能'},
  {school:'北京邮电大学',department:'信息工程学院',major:'通信工程'}
 ]});
 const fields=[
  {id:'existing-school',label:'学校名称',section:'教育经历',fieldKey:'school',groupIndex:0,groupCount:2,recordLabel:'北京邮电大学'},
  {id:'blank-department',label:'请填写学院名称',section:'教育经历',fieldKey:'department',groupIndex:1,groupCount:2,recordLabel:'教育经历 2'},
  {id:'blank-major',label:'请输入专业名称',section:'教育经历',fieldKey:'major',groupIndex:1,groupCount:2,recordLabel:'教育经历 2'}
 ];
 const plan=Object.fromEntries(localPlan(fields,r).map(item=>[item.fieldId,item.sourcePath]));
 assert.equal(plan['existing-school'],'education.1.school');
 assert.equal(plan['blank-department'],'education.0.department');
 assert.equal(plan['blank-major'],'education.0.major');
 assert.equal(resolvePlan({mappings:[{fieldId:'blank-major',sourcePath:'education.1.major'}]},fields,r).length,0);
 assert.equal(resolvePlan({mappings:[{fieldId:'blank-major',sourcePath:'education.0.major'}]},fields,r)[0].value,'人工智能');
});
test('education derives safe range and unique highest-degree facts while preserving explicit major category',()=>{
 const r=normalizeResume({education:[
  {school:'香港城市大学',degree:'硕士研究生',major:'人工智能',major_category:'本科（普通教育） / 工学 / 计算机类',start_date:'2026-09',end_date:'2027-10'},
  {school:'北京邮电大学',degree:'本科',major:'通信工程',major_category:'电子信息类',start_date:'2022-09',end_date:'2026-06'}
 ]});
 const fields=[
  {id:'category',label:'专业类别',section:'教育经历',fieldKey:'major_category',groupIndex:0,recordLabel:'香港城市大学',type:'combobox',options:[{value:'理学 / 数学相关类',label:'理学 / 数学相关类'},{value:'工学 / 计算机相关类',label:'工学 / 计算机相关类'}]},
  {id:'range',label:'起止时间',section:'教育经历',fieldKey:'date_range',groupIndex:0,recordLabel:'香港城市大学'},
  {id:'highest-master',label:'是否最高学历',section:'教育经历',fieldKey:'is_highest_degree',groupIndex:0,recordLabel:'香港城市大学',type:'radio',options:[{value:'true',label:'是'},{value:'false',label:'否'}]},
  {id:'highest-bachelor',label:'是否最高学历',section:'教育经历',fieldKey:'highest_degree',groupIndex:1,recordLabel:'北京邮电大学',type:'radio',options:[{value:'1',label:'是'},{value:'0',label:'否'}]}
 ];
 const plan=Object.fromEntries(localPlan(fields,r).map(item=>[item.fieldId,[item.sourcePath,item.value]]));
 assert.deepEqual(plan.category,['education.0.major_category','工学 / 计算机相关类']);
 assert.deepEqual(plan.range,['education.0.date_range','2026-09 - 2027-10']);
 assert.deepEqual(plan['highest-master'],['education.0.is_highest_degree','true']);
 assert.deepEqual(plan['highest-bachelor'],['education.1.is_highest_degree','0']);
 assert.equal(normalizeResume({personal:{graduate_status:'是'}}).personal.graduate_status,true);
 assert.equal(normalizeResume({personal:{graduate_status:'否'}}).personal.graduate_status,false);
});
test('major category options allow only verified hierarchy normalization, not guessed disciplines',()=>{
 const field={id:'category',label:'专业类别',section:'教育经历',fieldKey:'major_category',groupIndex:0,type:'combobox',options:[
  {value:'理学 / 数学相关类',label:'理学 / 数学相关类'},{value:'工学 / 计算机相关类',label:'工学 / 计算机相关类'}
 ]};
 const verified=normalizeResume({education:[{school:'示例大学',major_category:'本科（普通教育） / 理学 / 数学类'}]});
 assert.deepEqual(localPlan([field],verified).map(item=>item.value),['理学 / 数学相关类']);
 const professionalMaster=normalizeResume({education:[{school:'示例大学',major_category:'专业学位硕士 / 理学 / 数学类'}]});
 assert.deepEqual(localPlan([field],professionalMaster).map(item=>item.value),['理学 / 数学相关类']);
 const incomplete=normalizeResume({education:[{school:'示例大学',major_category:'数学类'}]});
 assert.equal(localPlan([field],incomplete).length,0);
 const ambiguousElectronic=normalizeResume({education:[{school:'示例大学',major_category:'专业学位硕士 / 工学 / 电子信息类'}]});
 assert.equal(localPlan([field],ambiguousElectronic).length,0);
 const unknownPrefix=normalizeResume({education:[{school:'示例大学',major_category:'未知层级 / 理学 / 数学类'}]});
 assert.equal(localPlan([field],unknownPrefix).length,0);
 const invalidOptions={...field,options:[{value:'数学相关类',label:'数学相关类'},{value:'未知类别',label:'未知类别'}]};
 assert.equal(localPlan([invalidOptions],incomplete).length,0);
 assert.equal(localPlan([invalidOptions],unknownPrefix).length,0);
});
test('project facts never cross into campus fields and campus fields require real campus facts',()=>{
 const r=normalizeResume({projects:[{name:'多智能体简历助手',description:'实现表单智能填写'}],cadre_experiences:[{organization:'团委宣传部',position:'干事',work_content:'负责宣传'}]});
 const campusField={id:'campus',label:'校园经历描述',section:'校园经历',fieldKey:'work_content',groupIndex:0,recordLabel:'团委宣传部'};
 assert.deepEqual(localPlan([campusField],r).map(item=>[item.sourcePath,item.value]),[['cadre_experiences.0.work_content','负责宣传']]);
 assert.equal(resolvePlan({mappings:[{fieldId:'campus',sourcePath:'projects.0.description'}]},[campusField],r).length,0);
 const noCampus=normalizeResume({projects:[{name:'多智能体简历助手',description:'实现表单智能填写'}]});
 assert.equal(localPlan([campusField],noCampus).length,0);
});
test('an explicit month range safely restores missing endpoints without inventing campus dates',()=>{
 const r=normalizeResume({
  projects:[{name:'项目甲',date_range:'2026-09 - 至今'},{name:'项目乙',date_range:'2025-10 至 2026-06'}],
  cadre_experiences:[{organization:'团委宣传部',position:'部员',work_content:'参与学院公众号运营、活动报道与文案撰写'}]
 });
 assert.deepEqual([r.projects[0].start_date,r.projects[0].end_date],['2026-09','至今']);
 assert.deepEqual([r.projects[1].start_date,r.projects[1].end_date],['2025-10','2026-06']);
 assert.equal(r.cadre_experiences[0].start_date,'');
 assert.equal(r.cadre_experiences[0].end_date,'');
 const facts=flattenResume(r);
 assert.equal(facts.find(item=>item.path==='projects.0.end_date').value,'至今');
});
test('a unique singleton label can match without metadata while unrelated cross-section metadata is rejected',()=>{
 const r=normalizeResume({job_intention:{preferred_city:'深圳'},education:[{school:'示例大学'}],work_experience:[{company:'示例公司'}]});
 const singleton=localPlan([{id:'city',label:'期望工作地点',type:'combobox'}],r);
 assert.deepEqual(singleton.map(item=>[item.sourcePath,item.value]),[['job_intention.preferred_city','深圳']]);
 assert.deepEqual(localPlan([{id:'city',label:'期望工作地点',section:'基本信息',type:'combobox'}],r).map(item=>item.sourcePath),['job_intention.preferred_city']);
 assert.equal(localPlan([{id:'company',label:'公司',section:'教育经历',groupIndex:0,type:'text'}],r).length,0);
});
test('native selects stay strict while an unloaded custom combobox can use the existing fact value',()=>{
 const r=normalizeResume({education:[{degree:'硕士'}],job_intention:{preferred_city:'深圳'}});
 assert.equal(localPlan([{id:'native',label:'学历',type:'select-one',section:'education',groupIndex:0,fieldKey:'degree'}],r).length,0);
 assert.deepEqual(localPlan([{id:'custom',label:'期望工作地点',type:'combobox',fieldKey:'job_intention.preferred_city'}],r).map(item=>item.value),['深圳']);
 assert.equal(resolvePlan({mappings:[{fieldId:'native',sourcePath:'education.0.degree'}]},[{id:'native',label:'学历',type:'select-one'}],r).length,0);
 const ambiguous=normalizeResume({education:[{degree:'研究生'}]});
 assert.equal(localPlan([{id:'degree',label:'学历',type:'select-one',section:'education',groupIndex:0,fieldKey:'degree',options:[{value:'master',label:'硕士研究生'},{value:'doctor',label:'博士研究生'}]}],ambiguous).length,0);
});
test('local matching uses section-specific labels for common keys',()=>{const r=normalizeResume({personal:{name:'林测试',graduate_school:'本科院校'},projects:[{name:'项目甲'}],awards:[{name:'奖项乙'}],education:[{school:'硕士院校'}]});const plan=localPlan([{id:'person',label:'姓名'},{id:'project',label:'项目名称'},{id:'school',label:'学校'},{id:'graduate',label:'毕业院校'}],r);assert.deepEqual(Object.fromEntries(plan.map(item=>[item.fieldId,item.sourcePath])),{person:'personal.name',project:'projects.0.name',school:'education.0.school',graduate:'personal.graduate_school'});});
test('schema covers the full site navigation and keeps known select options',()=>{assert.deepEqual(SECTIONS.map(section=>section.key),['personal','job_intention','education','internships','projects','cadre_experiences','work_experience','social_practices','skills','certificate','language_skills','family_relations','awards','patents','publications','training']);assert.equal(SECTIONS.find(section=>section.key==='personal').fields.length,61);const companySize=SECTIONS.find(section=>section.key==='internships').fields.find(field=>field.key==='company_size');assert.equal(companySize.type,'select');assert.ok(companySize.options.some(option=>option.value==='10000 人以上'));});
test('site dropdown metadata supplies real choices while custom degree category stays editable',()=>{const field=(section,key)=>SECTIONS.find(item=>item.key===section).fields.find(item=>item.key===key);assert.deepEqual(field('personal','gender').options.map(item=>item.label),['男','女']);assert.ok(field('personal','political_status').options.some(item=>item.value==='中共预备党员'));assert.deepEqual(field('education','degree').options.slice(0,3).map(item=>item.value),['博士研究生','硕士研究生','本科']);assert.deepEqual(field('personal','graduate_status').options,[{value:'true',label:'是'},{value:'false',label:'否'}]);assert.equal(field('education','academic_degree_category').type,'text');for(const section of SECTIONS)for(const item of section.fields)assert.ok(!(item.options||[]).some(option=>option.label==='未填写'));});
test('0.1 keys migrate to canonical site paths without losing booleans or issuer text',()=>{const r=normalizeResume({resumeName:'旧简历',personal:{city:'香港',website:'https://example.test',summary:'介绍',graduate_status:false},intent:{role:'算法工程师',city:'深圳'},experience:[{company:'示例公司',role:'工程师',details:'开发'}],certificates:[{name:'示例证书',issuer:'示例机构',date:'2024-01'}],languages:[{name:'英语',level:'熟练'}],social_practice:[{organization:'志愿队'}]});assert.equal(r.name,'旧简历');assert.equal(r.personal.address,'香港');assert.equal(r.personal.graduate_status,false);assert.equal(normalizeResume({personal:{graduate_status:'false'}}).personal.graduate_status,false);assert.equal(r.job_intention.target_position,'算法工程师');assert.equal(r.work_experience[0].position,'工程师');assert.equal(r.certificate[0].certificate_name,'示例证书');assert.match(r.extras,/证书颁发机构：示例机构/);assert.equal(r.language_skills[0].proficiency_level,'熟练');assert.equal(r.social_practices[0].organization,'志愿队');assert.equal(flattenResume(r).find(f=>f.path==='personal.graduate_status').value,'否');});
test('completion stats count singleton fields and instantiated collection rows',()=>{const r=normalizeResume({personal:{name:'林测试',graduate_status:false},education:[{school:'示例大学',degree:'硕士'}]});const stats=completionStats(r);assert.equal(stats.bySection.personal.total,61);assert.equal(stats.bySection.personal.filled,2);assert.equal(stats.bySection.education.total,40);assert.equal(stats.bySection.education.filled,2);assert.equal(stats.bySection.internships.total,0);assert.equal(stats.filled,4);assert.equal(stats.total,118);assert.equal(stats.missing,114);assert.equal(stats.percent,3);});
test('endpoint rejects insecure remote hosts and credentials; supports full endpoint',()=>{assert.equal(endpoint({baseUrl:'https://example.com/v1/'}),'https://example.com/v1/chat/completions');assert.equal(endpoint({baseUrl:'http://localhost:9999/v1/chat/completions'}),'http://localhost:9999/v1/chat/completions');for(const baseUrl of ['http://evil.example/v1','https://key:secret@example.com','https://example.com?key=secret','file:///etc/passwd'])assert.throws(()=>endpoint({baseUrl}));assert.deepEqual(parseJSON('```json\n{"ok":true}\n```'),{ok:true});assert.throws(()=>parseJSON('not JSON'));});
test('custom API request, matching, resume parsing and error handling against real local HTTP server',async()=>{let last;let mode='match';const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;last={path:req.url,headers:req.headers,body:JSON.parse(body)};if(mode==='error'){res.writeHead(401).end('secret-token-should-not-echo');return;}const content=mode==='parse'?{personal:{name:'林测试'},education:[{school:'示例大学'}]}:{mappings:[{fieldId:'a',sourcePath:'personal.name'}]};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const settings={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'test-model',apiKey:'test-key'};const items=await matchFields([{id:'a',label:'姓名',placeholder:'请输入姓名',helpText:'与证件一致',context:'基本信息 > 申请人',recordLabel:'基本资料',value:'existing-private',section:'personal',groupIndex:0,groupCount:1,fieldKey:'name',type:'text'}],normalizeResume({personal:{name:'林测试'}}),settings);assert.equal(items[0].value,'林测试');assert.equal(last.path,'/v1/chat/completions');assert.equal(last.headers.authorization,'Bearer test-key');assert.equal(last.body.model,'test-model');const matchPayload=JSON.parse(last.body.messages[1].content);assert.deepEqual(matchPayload.fields[0],{id:'a',label:'姓名',placeholder:'请输入姓名',helpText:'与证件一致',context:'基本信息 > 申请人',recordLabel:'基本资料',type:'text',section:'personal',groupIndex:0,groupCount:1,fieldKey:'name'});assert.ok(!last.body.messages[1].content.includes('existing-private'));mode='parse';const resume=await parseResumeText('姓名：林测试',settings);assert.equal(resume.education[0].school,'示例大学');mode='error';await assert.rejects(requestJSON(settings,'test',{}),e=>e.message==='API 请求失败（HTTP 401）');}finally{await new Promise(r=>server.close(r));}});
test('new local workbench creates stable persistent identity and preserves settings while saving resumes',async()=>{const data=new Map();globalThis.localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};const {loadState,saveResumes,saveSettings}=await import('../extension/lib/storage.js');const first=await loadState();assert.equal((await loadState()).activeId,first.activeId);await saveSettings({baseUrl:'http://localhost:8888/v1',model:'mock',apiKey:'test'});first.resumes[0].personal.name='测试';await saveResumes(first.resumes,first.activeId);assert.equal((await loadState()).settings.model,'mock');assert.equal((await loadState()).resumes[0].personal.name,'测试');delete globalThis.localStorage;});
test('concurrent profile and API setting saves never overwrite the other domain',async()=>{const data=new Map();globalThis.localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};const {loadState,saveResumes,saveSettings}=await import('../extension/lib/storage.js');const first=await loadState();first.resumes[0].personal.name='并发保存';await Promise.all([saveResumes(first.resumes,first.activeId),saveSettings({baseUrl:'https://example.com/v1',model:'concurrent-model',apiKey:'test'})]);const s=await loadState();assert.equal(s.resumes[0].personal.name,'并发保存');assert.equal(s.settings.model,'concurrent-model');delete globalThis.localStorage;});

test('unknown populated records stay protected while a fresh blank record receives unused campus facts',()=>{
 const resume=normalizeResume({cadre_experiences:[{organization:'示例学生组织',position:'部员',work_content:'活动报道'}]});
 const fields=[
  {id:'old',label:'组织名称',section:'校园经历',fieldKey:'organization',groupIndex:0,groupCount:2,recordLabel:'未识别的已有记录'},
  {id:'fresh',label:'组织名称',section:'校园经历',fieldKey:'organization',groupIndex:1,groupCount:2}
 ];
 const plan=localPlan(fields,resume);
 assert.deepEqual(plan.map(item=>[item.fieldId,item.sourcePath]),[['fresh','cadre_experiences.0.organization']]);
 assert.equal(resolvePlan({mappings:[{fieldId:'old',sourcePath:'cadre_experiences.0.organization'}]},fields,resume).length,0);
});
