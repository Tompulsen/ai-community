---
name: AI 创作社区
description: 作品在前，操作归位。
colors:
  canvas: "#1c1c1c"
  primary: "#8fa68e"
  primary-hover: "#aec2a8"
  primary-soft: "#2c362c"
  action-ink: "#1c1c1c"
  surface: "#262626"
  surface-soft: "#303030"
  border: "#3c3d3a"
  ink: "#f1f1ef"
  muted: "#aaaca6"
  success: "#a4cfb4"
  success-soft: "#293a30"
  pending: "#e3c38c"
  pending-soft: "#403728"
  danger: "#f1a0a7"
typography:
  headline:
    fontFamily: '"Schibsted Grotesk", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "28px"
    fontWeight: 500
    lineHeight: "36px"
    letterSpacing: "0"
  title:
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "0"
  section:
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "0"
  reading:
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "28px"
    letterSpacing: "0"
  mobile-headline:
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "32px"
    letterSpacing: "0"
  body:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "21px"
    letterSpacing: "0"
  label:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
    letterSpacing: "0"
rounded:
  small: "4px"
  control: "6px"
  framed: "32px"
  media-inner: "0"
spacing:
  compact: "4px"
  related: "8px"
  control: "12px"
  group: "16px"
  gutter: "24px"
  section: "32px"
  margin: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  text-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "40px"
  tag:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.muted}"
    rounded: "{rounded.small}"
    padding: "4px 12px"
---

# Design System: AI 创作社区

## Overview

**Creative North Star: "作品在前，操作归位"**

这是持续使用的创作社区界面。采用 tasteskill 的 charcoal-room-sage 配色，
以用户提供的 Aceternity Layout Grid 为当前作品参考，沿用五列栅格、炭灰界面、紧凑顶部导航、
大小交错的真实作品卡片和鼠尾草绿操作。

**Key Characteristics:**

- 作品直接进入首屏，导航与筛选保持稳定。
- 中性界面让内容提供颜色；鼠尾草绿标明主要操作与当前状态。
- 创作、投稿、审核和账户状态分别表达。

## Colors

主色用于主要操作、选择和焦点。炭灰是页面，稍浅的中性灰用于控件与工具。
明亮正文与灰色元信息保持层级。绿色表示成功或已公开，琥珀色表示待处理，
红色用于错误和删除；不能仅靠颜色传达状态。

## Typography

拉丁字形使用本地 Schibsted Grotesk 可变字体，中文沿用系统字体。字号固定，不随视口宽度连续缩放。桌面页面标题采用
headline，手机页面标题为 24px/32px；详情标题也采用 24px/32px。
正文和按钮采用 14px，区块标题采用 18px/28px，长文采用 16px/28px，
辅助信息采用 12px。所有字距为零。
作品标题单行省略，详细内容换行；不能用截断掩盖表单错误。

## Layout

浏览页面最大宽度 1512px。内容左右留白 40px，1279px 以下 32px，手机为 16px。
作品网格采用五列 Bento 排列，不采用瀑布流或 dense 重排。每八项中第六和第八项在桌面跨两列，
资源与骨架保留按序号跨列的节奏。
有可靠尺寸时横向封面优先跨两列，竖向和方形封面占一列；按原顺序排布，
本行只剩一列时使用小卡，不留中间空位，也不使用 dense 重排。
小卡固定 4:5，行高由单列宽度乘 5/4 得到，大卡保持同高并跨两列。
封面裁剪铺满卡片，没有内框或第二层圆角；预览和详情保留完整画面。
封面方向优先使用实际加载画面的尺寸，并以处理后缩略图尺寸作为初始值，避免 EXIF 旋转误判。
旧作品缺少尺寸时先使用小卡，加载后仅横图可跨两列，不再按序号将竖图放大。
点击作品封面或标题直接进入详情页，详情页完整显示作品，不经过中间预览弹窗。
标题、作者与互动信息置于底部柔和遮罩上，不使用有硬边的黑色信息条。
共用 `--work-cover-shade` 从上方透明渐变到最底部约 0.82 不透明度，保证明亮封面上的文字清晰。
遮罩不拦截点击，标题保持 14px、500 字重和单行省略，不重复显示媒体类型图标；
作者与点赞保留 12px 辅助层级，视频类型仍显示在封面左上角。
资源卡使用自身底色承载信息，骨架屏复用同一遮罩；详情保留完整原图。

| 视口宽度 | 作品列数 | 导航与工作台 |
| --- | --- | --- |
| 1200px 及以上 | 5，大卡跨两列 | 顶部完整导航 |
| 1000–1199px | 4，每三项中第三项跨两列 | 顶部完整导航 |
| 640–999px | 2，不跨列 | 顶部品牌与手机底部导航 |
| 639px 及以下 | 1 | 参数位于画布前，页面单列 |

作品网格在所有断点保持 16px 行列间距，加载态直接复用同一网格组件。
桌面顶部导航高 72px，手机 64px；底部导航包含安全区。

### Page Families

- 浏览页面使用 1512px 容器与 Bento 作品网格，标题、页面导航、工具栏、作品依次排列。
  我的作品工具栏的搜索、数量与视图切换共用一行，手机搜索独立一行。
- 账户设置容器最大 1168px，分类在页内横向排列，字段和保存操作保留在对应分组。
  资料图片与文字分组，账户连接和余额并列，手机依次排列。
- 管理页面采用 184px 局部侧栏与可收缩内容列，899px 以下侧栏改为横向分类。
  表格在自身容器内横向滚动，不撑宽页面。
- 活动容器最大 1360px，双栏按任务分组，手机改为单栏。
- 详情沿用媒体与信息双栏，长文限制 72ch，评论区最大 960px。
- 私信保留会话与消息双栏，手机在两者间切换；历史区独立滚动且可键盘聚焦。
- 创作页采用紧凑标题和类型导航，工作台高度扣除顶部、手机底栏及工具栏，
  最低 480px。持久 iframe 的挂载和后台任务机制保持不变。

共用 CSS 变量维护页面边距、顶部与底栏高度，以及 8/12/16/24/32px 间距。
页面容器桌面上留白 32px、底部 48px，手机沿用 24px/40px。
键盘与锚点滚动为固定导航预留空间。

## Elevation & Depth

普通页面和作品保持平面。用间距、浅色区域和分隔线表达层级。
弹出菜单使用 `0 12px 32px #1a263314`，对话框使用
`0 24px 80px #17233626`，不为普通页面区块添加阴影。
控件颜色过渡为 200ms，图片缩放为 300ms，使用 `cubic-bezier(.22, 1, .36, 1)`。
减少动态效果模式关闭动画和过渡。

## Shapes

控件和真正需要边框的工具使用 frontmatter 中的圆角层级。
用户最新要求作品只有一个 iOS 风格连续外圆角，保留现有 32px 半径与 0.6 平滑度。
复用 `v-continuous:clip` 和 `figma-squircle` 生成路径，直接裁切整张卡片；
封面没有独立圆角、内缩或 SVG 边框，媒体和底部信息区共同服从这一条外轮廓。
该平滑曲线是跨浏览器的 iOS 风格近似，不宣称与 UIKit 当前实现逐像素相同。
头像使用圆形。页面区块不包装成浮动卡片；创作者等重复条目可以使用单层卡片。
不能把卡片再嵌入卡片。

## Components

- **按钮：** 主要操作用鼠尾草绿与深色文字；次要操作用中性灰。图标按钮提供可访问名称和提示。
  名称包含可见数字，例如点赞数量。禁用状态必须对应真实不可用的操作。
- **输入：** 标签持续可见；placeholder 使用 muted。焦点边框和 2px 外轮廓表示位置，
  错误在控件附近说明原因与修复方法。
- **导航：** 桌面顶部单层导航，细线标识当前页面，小屏保留底部导航。
  手机顶部的私信入口收至账号菜单，给品牌、通知和发布操作留出空间。
  菜单互斥、外部点击关闭，Esc 关闭并恢复焦点。
- **发现页顶部：** 桌面标题与最高 560px 宽的搜索框同行，手机标题与搜索分行。
  搜索框高 48px，类别使用图标与文字的分段筛选，筛选和排序独立成组。
  手机类别等分四列，资源分类缩写为“资源”，完整名称保留为可访问名称。
  导航和类别的背景只做短距离缩放与透明度过渡，减少动态效果时直接切换。
- **标签：** 平静的浅灰背景，选中时使用主色和淡蓝背景。筛选紧邻其影响的内容。
- **作品：** 图像、视频和文本资源共用五列网格。全幅封面与底部轻遮罩元信息共用单层外轮廓。
  封面和标题直接进入作品详情，保留修饰键与中键的原生链接行为，作者和互动操作各自独立。
  图片提供 alt，详情中的视频使用原生播放控件，资源正文作为可读文本呈现。
  我的作品的编辑与删除放入卡片底部，保留固定行高；列表视图继续使用表格。
- **对话框：** 删除等确认操作使用原生 dialog 管理焦点，关闭后回到触发控件，
  支持 Esc 和明确的关闭按钮。作品浏览直接进入详情页。
- **状态：** 加载使用匹配内容形状的骨架；空态有下一步入口；消息明确说明本地演示边界。
  作品网格骨架与真实网格使用相同断点，创作者、列表和表单采用对应形状；
  骨架不包含可操作控件，减少动态效果时关闭循环动画。
- **Studio 嵌入：** 社区嵌入作用域映射同一套炭灰和鼠尾草绿、14px 字体、6–8px 圆角，
  聊天和视频输入区操作桌面高 40px、手机和触屏高 44px。
  覆盖限制在社区嵌入容器，独立 Studio 的主题与外观沿用原规则。

## Do's and Don'ts

- **Do** 沿用用户指定的 Bento 跨列节奏，保持 API 顺序和各断点的稳定行高。
- **Do** 将账户对外统一称为“章鱼账号”；协议和实现文档可保留 New API 技术名称。
- **Do** 把抽奖次数、奖励记录、账户余额分开，未连接时明确显示状态。
- **Do** 保留焦点、对比度和减少动态效果支持。
- **Don't** 把本地演示操作写成真实生成、已登录或已到账。
- **Don't** 在应用首屏添加营销大标题、装饰渐变或重复说明模块。
- **Don't** 在详情标题上方添加装饰性眉题；类型放入作品信息。

## Design Checks

本次设计计划、用户 Layout Grid 参考及技能抽签记录位于 `.taste-skill/design-plan.md`。这是实际应用，
不增加营销 hero、证言计数、着色器或整屏页尾。作品名称与作者是业务信息。
保留既有轮盘配置主题，不将它们扩散到品牌配色。
使用未修改的技能动效层提供按钮反馈、作品悬停与图片缩放。
响应式、真实公开素材和隔离业务测试的结果记录在 `.taste-skill/design-report.md`。
