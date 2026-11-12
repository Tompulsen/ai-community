# 单项目全栈与数据迁移

状态：用户确认无正式用户，按测试开发环境快速切换前后端。
TypeScript + Fastify 后端已接入身份、作品、审核、互动、附件、抽奖与章鱼账号；
前端改用真实 API，Studio 账号和创作协议迁入本地 Vue/Fastify 模块，文档服务独立保留。
直接沿用原表、ID、Redis 和附件，无需重新导入或运行旧 migration。
切换结果以服务器部署记录和关键接口检查为准，不宣称已完成全量业务验收。

## 最终形态

唯一业务项目为 `ai-community-next`：社区前端、后端和复用的业务模块在同一仓库
管理，统一账号、API、访问入口和发布流程。社区和创作页面使用 Vue 3，
由一个 Fastify 进程托管前端及本地 `/api/creation/*`、`/api/new-api/*`。
构建工作流只发布社区镜像，不引入额外前端或后端框架。
`studio/` Next.js/React 源码保留作兼容规则与第三方来源参考，
被 `.dockerignore` 排除，也不由当前 Dockerfile 构建或复制进运行镜像。

保留 PostgreSQL、Redis、附件存储等基础设施。章鱼账号继续使用现有账户与模型
网关服务，其余额是权威账本；社区不另建一份可独立修改的余额。
本轮合并的是社区和创作网页服务；PostgreSQL、Redis、文档服务与 New API
账户及模型网关继续独立运行，不随退役 Studio 容器删除。

## 复用边界

按用户确认，社区基础服务独立实现，已有业务代码优先复用，
仅调整它们的身份、权限、内容、媒体、会话和事件接口。
账号会话、模型请求协议、生成任务恢复、抽奖、标签、审核及文档链路优先复用。
`server/native-account/` 从原 Studio 账号模块适配到标准 Request/Response；
原生创作保留已有媒体抓取、任务和代理生命周期规则。
来源与适配清单见 REUSE.md；许可证和署名按实际文件保留。

## 业务迁移清单

| 业务 | 需要承接的数据与行为 | 验收 |
| --- | --- | --- |
| 身份与权限 | 用户、邮箱、原密码记录、角色、封禁、外部账号绑定 | 章鱼账号按原绑定登录；封禁生效；越权读写拒绝 |
| 作品与文件 | 作品、正文、类别、标签、提示词、参考图、来源链、原图与缩略图 | 各状态计数一致，附件大小及 SHA-256 一致，旧链接可访问 |
| 发布与审核 | 草稿、投稿幂等键、发布模式、待审改稿、审核人、原因与版本 | 发布稿不被待审内容覆盖；重复提交不重复创建 |
| 社区互动 | 帖子、评论、收藏、点赞、关注、屏蔽、静音 | 关联完整；不能只复制总数；私密内容保持原可见范围 |
| 通知与私信 | SQL中的聊天记录、Redis通知流及已读位置 | 已读状态与收件人权限正确；保留有数据的关系 |
| 活动与奖励 | 签到/邀请、抽奖次数、任务进度、奖池、中奖状态、凭证、审计 | 次数守恒；重复请求与超时重试不重复发奖 |
| 创作工作台 | 原生文本、图片、视频、上传、当前账号历史、模型及账户联动 | 无二次登录和密钥配置；真实扣费另行核对；不自动重放不确定的付费提交 |
| 站点管理 | 公告、品牌、分类、上传限制、业务设置 | 权限和原设置保留，前端使用真实接口 |

按用户在开发阶段的明确要求，社区二步验证和恢复码功能已移除。
历史数据库字段保留，新系统不再读取、写入或校验这些字段。

社区登录统一使用章鱼账号，原社区密码、注册及密码重置写入口关闭。
已绑定账号继续复用原社区用户 ID；首次使用章鱼账号时建立社区资料。
未绑定的旧用户、作品和权限记录保留，不按用户名或邮箱自动合并。
登录由本地 `/api/new-api/*` 建立原格式账号会话，再由社区服务核实账号映射。
`octopus_new_api_session` Cookie、`octopus:new-api:` Redis 前缀、
`NEW_API_SESSION_SECRET` 和原 Redis 数据库保持不变，继续使用同一刷新链及锁。
创作接口直接读取该会话，服务端复用或恢复当前账号所需密钥，不再经过 iframe
context、启动码或第二次授权。此版本只发布社区镜像；部署状态以实际切换记录为准。

## 必须保持的关系

- 保留旧用户、文件、作品、帖子和抽奖记录 ID，另记录新旧映射及来源版本。
- `community_submission.approvedNoteId` 指向 `note`；评论、收藏、点赞依赖
  帖子 ID。导入作品不能通过重新发布生成不同 ID。
- 校验数组和 JSON 内的 `fileIds`、`tagIds`、`referenceFileIds`、
  `sourceWorkId`、`sourceCommentId` 与 `pendingRevision`，不仅检查 SQL 外键。
- `external_account` 的 `(issuer, subject)` 身份键和 `(issuer, userId)`
  唯一关系保留。邮箱相同不等于同一账号。
- 抽奖 `balance` 是次数，不是金额。保留 `progress.works`，避免重算权益重复加次数。
- 保留发奖引用 `community_lottery_<drawId>_<index>`、奖项顺序、requestId、
  creditIssuer/Subject、重试状态及到账凭证。已到账不重放。
- 原发奖请求还带旧站 origin 的 client_id。更换域名前，必须核对账户服务的
  幂等键范围；不能直接用新 client_id 重发旧 pending 奖励。
- 章鱼账号余额、密钥和用量仍归账户服务；迁移账号映射和发放凭证，不从中奖记录
  重建余额。已有普通账号会话由原密钥和 Redis 原地读取，
  不把刷新令牌复制成另一份独立会话；旧 iframe 专用会话不能充当普通登录凭据。

## 数据位置

PostgreSQL 核心范围包括 `user`、`user_profile`、`external_account`、
`drive_file`、`note`、`community_submission`、`community_tag`、
`note_favorite`、`note_reaction`、关注/治理关系及四张 `community_lottery_*` 表。
公告、私信、角色、moderation_log 和 meta 配置也按实际数据盘点，不静默丢弃。

Redis 中存在通知 Stream、已读位置、反应缓冲及会话。冻结快照前排空写入缓冲或
将其纳入迁移。账号会话保留原 Redis 数据库、前缀和密封密钥，
社区会话仍按外部账号 ID、Cookie 指纹及现有映射验证，不按用户名猜测归属。

旧 Studio 的聊天、图库、视频草稿和未发布内容部分在浏览器 IndexedDB /
localStorage。原生工作台只读取当前已验证数字账号 ID 对应的精确命名空间：

- 任务：`octopus:user-<accountId>:task:*`。
- 视频结果：`octopus:user-<accountId>:video-workspace-results`。
- 图片：IndexedDB `octopus-gallery-user-<accountId>` 中的记录和原文件。

原生历史另存为 `octopus:user-<accountId>:native-creation-history`，不删除原记录。
不自动读取访客、无命名空间或其他账号的数据；旧聊天与未支持的草稿保持原样。
浏览器数据受来源隔离，单纯迁移服务器数据库不能读取其他域名上的浏览器存储。
无法确认的历史任务保留记录，不自动再次发起付费生成。

## 实施顺序

1. 保留 SQL、Redis、附件和原配置，不运行旧数据库初始化或重复导入。
2. 将原 Studio 的账号上游、会话密钥和 Redis 连接原值配置到社区容器；
   图片及异步上游存在专用配置时同步沿用。
3. 构建带提交 SHA 的单社区镜像，先检查候选环境的账号和原生创作接口。
4. 按上线指令切换入口，移除旧 `/studio` 上游代理；旧页面 GET/HEAD 由社区
   跳转 `/create`，旧 iframe 启动/交换/上下文接口返回 410。
5. 核实同一账号、历史数据及余额比例，再停用独立 Studio 容器。
   `/studio/api/new-api/*` 是进程内兼容别名，不依赖旧容器。
6. 保留前一版本镜像及配置用于回退，不删除 PostgreSQL、Redis、文档服务、
   New API 或附件数据卷。真实付费生成与扣费按单独授权验收。

## 当前工具与验收边界

`migration/inspect-legacy.sql` 是独立编写的 PostgreSQL 只读盘点脚本。
它强制只读事务并回滚，只输出计数、状态及断链数量，不输出用户、密码或令牌。
`allTableEstimates` 是统计估计，不用于正式迁移验收；核心表计数为精确查询。

该脚本不导出明文账号、不复制文件、不导入新库、不触发到账，也不执行部署。
源码清点不等于迁移完成；真实迁移以隔离演练和切换验收结果为准。

## 清点依据

数据库结构、首次只读基线及现用服务实现共同作为数据契约。
业务来源与署名按 REUSE.md 记录，当前实现入口为：

- `server/{auth,content,account,lottery,runtime,types}.ts`
- `server/native-account/`、`server/creation.ts`、`server/creation-contract.ts`
- `src/native-studio.ts`、`src/components/StudioWorkspace.vue`
- `server/business/{lottery,ads}.ts`
- `studio/docs/new-api-account.md`、`studio/docs/local-data.md`

独立实现和业务兼容不消除第三方依赖、素材或后续复用代码的授权要求。

## 首次生产只读基线

2026-11-12 02:01（Asia/Shanghai）的只读事务返回：
12 条用户记录、21 条作品投稿（19 published / 2 approved）、43 条文件记录、
27 条帖子、7 条账号绑定、7 条点赞、1 条收藏及 3 条关注。
抽奖有 5 条记录、剩余次数合计 6；奖项状态为 4 fulfilled / 1 empty，
其中 1 个奖项含 creditReceipt，当前无 creditPending 记录。

本次检查的作品作者、帖子、附件、标签和外部账号用户关系断链计数均为 0。
这些是数据库记录数，不等于已完成物理文件和全部 JSON 引用校验。
原始机器可读结果在 `.impeccable/migration/legacy-readonly-inventory.json`；
脚本在只读事务内执行后回滚，没有写入或导入数据。
