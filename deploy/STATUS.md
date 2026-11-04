# 部署与验证记录（2026-11-04）

## 已上线

- 访问地址：<https://zaiduyu.top>。
- 服务器：`210.126.232.192`，部署目录 `/opt/ai-community`。
- 私有仓库：`Tompulsen/ai-community`，分支 `main`。
- 已部署应用提交：`00605627f40c51572f3b9ecf953538e0623398a3`。
- 已拉取镜像：`ghcr.io/tompulsen/ai-community:sha-00605627f40c51572f3b9ecf953538e0623398a3`。
- 镜像摘要：`sha256:c5542650700dccd27ec84382b481da162918e93e35b9c5bc4d09fac7632f05de`。
- GitHub 构建工作流 `41850748115` 成功，服务器镜像的 OCI revision 与上述应用提交一致。
- Docker Compose 的应用、PostgreSQL 18、Redis 7 三个容器均为 healthy；数据库和 Redis 未发布公网端口，应用仅绑定 `127.0.0.1:13000`。

根域 A 记录已指向该服务器，Cloudflare 代理已开启；保留原有 `full` TLS 模式。
源站使用 Origin CA 证书和独立 Nginx 配置，Nginx 配置检查通过。
公网首页、`/healthz` 和 `/source/ai-community.tar.gz` 均返回 HTTP 200。
下载的源码归档对应上述运行中的应用提交，已排除生产凭据。
本次已更新上述应用镜像。收尾文档单独提交，不重复构建镜像；公开源码归档仍对应上述运行应用提交。

## 当前界面功能

- 侧栏统一为“社区”，其下依次为“文本制作 / 图片制作 / 视频制作”；社区内部作品分类保留。
- 独立网盘导航已取消，旧的网盘、文件和文件夹地址返回社区；附件上传及选择弹窗保留。
- 管理员通过“控制面板 → 制作页面链接”（`/admin/creation-links`）分别设置三个 HTTPS 网址与打开方式。
- 正式网址按用户要求暂时留空，已直接查询数据库确认三项均为 null。保存后制作页在整个工作区内打开，也可选择新窗口方式。
- 制作页始终保留新窗口入口。需要独立登录或禁止内嵌的外部工具可使用新窗口方式；未配置时不加载 iframe。
- 前后端拒绝非 HTTPS、含账号密码、本站同源及超长链接。仅管理员可写入，普通用户和匿名用户均不能修改。
- 使用既有 `meta.clientOptions` JSONB 保存六个可选字段，保留原品牌配置，无新数据库列或迁移。
- 上轮 Logo 上传、网盘选图、预览、保存与恢复默认已上线；工作区默认全宽，手机保留必要边距。本轮再次确认 Logo 上传按钮和文件选择弹窗可用。

## 本轮验收

- GitHub 完整 Docker 构建和镜像发布成功，服务器拉取精确 SHA 镜像并通过健康检查。
- 四个变更 Vue 页面的模板、TypeScript 转译、SCSS、文案引用通过。
- 32 个前后端真实 URL 校验用例通过；真实 update-meta 处理函数的局部合并、清空、非法链接原子拒绝通过。
- 新增/修改的五个后端文件以及 SDK 类型文件，定向 ESLint 均通过。
- 生产 OpenAPI 生成成功，请求与响应均包含六个可选字段，已同步 SDK 类型。
- 真实管理员界面保存三个网址及打开方式、刷新持久化、清空、保留品牌配置通过；真实 API 的非法 URL、非法打开方式、匿名与普通账号权限拒绝通过。
- 桌面与手机空态、工作区宽高、内嵌显示、新窗口无 opener、切换后销毁旧 iframe、拒绝内嵌时保留打开入口通过。外站使用测试浏览器内拦截的受控页面验证；尚未验证用户将来填写的第三方服务。
- 最终浏览器检查无页面运行错误。验收时的临时普通账户已从数据库删除，三项正式 URL 为空；管理员现有 Logo 保留。
- 变更前备份：`/opt/ai-community-backups/creation-links-20261104T145013Z`，含数据库、Compose、镜像版本与源码。

## 邮箱账户

沿用 Misskey 账户系统。注册填写用户名、邮箱和密码，支持邮箱或用户名登录。
邮箱去除首尾空格并统一为小写，数据库唯一索引阻止重复及并发重复注册。
管理员已按用户提供的账号文件初始化，使用该文件的用户名和密码登录；没有为管理员虚构邮箱。
按要求暂不启用邮件验证或 SMTP；未验证邮箱不能用于邮件找回密码。

## 已通过的验收

- GitHub Docker 完整构建；服务器实际拉取并运行指定版本镜像。
- 邮箱唯一索引迁移已执行，数据库索引为 unique 且 valid。
- 真实数据库及 API：管理员登录和角色、邮箱注册、未验证邮箱状态、大小写和首尾空格兼容登录、错误密码拒绝、缺失或非法密码拒绝、重复及并发重复邮箱防护、邮箱修改唯一性、普通账户不能访问管理接口。
- 桌面浏览器：通过真实界面注册成功。
- 手机浏览器（390 × 844）：大写邮箱登录、刷新保持会话、无横向溢出；本次浏览器流程无 JavaScript 运行错误。
- 四个账户 Vue 组件的模板、TypeScript 转译、SCSS 和文案引用检查。
- 镜像内运行 `node scripts/test-email-auth.mjs`：邮箱规范化、匿名预检隐私、密码验证、用户名兼容、MFA 及非法凭据回归。
- SPDX 检查（2500 个受检文件）；配置生成的 LF 换行检查。
- 真实 API 和浏览器验收创建的三个临时账户已从数据库删除。

## 开发检查限制

- 本轮完整 SDK 重生成命令因本机缺少 `tsx` / `esbuild` 未完成。已最小同步对应类型，并使用生产镜像生成 OpenAPI 验证新增字段；不将该检查表述为完整 SDK 构建通过。
- 本轮生产定向后端和 SDK ESLint 通过；前端 ESLint 仍受下述缺少解析器影响。数据库检查仍只报告下述已有默认值差异，没有新增 DDL。

- 数据库 schema 差异检查尚不为零：仅报告 `meta.proxyRemoteFiles` 默认值为 false，而模型声明为 true。该差异来自原有配置迁移与模型默认值，不涉及本次邮箱索引；本次未修改旧迁移或切换此业务设置。
- 定向后端 ESLint 在将检查进程堆上限提高到 1536 MB 后执行完成；六个生产认证源文件没有错误，`packages/backend/test/utils.ts` 的 448、658 行各有一处 `no-async-promise-executor` 错误，整体命令退出码为 1。
- 生产镜像缺少 `vue-eslint-parser`，前端 ESLint 无法运行；不能将上述组件编译检查视为 ESLint 通过。
- 本机依赖未完整安装，统一 shipping 检查因缺少 `execa` 未能运行。

## 运维交接

生产镜像固定在 `deploy/private/release.env`。在 `/opt/ai-community` 执行维护命令时使用：

```sh
docker compose --env-file deploy/private/release.env -f deploy/compose.yml ps
docker compose --env-file deploy/private/release.env -f deploy/compose.yml logs --tail=100 web
```

更新前备份数据库和当前镜像版本，再拉取已经构建成功的提交标签。保留命名卷，勿执行 `down -v`。
数据库及部署配置备份位于 `/opt/ai-community-backups`。
临时 GHCR 令牌、临时 Docker 登录目录和容器内管理员初始化文件已清理。
构建用的临时 2 GB swap 已移除，原有系统 swap 保留；本轮更新后磁盘约有 7.0 GB 可用，三项服务仍健康。
生产密码、数据库配置、管理员初始化凭据、Cloudflare 令牌和 TLS 私钥均未提交。

## 尚未完成的业务

社区作品、投稿及发布前审核 API 尚未完整实现，包括 `community/works`、
`community/submissions/create`、`community/submissions/mine`、
`admin/community/submissions`、`admin/community/review`。
首页因此显示“社区审核服务尚未接通，当前无法读取作品或提交审核”。
本次导航、制作链接配置、Logo 与账户系统更新不代表上述业务 API 已完成。
详见根目录 `BACKEND-COMMUNITY-HANDOFF.md` 和 `COMMUNITY_API_CONTRACT.md`。
