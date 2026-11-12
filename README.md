# 章鱼社区

使用 Vue 3、TypeScript、Vite、Vue Router 和 Lucide，从官方 Vite 模板开始实现。
社区前后端与创作业务统一保留在本项目。
来源及适配边界见 [REUSE.md](REUSE.md)。TypeScript + Fastify 后端直接复用原
PostgreSQL 表、Redis 命名空间和附件，保留原账号、作品及抽奖记录 ID。

项目统一包含社区前后端、`studio/` 工作台和 `services/documents/` 文档服务。
当前按测试开发环境快速替换网页服务，继续使用现有 Studio 与文档镜像。
业务范围及数据契约见 [MIGRATION.md](MIGRATION.md)。

社区入口为 `https://www.zhangyuapi.com`，创作台位于 `/create`，
内部工作台通过同源 `/studio` 代理。账号中心继续使用 `https://zhangyuapi.com`。
旧社区域名 `zaiduyu.top` 已停用，不再跳转至新入口。

## 本地运行

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 18775 --strictPort
```

访问 `http://127.0.0.1:18775/discover`。

```sh
npm run build
npm test
npm run test:server
npm run test:e2e
```

浏览器测试使用当前 Windows 电脑安装的 Microsoft Edge；其他环境需先调整
`playwright.config.ts` 中的浏览器路径。

## 容器镜像

推送 `main` 分支会通过 GitHub Actions 的 `Build container` 工作流构建并发布
社区和创作台的 `linux/amd64` 镜像，也可以在 Actions 页面手动运行该工作流。

```sh
docker pull ghcr.io/tompulsen/ai-community:latest
docker pull ghcr.io/tompulsen/ai-community-studio:latest
```

每次构建同时保留 `sha-<完整提交 SHA>` 标签，便于固定版本和回退。
首次发布后请在 GitHub Packages 检查镜像可见性：公开镜像可直接拉取；
私有镜像需要先登录 GHCR，密码使用有 `read:packages` 权限的 GitHub 令牌。

```sh
docker login ghcr.io -u <GitHub用户名>
docker pull ghcr.io/tompulsen/ai-community:latest
```

在容器管理面板中更新镜像并重建服务，沿用现有数据库、Redis、配置文件和附件挂载。
社区镜像包含社区前端和后端，Studio 镜像由同一次工作流构建并使用相同提交标签；
文档服务继续沿用现有镜像。
配置路径、附件路径和 Studio 上游设置见下文。

## 后端运行

后端使用 Node.js 24 直接运行 TypeScript；`npm run build` 包含严格后端类型检查。
入口为 `server/runtime.ts`，业务模块统一使用 `server/types.ts` 的请求上下文。
Fastify 管理路由、JSON 解析、对象校验、鉴权钩子和错误响应。
Studio 在请求解析前转发原始流；媒体通过 Fastify Reply 保留 HEAD 和 Range。

将服务器原配置只读挂载到 `/app/.config/default.yml`，附件卷挂载到
`/app/files`。原配置中的 `url`、`db`、`redis` 和 `newApiSso` 继续使用；
启动不会重建数据库。禁止提交真实配置、令牌和数据库快照。

```sh
CONFIG_PATH=/app/.config/default.yml FILES_ROOT=/app/files npm start
```

`COMMUNITY_STUDIO_UPSTREAM` 默认为 `http://studio:3000`。`/studio` 和原 OAuth
回调继续由同源入口代理。健康接口 `/healthz` 检查数据库和 Redis。

## 当前业务

| 页面 | 接入能力 |
| --- | --- |
| 发现 | 五列桌面、两列手机网格，分类、搜索、标签、排序 |
| 作品详情 | 原比例图片、实际视频播放、文本资源、收藏、点赞、带入创作 |
| 创作 | 复用 Studio 文本、图片、视频、统一账号会话、同款带入与分享投稿 |
| 我的作品 | 草稿、待审核、已公开、未通过、收藏，编辑与删除 |
| 活动 | 原抽奖次数、任务、奖池、记录、幂等发奖与重试 |
| 社区 | 创作者、关注、个人作品、公告 |
| 账户 | 章鱼账号统一登录、个人资料和可验证余额 |
| 管理 | 服务端权限、投稿审核、待审改稿、审计与违规处理 |

社区业务写入原数据库；没有示例作品、假生成或固定中奖结果。
原 Studio 浏览器聊天、草稿和图库不清除。上传当前单文件最多 20 MB。

## 统一登录

社区仅使用章鱼账号。登录表单调用现有 Studio 账号接口，成功后由社区后端
核实该会话并按 `(issuer, subject)` 复用原账号映射；首次使用自动建立社区资料。
已有 Studio 登录可直接恢复社区身份，不再打开独立授权窗口。
社区不保存章鱼密码，也不向浏览器返回模型密钥或账号访问、刷新令牌。

创作台的不同页面通过受验证的 context 共用同一 Studio 会话和刷新锁，
不复制刷新令牌、不重复请求授权。账号切换后旧社区身份和创作上下文失效。
注册、找回密码和密码设置统一到账户中心；社区原密码与注册接口已关闭，
原数据库记录保留，未绑定的旧账号不会按同名或邮箱自动合并。

此变更同时涉及社区和 `studio/` 源码，发布时需协调更新两个服务镜像。
本地测试和隔离接口测试不等于服务器已部署，也不替代真实账号及付费生成验收。

## 开发边界

本版本仍用于测试开发。时间限制隐私采用保守隐藏；远程 S3 附件不抓取。
章鱼账号启用的人机验证或额外身份验证由原账号服务校验，社区不绕过。
余额仅在同一章鱼账号会话可验证时显示，无法核验时返回空值。

抽奖 API 会实际扣次数并按原幂等规则发放，不能将测试请求当作无副作用操作。
候选环境禁用发奖密钥及自动重试；实际 OAuth 与付费生成需单独实测。

部署前保留数据库快照和配置；回退使用新系统的上一版本镜像。
数据卷不能随容器重建删除。

## 设计与素材

设计依据为用户提供的 `awesome-design-md` 参考集：Linear 的层级与密度、
Pinterest 的作品展示、Runway 的详情阅读。应用自己的统一规范见 `DESIGN.md`。
已移除无引用的模板与演示媒体；来源记录见 `ASSETS.md`，
依赖及复用声明见 `THIRD_PARTY_NOTICES.md`。

复用后端保留原 AGPL 声明与 LICENSE。Studio 和文档模块保留各自许可证与署名。
