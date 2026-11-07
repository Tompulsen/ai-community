# 部署验证记录（2026-11-07）

## 当前生产版本：明暗模式与私信优化（2026-11-07）

- 站点：`https://zaiduyu.top`；新服务器 `38.114.89.52`，仅更新 `ai-community-web-1`。
- 本轮 17 个文件提交：`4d7a497ab203dc6448893e4e407ec3374d1536b4`，已推送 main；GitHub 完整镜像构建 `42356206190` 成功。
- **实际生产为复合版本**：以此前已上线、尚未合入 Git 的 SSO 镜像 `sha256:988e78df7fa46d2f9f8445c4b7cd815d9902b3963f9d2d12cf6b7487cf00a720` 的源码为基线，仅叠加上述 17 个文件。不能用纯 Git 提交镜像替换当前生产，否则会丢失既有 New API 登录功能。
- 当前固定镜像：`community-appearance-chat:4d7a497-7b679ce0bb45`；镜像 ID `sha256:7b679ce0bb453ccafd303235df9a8fc06582101b843204ceccbffcc8ee2c87de`。
- 实际构建源码：`/opt/ai-community-appearance-chat-4d7a497/source`。3277 个源码文件的哈希对比确认仅 17 个目标文件变化，SSO 源码和全部迁移保持不变；源码树 SHA-256 `f93e81da7d4233e5ed0e26ad8a2d9d9196e96f97f11135753e9ac9bbc882b9d7`。
- 服务器完整 Docker 构建通过；切换前对容器、配置哈希及完整有效环境变量进行比较，保留现有账号登录与部署设置。Compose 当前直接固定 web 镜像，已同时更新该引用和 release.env。
- PASS：9 项公网浏览器检查，覆盖 HTTPS/节点、原管理员登录及 SSO 入口、明亮/暗色即时切换、定时时间保存与刷新保留、无效时间拦截、实际私信历史与搜索接口、WebSocket、1440/390/320px 和英文布局。浏览器运行错误和失败 JS/CSS 请求均为 0。
- PASS：公开复合源码包 SHA-256 `67a13bb78b5760c19279a5c93fec2fb8bd3fef9b3fb9f1b17eb269c8c7b1a343`；链接 `https://zaiduyu.top/source/ai-community.tar.gz?v=appearance-chat-4d7a497-f93e81da`。包内附 release.json、17 文件 overlay manifest 与源码验证结果；站点源码链接已更新，其他 clientOptions 不变。
- 备份：`/opt/ai-community-appearance-chat-4d7a497/backup`，包含数据库归档及清单、上传文件、私有配置、Compose、release.env、原镜像引用和原公开源码。回退只恢复应用配置/镜像，不自动恢复旧数据库。
- 先前尝试仅更新 release.env 时，校验发现 Compose 直接固定了旧镜像，自动恢复配置；未误报上线。后续已按固定镜像方式成功切换并核实实际镜像 ID。
- 使用：设置 → 主题 → 界面模式，支持明亮、暗色、跟随系统、定时切换；默认 07:00 明亮、19:00 暗色，按设备本地时间。
- 私信优化包括发送防重复、失败保留草稿、附件取消恢复、断线补拉及未读状态同步。本地 12 组真实组件测试通过；公网仅执行非发送检查，没有向真实用户发送测试消息，未完成生产双账号收发验收。
- 本地报告、脚本与截图：`.community-validation/deploy-appearance-chat/`。旧服务器仅作为既有 SSH 中转使用，本轮没有部署旧服务器或改动其他业务容器。

---

## 上一生产版本：迁移至 1Panel 服务器及分类上传限制

- 站点：<https://zaiduyu.top>；新服务器 `38.114.89.52`，Ubuntu 24.04、1Panel v2.4.2，应用目录 `/opt/ai-community`。
- 已部署应用提交：`e35e867a7734003a08a746b440d27825b1dc7551`，公开仓库 `Tompulsen/ai-community` 的 `main` 分支。
- 固定镜像：`ghcr.io/tompulsen/ai-community:sha-e35e867a7734003a08a746b440d27825b1dc7551`；摘要 `sha256:7778eb1af6cbd4bf831daa79464615725c6c11626f20774e03d7edfa03b5c4d7`。
- GitHub 完整 Docker 构建 `42256174119` 成功；应用、PostgreSQL、Redis 均 healthy，运行镜像 revision 与上述应用提交一致。部署记录独立提交，不为纯文档更新重复构建应用。
- 复用服务器现有 OpenResty，应用绑定 `127.0.0.1:13000`；站点配置 `/opt/1panel/www/conf.d/zaiduyu.top.conf`，站点文件 `/opt/1panel/www/sites/zaiduyu.top/`。现有 `ZY-*` 应用保持运行。
- Cloudflare 仅将根域 A 记录改为新 IP，代理保持开启。响应头 `X-Community-Node: vm-20261107` 用于核对请求到达新节点。

### 上传限制使用方式

- 管理员进入“管理后台 → 上传限制”（`/admin/upload-limits`），分别设置图片、视频、音频、文档／代码／Skill、其他文件／压缩包的单文件大小。
- 五类默认均为 20 MB，支持填写 1–10240 MB 的整数；实际允许值同时受服务器和账户限制约束。现有服务器总上限为 50 MB，页面展示生效上限。
- 服务端在接收及暂存上传时执行限制，超限返回结构化 413，失败后清理临时文件。本功能不是累计存储配额或按时间清理的保留策略。
- 配置使用既有 JSONB 数据，不新增数据库列或迁移文件。

### 迁移及验收

- 迁移前暂停并排空 10 个队列，停止旧 Web 和 Redis，再制作最终数据库、上传文件和 Redis AOF 快照。目标恢复后 10 个队列恢复原状态，未遗留演练用的禁用后台任务标志。
- PASS：全部 118 张 public 数据库表的行数逐表一致；全部 13 个物理上传文件的大小及 SHA-256 一致，共 25,854,615 字节。保留 5 个用户、6 条网盘文件记录、2 份投稿及 7 条 Note。
- PASS：目标演练验证管理员登录、分类配置保存、图片和 Skill 文档超限拒绝、允许的上传成功及临时文件清理。演练数据已由最终生产快照替换。
- PASS：10 项公网验收，覆盖原管理员账号登录、两份作品与附件、上传限制页面及权限、中英文手机布局、Cloudflare/OpenResty WebSocket 和源码归档校验。浏览器无运行错误，未发布测试作品、评论或点赞。
- PASS：目标本地 `/healthz` 与公网域名均返回 200，公网响应包含新节点标识。收尾时一次无显式 User-Agent 的服务器请求曾返回 403；随后带 User-Agent 的只读请求通过，未修改防护规则，未据此推断具体原因。
- BASELINE：既有 `meta.proxyRemoteFiles` 默认值 true/false 差异未在本次修改。
- 收尾仅更新两份部署文档；SPDX、locale safety、diff check 通过。BASELINE：本地 `check-shipping.mjs --base HEAD` 因缺少既有 `execa` 依赖未能运行，未重复安装全仓依赖；本轮应用完整构建及生产验收已通过。
- 公开对应源码：`https://zaiduyu.top/source/ai-community.tar.gz?v=e35e867a7734003a08a746b440d27825b1dc7551`；SHA-256 `42726587dc7687d0fa0d81fea5ffda7f377dd4efd324e95ff34be3136ea4a29a`。仅更新站点源码版本链接，其他设置读回不变。

### 备份与旧服务器状态

- 新旧服务器均保留 `/opt/ai-community-backups/migration-vm-20261107`，含演练快照、最终数据库／上传／Redis／私有配置及原反向代理配置。
- 最终归档 `final.tar.gz` 的 SHA-256：`bdc2adb665563d27767b92a745e157840bf093c31ec60fdd9e417a9c42ec9825`。目标另保留 DNS 切换前后记录、恢复核对结果和收尾健康检查记录。
- 旧服务器 `210.126.232.192` 的社区 Web、Redis 保持停止，数据库及备份保留；旧 Nginx 入口通过校验 Origin CA 的 HTTPS 转发至新服务器，避免 DNS 缓存期间写入两份数据。
- 新服务器已恢复队列和用户写入。若需无损回迁，必须先停止新写入并反向同步最新数据库、附件及 Redis；不能直接启动旧 Web 或仅改回 DNS。
- 迁移临时 SSH、Cloudflare、镜像拉取和测试凭据副本已清理，原始用户凭据文件与运行所需私有配置保留。
- 本地报告和截图：工作区 `.community-validation/migration-vm-20261107/`，以 `public-checks.json`、`loaded-pages.json` 及 `*-loaded.png` 为验收结果。

更新说明候选：项目迁移至新服务器，保留现有账户与内容，并增加管理员可配置的分类上传大小及暂存限制。

---
## 上一轮生产版本：社区四宫格广告位（2026-11-06）

- 站点：<https://zaiduyu.top>；服务器 `210.126.232.192`，应用目录 `/opt/ai-community`。
- 已部署应用提交：`aee9597c43110d7d7eb9f5686dda16f05f3be8d3`，私有仓库 `Tompulsen/ai-community` 的 `main` 分支。
- 固定镜像：`ghcr.io/tompulsen/ai-community:sha-aee9597c43110d7d7eb9f5686dda16f05f3be8d3`；摘要 `sha256:aecfcec83957a599b85594298e80d29a053a1aae69712c7b0cdffc0ea820f172`。
- GitHub 完整 Docker 构建 `42221282519` 成功；服务器镜像 revision 一致，应用、PostgreSQL、Redis 均 healthy。

### 使用方式

- 社区右侧搜索、公告、优质分享者下方新增固定 2×2 广告区，顺序为左上、右上、左下、右下。空槽保留中性“广告位待上架”占位。
- 管理员进入“管理后台 → 社区广告位”（`/admin/community-ads`），每格分别填写标题、上传或选择图片、填写跳转链接，开启“上架此广告”并保存。关闭开关并保存即可下架。
- 支持 PNG、JPEG、WebP、GIF、APNG，最大 20 MB；保留上传原始动图。链接在新窗口打开。
- 只向公开配置提供已上架且有效的广告；采用现有 JSONB 配置和管理员权限，单槽保存通过数据库原子合并保留其他配置。
- 保留桌面收起侧栏和手机抽屉。侧栏变长时可滚动到全部四格，支持中英文、主题和减少动态效果设置。
- 本次没有添加真实广告素材，等待管理员配置；未发布示例广告。

### 验证

- PASS：16 个变动 Vue/TS 文件的项目 ESLint、SPDX、locale safety、diff check；API 使用项目原生 OpenAPI/SDK 生成器更新并通过严格契约类型检查。
- PASS：新增广告和既有制作网址单元断言共 25 项，使用 Node test 适配器执行仓库原始测试（本地 Vitest 安装不完整）；8 组后端验证涵盖实际 API 权限拒绝、输入验证、公开过滤及真实 TypeORM SQL 在 PGlite 上的保存行为。PGlite 事务经单连接排队，未声称执行多连接并发压力测试。
- PASS：9 组实际 Vue 浏览器功能测试，3 组实际社区布局测试（1440/390/320px）；上传、取消、失败、上架、下架、错误恢复、双语、深色、焦点与抽屉均验证。前后端独立复核通过。
- PASS：线上 14 项检查，包含真实管理员登录、4 个生产编辑器、匿名权限拒绝、无效广告写入被拒且配置不变、公开草稿过滤、桌面及手机布局、中英文后台、源码归档校验。
- 线上现有公开作品 2 份；未新增作品、评论、点赞、关注或上传测试图片。仅更新本次公开源码版本链接。
- BASELINE：生产 `check-migrations` 检出既有 `meta.proxyRemoteFiles` 默认值 true/false 差异；已核对上一部署与本次实体声明一致。本次只扩展既有 JSONB 数据类型，没有新增数据库列或执行修复 DDL。
- 公开对应源码：`https://zaiduyu.top/source/ai-community.tar.gz?v=aee9597c43110d7d7eb9f5686dda16f05f3be8d3`；SHA-256 `eb9ef73f55005b99b042cd754924f34f33a92927b404482630c5b9ef0873f5f7`。

### 备份与回滚

- 本次备份：`/opt/ai-community-backups/sidebar-ads-20261106T125316Z`，包含可读取的数据库 dump、附件卷、私有配置、Compose、旧镜像引用和旧源码。
- 上一应用提交：`bc2f5ee925609660d46a9f798d5f3a4592f39efb`。健康检查失败会恢复旧 release.env 并回滚 web；本次未触发。
- 临时镜像拉取凭据已删除。完整报告和截图位于工作区 `.community-validation/sidebar-ads-production/`。

更新说明候选：新增管理员可独立上架的社区四宫格图片广告位，并完善侧栏长内容展示。

---
## 上一轮作品互动生产版本

- 访问地址：<https://zaiduyu.top>；服务器 `210.126.232.192`，项目目录 `/opt/ai-community`。
- GitHub 私有仓库：`Tompulsen/ai-community`，分支 `main`。
- 已部署应用提交：`bc2f5ee925609660d46a9f798d5f3a4592f39efb`。
- 固定镜像：`ghcr.io/tompulsen/ai-community:sha-bc2f5ee925609660d46a9f798d5f3a4592f39efb`。
- 镜像摘要：`sha256:a8d1214cffbf4d586a2a0e1d65ef289f9f128df2bbd59d0a621fd0f76805215d`。
- GitHub 完整 Docker 构建运行：`42191824571`，成功。服务器拉取镜像的 revision 与应用提交一致。
- 应用、PostgreSQL、Redis 均 healthy；仅更新 web，原数据库和附件卷继续使用。
- 公开源码：`https://zaiduyu.top/source/ai-community.tar.gz?v=bc2f5ee925609660d46a9f798d5f3a4592f39efb`；公网下载哈希与提交归档一致：`43af64746a92da01d7ebf154c64fb057d6f55f1e1b153c462efa3816ac9c391f`。

## 本轮作品互动、评论预览和制作页优化

- 首页可按文本、图片、视频选择分类热门作品，保留管理员配置展示及登录后的点赞评论入口。
- 社区作品右侧预览按可用空间显示评论；预览无内部滚动，完整讨论通过作品详情查看。
- 搜索、公告与创作者侧栏可收起，桌面记住选择并扩展作品区；手机使用可关闭抽屉，支持 Esc 和焦点恢复。
- 制作页改善目标自身来源和存储兼容性，新增仅重载 iframe、超时操作、双语故障说明及管理员嵌入配置提示。保留社区登录门槛。
- 本次无数据库迁移变更。

### 验证结果与边界

- PASS：25 个本次 Vue/TS 文件的项目 ESLint、SPDX、locale safety、diff check；本地前几轮的分类数据库/SDK契约、43 项评论与抽屉验证及14项制作页验证已完成。
- PASS：GitHub 完整 Docker 构建、镜像 revision、登录/注册弹窗 CSS 依赖、数据库 dump 可读取、上传附件备份、容器健康、公开源码哈希。
- PASS：线上 29 项账户/作品编辑/公开源码检查、16 项新功能检查、6 组冷启动弹窗检查；另验证真实评论读取完成及抽屉动画结束后的不透明面板。桌面、390px、320px、中英文截图已实看。
- 线上现有 1 份公开作品，评论接口正常返回空列表。未新增、删除或修改真实作品，未发布测试评论、点赞或转发；管理员作品版本和内容验证保持不变。
- 仅将公开源码设置更新为本次版本地址；其他站点 clientOptions 和名称保持不变。
- BASELINE：本地仓库交付总脚本触发 pnpm 补装既有不完整依赖并遇 EACCES，已停止；变动文件 ESLint 通过已有隔离工具链运行。完整发布构建在 GitHub 成功。
- 待处理：`oc.zhangyuapi.com` 本次实测仍返回 `frame-ancestors 'self' https://zhangyuapi.com`，没有允许 `https://zaiduyu.top`。目标站内嵌仍受限；需用户提供其源码或服务器配置路径，不能把本次社区部署称为目标站已恢复。

### 备份与回滚

- 本次备份：`/opt/ai-community-backups/interactive-ui-20261106T085917Z`；包含数据库 dump、上传卷、私有配置、Compose、旧镜像引用及旧源码。
- 上一应用提交：`a8a3950f6e81eb602978fe79f6a992fe9f0848bb`。健康失败自动恢复原 release.env 并回滚 web；本次未触发。
- 本次临时镜像拉取凭据已在拉取后删除。

更新说明候选：新增分类热门作品、评论预览及可收起社区侧栏，完善制作页加载与嵌入提示。

本轮截图和完整检查记录位于工作区 `.community-validation/interactive-ui-production/`。

---
## 上一轮现代极简 UI 生产版本

- 访问地址：<https://zaiduyu.top>；服务器 `210.126.232.192`，项目目录 `/opt/ai-community`。
- GitHub 私有仓库：`Tompulsen/ai-community`，分支 `main`。
- 已部署应用提交：`a8a3950f6e81eb602978fe79f6a992fe9f0848bb`。
- 固定镜像：`ghcr.io/tompulsen/ai-community:sha-a8a3950f6e81eb602978fe79f6a992fe9f0848bb`。
- 镜像摘要：`sha256:c49b41a699198641c2785ecfd887f7d7b1f93de4d1dc9fda9fbe815779be277c`。
- GitHub 完整 Docker 构建运行：`42155299154`，成功；镜像 OCI revision 与应用提交一致。
- 仅更新 web 容器，web / PostgreSQL / Redis 均为 healthy；应用仍绑定 `127.0.0.1:13000`。
- 公开源码：`https://zaiduyu.top/source/ai-community.tar.gz?v=a8a3950f6e81eb602978fe79f6a992fe9f0848bb`，SHA-256：`bc0489b01f149266bd66e3fc62355cda0995c1582557f754127822346be419f1`；公网下载与提交归档一致。

部署后的纯文档记录独立提交，不为记录重复构建应用。

## 本次现代极简 UI 改版（2026-11-06）

- 首页采用浅色背景、蓝色主操作与深色热门作品展示；保留管理员图片／动图及原有三模块作品布局。
- 统一社区作品卡、分类、右栏、作品详情、个人主页、制作入口、登录弹窗及访客／账户导航。手机访客使用横向导航；320px 英文首页三项制作入口完整可见。
- 默认浅／深主题及自托管 Inter 字体统一；自选主题机制保留。LeiBox 作为交互参考，未复制授权不明组件源码；OFL 字体声明随源码保存。
- 分享仅在实际复制成功后显示确认反馈；异步迟到结果在停用后失效，减少动态效果偏好关闭新增动画。
- 本次无后端 API 或数据库迁移变更；审核、账户、作品编辑删除和上传规则不变。

### 验证与边界

- PASS：本地认证 33 项、作品编辑 10 项、分享／视频／评论 7 项；13 组桌面／320px／390px／英文／深色预览，真实浏览器截图与独立 Vue 评审。
- PASS：中英文案键类型、作品相关类型检查、17 个变更 Vue／TS 文件 ESLint、全局 SCSS 编译、SPDX、locale safety 和 diff check。
- PASS：默认浅色正文／面板对比度 12.80:1，按钮 5.39:1；默认深色分别 10.31:1 与 10.54:1。
- PASS：线上 20 项真实账户／编辑／源码检查，6 组冷启动弹窗布局检查，8 项页面视觉与入口验证；截图和报告在外层 `.community-validation/minimal-ui-production/`。
- PASS：完整 Docker 构建、备份可读、固定 SHA 拉取、CSS 预加载依赖、源码哈希与容器健康。
- BASELINE：Impeccable 定向源码检测仅报告已有全局文字渐变样式和 bounce 辅助动画；本轮未新增此类样式。检测不代替浏览器验证。
- 保留当前邀请注册配置（disableRegistration=true）；线上测试未创建账号、作品、评论或点赞。外部视频站点的嵌入限制不因 UI 改版改变。
- SKIPPED：本次验收时公开作品及管理员投稿均为 0；线上核实对应空态与首页配置图片回退，详情、互动和编辑使用真实组件本地验证，未创建演示作品。

### 备份与回滚

- 本次备份：`/opt/ai-community-backups/minimal-ui-20261106T031358Z`，包含数据库 dump、上传卷、配置、旧源码与旧镜像标识。
- 前一镜像：`ghcr.io/tompulsen/ai-community:sha-aed53b32e22bc6088214272621ad5e924dc28c38`；健康失败时自动恢复旧 release.env 并回滚 web。未触发回滚。
- 临时镜像拉取凭据已删除，数据库与上传卷继续使用。

更新说明候选：全面更新社区界面为浅色极简与深色作品展示，并优化手机导航和分享反馈。
## 上一轮作品编辑删除与账户体验（2026-11-05）

- 作者可从个人主页作品栏及“我的投稿”编辑、删除自己的作品，包括已发布作品；编辑继续使用原 Note，保留点赞、评论、转发和浏览记录。
- 先审后发时，已公开作品的修改保存为私有待审稿，审核期间公开原版；先发后审时，公开作品的修改即时生效并进入审核。未公开、被驳回或下架作品的修改仍需审核。
- 服务端校验作者身份、附件所有权及版本，通过事务处理更新和删除。删除前需确认，保留原始上传文件；失败留稿，编辑稿与新投稿草稿隔离，并同步相关页面缓存。
- 邮箱或用户名与密码同屏输入、一次请求登录；支持自动填充、Enter 提交、密码显示、登录注册互切、内联错误和防重复提交。注册校验防止迟到响应覆盖，注册成功但本地 session 建立失败可重试登录，避免重复创建账号。
- 保留既有规则确认、邀请码、CAPTCHA、TOTP、备用码和 Passkey；当前邮箱＋密码注册流程不强制邮件验证，邮件服务待后续配置。
- 新增 `CommunityWorkEditing1793857663138` 迁移已在生产执行，`community_submission.pendingRevision` 的 JSONB 字段存在。

- 修复首页条件动态导入导致登录弹窗 CSS 漏载：登录与注册各自使用独立 loader，保留请求取消、迟到响应、弹窗销毁与错误处理。生产镜像中的两个样式预加载依赖均已验证。

### 验证与边界

- PASS：此前本地作品编辑后端 18 组、前端编辑/删除/草稿隔离 19 组，认证浏览器 33 组、真实 accounts.login 隔离检查 5 组，定向类型、SDK、变更文件 lint、SPDX、locale safety 及独立评审；详细报告位于外层 `.community-validation/work-edit/REPORT.md` 与 `auth-experience/REPORT.md`。
- PASS：GitHub 完整生产构建、固定 SHA 拉取、镜像 revision、备份 dump 可读取、新迁移及字段存在、源码归档哈希、三个容器健康。
- PASS：线上 29 项检查，覆盖公开社区、账号密码同屏、自动填充、密码显示、规则确认和邮箱注册表单、中英手机登录布局、真实管理员 Enter 登录且没有预查账号、本人投稿接口、未登录编辑读取被拒、编辑/删除入口、原内容载入、桌面/手机编辑布局、删除确认取消、个人主页编辑入口、公开源码一致。无页面异常或横向溢出。
- PASS：额外六组全新浏览器检查：首页登录及注册切换，覆盖 1440px、390px、320px 和中英文，核实不透明面板、登录面板 440px 最大宽度、居中及视口内可达。原版在该检查下可稳定复现失败，新版全部通过；已实看截图。当前站点 disableRegistration=true，首页独立注册按钮按既有配置隐藏；注册检查通过登录弹窗切换执行，邀请注册策略未改。独立注册 loader 的 CSS 依赖另由生产镜像产物校验。
- BASELINE：生产 check-migrations 仅报告 `meta.proxyRemoteFiles` 默认值 true/false 的两条既有差异，无本轮实体差异；未更改既有默认值。
- 边界：生产未注册测试账号，未保存或删除用户真实作品，未发布评论、点赞、转发或审核决定；已确认样本作品版本、标题及正文未变。实际保存/删除及错误恢复由本地隔离验证覆盖。真实邮件、第三方验证码与硬件 Passkey 不属于本次生产验收范围。
- 来源下载仅更新 repositoryUrl 为带本次 SHA 参数的地址，其余 clientOptions 与站点名称读回一致。无须改动 Cloudflare 缓存或白名单。
- 外部视频制作站的 CSP 嵌入限制不属于本次部署改动，制作链接仍为管理员原配置；可新窗口访问，内嵌需目标站允许社区来源。

生产记录与截图：`.community-validation/auth-css-production/checks.json`、`dialog-checks.json`、`signin-desktop.png`、`signin-mobile.png`、`signin-mobile-en.png`、`signup-mobile.png`、`editor-desktop.png`、`editor-mobile.png`、`profile-works-desktop.png`。

### 备份与恢复

- 功能升级备份目录：`/opt/ai-community-backups/work-auth-20261105T111636Z`；数据库、上传、私有配置、Compose、旧镜像引用与源码均保留，dump 已用 pg_restore --list 校验。
- 升级前镜像：`ghcr.io/tompulsen/ai-community:sha-1ad46d9f007da67e362e626eaa5651e32e559589`，已保留。新增可空 JSONB 字段与旧应用兼容，健康失败回滚恢复旧 release.env 和 web 容器；本次未触发回滚。
- 样式修复备份目录：`/opt/ai-community-backups/auth-css-20261105T114327Z`，补发前镜像 `ghcr.io/tompulsen/ai-community:sha-7a3946008c92b4094a7b72fcf9ef35f0b347daea` 也保留。
- 临时镜像拉取凭据已删除，原有数据库与上传卷继续使用。

更新说明候选：作者可编辑删除自己的社区作品，并优化邮箱/用户名登录、注册校验与失败恢复体验。

## 上一轮社区作品流与完整导航（2026-11-05）

- 保留原有完整左侧导航：社区、三个制作入口、个人主页、AI 工作台、我的投稿、作品审核、时间线、通知及原生功能。修复三个社区模块同时高亮，只有当前模块高亮，审核入口继续按管理权限显示。
- 社区默认展示全部公开作品，分区放在“最新作品”旁；公开搜索词与 URL 同步，跨分类及缓存页面恢复后保持一致，管理列表搜索不进入公开分类。线上首次验收发现的路由重建丢失搜索问题已修复并补充真实路由验证。
- 右侧展示搜索、管理员公告和近期公开作品中的优质分享者；手机保留搜索并支持展开公告与分享者。头像进入个人主页，关注复用原生流程与偏好。
- 公告复用 `/admin/announcements` 的已有管理流程。右栏匿名获取最多三条有效全站公告，不展示定向通知或自动标记已读；普通用户无发布权限。
- 视频悬停静音预览，支持开关声音、暂停、进度和全屏；离开、滚出视口、切后台或页面失活时暂停；多个预览互斥。触屏、省流、减少动态效果时主动播放，敏感媒体不自动加载。
- 一并发布评论草稿、发送快捷键、处理中反馈、错误恢复及点赞状态同步优化，新文案中英文同步。本轮为前端更新，无新增数据库迁移。

### 本轮验证与边界

- PASS：本轮 41 项社区组件与数据 adapter 检查、7 项真实 MkA / Nirax 导航检查、5 项真实 Surface / Nirax / KeepAlive 搜索路由检查；此前互动优化的 35 项检查已通过。全部为本地隔离验证，不伪称全仓测试。
- PASS：定向 TypeScript，15 个变更文件 ESLint（初版 14 文件及搜索修正的 3 文件有重叠），SPDX，locale safety，git diff --check；Vue 独立评审通过。
- PASS：GitHub 完整 Docker 镜像构建、固定 SHA 拉取、OCI revision、数据库备份可读取、源码归档哈希、三个容器健康。
- PASS：线上真实管理员登录、完整导航、三个模块逐项点击与精确高亮、社区默认全部、作品搜索与跨分类保留、右栏公开公告读取、游客互动登录要求、快速评论草稿、390px 中英文布局与移动信息栏展开；无页面错误或横向溢出。
- PASS：线上真实推荐者主页与游客关注登录要求，真实公开视频悬停静音播放、开关声音与移开暂停。当前全站公开公告为 0 条，已验证对应空态及匿名有效公告请求；没有为验证发布公告。具体结果记录于 `.community-validation/community-feed-production/checks.json`。
- SKIPPED：本机完整依赖安装有既有 EACCES，未重试全仓构建；完整生产构建由 GitHub Docker 流水线验证。
- 边界：未向生产发布评论、点赞、转发、关注或审核决定，未发布测试公告；只进行正常登录、浏览及本地浏览器草稿输入。正常浏览可能产生作品浏览计数。
- 源码缓存处理：不带版本参数的旧下载地址仍有 Cloudflare 缓存；已有 CF 令牌因出口 IP 限制未能执行清缓存。已仅更新站内 repositoryUrl 为上述带版本参数地址，公开下载哈希与运行版本一致，其他 clientOptions 和站点名称读回确认未变。无需为此追加 IP 白名单。

生产验收与截图：`.community-validation/community-feed-production/checks.json`、`community-admin-desktop.png`、`community-guest-desktop.png`、`community-mobile.png`、`community-mobile-en.png`。

### 本轮备份与恢复

备份目录：`/opt/ai-community-backups/feed-search-20261105T052323Z`。已备份数据库、上传文件、私有配置、Compose、旧镜像引用与源码，数据库 dump 经 pg_restore --list 校验。升级前镜像 `sha-de0d05b5514278fc2ae896ae5c2751b5a4454a51` 保留，可用于回滚；社区改版前版本 `sha-49e90b4b3d22ba13cb5bab6646effea965e131e2` 及备份 `/opt/ai-community-backups/feed-20261105T050835Z` 也保留。本轮健康启动成功，未回滚。临时镜像拉取凭据已删除。

更新说明候选：社区统一作品流、增加公告与分享者侧栏和静音视频预览，并保留完整导航、改善评论点赞转发体验。

## 上一轮作品互动与详情改版（2026-11-05）

- 社区作品卡片增加快速评论、原生转发、爱心点赞与真实浏览计数；评论草稿和转发结果状态可在站内路由往返中保留。
- 新作品页 /community/work/:submissionId 在桌面采用左侧作品、右侧信息与评论布局，手机改为上下排列。图片完整展示、GIF 保留动效、视频手动播放，多附件可切换，敏感媒体须主动展开。
- 作品信息下方的“制作同款”进入对应文本、图片或视频制作模块，继续使用管理员配置的网址及既有登录要求；另提供复制提示词，不假设第三方工具能够自动填充。
- 新增 CommunityWorkViews1793844969747 迁移与作品 show/view 接口，复用既有公开范围、作者隐私、关注时间和拉黑过滤。浏览计数从本轮上线开始统计；页面可见且预览进入视口满一秒才上报，同一账号或匿名请求 IP 在三十分钟内通过 Redis 原子键去重，数据库原子累加。
- 中文、英文文案同步；普通点赞、评论和转发继续调用原生 Note 接口，生产内容审核设置不变。

### 本轮验证与边界

- PASS：七组真实业务服务、TypeORM/PGlite 后端验证，覆盖权限、迁移 up/down、浏览去重及上限、缓冲点赞。
- PASS：二十项真实 Vue SFC、CSS、交互逻辑与 API 适配器的 Chromium 隔离检查，覆盖快速评论、失败草稿、分页、转发结果不确定、KeepAlive 状态同步、游客登录、中英文及 320px 长标题；无 pageerror。
- PASS：变更组件和共享逻辑针对生成 SDK 的定向类型检查，变更文件 ESLint、SPDX、locale safety、git diff --check；独立交叉评审无阻断项。
- PASS：GitHub 完整 Docker 镜像构建、服务器固定 SHA 拉取、OCI revision、源码归档 SHA-256、应用/PostgreSQL/Redis 三个容器健康。新增浏览计数迁移已在生产执行。
- PASS：线上真实公开作品《小狗自拍》的卡片、媒体解码、桌面左右布局、游客互动登录门控、制作同款及登录后制作入口、管理员登录、评论输入框、真实 Redis 同账号浏览去重、390px 中英文手机界面；无横向溢出或 pageerror。
- BASELINE：生产 check-migrations 仍仅报告 meta.proxyRemoteFiles 默认值 false/true 的两条既有差异，无本轮新实体差异。
- SKIPPED：本机完整依赖安装因 EACCES 失败，未宣称完整本地构建或全仓测试通过；完整生产构建由 GitHub Docker 流水线验证。
- 边界：线上只进行了正常浏览及登录，没有对用户作品发布评论、点赞、转发或执行审核决策。互动写入使用隔离服务验证；隔离 Redis 使用原子 fake，生产另验证真实 Redis 去重，但未进行多 PostgreSQL 连接并发压力测试。

本地验证报告：.community-validation/work-interactions-review/backend-results.json、frontend-results.json；生产验收与截图：.community-validation/work-interactions-production/checks.json、community-desktop.png、work-detail-desktop.png、work-detail-mobile.png、work-detail-mobile-en.png。

### 本轮备份与恢复

备份目录：/opt/ai-community-backups/interactions-20261105T023901Z。已备份数据库、上传文件、私有配置、Compose、旧镜像引用及源码；数据库 dump 已用 pg_restore --list 校验。升级前镜像为 sha-5da7f01201bff52a8c3f7c6d5d70ec7c0231d00b，保留在服务器。健康检查失败可恢复旧镜像；本轮健康启动成功，未回滚。临时镜像拉取凭据已删除。

## 上一轮审核修复（2026-11-05）

用户的《小狗自拍》已保存为 pending，未丢失。根因是投稿系统固定先审后发，而管理员菜单仍打开旧频道审核页；旧页面不能查询 community_submission，错误显示初始化提示。

- 管理后台 /admin/community 已接入真实投稿列表，默认“待处理”同时包含未公开待审和已公开待审作品。
- 管理员可保存“先审后发”或“先发后审”；默认并已保存为 before（先审后发）。切换只影响新投稿，既有 pending 不会自动公开。
- 先发后审创建 published 状态和公开 Note；随后审核通过不重新创建 Note，保留互动。幂等重试返回实际状态。
- 管理员可填写原因并确认违规下架。投稿状态、原 Note 删除、私有作者公告、删除审计在同一事务保存，外部事件仅在提交后发送。作者可在“我的投稿”查看下架记录和原因，在线收到原生私有公告事件，离线后重登仍可读取公告。
- 新迁移 CommunityModeration1793840812106 保存投稿时的发布模式，Note 外键改为 SET NULL，避免删除作品时连带丢失投稿历史；普通删除显示“作品已删除”。未修改历史迁移。
- 模式设置和新增审核状态支持中英；社区公共列表及热门作品可展示按先发后审模式公开的作品，未公开 pending 始终排除。

线上使用真实管理员账号确认《小狗自拍》可在审核列表和“我的投稿”查看，媒体可预览；作品仍保持 pending，未代替管理员批准、驳回或下架。

### 本轮验证

- PASS：10 组真实业务服务、实体、迁移和 TypeORM/PGlite 验证，包括两模式、切换不改旧稿、幂等冲突、权限、审核不重复建 Note、下架通知与审计、处理中途失败全部回滚，以及普通删除保留投稿；迁移 down/up 后目标实体 pending DDL 为 0。
- PASS：真实 Vue 组件的 Chromium 隔离验证：设置保存成功/失败、待处理筛选、下架必填原因与核对、取消不提交、409 保留反馈、下架状态筛选；320px 无横向溢出。
- PASS：后台和投稿组件脚本、API 适配器与重新生成的 SDK 定向类型检查；变更文件 ESLint、SPDX、locale safety 和 git diff --check。
- PASS：GitHub 最新固定 SHA 镜像构建、服务器拉取、OCI revision、三容器健康、源代码归档校验。
- PASS：线上原生管理员登录、匿名审核接口拒绝访问、审核设置保存且其他设置不变、真实投稿可见、pending 不进入公共列表、媒体详情、390px 手机和英文设置；浏览器无 pageerror。
- BASELINE：生产 check-migrations 仅报告既有 meta.proxyRemoteFiles 默认值 false/true 差异，无新增审核实体差异；未更改该既有默认值。
- SKIPPED：本地全量 SDK 构建因工作区缺少 tsx/依赖而失败，使用项目原生 OpenAPI 转换器与 SDK 生成器定向更新现有操作和 MetaClientOptions；完整 Docker 构建已通过。
- 边界：没有对用户真实作品执行审核写入。下架及通知持久性在隔离数据库验证，通知客户端真实 WebSocket 送达、真正多数据库连接并发和全量测试套件未执行。

本地验证记录位于工作区外层 .community-validation/moderation-review-checks.json、frontend-moderation-review/verification-results.json、moderation-production/checks.json；生产截图位于 moderation-production。

更新说明候选：修复管理员审核入口，支持可切换的发布模式及带原因通知的违规下架。

## 保留的首页与社区功能

官网首页采用用户指定的 playful 风格，支持中文与英文。顶部三个入口为文本、图片、视频制作，游客须先登录本站账号；社区入口保持公开浏览。管理员可配置首页图片 / 原始动图或社区热门作品，保留既有制作链接和项目 Logo。

热门窗口分为左上主作品预览、右上内容 / 提示词与“做同款”、底部作品信息和点赞 / 在线评论。图片完整展示，视频手动播放。点赞与评论调用原生 Note 接口；爱心独立计数，已有其他表情时明确提示替换。做同款复制作者内容后进入对应制作页，需自行粘贴到第三方工具。

内嵌评论确认成功后清空草稿并刷新公开回复，结果不确定时保留草稿及重发锁；同一账号、同一作品的草稿支持站内路由往返，浏览器刷新不保留。隐藏、删除、带内容警告和非公开评论不进入首页列表，敏感媒体以最新匿名 Note 标记为准。

同时发布此前已完成、待上线的社区投稿与审核、图片 / 视频 / 文档 / Skill 上传、原生表情选择及登录弹窗焦点修复。新增 `CommunitySubmission1793808005308` 迁移，已在生产数据库执行。

## 首页展示设置（上轮记录）

已通过真实管理员登录，在后台保存 `homeShowcaseMode=popular`，并验证原来的展示图片和三个制作链接未被覆盖。上线时 `/api/community/featured` 返回 0 件符合条件的作品；首页按设计显示已保存图片或默认视觉。待社区作品审核通过后，热门窗口自动展示三个互动模块。没有向生产社区发布演示作品、评论或虚构互动数据。

## 上一轮审核部署备份与恢复

本轮备份目录：`/opt/ai-community-backups/moderation-20261105T011750Z`（目录时间为 UTC，对应北京时间 2026-11-05）。

已备份数据库、上传文件、私有配置、Compose、旧镜像引用和旧源码。数据库为 PostgreSQL 自定义格式，已用 `pg_restore --list` 验证可读取。本轮升级前镜像为 `sha-a807eea41ed135aa76db37ea65cfe2a25e0a2777`，保留在服务器。更新使用固定 SHA 镜像，启动失败时自动恢复旧引用；本次启动成功，未执行回滚。私有镜像拉取使用临时凭据目录，完成后已删除。

## 上一轮首页验证记录

- PASS：GitHub 完整 Docker 构建、服务器镜像拉取、版本核对及三个容器健康检查。
- PASS：新增社区投稿迁移已执行，`community_submission` 存在；没有该实体相关的剩余 DDL。
- PASS：本地实际 Vue 组件的 21 项作品窗口交互检查，以及 23 项首页、语言、动图、登录入口回归检查。
- PASS：Vue 独立评审；草稿恢复、发送状态及账号隔离另有 8 项 Vue 生命周期验证。
- PASS：作品组件及交互逻辑针对实际生成的 Note / 回复 / 反应 API 类型检查；中英文文案键与图片 URL 工具检查。
- PASS：改变文件的 ESLint、SPDX、locale safety 与 Git diff 空白检查。
- PASS：公网首页、公开社区、制作入口登录门控、真实管理员账号登录、首页设置保存和预览、中英切换及 390px 英文手机界面；浏览器无运行时错误。
- PASS：公网健康检查和源代码下载；下载归档与应用版本对应的本地 Git 归档一致。
- BASELINE：生产执行 `pnpm --filter backend check-migrations` 仍发现既有 `meta.proxyRemoteFiles` 默认值 false / true 差异，与之前部署记录一致；检查未修改数据库默认值，不将其报告为全部迁移检查通过。
- SKIPPED：生产环境直接发布、点赞和评论真实作品的写入验收，因为当前没有已审核作品；未为验收创建公开演示内容。本地使用真实组件、原生 API 参数和测试响应完成对应交互检查。
- SKIPPED：完整后端测试套件与整个仓库的前端类型检查；本机完整开发依赖和测试服务不齐。本次使用针对性检查及 GitHub 完整生产镜像构建验证，不将其等同于完整测试套件。

更新说明候选：新增中英文官网首页、可配置的社区热门作品三模块展示，以及就地点赞、评论和做同款入口。
