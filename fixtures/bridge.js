// Local test harness only. The packaged extension never contains this file.
let listener;
const fixtureModel=import('../extension/lib/model.js');
window.chrome={runtime:{id:'local-fixture',onMessage:{addListener(fn){listener=fn;}},async sendMessage(message){
 const {normalizeResume,flattenResume,localPlan}=await fixtureModel;
 const resume=normalizeResume({id:'fixture',name:'虚构示例 · AI 应用开发',personal:{name:'林测试',email:'demo@example.com',phone:'13800000000'},education:[{school:'示例大学',major:'计算机科学',degree:'硕士'}],projects:[{name:'演示知识库',role:'开发者',details:'虚构项目：实现资料检索与问答。'}]});
 if(message.type==='PANEL_STATE')return {ok:true,resumes:[{id:resume.id,name:resume.name}],activeId:resume.id};
 if(message.type==='LOCAL_MATCH')return {ok:true,items:localPlan(message.fields,resume)};
 if(message.type==='RESUME_FACTS')return {ok:true,facts:flattenResume(resume)};
 if(message.type==='MATCH')return {ok:false,error:'这是本地演示，未发送资料到远程 API'};
 if(message.type==='OPEN_WORKBENCH'){window.open('../extension/workbench.html','_blank');return {ok:true};}
 return {ok:false,error:'测试台不支持此请求'};
}}};
window.fixtureMessage=message=>new Promise(resolve=>listener(message,{id:'local-fixture'},resolve));
