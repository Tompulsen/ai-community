# AI 社区 Docker 部署

目标：`https://zaiduyu.top`，服务器 `38.114.89.52`（Ubuntu 24.04、1Panel v2.4.2）。

2026-11-07 已完成服务器迁移、数据恢复、域名切换及分类上传限制部署。既有账户、作品、附件和站点配置保留；运行版本、验收结果及历史记录见 [STATUS.md](STATUS.md)。

采用现有 Misskey/Vue 后端与账户系统，Docker Compose 运行应用、PostgreSQL 18 和 Redis 7。参考本地 Supabase 的数据库及容器服务分工，没有另建第二套身份系统。数据库、Redis 不发布公网端口；应用绑定 `127.0.0.1:13000`，复用 1Panel 服务器已有的 host-network OpenResty 反向代理，不新增 80/443 端口监听服务。

`main` 分支的应用或部署代码更新会触发 `Build community container`，构建并发布镜像 `ghcr.io/tompulsen/ai-community`。镜像提供 `latest` 和 `sha-<完整提交号>` 标签。生产更新应先确认对应工作流成功，再使用提交标签，避免更新过程中版本改变。源码仓库 `Tompulsen/ai-community` 已公开；容器包访问权限独立管理，需要认证时使用有包读取权限的凭据。

## 制作链接与 Logo

使用管理员账号进入“控制面板 → 制作页面链接”（`/admin/creation-links`），分别填写文本、图片和视频制作的完整 HTTPS 地址，选择“在工作区内打开”或“在新窗口打开”，然后保存。
未配置时显示待配置页面；迁移保留现有网址配置。网址是公开配置，不应包含私密令牌或账号密码。目标站禁止被内嵌时，需由目标站允许社区来源，或选择新窗口方式。

左侧保留一个“社区”入口，内部仍有作品分类；其下是三类制作入口。独立网盘界面已移除，旧网盘地址返回社区，上传和文件选择继续用于 Logo 与投稿附件。
管理员点击“修改项目 Logo”或进入品牌设置，可上传 PNG/JPEG/WebP/GIF（最大 2 MB）、选择已上传图片、预览、保存或恢复默认。

## 邮箱账户

- 注册需要用户名、邮箱、密码；邮箱去除首尾空格并统一为小写。
- 邮箱随账户在同一事务保存，数据库函数唯一索引防止并发重复。
- 支持邮箱或原用户名登录，沿用密码校验、限流、MFA。
- 邮箱未经过所有权验证，`emailVerified=false`，不能用于邮件找回密码。后续启用 SMTP 后使用既有验证流程。
- 管理员使用用户提供的独立账号文件初始化，不为管理员虚构邮箱。
- 首次部署需先完成管理员初始化，再开放 Nginx 入口；公共注册不能抢占首次管理员。

## 配置与启动

在可信本机执行 `python deploy/prepare.py --admin-file <管理员文件绝对路径>`，生成 `deploy/private`。凭据不输出到终端，该目录已从 Git、Docker 构建和公开源码包排除。已有配置不会被覆盖。

配置始终使用 LF 换行，支持在 Windows 生成后上传 Linux。Compose 使用固定内部端口的健康检查，避免依赖脚本对配置文件的文本解析。

服务器上的路径为 `/opt/ai-community`。配置文件目录授权给容器 UID/GID 991，其他凭据仅 root 可读。执行：

```sh
umask 077
# 已部署实例更新前先备份原 release.env，并将占位符替换为构建成功的完整提交号。
printf 'COMMUNITY_IMAGE=ghcr.io/tompulsen/ai-community:sha-%s\n' '<完整提交号>' > deploy/private/release.env
# 首次拉取私有镜像前，通过标准输入使用有包读取权限的令牌登录 ghcr.io。
printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io -u Tompulsen --password-stdin
docker compose --env-file deploy/private/release.env -f deploy/compose.yml config --quiet
docker compose --env-file deploy/private/release.env -f deploy/compose.yml pull
docker logout ghcr.io
unset GHCR_READ_TOKEN
docker compose --env-file deploy/private/release.env -f deploy/compose.yml run --rm --no-deps --user root --entrypoint sh web -c 'mkdir -p /misskey/files && chown 991:991 /misskey/files'
docker compose --env-file deploy/private/release.env -f deploy/compose.yml up -d --no-build --wait
docker compose --env-file deploy/private/release.env -f deploy/compose.yml cp deploy/private/bootstrap.json web:/tmp/community-bootstrap.json
docker compose --env-file deploy/private/release.env -f deploy/compose.yml exec -T --user root web node deploy/bootstrap.mjs /tmp/community-bootstrap.json
docker compose --env-file deploy/private/release.env -f deploy/compose.yml exec -T --user root web rm /tmp/community-bootstrap.json
```

也可在有足够资源的环境运行 `docker compose -f deploy/compose.yml build web` 自行构建。更新前备份数据库和当前使用的镜像提交号；首次执行需要完成管理员初始化，现有部署可直接运行拉取与启动命令。

应用启动自动运行迁移。`UniqueCommunityEmail` 迁移遇到历史重复邮箱会停止，不自动删除或合并账户；需人工处理冲突后再迁移。

生产服务器拉取 GitHub 构建的镜像，应用运行限制为单 worker。镜像保留上游锁文件及 Node 26.12.1 / pnpm 12.15.0。早期服务器构建所用的临时 swap 已在验收后清理。

## 域名和 HTTPS

2026-11-07 根域名已在实例恢复核对和功能验收后，从 `210.126.232.192` 切换至 `38.114.89.52`，Cloudflare 代理保持开启；其他子域记录保留。

`nginx.conf` 是反向代理模板，不能不调整路径就覆盖当前生产配置。当前配置位于宿主机 `/opt/1panel/www/conf.d/zaiduyu.top.conf`；站点文件在 `/opt/1panel/www/sites/zaiduyu.top/`，在 OpenResty 容器中对应 `/www/sites/zaiduyu.top/`。

证书文件必须先存在，再执行 OpenResty 配置检查和 reload。当前采用 Cloudflare Origin CA 证书，私钥仅保存在受限目录，公网 HTTPS 由 Cloudflare 边缘证书提供。根域记录必须保持代理开启；直连源站不属于公网证书信任路径。公开源码包排除凭据，宿主机路径为 `/opt/1panel/www/sites/zaiduyu.top/source/ai-community.tar.gz`。更新应用时同步对应源码包及站内带版本参数的源码链接。

## 分类上传限制

管理员在 `/admin/upload-limits` 分别设置图片、视频、音频、文档／代码／Skill、其他文件／压缩包的单文件上限。默认均为 20 MB，可填 1–10240 MB 的整数；实际值同时受服务器与账户上限约束。当前服务器总上限为 50 MB，页面显示生效值。接收及暂存过程中超限拒绝，失败时清理临时文件；不包含累计空间配额或保留时长设置。

## 数据和运维

Compose 项目名固定为 `ai-community`，数据库、Redis 和用户附件使用独立命名卷。更新时使用 `docker compose up -d`；不要执行 `down -v`。迁移前备份数据库，例如：

```sh
umask 077
docker compose --env-file deploy/private/release.env -f deploy/compose.yml exec -T db pg_dump -U community community > community-backup.sql
```

数据库备份同时配套保存上传附件卷、Redis 数据和私有配置。迁移时先暂停并排空队列，再停止旧写入并生成最终一致性快照。健康检查使用 `/healthz`，容器日志限制为每服务 3 个 10 MB 文件。

本次迁移备份在新旧服务器的 `/opt/ai-community-backups/migration-vm-20261107`；包括最终快照、原配置和恢复核对结果。旧服务器的 Web、Redis 保持停止，旧 Nginx 入口转发至新服务器，以兼容 DNS 缓存。新服务器已接收写入，回迁前必须停写并反向同步最新数据库、附件及 Redis，不能仅切回 DNS 或启动旧 Web。备份摘要和具体状态见 [STATUS.md](STATUS.md)。

## 当前验证范围

本次 GitHub 完整 Docker 构建成功，118 张 public 表逐表行数及 13 个物理附件的大小、SHA-256 均与最终快照一致。目标演练已验证分类限制保存、图片和 Skill 文档超限拒绝、合法上传及临时文件清理。

公网已验证原管理员登录、两份现有作品与附件、上传设置及权限、中英文桌面／手机页面、实时连接和公开源码哈希；三个社区容器健康，现有其他应用运行正常。数据库仍有既有 `proxyRemoteFiles` 默认值差异，本次未改动实体或迁移文件。历史检查边界及详细结果见 [STATUS.md](STATUS.md)。
