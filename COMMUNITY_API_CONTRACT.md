# AI 社区：发布前审核接口契约

日期：2026-11-04。**这是待后端实现的契约，不是已运行的服务说明。**

用户明确选择：投稿先审核，通过后公开。前端的正式数据仅来自下列接口，不回退到公开标签、普通频道、localStorage 或预览夹具。

## 请求与身份

延用 Misskey 的 `POST /api/<endpoint>`、JSON 请求体和 `i` 登录令牌。服务端从令牌确认身份，不能接受客户端传入的作者、审核状态或审核权限。所有投稿和审核响应应禁止共享缓存。公开作品还应遵循实例对访客的内容可见性政策。

分类：`video`、`image`、`resource`；前端 `/community/knowledge` 映射到 `resource`。

## 五个接口

| Endpoint | 权限 | 请求 | 响应 |
| --- | --- | --- | --- |
| `community/works` | 按实例公开内容政策 | `category?`, `authorId?`, `query`, `limit`, `untilId?`（见个人主页约定） | `{ items: CommunityWork[], nextCursor: string \| null }`，仅已通过作品 |
| `community/submissions/create` | 已登录本地用户 | 下方投稿结构 | `{ id, status: "pending", submittedAt }` |
| `community/submissions/mine` | 已登录用户，仅本人 | `status: all/pending/approved/rejected`, `query`, `limit`, `untilId?` | 同分页结构 |
| `admin/community/submissions` | 管理员／审核员 | `status`, `query`, `limit`, `untilId?` | 同分页结构，含待审核完整内容 |
| `admin/community/review` | 管理员／审核员 | `submissionId`, `version`, `decision: approve/reject`, `reason?` | 审核完成后的完整 `CommunityWork` |

投稿请求：

```json
{
  "idempotencyKey": "client-generated-uuid",
  "category": "resource",
  "title": "作品标题",
  "text": "正文、创作说明或代码",
  "model": "模型或工具，可为空",
  "sourceUrl": "",
  "license": "",
  "fileIds": []
}
```

限制：标题 1–100 字符；正文最多 2500；model 最多 100；sourceUrl 最多 2000 且仅允许 HTTP(S)；license 最多 200；附件最多 16 个、去重。正文与附件至少有一项。视频至少有 video/* 附件，图片至少有 image/* 附件。附件必须属于当前用户，审核时重新核实存在性和归属。

相同用户、相同 `idempotencyKey` 和相同内容的重试返回同一投稿，不创建重复记录；同 key 不同内容返回冲突。前端在同一未成功提交的内容重试时保留 key，改动内容则生成新 key。服务端固定初始状态 pending，不允许客户端选择 approved。

## CommunityWork

精确 TypeScript 结构见 `packages/frontend/src/pages/community/types.ts`：

```ts
{
  id: string;
  version: number; // 非负整数，审核基于不可变版本
  category: 'video' | 'image' | 'resource';
  title: string; text: string; model: string; sourceUrl: string; license: string;
  files: Array<{id: string; name: string; type: string; url: string;
    thumbnailUrl?: string | null; isSensitive?: boolean}>;
  author: {id: string; name: string; username: string};
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string; // ISO 时间
  rejectionReason: string | null;
  approvedNoteId: string | null;
  repliesCount: number; // 非负整数，来自实际 Note
}
```

本轮所有字段按此结构返回；未填写的可选文本返回空字符串，不返回 undefined。approved 状态必须有合法 approvedNoteId。ID 和分页游标允许 1–128 位字母、数字、下划线、连字符；不要将 URL 作为 ID。分页默认 20 条，服务端限制最大值并维持稳定顺序；查询涵盖标题、正文、创作者。nextCursor=null 表示结束。

审核拒绝必须包含 1–1000 字符理由。审核通过需生成／绑定可被原生 `/notes/:id` 访问的 Note，并保留作者身份、正文、附件、来源和授权说明，让既有回复功能可用。审核请求携带 version，版本过期或已处理返回 409；不能重复公开。批准和实际公开之间需要原子性或可靠恢复机制。

## 错误

- 401：登录失效，前端引导重新登录。
- 403：无权限，不降级读取其他 API。
- 404/501/503：前端显示社区审核服务未接通或暂不可用。
- 409：已处理或版本改变，前端提示刷新并重新核对。
- 非预期结构、未审批公开记录、错误分类：前端拒绝展示整批响应。
- 网络错误：保留投稿输入；审核不乐观更新，不伪造已保存状态。

## 后端必须验证的边界

1. 待审核／被驳回投稿仅本人和授权审核员可读，不能进入公开列表、搜索、推送或联邦。
2. 公开列表以受审核保护的作品记录为准，不能通过普通 Note、频道或标签绕过。
3. 两名管理员并发处理、网络超时重试均最多形成一个审核结果与公开 Note。
4. 通过后的正文或附件变更必须重新审核，不能借原有 Note 编辑入口绕过。
5. 删除作品、封禁作者后，公开列表与评论链接对应的内容正确撤下。
6. 既有网盘资源 URL 不提供待审附件私密性。若要求“未通过附件也不可被直链访问”，必须补充私有存储及授权下载策略。
7. 当前原生时间线、频道、普通发帖和其他 API 仍然存在。如需要整站强制预审，应在后端统一覆盖这些发布路径。导航与按钮不是权限边界。
8. `NoteCreateService.create()` 内部自行插入 Note 并异步执行发布副作用；在外层包一层事务并不自动保证投稿状态与公开 Note 原子提交。需要后端专门设计幂等与恢复，不可简单套用。

现有 `/admin/community` 的频道作品下架页面属于发布后治理。真正待审核工作台为 `/community/review`，二者不可混称。

## 个人主页公开作品（2026-11-04）

`community/works` 增加可选 `authorId` 筛选。三大社区仍必须提供 `category`；仅在提供有效 `authorId` 时允许省略 `category`，表示该作者全部分类的已通过作品。个人主页请求示例：`{ authorId, query, limit, untilId? }`；分类页签请求加 `category: video/image/resource`。

服务端必须在分页前同时应用作者、分类（如有）、approved 状态及实例/作者/作品可见性规则；不能让前端从普通社区第一页过滤作者。`authorId` 仅为公开查询条件，不是投稿作者或鉴权身份。前端拒绝任何作者不符、分类不符或未通过的整批响应。待审与驳回投稿继续仅在有权限的“我的投稿”/审核工作台显示。该扩展仍待后端实现。
