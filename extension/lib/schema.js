import {INDUSTRY_OPTIONS} from './industry-options.js';
import {SITE_OPTIONS} from './site-options.js';

const yesNo=[{value:'true',label:'是'},{value:'false',label:'否'}];
const companySizes=['1-20 人','21-99 人','100-499 人','500-999 人','1000-9999 人','10000 人以上'];
const teamSizes=['1-5 人','6-10 人','11-20 人','21-50 人','51-100 人','100 人以上'];
const options=values=>values.map(value=>({value,label:String(value)}));
const f=(key,label,type='text',values)=>({key,label,type,...(values?{options:Array.isArray(values)&&values.length&&typeof values[0]==='object'?values:options(values)}:{})});
const group=(key,title,repeatable,fields)=>({key,title,...(repeatable?{repeatable:true}:{}),fields});

// Field names come from the extension's packaged default schema and the
// metadata-only cv.playoffer.cn/resumes snapshot. No packaged valueScript is
// retained or executed. The two empty-site modules at the end use conservative
// editable fields because neither artifact exposes their remote schema.
export const SECTIONS=[
 group('personal','个人信息',false,[
  f('name','姓名'),f('name_pinyin','姓名拼音'),f('english_name','英文姓名'),f('gender','性别'),
  f('phone','电话','tel'),f('email','邮箱','email'),f('birth_date','出生日期','date'),f('age','年龄','number'),
  f('nationality','国籍'),f('ethnicity','民族'),f('political_status','政治面貌'),f('marital_status','婚姻状况'),
  f('id_type','证件类型'),f('id_card','身份证号'),f('address','现居住地址'),f('native_place','籍贯'),
  f('origin_place','生源地'),f('household_type','户口性质'),f('household_address','户口所在地'),
  f('highest_degree','最高学历'),f('academic_degree','学位'),f('graduate_school','毕业院校'),
  f('graduation_major','毕业专业'),f('learning_mode','学习形式'),f('graduation_time','毕业时间','date'),
  f('graduate_status','是否应届生','select',yesNo),f('work_status','工作状态'),f('career_years','工作年限','number'),
  f('last_company','上一家公司'),f('wechat_id','微信号'),f('qq_id','QQ号'),
  f('personal_workspace_url','个人主页/作品链接','url'),f('english_level','英语等级'),
  f('gaokao_exam_date','高考时间','date'),f('gaokao_score','高考分数','number'),f('gaokao_subject','高考科目'),
  f('professional_rank','专业技术职级'),f('emergency_contact_name','紧急联系人姓名'),
  f('emergency_contact_relation','紧急联系人关系'),f('emergency_phone','紧急联系电话','tel'),
  f('postal_code','邮政编码'),f('health_status','健康状况'),
  f('has_long_term_disease','是否有长期病史','select',yesNo),f('has_criminal_record','是否有犯罪记录','select',yesNo),
  f('has_military_service','是否服兵役','select',yesNo),f('is_veteran','是否退伍军人','select',yesNo),
  f('blood_type','血型'),f('party_join_date','入党时间','date'),
  f('is_recommended_for_graduate_study','是否保研','select',yesNo),
  f('has_overseas_study_experience','是否有留学经历','select',yesNo),f('is_poor_student','是否贫困生','select',yesNo),
  f('is_color_weakness','是否色弱','select',yesNo),f('political_membership_date','入团/入党时间','date'),
  f('archive_location','档案所在地'),f('height','身高','number'),f('weight','体重','number'),
  f('self_introduction','自我介绍（自我评价）','textarea'),f('personal_advantages','个人优势','textarea'),
  f('hobbies','兴趣爱好','textarea'),f('career_plan','职业规划','textarea'),
  f('has_overseas_identity','是否具有境外身份','select',yesNo)
 ]),
 group('job_intention','求职意向',false,[
  f('target_position','目标岗位'),f('target_industry','期望行业'),f('current_industry','当前行业'),
  f('availability_date','预计入职时间','date'),f('preferred_city','期望城市'),f('interview_city','面试城市'),
  f('expected_salary','期望薪资','number'),f('expected_salary_year','期望年薪','number'),
  f('current_salary','当前薪资','number'),f('has_relative_in_target_company','是否有亲人在当前求职公司','select',yesNo),
  f('recruitment_source','招聘信息来源'),f('accepts_adjustment','是否接受调剂','select',yesNo)
 ]),
 group('education','教育背景',true,[
  f('school','学校'),f('degree','学历'),f('department','院系'),f('major','专业'),f('major_category','专业类别'),
  f('school_city','学校城市'),f('school_type','学校类型'),f('education_status','学历状态'),f('study_duration','学制（年）'),
  f('start_date','入学时间','month'),f('end_date','毕业时间','month'),f('date_range','起止时间'),
  f('education_award_date','学历授予日期','date'),f('academic_degree','学位'),f('academic_degree_type','学位类型'),
  f('academic_degree_category','学位类别'),f('education_mode','教育方式'),f('admission_category','招生类别'),
  f('is_unified_admission','是否统招','select',yesNo),f('gpa','成绩绩点','number'),
  f('failed_course_count','挂科数','number'),f('class_rank','班级排名','number'),f('major_rank','专业排名','number'),
  f('major_person_num','专业人数','number'),f('diploma_number','学历证书编号'),
  f('degree_certificate_number','学位证书编号'),f('student_id','学号'),f('advisor_name','导师姓名'),
  f('lab_name','实验室名称'),f('is_national_key_lab','是否国家重点实验室','select',yesNo),
  f('is_joint_training','是否联合培养','select',yesNo),f('counselor_name','辅导员姓名'),
  f('counselor_contact','辅导员联系方式','tel'),f('is_overseas_school','是否海外学校','select',yesNo),
  f('description','教育描述','textarea'),f('major_description','专业描述','textarea'),
  f('major_courses','专业课程','textarea'),f('research_focus','研究方向','textarea'),
  f('graduation_thesis','毕业论文','textarea'),f('is_top_up_degree','是否专升本','select',yesNo)
 ]),
 group('internships','实习经历',true,[
  f('company','实习公司'),f('company_size','公司规模','select',companySizes),
  f('is_overseas_experience','是否海外经历','select',yesNo),f('department','部门'),f('position','实习职位'),
  f('start_date','开始时间','month'),f('end_date','结束时间','month'),f('date_range','起止时间'),f('address','实习地址'),
  f('industry','所属行业'),f('employment_nature','用工性质'),f('salary_year','职位年薪','number'),
  f('reference_name','证明人姓名'),f('reference_contact','证明人联系方式','tel'),f('reference_title','证明人职位'),
  f('description','实习描述','textarea'),f('departure_reason','离职原因','textarea')
 ]),
 group('projects','项目经历',true,[
  f('name','项目名称'),f('team_size','团队规模','select',teamSizes),
  f('is_overseas_experience','是否海外经历','select',yesNo),f('role','项目职务'),f('practice_method','实践方式'),
  f('start_date','开始时间','month'),f('end_date','结束时间','month'),f('date_range','起止时间'),f('address','项目地址'),
  f('project_link','项目链接','url'),f('reference_name','证明人姓名'),f('reference_contact','证明人联系方式','tel'),
  f('reference_title','证明人职位'),f('description','项目描述','textarea'),
  f('responsibilities','项目职责','textarea'),f('project_result','项目成果','textarea')
 ]),
 group('cadre_experiences','校园经历',true,[
  f('organization','组织名称'),f('level','级别','select',['学校级','院系级','班级','社团级']),f('position','职位'),
  f('start_date','开始时间','month'),f('end_date','结束时间','month'),f('date_range','起止时间'),
  f('work_content','工作内容','textarea'),f('personal_responsibility','本人职责','textarea')
 ]),
 group('work_experience','工作经历',true,[
  f('company','公司'),f('company_size','公司规模','select',companySizes),
  f('is_overseas_experience','是否海外经历','select',yesNo),f('department','部门'),f('position','职位'),
  f('start_date','开始时间','month'),f('end_date','结束时间','month'),f('date_range','起止时间'),
  f('description','工作描述','textarea'),f('target_city','工作城市'),f('industry','工作行业'),
  f('employment_nature','用工性质'),f('salary','月薪','number'),f('salary_year','年薪薪资','number'),
  f('reference_name','证明人姓名'),f('reference_contact','证明人联系方式','tel'),
  f('reference_title','证明人职位'),f('departure_reason','离职原因','textarea')
 ]),
 group('social_practices','社会实践',true,[
  f('organization','实践单位'),f('position','担任职务'),f('practice_type','实践类型'),
  f('start_date','开始时间','month'),f('end_date','结束时间','month'),f('date_range','起止时间'),
  f('address','实践地点'),f('description','实践描述','textarea'),f('responsibilities','本人职责','textarea'),
  f('achievement','实践成果','textarea')
 ]),
 group('skills','技能专长',false,[
  f('technical','技术技能','textarea'),f('language','语言能力','textarea'),f('software','软件技能','textarea'),
  f('certificate','证书认证','textarea'),f('soft','软技能','textarea')
 ]),
 group('certificate','证书',true,[
  f('certificate_name','资质证书名称'),f('certificate_type','资质证书类型'),f('certificate_date','证书获取时间','date')
 ]),
 group('language_skills','外语能力',true,[
  f('language_type','语言种类'),f('acquired_at','获得时间','date'),f('certificate_name','证书名称'),
  f('certificate_score','成绩'),f('proficiency_level','掌握程度'),f('listening_speaking','听说能力'),
  f('reading_writing','读写能力')
 ]),
 group('family_relations','家庭情况',true,[
  f('name','姓名'),f('relation','关系'),f('birth_date','出生日期','date'),f('age','年龄','number'),
  f('phone','联系电话','tel'),f('id_card','身份证号'),f('company','工作单位'),
  f('has_relative_in_target_company','是否在当前单位任职','select',yesNo),f('position','职位'),
  f('political_status','政治面貌'),f('address','联系地址')
 ]),
 group('awards','获奖经历',true,[
  f('name','奖项名称'),f('organization','颁发机构'),f('date','获奖时间','date'),f('end_date','结束时间','date'),
  f('date_range','起止时间'),f('level','奖项级别'),f('award_type','奖励类型'),f('award_level','奖励等级'),
  f('description','获奖描述','textarea')
 ]),
 group('patents','专利信息',true,[
  f('title','专利名称'),f('patent_number','专利号'),f('applicant_date','申请日期','date'),
  f('status','专利状态'),f('inventors','发明人'),f('description','专利描述','textarea')
 ]),
 group('publications','论文发表',true,[
  f('title','论文标题'),f('journal','发表期刊'),f('authors','作者'),f('journal_issue','期刊卷期'),
  f('impact_factor','影响因子','number'),f('author_order','作者顺序','select',['第一作者','共同第一作者','第二作者','第三作者','第四作者及以后','通讯作者']),
  f('publish_date','发表时间','date'),f('doi','DOI号'),f('description','论文摘要','textarea')
 ]),
 group('training','培训经历',true,[
  f('name','培训名称'),f('organization','培训机构'),f('start_date','开始时间','month'),f('end_date','结束时间','month'),
  f('date_range','起止时间'),f('address','培训地点'),f('certificate','获得证书'),f('description','培训内容','textarea')
 ])
];

for(const section of SECTIONS)for(const field of section.fields){
 const observed=SITE_OPTIONS[`${section.key}.${field.key}`];
 if(!observed)continue;
 field.type='select';
 field.options=observed.map(option=>({...option}));
}

for(const field of SECTIONS.find(section=>section.key==='job_intention').fields){if(['target_industry','current_industry'].includes(field.key))field.suggestions=INDUSTRY_OPTIONS;}
