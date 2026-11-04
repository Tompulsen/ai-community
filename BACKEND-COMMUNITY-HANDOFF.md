# AI 社区后端改造记录

记录日期：2026-11-04。当前是源码改造，尚未部署，也未完成全栈联调。

## 当前需要对齐的并行改动

工作期间，`packages/frontend/src/pages/community.vue` 被外部改动替换，并新增 `pages/community/`。这组界面要求“先审核、后公开”，而本轮先实现的是基于官方频道的“发布后巡查审核”。外部改动已保留，未回滚。

新界面调用以下接口，本轮尚未实现：

- `community/works`
- `community/submissions/mine`
- `community/submissions/create`
- `admin/community/submissions`
- `admin/community/review`

新界面的 `resource` 分类与本轮配置中的 `knowledge` 对应。必须先统一审核方式和接口契约再联调。目前首页不能作为已完成的可用社区交付。新界面没有可用接口时应显示服务未接通，不能将模拟数据当作真实作品。

## 本轮已落地的后端能力

- 复用 Misskey 的账号、认证、附件、频道、作品、回复、用户管理、删帖鉴权和管理日志。
- `GET /ai-community.json` 只返回三个官方频道 ID。缺少配置时返回三个 null；配置损坏时返回 503，禁止泄露配置原文或令牌。
- `POST /api/admin/community/notes` 是管理员/版主专用的作品巡查接口，要求 `read:admin:abuse-user-reports` 权限。入参为 `module: video | image | knowledge`、可选 `limit`、`sinceId`、`untilId`。
- 审核查询只读取配置所指频道内的公开内容，绕过普通时间线的屏蔽、静音和实时缓存过滤，避免作者屏蔽审核员后漏审。
- 以 `detail:false`、`skipHide:true` 打包当前作品，不递归暴露关联私密回复或转发。投票选项单独查询并以只读方式呈现。
- 删除继续使用既有 `notes/delete`，服务端校验版主或作者身份。没有创建另一套登录或权限系统。
- 本轮不提供“待审、通过、驳回”状态，也不声称普通频道能保障先审后发。若采用先审后发，需要独立投稿存储、版本冲突保护、审核事务、附件访问策略和批准后的公开发布。

## 前端与 SDK

- `MkCommunityNav.vue` 提供三个固定导航；根据实际模块单独高亮，支持紧凑和横向模式，并补了 Storybook 状态。
- 已接入登录侧栏、横栏和访客布局；首页路由指向 `community.vue`，保留 `/welcome` 原入口和 `/timeline` 原时间线。
- `/admin/community` 为本轮发布后巡查页，包含模块筛选、内容/附件/投票展示、作者管理入口和确认删除。
- `packages/misskey-js/src/community-api.types.ts` 是独立 MIT 许可的分支端点类型，合并到 `api.types.ts`。未手动改写上游自动生成文件。
- 全量 SDK 生成未完成。依赖可用后必须运行 `pnpm build-misskey-js-with-types` 并核对生成结果；独立类型扩展不能替代该检查。
- 新增 `_aiCommunity` 文案经既有 `i18n` 系统使用。为遵守上游只手改 `ja-JP.yml` 的规则，本中文分支暂将该命名空间的中文作为回退文案；其他语言 YAML 未改。已用上游生成器重新生成 locale 类型。

## 官方频道初始化（仅在选择频道方案后）

前提：完整 Misskey 已启动、已创建管理员账号、数据库和 Redis 已连接，管理员允许创建频道。

在项目根目录使用 PowerShell：

```powershell
$env:MISSKEY_ADMIN_TOKEN = '<管理员访问令牌>'
node scripts/setup-ai-community.mjs --url http://localhost:3000
Remove-Item Env:MISSKEY_ADMIN_TOKEN
```

远程实例须使用 HTTPS。令牌需具备读取当前账号、读取频道和创建频道所需权限。脚本调用既有 API，生成 `.config/ai-community.json`；此文件仅含频道 ID，令牌不会持久化。服务按请求读取配置，无需为更换频道重新构建前端。

脚本支持排他锁、单文件备份、同目录临时文件原子替换和按频道保存进度。再次运行会验证已保存的频道。若进程在服务端已创建频道、配置尚未保存的窗口崩溃，应先检查已创建频道并手动填入对应 ID，避免产生孤立频道。遗留 `.lock` 只能在确认旧进程已结束后移除。

自托管容器需要将 `.config/ai-community.json` 放在后端实际运行目录的 `.config/`，多实例部署需同步同一份映射。不要按同名频道搜索绑定，以免被普通用户创建的同名频道混淆。

## 参考与复用

- Misskey 本地仓库：沿用 Vue、NestJS/Fastify、TypeORM/PostgreSQL 和 Redis；保留原 AGPL 版权头，SDK 子包沿用 MIT。
- Supabase 本地 README 和 Docker README：参考认证、数据、存储与运行服务分工；本轮未迁移账号到 Supabase，也未额外启动第二套后端。
- Galaxy：已查看 `Buttons/0x-Sarthak_hungry-penguin-30.html` 与 MIT 许可证，参考按钮反馈；实际控件复用 Misskey，未复制该组件源码。
- Taste / Impeccable：采用应用界面的信息层级、平面布局、现有主题变量、响应式布局、状态反馈与焦点规范。

## 验证结果与限制

- PASS：`node --test scripts/test-ai-community.mjs`，3 个测试覆盖公开配置白名单、非法/重复 ID、缺失/损坏配置、非管理员拒绝、失败续跑、并发锁及令牌不落盘。
- PASS：独立测试环境中对实际管理员端点处理函数进行 2 个测试，覆盖鉴权元数据、频道/公开范围、分页、个人屏蔽不影响查询和投票选项。ORM、认证框架为测试替身，不等同于真实 HTTP/数据库集成测试。
- PASS：6 个本轮修改的 Vue 文件通过模板、TypeScript 转译、SCSS Modules 编译及文案引用校验；locale 类型使用上游生成器生成。
- BLOCKED：完整依赖安装遇到网络权限错误 `EACCES / WinError 10013`。本机 Node 为 24.15.0，源码所声明的支持版本也高于本机。未通过完整构建、完整类型检查或 SDK 生成。
- BLOCKED：浏览器启动返回 `spawn UNKNOWN`，没有完成桌面/移动端实际视觉与交互验收。隔离界面测试脚本使用模拟 API，不能代替全栈验证。
- BLOCKED：上游 shipping 脚本缺少 `execa`；SPDX 脚本要求 Git 元数据，而当前目录为源码压缩包、没有 `.git`。本轮修改文件另做定向版权头与文案校验。

隔离验证工具位于项目上层 `.community-validation`，原文件备份位于项目上层 `.community-backups/20261104`。这些开发辅助文件不参与生产构建。

后续真实环境验收应覆盖：游客导航、管理员初始化、注册/登录、三社区发布与回复、普通账号不能删除他人内容、屏蔽审核员后的可审核性、投票与附件内容、删除失败恢复、桌面与手机布局。先审后发方案还必须验证未批准内容无法通过 API、时间线、文件地址或实时推送绕过审核公开。

候选更新日志：增加 AI 社区三模块导航、官方频道配置及管理员作品巡查能力。
