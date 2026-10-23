import test from 'node:test';
import assert from 'node:assert/strict';
import {SECTIONS} from '../extension/lib/schema.js';
import {FIELD_HELP,getFieldHelp} from '../extension/lib/field-help.js';

test('every schema field has concise non-empty help',()=>{
 const all=SECTIONS.flatMap(section=>section.fields.map(field=>({section,field})));
 assert.equal(all.length,240);
 assert.equal(Object.keys(FIELD_HELP).length,240);
 for(const {section,field} of all){
  const help=getFieldHelp(section.key,field);
  assert.equal(typeof help,'string',`${section.key}.${field.key}`);
  assert.ok(help.trim().length>=5,`${section.key}.${field.key}: ${help}`);
  assert.ok(help.length<=100,`${section.key}.${field.key} is too verbose`);
 }
});

test('high-risk ambiguous fields explain the expected unit or meaning',()=>{
 assert.match(FIELD_HELP['personal.height'],/厘米（cm）/);
 assert.match(FIELD_HELP['personal.weight'],/千克（kg）/);
 assert.match(FIELD_HELP['job_intention.expected_salary'],/税前月薪.+元/);
 assert.match(FIELD_HELP['job_intention.expected_salary_year'],/税前年薪.+元/);
 assert.match(FIELD_HELP['education.class_rank'],/前 5% 填 5/);
 assert.match(FIELD_HELP['education.major_category'],/教育部专业目录.+不同于具体专业名称/);
 assert.match(FIELD_HELP['education.academic_degree_type'],/学术学位或专业学位.+不要填写学历层次/);
});

test('date and region guidance preserves precision and limits',()=>{
 assert.match(FIELD_HELP['personal.birth_date'],/具体日期/);
 assert.match(FIELD_HELP['education.start_date'],/入学年月/);
 assert.match(FIELD_HELP['education.date_range'],/自动生成.+手动填写/);
 assert.match(FIELD_HELP['work_experience.end_date'],/至今/);
 assert.match(FIELD_HELP['job_intention.preferred_city'],/最多选择 5 个.+任意城市/);
});

test('sensitive optional fields avoid inference and forced disclosure',()=>{
 assert.match(FIELD_HELP['personal.health_status'],/实际情况.+可留空/);
 assert.match(FIELD_HELP['personal.id_card'],/确有需要/);
 assert.match(FIELD_HELP['personal.has_overseas_identity'],/分别填写.+无法确认时可留空/);
});
