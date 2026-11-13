# 章鱼社区

使用 Vue 3、TypeScript、Vite、Vue Router 和 Lucide，从官方 Vite 模板开始实现。
社区前后端与创作业务统一保留在本项目。
来源及适配边界见 [REUSE.md](REUSE.md)。TypeScript + Fastify 后端直接复用原
PostgreSQL 表、Redis 命名空间和附件，保留原账号、作品及抽奖记录 ID。

社区页面与创作台统一使用 Vue，由同一个 Fastify 进程提供接口和构建后的前端，
只发布一个社区镜像。旧 `studio/` Next.js/React 源码保留为业务和来源参考，
不参与当前构建，也不复制进社区镜像。文档服务、PostgreSQL、Redis 和
New API 账户与模型网关继续独立保留。业务及数据契约见 [MIGRATION.md](MIGRATION.md)。

社区入口为 `https://www.zhangyuapi.com`，创作台位于 `/create`，
创作页面直接调用本地 `/api/creation/*` 与 `/api/new-api/*`。
账号中心继续使用 `https://zhangyuapi.com`。
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
一个社区 `linux/amd64` 镜像，也可以在 Actions 页面手动运行该工作流。

```sh
docker pull ghcr.io/tompulsen/ai-community:latest
```

每次构建同时保留 `sha-<完整提交 SHA>` 标签，便于固定版本和回退。
首次发布后请在 GitHub Packages 检查镜像可见性：公开镜像可直接拉取；
私有镜像需要先登录 GHCR，密码使用有 `read:packages` 权限的 GitHub 令牌。

```sh
docker login ghcr.io -u <GitHub用户名>
docker pull ghcr.io/tompulsen/ai-community:latest
```

在容器管理面板中更新镜像并重建服务，沿用现有数据库、Redis、配置文件和附件挂载。
社区镜像包含社区前端、原生创作台与 Fastify 后端。工作流不再构建 Studio 镜像；
文档服务继续沿用现有独立镜像。切换旧服务的步骤见 [MIGRATION.md](MIGRATION.md)，
镜像发布本身不代表服务器已完成更新。

## 后端运行

后端使用 Node.js 24 直接运行 TypeScript；`npm run build` 包含严格后端类型检查。
入口为 `server/runtime.ts`，业务模块统一使用 `server/types.ts` 的请求上下文。
Fastify 管理路由、JSON 解析、对象校验、鉴权钩子和错误响应。
原生创作接口在服务端验证账号、参数与任务归属，再请求模型网关；
媒体通过 Fastify Reply 处理 HEAD 和 Range。

将服务器原配置只读挂载到 `/app/.config/default.yml`，附件卷挂载到
`/app/files`。原配置中的 `url`、`db`、`redis` 和 `newApiSso` 继续使用；
启动不会重建数据库。禁止提交真实配置、令牌和数据库快照。

```sh
CONFIG_PATH=/app/.config/default.yml FILES_ROOT=/app/files npm start
```

将原 Studio 的下列账号配置移到社区容器，保持值不变：

| 配置 | 用途 |
| --- | --- |
| `NEW_API_BASE_URL` | 账户及模型网关内部地址 |
| `NEW_API_PUBLIC_URL` | 章鱼账户中心公开来源 |
| `NEW_API_SESSION_SECRET` | 原加密会话密钥，切换时不能重新生成 |
| `NEW_API_REDIS_URL` | 原账号会话使用的 Redis 数据库 |
| `NEW_API_IMAGE_BASE_URL`、`NEW_API_ASYNC_BASE_URL` | 已配置时沿用图片或异步任务专用上游 |

`server/native-account/` 原地读取 `octopus_new_api_session` Cookie 和
`octopus:new-api:` Redis 记录，保留原刷新锁及 `iron-session@8.0.4` 密封格式。
不需要 `COMMUNITY_STUDIO_UPSTREAM`，也不需要启动 Next.js 服务。
旧 `/studio` 页面 GET/HEAD 跳转 `/create`；`/studio/api/new-api/*` 仅作为本地
账号接口兼容别名。旧 iframe 启动、交换和上下文接口返回 410。
健康接口 `/healthz` 检查数据库和 Redis。

页面与静态资源不依赖账号存储读取，账号服务短暂故障时仍可打开登录页；业务接口与
附件继续按原规则鉴权。镜像构建会先运行单元测试和服务端测试，再执行类型检查与构建。

管理员可在“站点设置”修改社区名称和 Logo，在“社区设置”调整审核、推荐和上传限制。
设置沿用原数据库配置；站点、社区和广告编辑使用版本检查，冲突时保留表单草稿。
旧 `communityUploadLimits` 会按原分类读取，单独修改品牌不会重置其他配置。

上传或缩略图发布时若数据库提交响应中断，后端会保留可能已被引用的文件，并记录
`UPLOAD_COMMIT_UNCERTAIN` 或 `MEDIA_PUBLISH_UNCERTAIN`（含文件编号和存储键）。
这类少量保留文件需在数据库恢复后核对引用再清理，不能仅凭请求失败删除；已确认的
提交前失败与租约失效仍会清理临时文件。

## 当前业务

| 页面 | 接入能力 |
| --- | --- |
| 发现 | 五列桌面、两列手机网格，分类、搜索、标签、排序 |
| 作品详情 | 原比例图片、实际视频播放、文本资源、收藏、点赞、带入创作 |
| 创作 | 原生 Vue 文本、图片、视频工作台，统一账号会话、同款带入与分享投稿 |
| 我的作品 | 草稿、待审核、已公开、未通过、收藏，编辑与删除 |
| 活动 | 原抽奖次数、任务、奖池、记录、幂等发奖与重试 |
| 社区 | 创作者、关注、个人作品、公告 |
| 账户 | 章鱼账号统一登录、个人资料和可验证余额 |
| 管理 | 服务端权限、投稿审核、待审改稿、审计与违规处理 |

社区业务写入原数据库；没有示例作品、假生成或固定中奖结果。
原 Studio 浏览器聊天、草稿和图库不清除。原生创作只读取当前已验证章鱼账号的
精确历史命名空间；无归属记录与其他账号数据不自动导入。上传限额按站点分类、角色策略
与服务器文件上限共同约束，未配置的分类默认 20 MB。
内嵌图片结果保存在当前浏览器；超过 1 MiB 的结果不进入服务端响应缓存。
若这类响应中断且没有上游任务编号，记录会要求核对，不会自动再次付费生成。

## 统一登录

社区仅使用章鱼账号。登录表单调用同一 Fastify 进程中的 `/api/new-api/*`，
成功后由社区后端核实会话并按 `(issuer, subject)` 复用原账号映射；
首次使用自动建立社区资料。配置保持一致时，已有普通 Studio 登录 Cookie
继续使用，不建立第二条刷新链，也不打开独立授权窗口。
社区不保存章鱼密码，也不向浏览器返回模型密钥或账号访问、刷新令牌。

社区登录后可直接进入创作，无需再次登录、授权或手动配置模型密钥。
服务端读取当前账号的可用密钥；未选择密钥时复用或恢复该账号的系统 Auto 密钥，
不回退到管理员或共享密钥。账号切换后旧身份、请求和本地创作视图失效。
注册、找回密码和密码设置统一到账户中心；社区原密码与注册接口已关闭，
原数据库记录保留，未绑定的旧账号不会按同名或邮箱自动合并。

此版本仅需构建社区镜像；完成服务器切换后可停用独立 Studio 容器。
本地测试和隔离接口测试不等于服务器已部署，也不替代真实账号及付费生成验收。

## 开发边界

本版本仍用于测试开发。时间限制隐私采用保守隐藏；远程 S3 附件不抓取。
章鱼账号启用的人机验证或额外身份验证由原账号服务校验，社区不绕过。
余额仅在同一章鱼账号会话可验证时显示，无法核验时返回空值。

抽奖 API 会实际扣次数并按原幂等规则发放，不能将测试请求当作无副作用操作。
候选环境禁用发奖密钥及自动重试；真实账号登录与付费生成需单独实测。

部署前保留数据库快照和配置；回退使用新系统的上一版本镜像。
数据卷不能随容器重建删除。

## 设计与素材

设计依据为用户提供的 `awesome-design-md` 参考集：Linear 的层级与密度、
Pinterest 的作品展示、Runway 的详情阅读。应用自己的统一规范见 `DESIGN.md`。
已移除无引用的模板与演示媒体；来源记录见 `ASSETS.md`，
依赖及复用声明见 `THIRD_PARTY_NOTICES.md`。

复用后端保留原 AGPL 声明与 LICENSE。Studio 和文档模块保留各自许可证与署名。
