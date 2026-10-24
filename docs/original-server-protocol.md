# 原扩展的公开服务协议与规则

采集日期：2026-10-24。目标客户端：来个简历 0.9.8。个人版：0.7.1。

## 直接观察到的服务端响应

通过 Chrome 的普通 GET 导航读取原包明确声明的接口；未读取或导出登录 token、Cookie、个人简历响应、管理员接口。保留的 HAR 去除了请求头和 Cookie。REA 对该 HAR 的 3 条响应完成解析；HAR 转换不保留浏览器事务 ID，REA 将其归为 historical-reference，不能单靠它证明运行归属。

| 接口 | HTTP | 观察结果 |
|---|---:|---|
| `/api/plugin/resume-schema` | 200 | `data.version=2.0.16`，16 个分组、257 个字段定义，其中 13 个虚拟字段；`lastUpdated=2026-10-18T08:46:37.729Z` |
| `/api/ai/config` | 200 | 公开配置，含 `sitePromptRules`、`platformFormGroupings`、`fillEngineRoute`、`remoteTriggers` 等 |
| `/api/semantic-config?domain=campus.jd.com` | 404 | 在本次普通浏览器 GET 请求条件下未得到站点响应；不代表所有登录态、版本或站点均无配置 |

配置中可确认的事实：

- `platformFormGroupings` 列出 mokahr、beisen_old、beisen_mobile、beisen、atsx、hotjob、hotjob_mc、feishu、hcm 共 9 类平台。
- 每类包含分组边界、模块标题、字段标签等选择器；部分还含 host/path 限制、新增按钮、候选排除规则、记录索引重写开关。
- Moka 配置排除了各经历分区的独立开始/结束日期字段；这是该发现流程的排除项，不能解释成日期永远不支持。
- 北森移动版和 Hotjob 移动版使用特殊候选/标签容器；Hotjob 移动版提示优先选区处理。
- `sitePromptRules` 是给用户看的“建议选区填写”等提示，不是完整模型 system prompt。部分能源、银行等页面被标记为动态/分步表单。
- 本次匿名响应的 `fillEngineRoute` 为 `percentage=100`、`fullButtonMode=legacy_full`、`parseResumeAiMode=sync`、`reason=anonymous`；`siteFormGroupAutoDiscoveryEnabled=false`、`remoteTriggers=[]`。账号态路由未知。
- schema 返回的虚拟规则涉及英语等级成绩、是否有经历/成果、最高学历/学位、第一学历、亲属是否在目标公司等。客户端可获得这些表达式，不等于获得服务端模型实现。

## 原包中静态确认的请求参数

下表来自 REA 对原包 `background.js` 的惰性分析及精确文本交叉检查；这些 POST 没有在本次向原服务端重放。

| 功能 | 协议与参数 |
|---|---|
| 站点配置 | `GET /api/semantic-config?domain=...` |
| 表单解析 | `POST /api/ai/parse-resume/v2`：`mode`、`fill_source`、`title`、`url`、`html_fragment`、`simple_fragment`、`all_fragment`、`element_dict`、`token_context`、`rewrite_index_by_group`、`form_grouping_id`、`candidate_count`、`unmatchedTokens`、`resume_context` |
| 异步任务 | `POST /api/ai/parse-resume/v2/task`：同类解析参数，固定 AI 模式并增加 `clientRequestId`；随后 GET `/task/{taskId}?cursor=...` |
| 下拉候选理解 | `POST /api/ai/fill-selector`：`resumeId`、`value`、`resumeValue`、`resumeFieldValue`、`candidates`、`context`；context 包括字段键/名称、网页标签、XPath 和站点上下文 |
| 需要新增多少条 | `POST /api/resume-fill-plugin/module-count`：`url`、`module_names`、`resume_uuid`、`resume_module_counts` |

原包的主解析会发送页面片段、元素字典、定位 token、分区/经历上下文，并非只比较标签是否相同。菜单打开后还有一次专门的候选判断。动态字段出现或定位失效后需重新扫描/匹配，而不是反复执行旧坐标。

背景脚本中上述请求分支大致位于 UTF-8 字节偏移 64616（站点配置）、64806（解析）、65377（任务创建）、66757（下拉选择）。静态关系不证明接口当前可用或其返回数据的实际内容。

## 个人版采用的实现

- 公开布局参数转换为本地声明式适配；匹配时要求字段容器与唯一模块标题，不从远端加载选择器或可执行代码。
- 原有基于学校、公司、项目等身份的记录匹配优先；不会盲目照搬远端索引重写。
- 字段匹配后，简单自定义单选菜单可再次把当前候选和可信资料值交给自定义 API。只接收已有候选 ID/索引和足够置信度，点击后读回；日期精度与多选拆分走独立校验。
- 通过本地函数派生业务事实。空白经历不等于明确“没有”，同级多条学历不能猜第一学历；没有明确英语成绩就不生成分数。不执行 schema 中的 `valueScript`。
- 官网证书、家庭、论文、培训等新增输入字段采用本地规范键名；显式兼容原始字段别名，包括原接口中的历史拼写。
- 连续处理最多 5 轮 / 60 秒，按用户选择的资料范围执行。新增条目只在已确认分区内操作；出现弹窗暂停，下一步由独立按钮触发。
- 正式扩展不调用原产品后端、不发送原产品统计；仅在用户选择 AI 功能时调用其配置的 API。

尚未知：完整模型提示词、供应商/模型配置、私有站点规则库、分组发现服务的内部算法、不同会员/账号状态下的策略。公开布局定义也不是完整控件适配库，仍需逐类实站验证。

## 本地证据索引

原始分析和公开响应仅保存在本机 `analysis/laige-0.9.8/`，不把原扩展代码或服务端表达式整包提交到本仓库。

- 原包 root SHA-256：`3b5563ac59a06840c1967ab6768bf66819efbc553a0731a6ffde0d49f7bc88dd`
- schema 快照 SHA-256：`aa8e3899d51ce4e66fee78645af66122d53076f4993c7787e8918a563d8ab94b`
- config 快照 SHA-256：`cf3f194ee6246a4439827e85d702a7e195ccacb3c57bcff03ebb70fb15a56a7e`
- 脱敏 HAR SHA-256：`6577186953dd12239dbd79ba39bd5b7c022e1c6a96d9c19c60683d947b05fe8b`
- REA 导出：`rea-server-protocol-2026-10-24.json`，包括静态分析及 HAR 分析记录；静态语义图有明确截断和未解析关系，不将其称为完整逆向。
