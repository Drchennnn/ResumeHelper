import {SECTIONS} from './schema.js';

// Short, factual guidance adapted from the field descriptions observed on the
// reference resume page.  The text is bundled locally and never loads remote
// copy or user data.
const EXACT={
 'personal.name':'填写证件或招聘材料中使用的真实姓名。',
 'personal.name_pinyin':'填写姓名拼音，便于英文表单使用。',
 'personal.english_name':'填写完整英文姓名；没有可留空。',
 'personal.phone':'填写常用手机号码。',
 'personal.email':'填写常用联系邮箱。',
 'personal.birth_date':'选择出生的具体日期。',
 'personal.age':'填写周岁，只填数字。',
 'personal.id_card':'按所选证件类型填写证件号码；仅在招聘方确有需要时提供。',
 'personal.address':'选择或填写当前居住地区。',
 'personal.native_place':'填写籍贯所在省市。',
 'personal.origin_place':'应届生按学校或招聘方口径填写生源地。',
 'personal.household_type':'选择户口性质，例如城镇或农村。',
 'personal.household_address':'选择或填写户口所在地区。',
 'personal.highest_degree':'填写已取得或当前最高学历层次。',
 'personal.academic_degree':'填写最高学历对应的学位，例如学士、硕士或博士。',
 'personal.graduate_school':'填写最高学历对应的毕业院校。',
 'personal.graduation_major':'填写最高学历对应的专业名称。',
 'personal.learning_mode':'填写最高学历的学习形式，例如全日制或非全日制。',
 'personal.graduation_time':'选择最高学历的毕业日期；尚未毕业时填预计日期。',
 'personal.graduate_status':'按招聘方对应届生的定义选择。',
 'personal.work_status':'选择当前在职、离职或在校等求职状态。',
 'personal.career_years':'填写累计全职工作年限；在读或应届生通常填 0。',
 'personal.last_company':'填写最近一段正式工作所在单位。',
 'personal.personal_workspace_url':'填写个人主页、作品集或代码仓库的完整链接。',
 'personal.english_level':'选择已取得的最高英语等级。',
 'personal.gaokao_exam_date':'选择参加高考的具体日期。',
 'personal.gaokao_score':'填写高考总分，只填数字。',
 'personal.gaokao_subject':'填写参加高考时的科目或选科组合。',
 'personal.professional_rank':'填写已取得的专业技术资格或职级。',
 'personal.emergency_contact_name':'仅在招聘方确有需要时填写紧急联系人姓名。',
 'personal.emergency_contact_relation':'填写紧急联系人与你的关系。',
 'personal.emergency_phone':'填写紧急联系人的常用电话号码。',
 'personal.postal_code':'填写当前居住地邮政编码。',
 'personal.health_status':'按本人实际情况填写；招聘方未要求时可留空。',
 'personal.has_long_term_disease':'仅按实际情况选择；无法确认招聘口径时可留空。',
 'personal.has_criminal_record':'仅按实际情况选择；无法确认招聘口径时可留空。',
 'personal.has_military_service':'选择是否曾服兵役。',
 'personal.is_veteran':'选择是否属于退伍军人。',
 'personal.blood_type':'按本人已确认的信息填写；不知道可留空。',
 'personal.party_join_date':'选择正式加入党组织的具体日期。',
 'personal.political_membership_date':'选择加入共青团或党组织的具体日期。',
 'personal.is_recommended_for_graduate_study':'选择是否通过推荐免试攻读研究生。',
 'personal.has_overseas_study_experience':'选择是否有境外留学经历。',
 'personal.is_poor_student':'按学校认定结果填写；招聘方未要求时可留空。',
 'personal.is_color_weakness':'按本人已确认的情况填写；招聘方未要求时可留空。',
 'personal.archive_location':'选择或填写人事档案当前所在地区。',
 'personal.height':'填写身高，单位为厘米（cm），只填数字。',
 'personal.weight':'填写体重，单位为千克（kg），只填数字。',
 'personal.career_plan':'简要说明应聘成功后的职业发展目标。',
 'personal.has_overseas_identity':'指外国国籍或境外永久居留权等身份；与留学、海外经历分别填写，无法确认时可留空。',

 'job_intention.target_position':'填写正在申请或期望从事的岗位名称。',
 'job_intention.target_industry':'选择期望从事的行业。',
 'job_intention.current_industry':'选择当前或最近从事的行业。',
 'job_intention.availability_date':'选择预计可以到岗的具体日期。',
 'job_intention.preferred_city':'最多选择 5 个期望工作城市；不限制地点时可选择“任意城市”。',
 'job_intention.interview_city':'选择可以参加线下面试的城市。',
 'job_intention.expected_salary':'填写期望税前月薪，单位为元，只填数字。',
 'job_intention.expected_salary_year':'填写期望税前年薪，单位为元，只填数字。',
 'job_intention.current_salary':'填写当前税前月薪，单位为元，只填数字。',
 'job_intention.has_relative_in_target_company':'按当前应聘公司的实际情况选择。',
 'job_intention.recruitment_source':'填写获知本次招聘信息的渠道。',
 'job_intention.accepts_adjustment':'选择是否接受岗位或工作城市调剂。',

 'education.school':'填写学校官方全称。',
 'education.degree':'选择学历层次；它决定可选的专业类别范围。',
 'education.department':'填写就读院系的官方名称。',
 'education.major':'填写成绩单或学历材料上的具体专业名称。',
 'education.major_category':'选择当前学历对应的教育部专业目录类别；它不同于具体专业名称。',
 'education.school_city':'选择学校所在地。',
 'education.school_type':'按学校实际类型选择。',
 'education.education_status':'选择该教育经历当前是已毕业、在读或其他状态。',
 'education.study_duration':'填写学制年数，例如 2、2.5 或 4。',
 'education.start_date':'选择入学年月。',
 'education.end_date':'选择毕业年月；在读时填写预计毕业年月。',
 'education.date_range':'根据入学和毕业年月自动生成，也可手动填写。',
 'education.education_award_date':'选择学历证书正式授予或取得的具体日期。',
 'education.academic_degree':'填写具体学位，例如学士、硕士或博士。',
 'education.academic_degree_type':'选择学术学位或专业学位；不要填写学历层次。',
 'education.academic_degree_category':'填写学位门类与层级，例如工学硕士。',
 'education.education_mode':'选择全日制、非全日制、函授等教育方式。',
 'education.admission_category':'按录取材料选择统招、单招、专升本或定向等类别。',
 'education.is_unified_admission':'选择该教育经历是否属于统一招生。',
 'education.gpa':'填写成绩绩点；建议保留 1 位小数。',
 'education.failed_course_count':'填写该教育阶段挂科科目数量，只填数字。',
 'education.class_rank':'填写班级排名百分比数值，例如前 5% 填 5。',
 'education.major_rank':'填写专业排名百分比数值，例如前 5% 填 5。',
 'education.major_person_num':'填写同年级同专业总人数，只填数字。',
 'education.diploma_number':'按学历证书填写编号；未取得可留空。',
 'education.degree_certificate_number':'按学位证书填写编号；未取得可留空。',
 'education.student_id':'填写该教育阶段的学号。',
 'education.advisor_name':'填写导师姓名；没有可留空。',
 'education.lab_name':'填写所在实验室名称；没有可留空。',
 'education.is_national_key_lab':'按实验室正式认定情况选择。',
 'education.is_joint_training':'选择该教育经历是否属于联合培养项目。',
 'education.counselor_name':'填写辅导员姓名；招聘方未要求时可留空。',
 'education.counselor_contact':'填写辅导员联系方式；招聘方未要求时可留空。',
 'education.is_overseas_school':'选择学校是否位于中国大陆以外。',
 'education.is_top_up_degree':'本科学历通过专升本取得时选择“是”。',

 'internships.salary_year':'填写该实习岗位折算或约定的税前年薪，单位为元。',
 'work_experience.salary':'填写税前月薪，单位为元，只填数字。',
 'work_experience.salary_year':'填写税前年薪，单位为元，只填数字。',
 'publications.impact_factor':'填写论文发表时或招聘方指定口径的影响因子。',
 'publications.author_order':'选择本人在论文署名中的顺序。',
 'publications.doi':'填写 DOI 标识，例如 10.xxxx/xxxxx。'
};

const SECTION_CONTEXT={
 internships:'实习',projects:'项目',cadre_experiences:'校园任职',work_experience:'工作',
 social_practices:'社会实践',certificate:'证书',language_skills:'外语能力',family_relations:'家庭成员',
 awards:'获奖',patents:'专利',publications:'论文',training:'培训'
};

const KEY_HELP={
 start_date:'选择开始年月。',end_date:'选择结束年月；仍在进行时可按页面支持选择“至今”。',
 date_range:'根据开始和结束年月自动生成，也可手动填写。',date:'选择对应事项发生的具体日期。',
 address:'选择或填写实际所在地区。',company_size:'选择当时公司的员工人数规模。',
 team_size:'选择项目参与团队的人数规模。',industry:'选择该经历所属行业。',
 employment_nature:'选择实习、全职、兼职、劳务或外包等实际用工性质。',
 is_overseas_experience:'选择该经历是否发生在中国大陆以外。',
 reference_name:'填写可核实该经历的证明人姓名；无要求可留空。',
 reference_contact:'填写证明人的有效联系方式；无要求可留空。',
 reference_title:'填写证明人当时的职位；无要求可留空。',
 departure_reason:'客观简要说明离开该岗位的原因。',
 description:'概述背景、主要工作和结果，优先使用可核实的事实。',
 responsibilities:'说明本人承担的职责和具体贡献。',achievement:'填写可核实的成果，能量化时注明口径。',
 organization:'填写组织或机构的官方名称。',position:'填写当时的岗位或职务名称。',
 name:'填写该项的正式名称。',phone:'填写常用联系电话。',birth_date:'选择出生的具体日期。',
 age:'填写周岁，只填数字。',id_card:'仅在招聘方确有需要时填写证件号码。',
 political_status:'按本人实际情况选择政治面貌。'
};

function fallback(sectionKey,field){
 const context=SECTION_CONTEXT[sectionKey]||'';
 if(KEY_HELP[field.key])return KEY_HELP[field.key];
 if(field.key==='end_date')return KEY_HELP.end_date;
 if(field.type==='month')return `选择${context||'该项'}对应的年月。`;
 if(field.type==='date')return `选择${context||'该项'}对应的具体日期。`;
 if(field.type==='number')return `填写${field.label}，只填数字；没有或不适用时可留空。`;
 if(field.type==='url')return `填写${field.label}的完整链接。`;
 if(field.type==='tel')return `填写${field.label}；招聘方未要求时可留空。`;
 if(field.type==='select')return `按实际情况选择${field.label}；无法判断时可留空。`;
 if(field.type==='textarea')return `填写${field.label}，只写可核实的事实；没有可留空。`;
 return `填写${field.label}；没有或不适用时可留空。`;
}

export function getFieldHelp(sectionKey,field){
 if(!field||typeof field!=='object')return '';
 return EXACT[`${sectionKey}.${field.key}`]||fallback(sectionKey,field);
}

export const FIELD_HELP=Object.freeze(Object.fromEntries(
 SECTIONS.flatMap(section=>section.fields.map(field=>[
  `${section.key}.${field.key}`,
  getFieldHelp(section.key,field)
 ]))
));
