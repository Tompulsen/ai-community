# AI 社区 Docker 部署

目标：`https://zaiduyu.top`，服务器 `210.126.232.192`。

2026-11-04 已完成 Docker 镜像拉取部署、域名 HTTPS、账户系统、Logo 上传、全宽工作区及在线制作链接配置。运行版本、验收结果及尚未完成的检查见 [STATUS.md](STATUS.md)。

采用现有 Misskey/Vue 后端与账户系统，Docker Compose 运行应用、PostgreSQL 18 和 Redis 7。参考本地 Supabase 的数据库及容器服务分工，没有另建第二套身份系统。数据库、Redis 不发布公网端口；应用绑定 `127.0.0.1:13000`，由服务器已有 Nginx 反向代理。

`main` 分支的应用或部署代码更新会触发 `Build community container`，构建并发布私有镜像 `ghcr.io/tompulsen/ai-community`。镜像提供 `latest` 和 `sha-<完整提交号>` 标签。生产更新应先确认对应工作流成功，再使用提交标签，避免更新过程中版本改变。源码仓库及容器包保持私有。

## 制作链接与 Logo

使用管理员账号进入“控制面板 → 制作页面链接”（`/admin/creation-links`），分别填写文本、图片和视频制作的完整 HTTPS 地址，选择“在工作区内打开”或“在新窗口打开”，然后保存。
三个网址按用户要求先留空；未配置时显示待配置页面。网址是公开配置，不应包含私密令牌或账号密码。需要登录或禁止被内嵌的网站选择新窗口方式。

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

根域名已在实例健康检查、管理员和账户验收通过后，从 `154.9.252.197` 切换到本服务器并启用 Cloudflare 代理；其他子域记录保留。

`nginx.conf` 是目标配置。证书文件必须先存在，再安装此配置并执行 Nginx 配置检查和 reload。当前采用 Cloudflare Origin CA 证书，私钥仅保存在私有配置目录，公网 HTTPS 由 Cloudflare 边缘证书提供。根域记录必须保持代理开启；直连源站不属于公网证书信任路径。勿占用其他站点的 80/443 监听端口。源码下载路径应指向经排除凭据后的 `/opt/ai-community-source.tar.gz`。

## 数据和运维

Compose 项目名固定为 `ai-community`，数据库、Redis 和用户附件使用独立命名卷。更新时使用 `docker compose up -d`；不要执行 `down -v`。迁移前备份数据库，例如：

```sh
umask 077
docker compose --env-file deploy/private/release.env -f deploy/compose.yml exec -T db pg_dump -U community community > community-backup.sql
```

数据库备份同时配套保存上传附件卷和私有配置。健康检查使用 `/healthz`，容器日志限制为每服务 3 个 10 MB 文件。

## 当前验证范围

本地已检查 4 个账户 Vue 组件的模板/TypeScript 转译/SCSS/文案引用，运行真实登录与注册处理函数的依赖隔离回归，覆盖邮箱规范化、匿名预检不查询账户、错误密码、用户名登录、MFA、缺失或非法密码以及未验证邮箱传递。可移植脚本为 `scripts/test-email-auth.mjs`。

GitHub 镜像构建、真实 PostgreSQL 邮箱索引迁移、线上 API、桌面注册和手机邮箱登录也已通过，SPDX 检查通过。数据库模型仍有一处 `proxyRemoteFiles` 默认值差异；定向后端 ESLint 仅在测试辅助文件报告两处错误，前端 ESLint 因生产镜像缺少开发依赖未运行，本机 shipping 检查仍受缺失 `execa` 限制。完整结果见 [STATUS.md](STATUS.md)。

另有部署前基线问题：`BACKEND-COMMUNITY-HANDOFF.md` 记录社区页面的投稿/发布前审核接口未实现；此轮账户改造没有将模拟数据或组件预览当作生产后端。
