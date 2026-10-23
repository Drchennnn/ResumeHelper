# 0.3.0 验证记录

日期：2026-10-23（Asia/Hong_Kong）。使用纯虚构样例，不使用用户真实简历或远程模型密钥。

## 自动检查

- 47 项 Node 测试：字段扫描、保护已有内容、模型映射、完整字段与选项、数据迁移和存储；PDF 本地提取、真实扫描／混合 PDF 渲染；图片 PNG/JPEG/WebP 头部与尺寸预算；超长文字和损坏 PDF；图片 API 请求及错误处理；导入 UI 预览、取消、显式发送、失败重试和保存。
- JS/MJS 语法、manifest 入口、HTML资源和 PDF worker/decoder 存在性检查。
- npm audit：未发现已知漏洞。PDF.js固定6.4.299，许可证随资源保留。
- 文件上限之外另检查原图边长16000、总像素33554432；PDF Canvas预算64MiB，文字流累计10万字符。资源预算降低风险，不能保证任意恶意文档都可正常处理。

## Chrome 实际浏览器

本机开发服务器对工作台使用与扩展相同的 `script-src 'self'; object-src 'self'` CSP。使用本地 module Worker，不放宽 CSP。

1. 实际 file chooser 选择 `fictional-resume.pdf`，本地提取 `Fictional Candidate / demo@example.com / JavaScript and Python`，显示可编辑预览，mock API请求数仍为0。
2. 明确点击解析后，mock收到纯文本 Chat Completions 请求；新增“虚构PDF导入”，原“我的简历”保留。
3. 实际选择 PNG 图片，得到1张压缩图片预览，强制视觉模式；点击识别后mock收到1张data URL并新增“虚构图片导入”。
4. 实际选择无文字层的扫描PDF，自动渲染1张页面；取消，没有新增API请求。
5. 实际选择两页混合PDF，保留文字页的提取文本和1张扫描页图片；预览期间请求数仍为2；确认识别后请求数为3。刷新工作台，新旧4份简历仍在。
6. 浏览器独立文档冒烟页覆盖文字PDF、扫描PDF、混合PDF、完整页面渲染和图片预处理。

截图为 `artifacts/import-image-v0.3.png` 与 `artifacts/import-mixed-pdf-v0.3.png`。

自动化上传最初被Chrome权限拦截，用户开启权限后已重新执行并通过实际上传流程，无此项待办。

## 验证边界

- 自定义 API 使用本机确定性mock，验证了图文请求、错误和落库流程；这不是对真实视觉模型 OCR 准确率的测量。
- 文字/扫描/混合PDF为英文虚构fixture；中文CMap及标准字体已打包，未建立中文/复杂排版/各类PDF编码的兼容性矩阵。
- 本轮没有验证安装后的完整MV3 service worker生命周期；本地浏览器验证不能替代扩展安装验收。
- 真实招聘网站复杂联动控件、跨域iframe、所有站点兼容矩阵与DOCX仍不在本次验证范围内。

历史0.2.0填写测试记录保留在 `artifacts/verification.md`；其中PDF尚未支持的陈述属于旧版本。
