# 部署与验证记录（2026-11-04）

## 已上线

- 访问地址：<https://zaiduyu.top>。
- 服务器：`210.126.232.192`，部署目录 `/opt/ai-community`。
- 私有仓库：`Tompulsen/ai-community`，分支 `main`。
- 已部署应用提交：`b6e70fc60e8bd2a027124007bce8841b6ed5c74e`。
- 已拉取镜像：`ghcr.io/tompulsen/ai-community:sha-b6e70fc60e8bd2a027124007bce8841b6ed5c74e`。
- 镜像摘要：`sha256:0c17db69c7054a6e7fafc7c93182a1dea7182f04867cad09387bffb041603d30`。
- GitHub 构建工作流 `41815455846` 成功，服务器镜像的 OCI revision 与上述应用提交一致。
- Docker Compose 的应用、PostgreSQL 18、Redis 7 三个容器均为 healthy；数据库和 Redis 未发布公网端口，应用仅绑定 `127.0.0.1:13000`。

根域 A 记录已指向该服务器，Cloudflare 代理已开启；保留原有 `full` TLS 模式。
源站使用 Origin CA 证书和独立 Nginx 配置，Nginx 配置检查通过。
公网首页、`/healthz` 和 `/source/ai-community.tar.gz` 均返回 HTTP 200。
下载的源码归档对应上述运行中的应用提交，已排除生产凭据。
本次收尾仅更新部署文档，不更换已验收的应用镜像；后续文档提交号与应用镜像提交号可不同。

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
构建用的临时 2 GB swap 已移除，原有系统 swap 保留；收尾时磁盘约有 8.1 GB 可用，三项服务仍健康。
生产密码、数据库配置、管理员初始化凭据、Cloudflare 令牌和 TLS 私钥均未提交。

## 尚未完成的业务

社区作品、投稿及发布前审核 API 尚未完整实现，包括 `community/works`、
`community/submissions/create`、`community/submissions/mine`、
`admin/community/submissions`、`admin/community/review`。
首页因此显示“社区审核服务尚未接通，当前无法读取作品或提交审核”。
本次完成部署与账户系统，不代表上述业务流程已完成。
详见根目录 `BACKEND-COMMUNITY-HANDOFF.md` 和 `COMMUNITY_API_CONTRACT.md`。
