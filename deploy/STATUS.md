# 部署与验证记录（2026-11-04）

## 当前提交

本仓库保存社区项目源码、邮箱账户改造和 Docker Compose 部署文件。
沿用 Misskey 账户系统，数据库使用 PostgreSQL，缓存与队列使用 Redis。

邮箱注册要求用户名、邮箱和密码；支持邮箱或用户名登录。
按用户要求暂不启用邮件验证。未验证邮箱不能用于邮件找回密码。
生产密码、数据库配置、管理员初始化凭据、Cloudflare 令牌和 TLS 私钥均未提交。
部署步骤见 [README.md](README.md)。

## 已验证

- 服务器 Docker 构建中的后端、前端主站与嵌入页面编译通过；最后观察到的状态是最终镜像导出。
- 四个账户 Vue 组件的模板、TypeScript 转译、SCSS 和文案引用检查通过。
- 登录与注册处理函数的依赖隔离回归通过，覆盖邮箱规范化、匿名预检隐私、密码与凭据验证、用户名兼容和 MFA。
- SPDX 检查通过（2500 个受检文件）。
- 初次 Git 提交的源码检查未发现用户提供的生产密码或令牌；生产配置与私钥路径已排除。

## 尚未验证或完成

- 服务器管理连接受到代理出口 IP 轮换及面板白名单限制；尚未确认最终镜像导出、容器健康状态和管理员初始化结果。
- 实际 PostgreSQL 迁移、真实账户端到端验收、浏览器桌面/移动端验收待执行。
- 根域名尚未切换，新站 HTTPS 尚未启用。
- 本地依赖未完整安装，统一 shipping 检查因缺少 `execa` 无法运行；初次导入也没有上游 Git 基线。目标文件 ESLint 和数据库 schema 差异检查仍待执行。

## 既有业务缺口

社区作品、投稿及发布前审核 API 尚未完整实现，包括 `community/works`、
`community/submissions/create`、`community/submissions/mine`、
`admin/community/submissions`、`admin/community/review`。
本次账户与部署改造不代表这些业务流程已完成。
详见根目录 `BACKEND-COMMUNITY-HANDOFF.md` 和 `COMMUNITY_API_CONTRACT.md`。
