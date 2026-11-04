# AI 社区 Docker 部署

目标：`https://zaiduyu.top`，服务器 `210.126.232.192`。

采用现有 Misskey/Vue 后端与账户系统，Docker Compose 运行应用、PostgreSQL 18 和 Redis 7。参考本地 Supabase 的数据库及容器服务分工，没有另建第二套身份系统。数据库、Redis 不发布公网端口；应用绑定 `127.0.0.1:13000`，由服务器已有 Nginx 反向代理。

## 邮箱账户

- 注册需要用户名、邮箱、密码；邮箱去除首尾空格并统一为小写。
- 邮箱随账户在同一事务保存，数据库函数唯一索引防止并发重复。
- 支持邮箱或原用户名登录，沿用密码校验、限流、MFA。
- 邮箱未经过所有权验证，`emailVerified=false`，不能用于邮件找回密码。后续启用 SMTP 后使用既有验证流程。
- 管理员使用用户提供的独立账号文件初始化，不为管理员虚构邮箱。
- 首次部署需先完成管理员初始化，再开放 Nginx 入口；公共注册不能抢占首次管理员。

## 配置与启动

在可信本机执行 `python deploy/prepare.py --admin-file <管理员文件绝对路径>`，生成 `deploy/private`。凭据不输出到终端，该目录已从 Git、Docker 构建和公开源码包排除。已有配置不会被覆盖。

服务器上的路径为 `/opt/ai-community`。配置文件目录授权给容器 UID/GID 991，其他凭据仅 root 可读。执行：

```sh
docker compose -f deploy/compose.yml config --quiet
docker compose -f deploy/compose.yml build web
docker compose -f deploy/compose.yml run --rm --no-deps --user root --entrypoint sh web -c 'mkdir -p /misskey/files && chown 991:991 /misskey/files'
docker compose -f deploy/compose.yml up -d --wait
docker compose -f deploy/compose.yml cp deploy/private/bootstrap.json web:/tmp/community-bootstrap.json
docker compose -f deploy/compose.yml exec -T --user root web node deploy/bootstrap.mjs /tmp/community-bootstrap.json
docker compose -f deploy/compose.yml exec -T --user root web rm /tmp/community-bootstrap.json
```

应用启动自动运行迁移。`UniqueCommunityEmail` 迁移遇到历史重复邮箱会停止，不自动删除或合并账户；需人工处理冲突后再迁移。

2 GB 内存服务器使用顺序构建和独立临时 swap，保留上游锁文件及 Node 26.12.1 / pnpm 12.15.0。应用运行限制为单 worker。

## 域名和 HTTPS

根域名原记录指向 `154.9.252.197`；在新实例本机健康检查、管理员和账户验收通过后，修改根域 A 记录到本服务器并启用 Cloudflare 代理，保留其他子域记录。

`nginx.conf` 是目标配置。证书文件必须先存在，再安装此配置并执行 Nginx 配置检查和 reload。当前采用 Cloudflare Origin CA 证书，私钥仅保存在私有配置目录，公网 HTTPS 由 Cloudflare 边缘证书提供。根域记录必须保持代理开启；直连源站不属于公网证书信任路径。勿占用其他站点的 80/443 监听端口。源码下载路径应指向经排除凭据后的 `/opt/ai-community-source.tar.gz`。

## 数据和运维

Compose 项目名固定为 `ai-community`，数据库、Redis 和用户附件使用独立命名卷。更新时使用 `docker compose up -d`；不要执行 `down -v`。迁移前备份数据库，例如：

```sh
umask 077
docker compose -f deploy/compose.yml exec -T db pg_dump -U community community > community-backup.sql
```

数据库备份同时配套保存上传附件卷和私有配置。健康检查使用 `/healthz`，容器日志限制为每服务 3 个 10 MB 文件。

## 当前验证范围

本地已检查 4 个账户 Vue 组件的模板/TypeScript 转译/SCSS/文案引用，运行真实登录与注册处理函数的依赖隔离回归，覆盖邮箱规范化、匿名预检不查询账户、错误密码、用户名登录、MFA、缺失或非法密码以及未验证邮箱传递。可移植脚本为 `scripts/test-email-auth.mjs`。

这些检查不代替实际 PostgreSQL 迁移、容器完整构建或线上浏览器验收。源目录不是 Git 仓库且本机依赖未完整安装，上游 shipping/SPDX 脚本目前不能运行；需在构建环境执行目标文件 ESLint 和数据库检查。

另有部署前基线问题：`BACKEND-COMMUNITY-HANDOFF.md` 记录社区页面的投稿/发布前审核接口未实现；此轮账户改造没有将模拟数据或组件预览当作生产后端。
