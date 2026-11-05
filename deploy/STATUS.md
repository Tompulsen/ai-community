# 部署验证记录（2026-11-05）

## 当前生产版本

- 访问地址：<https://zaiduyu.top>。
- 服务器：`210.126.232.192`；项目目录 `/opt/ai-community`。
- GitHub 私有仓库：`Tompulsen/ai-community`，分支 `main`。
- 已部署应用提交：`49e90b4b3d22ba13cb5bab6646effea965e131e2`。
- 固定镜像：`ghcr.io/tompulsen/ai-community:sha-49e90b4b3d22ba13cb5bab6646effea965e131e2`。
- 镜像摘要：`sha256:e2c6a1c97d1785e9f0db88cb6a3436b08fd1ea78b80d960be74f5109f9b88d59`。
- GitHub Docker 构建运行：`41956714315`，成功；服务器拉取后的 OCI revision 与应用提交一致。
- 应用、PostgreSQL、Redis 三个容器均为 healthy。数据库与 Redis 不发布宿主机端口，应用仍绑定 `127.0.0.1:13000`。
- 生产源码下载 `/source/ai-community.tar.gz` 对应上述应用提交；SHA-256 为 `84a13982f8e4bd7ec6ba7320da60d05ddffe71f4220f96898784f51308e06b59`，已核对上传归档和服务器归档哈希。

本记录可在部署后以纯文档提交更新；不要求为文档提交重复构建应用镜像。提供给用户的源码归档对应实际运行的应用版本。

## 本次作品互动与详情改版（2026-11-05）

- 社区作品卡片增加快速评论、原生转发、爱心点赞与真实浏览计数；评论草稿和转发结果状态可在站内路由往返中保留。
- 新作品页 /community/work/:submissionId 在桌面采用左侧作品、右侧信息与评论布局，手机改为上下排列。图片完整展示、GIF 保留动效、视频手动播放，多附件可切换，敏感媒体须主动展开。
- 作品信息下方的“制作同款”进入对应文本、图片或视频制作模块，继续使用管理员配置的网址及既有登录要求；另提供复制提示词，不假设第三方工具能够自动填充。
- 新增 CommunityWorkViews1793844969747 迁移与作品 show/view 接口，复用既有公开范围、作者隐私、关注时间和拉黑过滤。浏览计数从本轮上线开始统计；页面可见且预览进入视口满一秒才上报，同一账号或匿名请求 IP 在三十分钟内通过 Redis 原子键去重，数据库原子累加。
- 中文、英文文案同步；普通点赞、评论和转发继续调用原生 Note 接口，生产内容审核设置不变。

### 本轮验证与边界

- PASS：七组真实业务服务、TypeORM/PGlite 后端验证，覆盖权限、迁移 up/down、浏览去重及上限、缓冲点赞。
- PASS：二十项真实 Vue SFC、CSS、交互逻辑与 API 适配器的 Chromium 隔离检查，覆盖快速评论、失败草稿、分页、转发结果不确定、KeepAlive 状态同步、游客登录、中英文及 320px 长标题；无 pageerror。
- PASS：变更组件和共享逻辑针对生成 SDK 的定向类型检查，变更文件 ESLint、SPDX、locale safety、git diff --check；独立交叉评审无阻断项。
- PASS：GitHub 完整 Docker 镜像构建、服务器固定 SHA 拉取、OCI revision、源码归档 SHA-256、应用/PostgreSQL/Redis 三个容器健康。新增浏览计数迁移已在生产执行。
- PASS：线上真实公开作品《小狗自拍》的卡片、媒体解码、桌面左右布局、游客互动登录门控、制作同款及登录后制作入口、管理员登录、评论输入框、真实 Redis 同账号浏览去重、390px 中英文手机界面；无横向溢出或 pageerror。
- BASELINE：生产 check-migrations 仍仅报告 meta.proxyRemoteFiles 默认值 false/true 的两条既有差异，无本轮新实体差异。
- SKIPPED：本机完整依赖安装因 EACCES 失败，未宣称完整本地构建或全仓测试通过；完整生产构建由 GitHub Docker 流水线验证。
- 边界：线上只进行了正常浏览及登录，没有对用户作品发布评论、点赞、转发或执行审核决策。互动写入使用隔离服务验证；隔离 Redis 使用原子 fake，生产另验证真实 Redis 去重，但未进行多 PostgreSQL 连接并发压力测试。

本地验证报告：.community-validation/work-interactions-review/backend-results.json、frontend-results.json；生产验收与截图：.community-validation/work-interactions-production/checks.json、community-desktop.png、work-detail-desktop.png、work-detail-mobile.png、work-detail-mobile-en.png。

### 本轮备份与恢复

备份目录：/opt/ai-community-backups/interactions-20261105T023901Z。已备份数据库、上传文件、私有配置、Compose、旧镜像引用及源码；数据库 dump 已用 pg_restore --list 校验。升级前镜像为 sha-5da7f01201bff52a8c3f7c6d5d70ec7c0231d00b，保留在服务器。健康检查失败可恢复旧镜像；本轮健康启动成功，未回滚。临时镜像拉取凭据已删除。

## 上一轮审核修复（2026-11-05）

用户的《小狗自拍》已保存为 pending，未丢失。根因是投稿系统固定先审后发，而管理员菜单仍打开旧频道审核页；旧页面不能查询 community_submission，错误显示初始化提示。

- 管理后台 /admin/community 已接入真实投稿列表，默认“待处理”同时包含未公开待审和已公开待审作品。
- 管理员可保存“先审后发”或“先发后审”；默认并已保存为 before（先审后发）。切换只影响新投稿，既有 pending 不会自动公开。
- 先发后审创建 published 状态和公开 Note；随后审核通过不重新创建 Note，保留互动。幂等重试返回实际状态。
- 管理员可填写原因并确认违规下架。投稿状态、原 Note 删除、私有作者公告、删除审计在同一事务保存，外部事件仅在提交后发送。作者可在“我的投稿”查看下架记录和原因，在线收到原生私有公告事件，离线后重登仍可读取公告。
- 新迁移 CommunityModeration1793840812106 保存投稿时的发布模式，Note 外键改为 SET NULL，避免删除作品时连带丢失投稿历史；普通删除显示“作品已删除”。未修改历史迁移。
- 模式设置和新增审核状态支持中英；社区公共列表及热门作品可展示按先发后审模式公开的作品，未公开 pending 始终排除。

线上使用真实管理员账号确认《小狗自拍》可在审核列表和“我的投稿”查看，媒体可预览；作品仍保持 pending，未代替管理员批准、驳回或下架。

### 本轮验证

- PASS：10 组真实业务服务、实体、迁移和 TypeORM/PGlite 验证，包括两模式、切换不改旧稿、幂等冲突、权限、审核不重复建 Note、下架通知与审计、处理中途失败全部回滚，以及普通删除保留投稿；迁移 down/up 后目标实体 pending DDL 为 0。
- PASS：真实 Vue 组件的 Chromium 隔离验证：设置保存成功/失败、待处理筛选、下架必填原因与核对、取消不提交、409 保留反馈、下架状态筛选；320px 无横向溢出。
- PASS：后台和投稿组件脚本、API 适配器与重新生成的 SDK 定向类型检查；变更文件 ESLint、SPDX、locale safety 和 git diff --check。
- PASS：GitHub 最新固定 SHA 镜像构建、服务器拉取、OCI revision、三容器健康、源代码归档校验。
- PASS：线上原生管理员登录、匿名审核接口拒绝访问、审核设置保存且其他设置不变、真实投稿可见、pending 不进入公共列表、媒体详情、390px 手机和英文设置；浏览器无 pageerror。
- BASELINE：生产 check-migrations 仅报告既有 meta.proxyRemoteFiles 默认值 false/true 差异，无新增审核实体差异；未更改该既有默认值。
- SKIPPED：本地全量 SDK 构建因工作区缺少 tsx/依赖而失败，使用项目原生 OpenAPI 转换器与 SDK 生成器定向更新现有操作和 MetaClientOptions；完整 Docker 构建已通过。
- 边界：没有对用户真实作品执行审核写入。下架及通知持久性在隔离数据库验证，通知客户端真实 WebSocket 送达、真正多数据库连接并发和全量测试套件未执行。

本地验证记录位于工作区外层 .community-validation/moderation-review-checks.json、frontend-moderation-review/verification-results.json、moderation-production/checks.json；生产截图位于 moderation-production。

更新说明候选：修复管理员审核入口，支持可切换的发布模式及带原因通知的违规下架。

## 保留的首页与社区功能

官网首页采用用户指定的 playful 风格，支持中文与英文。顶部三个入口为文本、图片、视频制作，游客须先登录本站账号；社区入口保持公开浏览。管理员可配置首页图片 / 原始动图或社区热门作品，保留既有制作链接和项目 Logo。

热门窗口分为左上主作品预览、右上内容 / 提示词与“做同款”、底部作品信息和点赞 / 在线评论。图片完整展示，视频手动播放。点赞与评论调用原生 Note 接口；爱心独立计数，已有其他表情时明确提示替换。做同款复制作者内容后进入对应制作页，需自行粘贴到第三方工具。

内嵌评论确认成功后清空草稿并刷新公开回复，结果不确定时保留草稿及重发锁；同一账号、同一作品的草稿支持站内路由往返，浏览器刷新不保留。隐藏、删除、带内容警告和非公开评论不进入首页列表，敏感媒体以最新匿名 Note 标记为准。

同时发布此前已完成、待上线的社区投稿与审核、图片 / 视频 / 文档 / Skill 上传、原生表情选择及登录弹窗焦点修复。新增 `CommunitySubmission1793808005308` 迁移，已在生产数据库执行。

## 首页展示设置（上轮记录）

已通过真实管理员登录，在后台保存 `homeShowcaseMode=popular`，并验证原来的展示图片和三个制作链接未被覆盖。上线时 `/api/community/featured` 返回 0 件符合条件的作品；首页按设计显示已保存图片或默认视觉。待社区作品审核通过后，热门窗口自动展示三个互动模块。没有向生产社区发布演示作品、评论或虚构互动数据。

## 上一轮审核部署备份与恢复

本轮备份目录：`/opt/ai-community-backups/moderation-20261105T011750Z`（目录时间为 UTC，对应北京时间 2026-11-05）。

已备份数据库、上传文件、私有配置、Compose、旧镜像引用和旧源码。数据库为 PostgreSQL 自定义格式，已用 `pg_restore --list` 验证可读取。本轮升级前镜像为 `sha-a807eea41ed135aa76db37ea65cfe2a25e0a2777`，保留在服务器。更新使用固定 SHA 镜像，启动失败时自动恢复旧引用；本次启动成功，未执行回滚。私有镜像拉取使用临时凭据目录，完成后已删除。

## 上一轮首页验证记录

- PASS：GitHub 完整 Docker 构建、服务器镜像拉取、版本核对及三个容器健康检查。
- PASS：新增社区投稿迁移已执行，`community_submission` 存在；没有该实体相关的剩余 DDL。
- PASS：本地实际 Vue 组件的 21 项作品窗口交互检查，以及 23 项首页、语言、动图、登录入口回归检查。
- PASS：Vue 独立评审；草稿恢复、发送状态及账号隔离另有 8 项 Vue 生命周期验证。
- PASS：作品组件及交互逻辑针对实际生成的 Note / 回复 / 反应 API 类型检查；中英文文案键与图片 URL 工具检查。
- PASS：改变文件的 ESLint、SPDX、locale safety 与 Git diff 空白检查。
- PASS：公网首页、公开社区、制作入口登录门控、真实管理员账号登录、首页设置保存和预览、中英切换及 390px 英文手机界面；浏览器无运行时错误。
- PASS：公网健康检查和源代码下载；下载归档与应用版本对应的本地 Git 归档一致。
- BASELINE：生产执行 `pnpm --filter backend check-migrations` 仍发现既有 `meta.proxyRemoteFiles` 默认值 false / true 差异，与之前部署记录一致；检查未修改数据库默认值，不将其报告为全部迁移检查通过。
- SKIPPED：生产环境直接发布、点赞和评论真实作品的写入验收，因为当前没有已审核作品；未为验收创建公开演示内容。本地使用真实组件、原生 API 参数和测试响应完成对应交互检查。
- SKIPPED：完整后端测试套件与整个仓库的前端类型检查；本机完整开发依赖和测试服务不齐。本次使用针对性检查及 GitHub 完整生产镜像构建验证，不将其等同于完整测试套件。

更新说明候选：新增中英文官网首页、可配置的社区热门作品三模块展示，以及就地点赞、评论和做同款入口。
