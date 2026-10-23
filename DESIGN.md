# Design
## Source of truth
Active · 2026-10-23. Personal Chrome MV3 extension. Reference: observed cv.playoffer.cn/resumes navigation and local extension 0.9.8 analysis. No existing app UI.
## Brand
清晰、克制、个人工具。名称「简历工作台」。不使用原产品品牌或资源。
## Product goals
本地多份结构化简历、文件导入导出、自定义模型接口、表单扫描、预览和填写。成功标准：测试表单的真实输入值与资料一致，禁止生成未提供的经历。暂不承诺所有招聘网站兼容。
## Personas and jobs
个人求职者，重复填写网申；桌面 Chrome。
## Information architecture
独立工作台：资料 / API 设置 / 使用说明。左侧资料分区导航；主区编辑；侧栏显示已填/总数、百分比、未补齐计数、各分区进度和未填筛选。16分区覆盖240种字段定义，记录数量决定实际总数。弹窗选择简历并扫描当前页，展示匹配预览后应用。
## Design principles
用户先校对资料；模型只返回字段映射；网页与模型文本不执行。保存本地，发送模型前由用户明确触发。
## Visual language
暖白底、深蓝文字、青绿色强调；系统中文字体；8px 间距基准；细边框与12px圆角。无外部字体图片。
页面助手采用蓝色渐变，右下闪电按钮与380px面板；closed Shadow DOM隔离，敏感动作要求真实用户事件。首次由扩展弹窗手动启用，无新增持久站点权限。
## Components
分区卡片、字段标签及aria-describedby说明、日期精度切换及原生日期/月选择器（结束时间支持至今）、本地省市区联动（期望城市最多5个）、按学历/门类/关键词筛选专业目录、重复经历列表、提示条、主次按钮、空状态、匹配表；CSS变量统一管理。
## Accessibility
语义表单、可见标签、键盘焦点、状态aria-live；正常文字4.5:1对比；不依赖颜色。
## Responsive behavior
桌面侧栏240px；小于760px上下堆叠；弹窗宽390px。
## Interaction states
明确保存、解析中、请求失败、无字段、无匹配、部分成功；避免静默覆盖已填写字段。
## Content voice
简短中文，直接说明结果与下一步；说明哪些内容会发往自定义API。
## Implementation constraints
原生HTML/CSS/ES modules，无构建依赖。Node内置测试；独立测试表单。MV3外部脚本，严格CSP，无eval。支持JSON/TXT/MD、PDF和PNG/JPEG/WEBP。PDF.js固定版本本地打包与独立module worker，关闭WASM，不放宽CSP；PDF提取/扫描页渲染和图片压缩先本地进行。预览显示API接收方、模型、图片和可编辑文本；显式发送后保存为新简历，保留原简历。DOCX待后续适配。
目录仅点击展开时读取包内JSON，运行时不访问外部目录服务。改变日期精度或学历保留旧值，只有明确选择替换；手填和海外数据始终可用。已有手填起止时间不随日期字段自动覆盖。
## Open questions
- [ ] 用户自定义API实际地址与模型未知；使用OpenAI兼容chat/completions协议并提供本地模拟验证。
- [x] 已观察登录后原站字段元数据；仅保存标签与类型，不保留个人简历值。
- [ ] 社会实践/培训远端字段未完整取得，当前为保守补充。
