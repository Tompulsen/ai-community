# 章鱼公益平台

基于 ChatGPT-Next-Web 深度定制的多模型 AI 服务平台，支持文本对话、多模态识图、图像生成（文生图/图生图/变体）、视频生成，通过统一的 API 代理网关接入上游服务。

[Web App](https://zhangyuapi.com/) | [API 文档](https://docs.zhangyuapi.com)

## 功能特性

- **多模型路由**：文本对话 / 多模态识图 / 文生图 / 图生图 / 图像变体 / 视频生成，自动路由到对应接口
- **同步生图**：文生图走 `images/generations`，图生图走 `images/edits`（multipart），无异步轮询
- **实时进度展示**：生图中... ⏱ 附带已用时长显示
- **结构化错误提示**：每个错误都带解决建议，如"认证失败 → 请刷新页面重新输入密码"
- **智能图片压缩**：
  - 小图片（<200KB）不压缩，保持原始质量
  - 中等图片（200KB-1MB）轻微压缩（0.9 质量）
  - 大图片（>1MB）aggressive 压缩（尺寸 + 质量）
  - 优先使用 WebP 格式（比 JPEG 小 30%），Safari 回退到 JPEG
  - 高质量平滑渲染（`imageSmoothingQuality: "high"`）
- **IndexedDB 图片缓存**：已上传的图片持久化存储，页面刷新不丢失
- **PWA 离线支持**：
  - 静态资源预缓存，支持离线访问
  - Service Worker 智能缓存策略（网络优先 / 缓存优先）
  - 支持添加到主屏幕，原生 App 体验
  - 桌面端支持拖拽图片上传，移动端支持 Ctrl+V 粘贴
- **自定义 API Key**：用户可在设置页填写自己的 Key，留空则用服务端 `MODEL_API_KEY`
- **站点密码保护**：可选的全局访问认证，支持中文密码
- **MCP 工具集成**：支持 Model Context Protocol 工具调用
- **HTTPS 代理出口**：支持 `PROXY_URL` 环境变量，通过 HTTP CONNECT 隧道出网
- **GitHub Actions 自动构建**：推送 `main` 自动构建 Docker 镜像到 ghcr.io

## 环境变量

| 变量 | 必填 | 说明 | 默认值 |
|------|------|------|--------|
| `MODEL_API_KEY` | ✅ | 上游 API Key（服务端使用，不暴露给客户端） | — |
| `BASE_URL` | ❌ | 上游 API 地址 | `https://zhangyuapi.com` |
| `ACCESS_PASSWORD` | ❌ | 站点访问密码，留空则不限制 | 无 |
| `CUSTOM_MODELS` | ❌ | 自定义模型列表，`+` 添加 `-` 隐藏 | 无 |
| `DEFAULT_MODEL` | ❌ | 新建会话的默认模型 | 无 |
| `HIDE_USER_API_KEY` | ❌ | 隐藏用户自行输入 API Key 的入口 | `false` |
| `ENABLE_RATE_LIMIT` | ❌ | 启用 IP 限流 | `true` |
| `RATE_LIMIT_MAX` | ❌ | 单 IP 每分钟最大请求数 | `20` |
| `RATE_LIMIT_WINDOW` | ❌ | 限流窗口（秒） | `60` |
| `ENABLE_MCP` | ❌ | 启用 MCP 工具 | `false` |
| `MODELS_API_URL` | ❌ | 远程模型列表 API 地址 | 无 |
| `PROXY_URL` | ❌ | 代理出口地址（HTTP CONNECT 隧道） | 无 |

### 上游 API 兼容性

项目兼容 [NewAPI](https://github.com/songquanpeng/one-api) 风格接口，上游需支持以下端点：

| 端点 | 用途 | 请求格式 |
|------|------|----------|
| `POST /v1/chat/completions` | 文本对话 / 多模态识图 | JSON |
| `POST /v1/images/generations` | 文生图（纯文字 prompt） | JSON |
| `POST /v1/images/edits` | 图生图 / 图像编辑（带参考图） | multipart/form-data |
| `POST /v1/images/variations` | 图像变体生成 | multipart/form-data |
| `POST /v1/videos/generations` | 提交视频生成任务 | JSON |
| `GET /v1/videos/{task_id}` | 查询视频生成任务状态 | — |
| `GET /v1/models` | 获取可用模型列表 | — |
| `POST /v1/embeddings` | 文本嵌入向量 | JSON |

## 部署

### Vercel（零配置）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fqzq00767%2Foctopus_chat&env=MODEL_API_KEY&project-name=octopus-chat&repository-name=octopus_chat)

**Hobby 计划限制**：Node.js 函数 10s 超时，Edge 函数 30s 超时，请求体上限 4.5MB。大图片生图建议用 Docker 部署。

### Docker 自部署（推荐）

```bash
# 构建
docker build -t octopus-chat .

# 运行
docker run -d -p 3000:3000 \
  -e MODEL_API_KEY=你的Key \
  -e BASE_URL=https://zhangyuapi.com \
  -e ACCESS_PASSWORD=可选密码 \
  --name octopus-chat \
  octopus-chat
```

或使用 GitHub Actions 自动构建：

```bash
git tag v1.0.0
git push origin v1.0.0
# Actions 自动构建并推送到 ghcr.io
```

拉取镜像：

```bash
docker pull ghcr.io/你的用户名/octopus_chat:latest
```

### docker-compose

```bash
# 无代理
docker compose --profile no-proxy up -d
# 有代理
docker compose --profile proxy up -d
```

### VPS 手动部署

```bash
npm install --legacy-peer-deps
npm run build
MODEL_API_KEY=你的Key node .next/standalone/server.js
```

## 模型路由规则

| 模型类型 | 匹配规则 | 路由接口 | 说明 |
|----------|---------|----------|------|
| 文本对话 | 其他 | `chat/completions` | GPT / Claude / DeepSeek 等 |
| 多模态识图 | `gpt-4o` / `gpt-5` / `claude-3.5` / `gemini-1.5` 等 | `chat/completions` | 图片作为 `image_url` 嵌入消息 |
| 文生图（无图） | `gpt-image` / `dall-e` / `flux` 等 | `images/generations` | JSON 请求 |
| 图生图（有图） | `gpt-image` + 参考图 | `images/edits` | multipart 上传，客户端自动压缩 |
| 视频生成 | `t2v` / `sora` / `kling` etc | `videos/generations` | 异步提交 |

## 错误提示对照

| 用户看到 | 实际原因 | 解决方法 |
|----------|---------|---------|
| ⚠️ 认证失败 | ACCESS_PASSWORD 错误或已更改 | 刷新页面重新输入密码 |
| ⚠️ 无法连接到服务器 | 网络断开或 Vercel 超时 | 检查网络，或换 Docker 部署 |
| ⚠️ 请求超时 | 上游响应超过 6 分钟 | 稍后重试，或降低图片尺寸 |
| ⚠️ 账户绘图额度不足 | API Key 配额耗尽 | 充值或更换 Key |
| ⚠️ 当前渠道不支持该模型 | 上游不支持此模型 | 更换模型 |
| ⚠️ 请求限流 | 调用过于频繁 | 稍后再试 |
| 图片上传失败 | 图片过大或网络问题 | 已自动压缩为 WebP/JPEG，可尝试拖拽或 Ctrl+V 上传 |

## 架构

```
浏览器 → Next.js API 路由 → 上游 API
         ├── Edge Runtime（images/generations, videos/*, models）
         └── Node.js Runtime（chat/completions, images/edits, images/variations）
```

## 开发

```bash
npm install --legacy-peer-deps
# 创建 .env.local
# MODEL_API_KEY=你的Key
npm run dev
# http://localhost:3000
```

## 技术栈

- **框架**：Next.js 14 (App Router) + React 18
- **语言**：TypeScript
- **状态管理**：Zustand
- **样式**：SCSS Modules
- **PWA**：Service Worker + Manifest + IndexedDB
- **图片处理**：Canvas 压缩 + WebP 格式支持
- **部署**：Vercel / Docker / VPS
- **CI**：GitHub Actions → ghcr.io

## License

MIT
