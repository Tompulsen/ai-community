# 投稿弹窗视觉复核

沿用已确认的Misskey主题、字体和全宽社区布局。用户提供X模态投稿参考，本轮以独立编辑弹窗保护投稿焦点，移除信息流内重复投稿栏。Galaxy既有方向反馈按主题继续使用；Taste沿用已有app方向（keep palette/type）；Impeccable应用distill和craft-floor。

源码lint 0 FAIL/0 WARN。inspect最初仅报covered-text：模态层有意覆盖背景社区标题，且背景通过原生focusTrap设置inert，属于本任务所需行为。仅为此规则显式allow后0 FAIL/0 WARN，没有掩盖弹窗内部控件遮挡。已查看desktop/tablet/mobile-fold及320px、深色Playwright截图。标题聚焦为单条下划线，正文可编辑，投放模块三选一，补充字段折叠，提交按钮可达。320px模块和底栏自然换行，弹窗层可滚动。

没有增加持久化草稿功能；提示仅保留本页输入。所有预览作品/提交为标注的测试数据。完整Misskey与网盘后端尚未联调。
