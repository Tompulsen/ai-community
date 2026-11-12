# 业务复用与适配边界

用户确认：最终只使用一个项目；原数据与前后端业务迁入新项目。
社区基础服务独立实现，已有创作与运营业务优先复用。
用户随后确认按测试开发环境快速替换前后端，直接沿用原数据。

## 分类

| 范围 | 处理方式 | 接入边界 |
| --- | --- | --- |
| 用户、会话、角色、帖子、文件、通知、流事件 | 独立实现 | 保留身份、权限、内容和数据契约 |
| 抽奖纯规则与到账凭证校验 | 已迁出到 `server/business/lottery.ts` | 仅依赖 `node:crypto`；规则和计算保持不变 |
| 广告配置清洗 | 已迁出到 `server/business/ads.ts` | 接入本项目配置存储 |
| 抽奖事务、发放、重试与审计 | 保留业务，替换适配接口 | 用户/权限、关系计数、账号映射、HTTP、ID与日志 |
| 投稿、修改、标签、审核及违规治理 | 保留业务，替换适配接口 | 用户、内容、媒体、权限、封禁与事件 |
| 章鱼账号登录与身份映射 | 复用 Studio 账号登录和服务端会话校验 | 按 issuer/subject 复用原绑定，关闭社区独立密码与注册，不按同名或邮箱合并 |
| Studio 聊天、图片/视频生成、图库、任务恢复与备份 | 复用业务及可保留的 Next.js/React 模块 | 替换旧社区接口、会话和必要的跨页面桥接，不为统一框架重写成熟逻辑 |
| Word/Excel 文档引擎与版本处理 | 复用现有实现 | 从可信会话派生 owner，接入新后端；按实际来源保留声明 |

Studio 是独立 Next.js/React 模块，通过 HTTP 接入本项目；
身份、会话与跨页面通信遵循统一接口契约。
章鱼账号登录成功后，社区后端校验 Studio 会话并建立对应的社区会话。
各创作 context 共用原 Studio 登录 ID、刷新链和锁，并继续验证各自的社区身份绑定；
不为不同创作页面复制刷新令牌或要求再次授权。
`src/turnstile.ts` 复用 `studio/app/utils/turnstile.ts` 的账号验证码脚本加载逻辑，
避免社区开发页面跨 `/studio` 源码路径加载，并保留原有超时、重试和单次加载规则。
“一个项目”要求统一仓库、账号、API、入口和发布，不强制单一前端框架、
进程或容器。模块保留方式按实际依赖确定，避免把框架转换扩大为业务重写。

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

纯算法仍在 `server/business/`；`auth.ts`、`content.ts`、`account.ts`、
`lottery.ts` 和 `runtime.ts` 提供 TypeScript + Fastify 后端及原表适配。
`types.ts` 统一请求上下文，构建时执行严格类型检查；事务、锁顺序与业务规则沿用。
`studio/` 与 `services/documents/` 源码归入同一项目，当前复用既有健康镜像。
前端使用真实 API，移除演示数据与伪造成功状态。统一登录变更需同时发布社区与 Studio 镜像。
上传限制 20 MB，时间限制隐私
暂时保守隐藏。付费生成、真实 OAuth 与完整业务验收没有用单元测试替代。
完整迁移契约及验收条件见 MIGRATION.md。

## 界面资产

`public/assets/motion/motion.css` 与 `motion.js` 原样来自用户指定的
design-taste-frontend 2.5.1 技能，不修改其实现以通过检查。
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
