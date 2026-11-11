---
name: AI 创作社区
description: 作品在前，操作归位。
colors:
  primary: "#245cdb"
  primary-hover: "#194bbd"
  primary-soft: "#edf3ff"
  surface: "#ffffff"
  surface-soft: "#f5f6f8"
  border: "#e7e9ed"
  ink: "#202329"
  muted: "#686e78"
  success: "#187452"
  success-soft: "#eaf6ef"
  pending: "#89600e"
  pending-soft: "#fff6dd"
  danger: "#b63846"
typography:
  headline:
    fontFamily: '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif'
    fontSize: "30px"
    fontWeight: 600
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
  framed: "8px"
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
    textColor: "{colors.surface}"
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

这是持续使用的创作社区界面。借鉴 Linear 的清晰层级、Pinterest 的作品优先、
Runway 的大幅作品详情，统一为浅色、紧凑、可操作的系统。

**Key Characteristics:**

- 作品直接进入首屏，导航与筛选保持稳定。
- 中性界面让内容提供颜色；蓝色标明主要操作与当前状态。
- 创作、投稿、审核和账户状态分别表达。

## Colors

主色用于主要操作、选择和焦点。纯白是工作面，浅灰用于次要区域和控件。
深色正文与灰色元信息保持层级。绿色表示成功或已公开，琥珀色表示待处理，
红色用于错误和删除；不能仅靠颜色传达状态。

## Typography

使用同一套中文系统字体。字号固定，不随视口宽度连续缩放。桌面页面标题采用
headline，手机页面标题为 24px/32px；详情标题也采用 24px/32px。
正文和按钮采用 14px，区块标题采用 18px/28px，长文采用 16px/28px，
辅助信息采用 12px。所有字距为零。
作品标题单行省略，详细内容换行；不能用截断掩盖表单错误。

## Layout

页面最大宽度 1632px。桌面左右留白 48px，1279px 及以下为 32px，手机为 16px。
作品网格按内容区稳定等分，不采用瀑布流。封面比例为 4:5，详情保留原图比例。

| 视口宽度 | 作品列数 | 导航与工作台 |
| --- | --- | --- |
| 1200px 及以上 | 5 | 完整桌面工作台在 1199px 以下隐藏历史区 |
| 900–1199px | 4 | 999px 以下使用底部导航 |
| 640–899px | 3 | 899px 以下详情改为单列 |
| 639px 及以下 | 2 | 参数位于画布前，页面单列 |

桌面网格列间距 24px、行间距 32px；中等屏为 16px/24px；手机为 12px/24px。
桌面顶部导航高 72px，小屏顶部为 64px；底部导航包含安全区。

### Page Families

- 浏览页面沿用 1632px 容器与既有作品网格，标题、页面导航、工具栏、作品依次排列。
  我的作品工具栏的搜索、数量与视图切换共用一行，手机搜索独立一行。
- 账户设置容器最大 1200px，桌面采用 184px 分类侧栏与最大 720px 表单，
  手机分类横向滚动，字段和保存操作保留在对应分组。
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

控件、封面和真正需要边框的工具使用 frontmatter 中的圆角层级。
头像使用圆形。页面区块不包装成浮动卡片；创作者等重复条目可以使用单层卡片。
不能把卡片再嵌入卡片。

## Components

- **按钮：** 主要操作用蓝底白字；次要操作用浅灰。图标按钮提供可访问名称和提示。
  名称包含可见数字，例如点赞数量。禁用状态必须对应真实不可用的操作。
- **输入：** 标签持续可见；placeholder 使用 muted。焦点边框和 2px 外轮廓表示位置，
  错误在控件附近说明原因与修复方法。
- **导航：** 桌面使用浅灰分组与白色选中背景，主色文字指示当前页面，小屏保留底部导航。
  手机顶部的私信入口收至账号菜单，给品牌、通知和发布操作留出空间。
  菜单互斥、外部点击关闭，Esc 关闭并恢复焦点。
- **发现页顶部：** 桌面标题与最高 560px 宽的搜索框同行，手机标题与搜索分行。
  搜索框高 48px，类别使用图标与文字的分段筛选，筛选和排序独立成组。
  手机类别等分四列，资源分类缩写为“资源”，完整名称保留为可访问名称。
  导航和类别的背景只做短距离缩放与透明度过渡，减少动态效果时直接切换。
- **标签：** 平静的浅灰背景，选中时使用主色和淡蓝背景。筛选紧邻其影响的内容。
- **作品：** 图像、视频和文本资源共用网格。标题和作者位于封面下方；收藏不遮住主内容。
  图片提供 alt，视频使用原生播放控件，内容摘要作为文本呈现。
- **对话框：** 使用原生 dialog 管理焦点，关闭后回到触发控件。删除提供明确确认。
- **状态：** 加载使用匹配内容形状的骨架；空态有下一步入口；消息明确说明本地演示边界。
  作品网格骨架与真实网格使用相同断点，创作者、列表和表单采用对应形状；
  骨架不包含可操作控件，减少动态效果时关闭循环动画。
- **Studio 嵌入：** 社区嵌入作用域映射同一套白灰蓝、14px 字体、6–8px 圆角，
  聊天和视频输入区操作桌面高 40px、手机和触屏高 44px。
  覆盖限制在社区嵌入容器，独立 Studio 的主题与外观沿用原规则。

## Do's and Don'ts

- **Do** 沿用五列桌面、两列手机规则，并保持中间断点有序降列。
- **Do** 将账户对外统一称为“章鱼账号”；协议和实现文档可保留 New API 技术名称。
- **Do** 把抽奖次数、奖励记录、账户余额分开，未连接时明确显示状态。
- **Do** 保留焦点、对比度和减少动态效果支持。
- **Don't** 把本地演示操作写成真实生成、已登录或已到账。
- **Don't** 在应用首屏添加营销大标题、装饰渐变或重复说明模块。
- **Don't** 在详情标题上方添加装饰性眉题；类型放入作品信息。
