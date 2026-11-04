# AI 社区前端交付记录

2026-11-04。基于本地 Misskey 增量扩展。**前端第一版；新增发布前审核 API 尚未接通，不能当作可上线整站。**

## 页面与入口

| 页面 | 地址 | 行为 |
| --- | --- | --- |
| 视频社区 | `/`、`/community/video` | 已审核视频作品、搜索、投稿入口 |
| 图片社区 | `/community/image` | 已审核图片作品 |
| 文本／代码／Skill | `/community/knowledge` | 对接 resource 分类，兼容 resource/text/code/skill 别名 |
| 投稿表单 | `/community/compose` | 桌面导航和移动底栏发布按钮进入此页 |
| 我的投稿 | `/community/mine` | 登录后查看状态、审核理由、公开作品链接 |
| 待审核工作台 | `/community/review` | 管理员／审核员核对内容、通过或驳回 |
| 第三方 AI | `/community/ai` | 明确标为预留，不提供假调用 |
| 用户管理／举报 | `/admin/users`、`/admin/abuses` | 复用 Misskey 原有后台 |

`community.vue` 适配现有路由的 `module` 参数与 `section` 参数，复用 Misskey 的登录、注册、文件选择和首次实例初始化。`community/surface.vue` 是实际正式页面组件；`api.ts` 仅调用新审核接口，严格校验响应；`types.ts` 与接口契约对应。

作品评论跳转审核通过的原生 Note 详情，使用原生回复体系。前端不新增第二套账号或评论存储。

## 视觉与资源

- Galaxy：参考 `Buttons/0x-Sarthak_hungry-penguin-30.html` 的按钮方向反馈，按现有主题与减少动效偏好适配。
- Taste Skill：采用应用界面的分层、导航、内容密度、空态与多尺寸检查原则。
- Impeccable：本次为现有 Misskey 界面的功能扩展，使用其响应式和交互完整性要求；保留 MI_THEME 变量、Tabler 图标与现有技术栈。检测返回空问题列表。
- 中文项目文案集中在 `community/copy.ts`，不覆盖 Crowdin 管理的 locale YAML。
- 没有真实作品时显示空态；正式界面不预置虚构作者或作品数量。

## 验证范围

- PASS：核心 API 与类型文件的 TypeScript strict 检查。
- PASS：5 个本轮新增／修改的 Vue 组件语法及模板编译。
- PASS：正式 surface 组件的 Vue 生产编译、CSS Modules、压缩。
- PASS：13 项 Node 接口测试，覆盖响应结构、未审批列表拒绝、鉴权错误、取消、来源 URL 和不降级绕过审核。
- PASS：12 组 Playwright 组件交互检查，包含投稿待审、同路由重复打开投稿、失败保留输入与重试 key、视频附件要求、管理员确认与驳回理由、刷新后重新确认、搜索、导航、无权限和未接通状态。
- PASS：1440 / 768 / 390 像素布局检查，无页面横向溢出；查看浅色、深色与减少动效截图。测试详见 `.community-preview/browser-results.json`。
- PASS：本轮目标文件的 SPDX 表头与主题变量脚本检查；不是仓库全量 Git 检查。
- BLOCKED：原仓库完整 ESLint / 集成构建 / 整站账号与后端联调。所需依赖未安装完整，包下载出现 EACCES；本机 Node 24.15.0 与仓库 `.node-version` 指定的 26.12.1 不同。
- BLOCKED：仓库官方 SPDX 检查要求 `.git`，当前为解压目录；shipping 检查缺少 execa。未伪造通过结果，未初始化或改写 Git 历史。

## 本地组件预览

运行：`node .community-preview/serve.cjs`，浏览器访问 `http://127.0.0.1:5188`。

预览使用已生成的 dist，不需要安装完整 Misskey。顶部始终标注“示例数据与操作仅用于验证”，身份切换、投稿和审核使用内存夹具，不会向正式后端提交。登录／注册只验证入口事件；真实认证仍需整站联调。预览外壳和图标简化，不等于完整 Misskey 外壳截图。

可选预览地址：`/community/video?scenario=populated`、`/community/review?role=moderator&scenario=review`、`/community/video?scenario=unavailable`。

本机验证工具通过本地 npm 缓存与既有浏览器运行，未更改原仓库 package.json 或锁文件。`.community-preview/build.cjs`、`browser-test.cjs` 的工具路径针对本机；移到其他机器需先配置相同工具。预览用 Vue 3.5.33，完整仓库目标版本为 3.5.44，不能代替目标版本的集成检查。

## 并行编辑与后续对接

工作期间另一处新增了路由、`MkCommunityNav`、频道配置工具、`/admin/community` 等文件。本轮保留这些变化，兼容 `/community/:module` 与 knowledge 分类，避免重复三大社区菜单。该频道管理页面是已发布作品管理，不能替代用户刚确认的发布前审核。

下一步后端按 `COMMUNITY_API_CONTRACT.md` 实现 5 个接口及审核权限／幂等／附件策略，然后在完整 Misskey 服务上验证注册登录、真实投稿、管理员审核和评论。正式上线前还需决定原生时间线／频道发帖是否也必须统一预审。

变更说明候选：新增 AI 三大社区、投稿待审界面和审核工作台，预留第三方 AI 工作台。

## Misskey UI 对齐（2026-11-04）
按用户指定，以本仓库原生时间线、Note 组件与 Mi Light 主题为主要视觉参考。作品区域改为单列信息流，作者与时间在前、正文及媒体在后，沿用主题强调色、圆角面板和右侧辅助区；窄屏依据实际内容容器宽度收为单列。预览主题同步到 Mi Light 的主要色值，正式页面仍跟随用户所选 Misskey 主题。

PASS：组件生产编译、12 组浏览器交互回归、1440/768/390 布局、桌面与手机有作品状态截图核对；独立 Vue 代码审查无新增问题。此次未改审核 API 逻辑。完整 ESLint 和整站构建仍受前述依赖环境限制，未宣称通过。截图为隔离组件预览，图标与外壳仍为简化版本。

## 简洁化更新（2026-11-04）
合并账号操作与主标题，移除重复品牌页头；加宽作品信息流、放大标题并增加留白；搜索和刷新集中显示，右侧说明收为底部可展开指引，无封面作品使用紧凑附件入口。保留三大社区导航及全部投稿、审核、评论行为。此布局取代上一版右侧辅助面板。

PASS：正式组件编译、12 组浏览器回归、桌面及手机实图检查、指引键盘展开验证；独立 Vue 代码复查无新增问题。补充验证首次选中了折叠区内隐藏标题，改用 summary 验证通过。完整构建和 ESLint 的既有环境限制仍未解除。新截图位于 `.community-preview/spacious-desktop.png` 和 `spacious-mobile.png`，仍为测试数据与简化外壳的组件预览。

## X 参考与三设计资源精修（2026-11-04）
连续信息流替代独立作品卡片；吸顶社区标签、列表上方投稿入口、作者左栏对齐、放大社区导航，移动端压缩投稿行。主操作使用主题前景与面板色反转，修正浅色主题的低对比度；辅助文案增至13px；滚动容器预留72px，修复吸顶导航遮挡反向键盘焦点的问题。

实际使用：Galaxy 按钮方向反馈源码；Taste Skill app draw（True-black flat，seed 1803568725，保留现有字体/主题，按用户截图保留标签细线）、3轮inspect、源码lint；Impeccable context与detect。完整说明见 `.taste-skill/x-ui/review.md`。

验证：12组浏览器回归通过；新增design-test覆盖5个有作品布局（1440浅/深、390浅/深、320）、按钮对比度、首条作品位置及键盘反向导航。浅色按钮5.66:1，深色13.36:1。3个修改的Vue组件编译、核心接口/文案TypeScript检查、目标SPDX及主题变量检查通过。Taste lint 0 FAIL/0 WARN，最后inspect 0 FAIL/2 WARN；其中手机边距随后修至16px并查看截图，另一个长信息流折叠线提示按业务保留。Impeccable detector为空列表。

预览图标已换为17个官方Tabler SVG，许可证保存在 `.community-preview/vendor/tabler-icons/LICENSE`。正式应用仍用既有Tabler图标字体；预览外壳仍是简化环境，图片/作品均为标注的测试内容。最新截图为 `.community-preview/refined-desktop.png`、`refined-desktop-dark.png`、`refined-mobile.png`。完整整站构建、ESLint及后端联调限制仍如前述，未宣称通过。

## 红框全宽与圆滑化更新（2026-11-04）
展示区取消860px上限，铺满侧栏外可用宽度；移除主栏竖线和标签、投稿区、工具栏、作品间的结构分隔线，采用柔和主题底色和16px圆角。社区标签改为圆角选中态，搜索采用圆角输入区域。大媒体完整显示并限制高度560px，正文保留可读行长。

PASS：12组行为回归、5种已有布局/对比度/键盘检查、2048px全宽实测、Impeccable检测空列表、独立CSS复查。在2048px视口中main/canvas均1798px，作品1734px，无横向溢出。新版截图：`.community-preview/wide-soft-desktop.png`、`wide-soft-mobile.png`。本地预览构建已更新，刷新原网页即可查看。完整应用与审核后端的既有验证限制仍适用。

## 个人主页更新（2026-11-04）
新增共享 profile-header.vue 和原生 user/community-profile.vue 适配，`/@用户名` 默认进入社区个人主页，原生概览通过“更多资料”访问。页面采用封面、重叠头像、资料及关注数据；内容页签为全部作品、视频社区、图片社区、文本·代码·Skill。保留全宽柔和布局，手机页签两列排列。公开列表按作者和分类请求并校验；待审/驳回不会混入。

复用原生编辑资料、关注按钮、Mfm 简介、关注可见性与静态图片代理。独立审查指出动态图片偏好回归，已修正头像的禁用动画/省流及封面的禁用动画设置。

PASS：16项API测试、个人主页4页签/作者筛选/编辑入口/访客/服务缺失测试、5种个人主页布局无横向溢出并核对截图；原12组浏览器回归及5种设计布局/对比度/键盘检查均通过。新增原生适配、用户路由页和导航通过Vue脚本/模板编译；共享组件完成隔离生产编译。Taste源码lint为0 FAIL/0 WARN，Impeccable detect无发现。完整应用类型检查、ESLint、整站构建和真实后端联调仍受前述环境及未实现API限制，未宣称通过。

本地个人主页预览：`http://127.0.0.1:5188/community/profile?role=member&scenario=populated`。示例身份和作品仅用于验证，封面/头像未设置时使用中性占位，不代表真实用户资料。截图位于 `.community-preview/profile-desktop.png`、`profile-mobile.png`、`profile-small.png`、`profile-wide.png`、`profile-dark.png`。

最终视觉复核：手机预览导航改为紧凑文字入口，消除新增个人主页后的边缘裁切，同时维持社区首条作品的位置。重新运行个人主页和design-test通过；Taste inspect最终0 FAIL/0 WARN，并已查看桌面、平板、手机与320px截图。

## 独立投稿弹窗与纯作品展示（2026-11-04）
移除surface的composeEntry，复用已有投稿状态/验证/网盘/审核API，将编辑器改为Teleport弹窗。顶部选择视频、图片或文本·代码·Skill投放模块；正文使用无常驻边框的编辑区，模型、来源与授权折叠，底部提供附件和提交审核。沿用Galaxy方向反馈、Taste应用排版与Impeccable渐进展示/响应式规则。

新增compose.ts分发可取消的投稿事件，正式navbar和mobile-footer-menu优先在可见社区上打开弹窗，不更换社区/滚动位置；无可用社区surface（如个人主页）时回退已有/community/compose路由。独立预览的侧栏同样接入，手机提供独立浮动投稿按钮。关闭/重新打开保留当前页面输入及已选模块；刷新或离开该页面不保证保留，不冒充服务器草稿。

弹窗复用Misskey原生focusTrap。进入后背景inert，关闭前同步释放，恢复触发按钮焦点；支持Escape和Tab循环。原生网盘选择在closed后才返回结果，再恢复附件按钮焦点；满16附件时回退标题输入框。折叠可选URL字段使用统一程序校验，避免浏览器阻止提交却无法聚焦隐藏输入。

PASS：正式组件隔离生产编译；5个改动Vue文件脚本/模板编译；API/types/copy/compose TypeScript strict；16项API测试；12组原有浏览器回归；个人主页回归；5种设计布局与对比度/键盘检查。新增composer-test覆盖无内嵌投稿栏、原页弹窗、分类默认值与切换、草稿保留、关闭后inert/焦点恢复、Tab循环、折叠无效URL、同一原生焦点工具的嵌套网盘模拟、上传焦点、满16附件、正确投放及待审状态、图片必需附件、5种弹窗和内容区截图。查看桌面/宽屏/390/320/深色截图，未见横向溢出。

PASS：Taste lint 0 FAIL/0 WARN；Impeccable detect空列表。Taste inspect识别弹窗遮住背景大标题为covered-text，属于用户指定模态叠层的预期行为，背景已inert；仅对此规则显式allow后0 FAIL/0 WARN，已人工检查桌面/平板/手机。记录在.taste-skill/composer-ui/review.md。

BASELINE/BLOCKED：完整ESLint尝试被pnpm环境自动补依赖流程阻断（包下载EACCES/ETIMEDOUT），已终止，不再尝试安装。shipping仍缺execa，仓库SPDX全量检查仍因无.git无法执行；目标文件SPDX单独校验。完整应用构建、真实网盘服务/账号/审核后端联调未通过验证，组件测试及嵌套焦点模拟不能替代整站联调。

预览：`http://127.0.0.1:5188/community/video?role=member&scenario=populated`，点左侧“投稿作品”；直接打开弹窗：`http://127.0.0.1:5188/community/compose?role=member&scenario=populated`。截图为`.community-preview/clean-feed-desktop.png`和`composer-desktop.png`、`composer-mobile.png`等，均使用显式标注的示例数据。

变更说明候选：投稿改为独立弹窗，可选择三大社区投放，作品列表移除内嵌投稿栏。

## X 投稿展示形式精修（2026-11-04）
以用户本轮截图为主要视觉依据：640px圆角弹窗、左侧原生头像slot、大字号正文、小号标题、正文下方投放模块下拉与审核提示、底部四个图标操作及右侧提交。图标全部复用现有Tabler资源（图片、代码、外链箭头、模型/补充信息）。来源按钮展开补充字段并聚焦，代码按钮包裹选区/插入代码围栏，2500字上限保持有效；不加入没有对应业务实现的投票/定位/定时发布。

PASS：2个改动Vue脚本/模板编译与隔离生产构建；12组原有浏览器回归；更新的composer-test通过模块选择、输入保留、焦点/嵌套窗口、16附件及5布局验证，新增代码选区包裹/选区恢复/字数上限、来源字段自动聚焦、工具按钮可访问名称。查看1440/2048/390/320与深色截图。独立代码审查未发现新增明确问题。Taste lint与inspect均0 FAIL/0 WARN（沿用对预期模态背景遮挡covered-text的显式豁免），Impeccable detect空列表。完整构建/ESLint及后端联调仍受上一节环境限制，此轮不重复安装依赖。

更新截图：`.community-preview/composer-desktop.png`、`composer-mobile.png`、`composer-small.png`、`composer-dark.png`。直接预览地址仍为`http://127.0.0.1:5188/community/compose?role=member&scenario=populated`。X链接抓取未获得可读页面，未声称读取登录态X；实现依据用户截图和本地资源。
