# AI 创作社区

使用 Vue 3、TypeScript、Vite、Vue Router 和 Lucide，从官方 Vite 模板开始实现。
社区前后端与创作业务统一保留在本项目。
来源及适配边界见 [REUSE.md](REUSE.md)。TypeScript + Fastify 后端直接复用原
PostgreSQL 表、Redis 命名空间和附件，保留原账号、作品及抽奖记录 ID。

项目统一包含社区前后端、`studio/` 工作台和 `services/documents/` 文档服务。
当前按测试开发环境快速替换网页服务，继续使用现有 Studio 与文档镜像。
业务范围及数据契约见 [MIGRATION.md](MIGRATION.md)。

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
| 创作 | 复用 Studio 文本、图片、视频、账号授权、同款带入与分享投稿 |
| 我的作品 | 草稿、待审核、已公开、未通过、收藏，编辑与删除 |
| 活动 | 原抽奖次数、任务、奖池、记录、幂等发奖与重试 |
| 社区 | 创作者、关注、个人作品、公告 |
| 账户 | 旧账号密码与 MFA、章鱼账号 PKCE、资料和可验证余额 |
| 管理 | 服务端权限、投稿审核、待审改稿、审计与违规处理 |

社区业务写入原数据库；没有示例作品、假生成或固定中奖结果。
原 Studio 浏览器聊天、草稿和图库不清除。上传当前单文件最多 20 MB。

## 开发边界

本版本仍用于测试开发。时间限制隐私采用保守隐藏；远程 S3 附件不抓取。
旧验证码供应商目前禁用，若配置启用则密码登录拒绝绕过验证。
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
