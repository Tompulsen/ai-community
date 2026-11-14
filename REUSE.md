# 业务复用与适配边界

用户确认：最终只使用一个项目；原数据与前后端业务迁入新项目。
社区基础服务独立实现，已有创作与运营业务优先复用。
用户随后确认按测试开发环境快速替换前后端，直接沿用原数据。

社区工具入口参考用户截图及本地 `community-studio-ui` 的 `MkLaunchPad.vue` / `navbar.ts`
图标网格与未读提示交互，使用本项目已有 header-menu、Vue Router、Lucide 与 inbox 状态实现。
本次不迁入参考项目的菜单源码、运行时依赖或未接入的业务模块。

2026-11-13 运营体验完善继续复用本项目的原生 dialog、Vue Router 离开守卫、
公共身份映射、PostgreSQL 管理记录与 ID 时间编码，以及 Redis 通知流。
新增 `notification-inbox.ts` 整理现有通知处理，保留旧全局已读水位和单条已读语义，
按保留通知统计与分页；公告批量已读使用短期账号快照，当前权限与可见性仍在写入时检查。
`admin-insights.ts` 读取现有表，不新增数据库字段；日志仅输出逐类型白名单摘要。
没有引入新依赖，也没有迁入参考项目的整个管理系统。

## 分类

| 范围 | 处理方式 | 接入边界 |
| --- | --- | --- |
| 用户、会话、角色、帖子、文件、通知、流事件 | 独立实现 | 保留身份、权限、内容和数据契约 |
| 抽奖纯规则与到账凭证校验 | 已迁出到 `server/business/lottery.ts` | 仅依赖 `node:crypto`；规则和计算保持不变 |
| 广告配置清洗 | 已迁出到 `server/business/ads.ts` | 接入本项目配置存储 |
| 抽奖事务、发放、重试与审计 | 保留业务，替换适配接口 | 用户/权限、关系计数、账号映射、HTTP、ID与日志 |
| 投稿、修改、标签、审核及违规治理 | 保留业务，替换适配接口 | 用户、内容、媒体、权限、封禁与事件 |
| 章鱼账号登录与身份映射 | 将 Studio 账号模块迁入 `server/native-account/` | 保留 Cookie、Redis、密封密钥及刷新链；按 issuer/subject 复用原绑定 |
| 文本、图片/视频生成、图库与任务恢复 | 复用协议、媒体与任务规则，接入原生 Vue/Fastify | 本地 `/api/creation/*`；当前账号历史按精确命名空间读取，旧数据不清除 |
| Word/Excel 文档引擎与版本处理 | 复用现有实现 | 从可信会话派生 owner，接入新后端；按实际来源保留声明 |

社区与创作台同用 Vue 3，由一个 Fastify 进程承接页面、账号与创作 API。
`server/native-account/` 直接读取原普通登录 Cookie `octopus_new_api_session`，
沿用 `octopus:new-api:` Redis 会话、原 `NEW_API_SESSION_SECRET` 和原刷新锁。
社区登录后进入创作无需再次登录、授权或手动配置模型密钥；
密钥由服务端按当前账号取得，无可用选择时复用或恢复该账号的系统 Auto 密钥。
不回退到管理员或共享模型密钥，不向浏览器返回访问、刷新或模型令牌。
`src/turnstile.ts` 复用 `studio/app/utils/turnstile.ts` 的账号验证码脚本加载逻辑，
避免社区开发页面跨 `/studio` 源码路径加载，并保留原有超时、重试和单次加载规则。
当前构建只发布社区镜像，旧 `/studio` 页面跳转 `/create`，
旧 iframe 启动、交换与上下文接口返回 410。`studio/` 保留为源码及来源参考，
不进入社区镜像，也不再单独构建；数据库、Redis、文档及 New API 服务继续独立。

## 第一批代码来源

| 新文件 | 原项目来源 | 原始 SHA-256 |
| --- | --- | --- |
| `server/business/lottery.ts` | `packages/backend/src/misc/community-lottery.ts` | `e8584af0eac700194b24aecb08484ae12d8db3b19fffed9c98f470949b07d873` |
| `server/business/ads.ts` | `packages/backend/src/misc/community-ads.ts` | `faaab3eba36d2ade63cd00c260cc0de300517b5586bb7be80aa97296ef7fba73` |

两份业务源码按原字节迁入，不修改算法、默认配置或现有 SPDX 声明。
本地 Git 历史中，抽奖模块于 `6f113b7`（2026-11-10）加入，广告模块于
`aee9597`（2026-11-06）加入；加入时间不是原创权或重新许可结论。

相邻 `*.test.ts` 来自旧项目对应测试，仅调整模块路径和测试运行器导入。
与旧接口 schema/Ajv 包装耦合的两个用例没有直接搬入，
后续实现新接口时需补对应输入边界测试；业务算法用例保留。

## 原生创作代码来源

| 当前代码 | 原 Studio 来源 | 适配内容 |
| --- | --- | --- |
| `server/native-account/{config,client,session,model-groups,model-pricing,relay}.ts` | `studio/app/lib/new-api/` 同名模块 | 标准 Request/Response、同进程鉴权，保留加密、锁、分组及额度规则 |
| `server/native-account/routes.ts` | `studio/app/api/new-api/[...path]/route.ts` | 本地 `/api/new-api/*`，移除 iframe/SSO 交换；钱包路由后续从用户指定的 octopus_chat 恢复 |
| `server/native-account/{pricing,request-body}.ts` | `studio/app/utils/{model-pricing,request-body}.ts` | 保留价格计算与有界请求读取 |
| `server/creation/{public-media,proxy-lifecycle}.ts` | `studio/app/utils/{public-image-fetch,proxy-lifecycle}.ts` | 复用媒体访问边界与请求取消生命周期 |
| `server/creation-contract.ts` | `studio/app/utils/{video-api,local-tasks}.ts` | 复用生成协议、任务地址及状态规则 |
| `src/native-studio.ts` | 原 Studio 的账号命名空间、图库和视频结果数据契约 | Vue 任务状态、精确账号历史读取与本地持久化 |

移植模块沿用 Studio 的 MIT/NextChat 来源。完整 NextChat MIT 通知也写入
会随社区镜像分发的 `THIRD_PARTY_NOTICES.md`，不依赖镜像外的 `studio/LICENSE`。
`iron-session@8.0.4`（MIT）保留旧会话密封格式，不引入 Next.js 或 React 运行时。
历史导入仅限已验证 `accountId` 的 `octopus:user-<accountId>:` 及
`octopus-gallery-user-<accountId>`，不清空或合并其他账号、访客和旧聊天存储。

## 2026-11-14 账户充值复用

来源为用户指定的本地 `octopus_chat`，当前 HEAD 为
`0eac2b491406574cccfe29ad9252dc56bd97ae95`，保留其 MIT / NextChat 声明。
`server/native-account/wallet.ts` 原样迁入钱包业务后只调整 Request 类型和模块路径；
`shared/studio/wallet.ts` 复用浏览器安全契约和支付地址检查。
源钱包业务 SHA-256 为 `4cb803f10bd719d4dce7514df8c766ee95ae11feec16035f1a719db7860ecb46`，
源契约 SHA-256 为 `a01191fae0ac311248785c0e27f40831df49c4733cb6504f167fa96ea338d78b`。
`server/native-account/wallet.test.ts` 从源项目钱包测试适配至 Vitest，DNS 和上游请求均模拟。

`AccountWallet.vue` 将原 React 钱包交互适配为 Vue，保留充值报价、支付宝/微信、
兑换码、套餐价格确认和限购、已有订阅及最近 20 笔充值记录。
支付使用浏览器原生 POST 表单打开新页，显式确认签名订单中的实际金额，
避免嵌入外部收银台或改写签名回调；返回时仅刷新状态。
使用当前章鱼账号 Cookie 和预期 accountId，切账号与卸载同步清理报价及支付表单，
写操作不自动重试。金额、单位、换算、折扣和实付报价仍由 New API 提供，
保留公网支付地址、签名字段和回调地址检查；订单、兑换码、余额和套餐数据仍归账号中心。
社区不增加支付数据库、新账号、支付服务容器或 React 运行时。

## 2026-11-13 创作功能恢复

用户指定复用来源 `qzq00767/octopus_chat`，核对的远端 `main` 为
`0eac2b491406574cccfe29ad9252dc56bd97ae95`。本地相邻源码属于同一仓库，
仅获取远端信息，没有覆盖其未提交修改。

`shared/studio/` 的图片参数、视频能力表与序列化、聊天格式/usage、
思考流解析、附件/视频采帧、上下文预算、对话分支和附件分离持久化，
从现有 `studio/app/` 对应模块迁入；保留已在社区中更新的视频能力表，
替换框架/store 类型依赖及显式 `.ts` 导入，不重新实现这些算法。
`shared/studio/chat-completions.ts` 摘取原 `client/platforms/openai.ts` 的
o1/o3/o4-mini/GPT-5 参数兼容分支。

`server/creation/skills-retrieval.ts` 采用用户指定仓库的 Tavily 计费版本，
没有采用 `studio/` 中旧的 SearXNG 实现。保留按用户系统 Auto 密钥检索、
来源解析、超时和不重放规则，替换 Next Request/Response 与授权适配。
搜索和生成分别保存请求编号及结果，回答重生成不重复搜索。

`server/mcp/{client,types,logger}.ts` 和 `server/skills/` 复用旧源码，
MCP 接入官方 SDK；SDK、Zod 和 Nano ID 更新至安装时审计已修复的版本。
MCP 仍要求显式部署开关、账号 allowlist 及上游管理员角色；
普通登录不获得进程管理权限。模型工具回合只在会话选择服务后启用，
用户确认具体调用后执行，保留调用编号，不自动重放。

Vue 页面是原生适配层，不加载 React 或 Next 运行时。图片/视频参数、
图库/任务、多轮对话、技能工具以及账号价格/日志/密钥复用同一社区登录。
旧聊天通过原 `readChatSnapshot` 还原分离附件，写入新的账号专属
`native-chat` 键，保留旧快照和图库；原生单轮文本记录也能继续读取。
付费生成在浏览器断开后继续记录最终结果，大型结果存入私有文件目录，
通过受账号约束的 GET 请求恢复，不再次提交生成。

具体功能范围与配置边界见 `RESTORED-STUDIO.md`。

## 保持不变的业务约束

- 次数累计不会因取消点赞、重新关注或规则切换重复发放。
- 奖池权重、库存、金额精度和额度回执校验沿用已验证规则。
- 发奖保留旧 drawId、奖项顺序、requestId、client_id 及到账凭证，
  已到账记录不重放。
- 发布与审核保留待审改稿、版本冲突和来源链语义。
- 付费请求在响应不确定时不自动重复发送。
- 浏览器中的聊天和未发布创作单独迁移，不清空原数据。

## 来源声明

本批两个模块及原测试已有 AGPL-3.0-only 声明，迁入时保留。
Studio 主包声明 MIT 并带有 NextChat 署名；文档链路同时包含 QXChat MIT、
GenOffice Apache-2.0 和新增服务的 AGPL-3.0-only，不能按“后加”统一改为 MIT。
本清单记录实际来源和依赖，不自动修改许可证或声明全部源码可重新许可。

## 当前完成范围

2026-11-14 的关注与主题设置继续参考 `D:/ip/新社区汇总平台/community-studio-ui`：
`packages/backend/src/core/UserFollowingService.ts`、账号年龄审批辅助函数及
`packages/frontend/src/pages/settings/privacy.vue` 的规则适配到 `server/following.ts`，
复用原 `following`、`follow_request`、`user_profile` 表，无数据库迁移。
`pages/settings/theme.vue`、`appearance.vue` 和 `utility/appearance.ts`、
`theme-schedule.ts` 的模式/跨夜/休眠恢复逻辑适配到 `public/theme-preload.js`；
保留 AGPL-3.0-only 来源声明。主题预览用现有 CSS 变量与 Lucide，持久化使用原生
localStorage / storage 事件 / matchMedia，不引入新依赖或任意主题脚本执行。
验证包含隔离 PostgreSQL 的并发与权限测试，以及浏览器关注、隐私、主题、移动端与 axe 检查。

纯算法仍在 `server/business/`；`auth.ts`、`content.ts`、`account.ts`、
`lottery.ts` 和 `runtime.ts` 提供 TypeScript + Fastify 后端及原表适配。
`types.ts` 统一请求上下文，构建时执行严格类型检查；事务、锁顺序与业务规则沿用。
`studio/` 与 `services/documents/` 源码保留在项目中，
其中 Studio 不参与当前运行镜像，文档服务继续独立复用。
前端使用真实 API，移除演示数据与伪造成功状态。统一登录与原生创作只需发布社区镜像。
上传限制 20 MB，时间限制隐私
暂时保守隐藏。当前文档描述源码实现；是否已部署以实际发布记录为准。
付费生成、真实账号登录与完整业务验收没有用本地或模拟接口测试替代。
完整迁移契约及验收条件见 MIGRATION.md。

## 界面资产

2026-11-14 创作交互与移动端优化参考用户指定的两个本地项目：
`D:/ip/QXChat(积分)/app/components/chat.module.scss` 的手机输入/发送及模型工具排列，
`app/components/chat.tsx` 的输入行为；该项目声明 MIT。本项目用既有 Vue、CSS 和
Lucide 适配布局，没有移植其积分服务或引入 Next.js 运行时。
顶部作品库、模型定价与新建入口参考旧社区
`studio/app/components/workspace-navigation.tsx`；请求回显与耗时参考同目录
`chat.tsx`、`image-request-time.tsx`，继续遵守已有 AGPL-3.0-only 来源约定。
价格和余额复用本项目账号只读接口，大图复用 StudioGallery，停止/恢复复用原请求，
未用参考截图中的数值冒充当前账号数据。

Schibsted Grotesk 拉丁可变字体来自 Google Fonts，随文件保留
`public/assets/fonts/Schibsted-OFL.txt` 中的版权和 SIL OFL 1.1 声明。
站点图标复用已安装的 Lucide Aperture（ISC）；页面操作仍使用同一 Lucide 图标库。
作品、创作者头像及媒体来自现有公开社区数据，本次没有引入图库替代作品。
`BentoGrid.vue` 沿用用户确定的五列及一列、两列跨列规则；作品展示与点击展开参考
用户随后提供的 Aceternity UI Layout Grid 示例，按现有 Vue、Lucide 和 CSS 变量适配，
保留组件来源说明；未复制示例中的虚构作品文案与房屋图片。
连续圆角继续使用已有 `figma-squircle` 1.1.0（MIT）和 `v-continuous:clip`：
仅保留 32px、平滑度 0.6 的单层外轮廓，直接裁切全幅媒体和底部元信息，不生成额外内框。
不从零编写曲线算法，不宣称与 Apple UIKit 实现逐像素相同。
展开预览复用浏览器原生 dialog 和 WAAPI，取代示例的 React、Tailwind 与 Motion 实现；
内容 0.3s ease-in-out、黑色 0.3 遮罩，补齐键盘关闭、焦点恢复及减少动态效果。
本轮没有新增依赖，作品详情、权限、收藏、喜欢和管理 API 契约保持原样。

`src/components/GooeyInput.vue` 按用户指定的 Aceternity UI Gooey Input 适配：
源码提供方 Manu Arora，来源 `https://ui.aceternity.com/registry/gooey-input.json`，
于 2026-11-12 读取。沿用 SVG 模糊、颜色矩阵与分离圆泡的结构，改用现有 Vue、
Lucide 和 CSS 过渡，不引入 React、Motion 或 Tailwind 运行时。
输入与按钮分别保留语义，提供键盘焦点、清除、减少动态效果及原有搜索 URL/API 行为。
此处记录来源，不为上游代码追加未核实的许可证声明。

用户于 2026-11-12 确认社区品牌为“章鱼社区”，并提供蓝底章鱼图片作为品牌标识。
原始文件为 `D:/Users/86136/Desktop/1/temu/1证书资质/个人/新章鱼logo/资源 2.jpg`；
仓库资产为 `public/assets/brand/octopus-community.jpg`，公开路径为
`/assets/brand/octopus-community.jpg`。

2026-11-14 同款与发布流程继续参考旧社区 `packages/frontend/src/components/MkStudioRemix.vue`、
`packages/frontend/src/utility/studio-remix.ts`、`studio/app/components/community-share-button.tsx` 与
`studio/app/utils/community-share.ts`：保留来源归属，参考图只来自作者显式公开的 referenceFiles；
适配为 Vue 选择弹层，可与用户上传混用。发布复用现有 `/api/works` 的 community/source-comment、
附件归属、审核和防重规则，不新增发布通道或数据库结构。参考图发布前复制上传到当前账号；
结果上传与提交内容持久化，断网重试复用同一结果，不再调用生成接口。

2026-11-14 模型选择复用用户指定 `D:/Users/86136/Desktop/1/仓库代码/octopus_chat`，
参考提交 `0eac2b491406574cccfe29ad9252dc56bd97ae95` 的
`app/components/model-select.tsx`、`app/utils/model.ts`、`app/utils/model-metadata.ts`、
`app/utils/model-preferences.ts` 与 `app/store/model-preferences.ts`。
保留厂商分类计数、名称/说明/厂商搜索、收藏、模型类型覆盖和对话接口格式选择规则，
适配为 `StudioModelPicker.vue`、`src/model-preferences.ts`、`shared/studio/model-catalog.ts`。
八个厂商图标沿用源项目 `app/icons` 资产，MIT 版权及许可保存在
`public/assets/model-vendors/LICENSE.txt`；不引入 React、Next.js 或 Zustand。
仅使用现有章鱼账号目录和分组接口，不接入参考项目的自定义 API 密钥来源；
设置按社区身份、章鱼账号与实际目录令牌编号隔离保存在本浏览器。
仅提供当前创作后端支持的对话、生图、视频分类；接口覆盖只作用于对话请求，
保留历史对话格式作为默认，不将某个模型格式写入所有会话。
跨类型选择切换原生创作路由，分组变更与任务查询仍复用既有令牌固定和过期响应防护。

分组展示进一步复用同提交 `app/components/account-model-source.tsx` 和
`account-model-source.module.scss`：整行触发、完整分组滚动列表、Auto 系统标识、
倍率与选中状态，适配 Vue 和现有主题。请求仍走社区已有分组选择方法，
失败后读取服务端实际状态，不自动重放分组 POST 或生成请求。

2026-11-14 同款参数扩展复用现有 `task.request`、`shared/studio/options.ts`、
图片尺寸计算及视频参数序列化/能力校验；旧 Studio 发布逻辑只包含提示词与模型，
故增加共享白名单 `shared/studio/remix-parameters.ts`。版本化参数保存在已有
`generation.parameters` JSON 中，不改变数据库表。模型、分组、尺寸、比例、数量、
时长、seed、请求方式和公开高级参数来自生成时快照，分组在异步准备前与令牌一起固定。
图片固定尺寸和 seed 进入实际 Images JSON/multipart；OpenAI Video 尺寸及 seed
元信息进入实际请求。当前 Gemini 图片 Chat Completions 兼容分支不支持固定尺寸/seed，
明确拒绝相关请求，其作品不发布未实际使用的图片参数。
公开参数在写入与读取时均校验；不携带账号/令牌、聊天历史、MCP、私有素材地址或文件 ID。
视频自定义 JSON 只保留受控生成参数，素材继续通过公开参考图列表单独选择。
同款先恢复当前账号可用分组再核实模型；失败需用户确认使用当前配置，不自动付费生成。
