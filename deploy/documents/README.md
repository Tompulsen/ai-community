# 社区文档工作区

技能广场启用「文档工作区」后，在当前聊天选择该技能，直接提出生成或修改文件的要求。输入框旁的「文件」可上传 DOCX / XLSX、预览内容、下载原件与历史版本，并选择文件继续编辑。普通问答、「不要生成文件」「仅展示 Markdown」不触发文档工具。

模型使用当前聊天选择的模型和现有 New API 账号计费。文件制作、状态查询和制作重试使用已经保存的计划，不重新调用模型。模型调用不成功时，需要重新生成内容。选择过期版本会在调用模型前被拒绝。

## 来源与范围

复用 QXChat 的 GenOffice 文档计划、意图识别、内容预览和文件引擎，来自本地 `genoffice-integration-20261103/source` 快照（`49d2586`）。MIT 声明保存在 `services/documents/QXChat-LICENSE`。社区的身份验证、技能目录、聊天存储和模型适配器继续使用现有实现。

GenOffice 核心固定为 `genspark-ai/genoffice` 的 `1a0fcec971c714d11777cbd5c68da1c933572d14`（v0.12.600，Apache-2.0）。构建收集核心依赖许可证；Linux 表格 sidecar 从同版本发布包提取并验证 SHA-256，保留 THIRD-PARTY-NOTICES。新增社区服务使用 AGPL-3.0-only。

支持 Word 标题、段落和表格创建、按原文校验的局部替换；Excel 多工作表、类型化单元格、公式计算和按旧值校验的单元格修改。内容预览不提供完整 Office 分页或任意版式编辑。宏、嵌入对象、外部链接、受保护或带修订的文档及无法验证的公式会明确拒绝。

## 运行

`deploy/compose.yml` 增加独立 `documents` 服务和持久化卷，不暴露公网端口。Studio 使用 `DOCUMENT_SERVICE_URL=http://documents:3010`；`private/studio.env` 和 `private/documents.env` 中设置同一个至少 32 字符的 `DOCUMENT_SERVICE_SECRET`。现有 `deploy/studio/deploy.py <main-sha>` 会生成或保留密钥，并部署三个同 SHA 镜像。

Studio 代理从已验证会话派生用户标识，不接受浏览器提供的文件所有者。服务按账号隔离文件，保留不可变版本。上传上限 20 MiB；每账号最多 500 个版本、500 MiB；全局一次处理一个文件，超时 90 秒；磁盘余量低于 1 GiB 时拒绝新任务。文件计划保存后独立执行，页面刷新可恢复查询；中断任务可重试，关闭上传面板会取消当前上传。

发布顺序：验证 → 对应 GitHub `main` → 确认镜像 revision → 服务器拉取同一 SHA → 部署与健康检查。回滚保留文档卷，容器清理不删除卷或历史文件。

## 验证

- `services/documents`: 设置 `GENOFFICE_SOURCE` 后运行 `node build.mjs`；设置 `XLSX_SIDECAR_PATH` 后运行 `node test.mjs`。镜像构建会执行相同的 21 项 Linux 引擎测试。
- 仓库根目录运行 `node services/documents/server.test.mjs`：实际服务的生成、上传、下载、账号隔离、幂等、公式重算、版本冲突、取消和并发限制。
- Studio 的 `test/document-*.test.ts`、`test/skills.test.ts`、`test/skill-activation.test.ts` 覆盖计划、意图、代理、模型调用边界及技能启用。
- 浏览器验收覆盖 1440、390、320 像素视口、生成与下载、上传与预览、连续修改、刷新恢复和免模型重复调用的制作重试。
