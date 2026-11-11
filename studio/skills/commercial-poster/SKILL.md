---
name: commercial-poster
description: "根据活动或产品文案设计海报，支持瑞士编辑、包豪斯、极简高端与装饰艺术风格。"
license: MIT
source: https://github.com/howardz27/poster-generator-skill
upstream-revision: fa2a40bf0943c14dbcf2dfd86a2efe66fa8b4cbc
adaptation: Chinese browser edition; base rules plus four verified style references inlined, no local renderer discovery or configuration menus.
license-notice: |
  MIT License
  
  Copyright (c) 2026 yinnhao
  
  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:
  
  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.
  
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
---
# 商业海报

The user's explicit instructions and image request parameters take priority over these defaults, including aspect ratio, dimensions, resolution, background, output format and image count.

根据活动、新品、品牌或宣传主题，直接生成可读、重点明确的静态海报。只使用用户给出的事实、名称、价格、日期和联系方式；用户附图时保留产品或人物的关键外观，不编造未提供的卖点。

## 信息与布局

在内部提取主标题、副标题、必须显示的信息、视觉主体、受众和用途。保留用户要求的精确文字；默认沿用输入语言。围绕一个主要信息和一个视觉焦点安排阅读顺序：标题、主视觉、支持文案、必要详情。

画幅和文字密度决定布局。产品主题突出单一产品和简短说明，活动主题突出标题与已提供的时间地点，多条信息使用有秩序的网格。自动比例时偏好 2:3；用户明确设置优先，不为套模板改变画幅。

## 四种完整风格

用户点名风格时使用对应语言，否则默认瑞士编辑式：

- 瑞士编辑式：清晰无衬线、强字号对比、非对称网格、统一左对齐与基线。黑白中性色配单一强调色，使用一张克制图片或一个简洁主体，纸面干净。
- 包豪斯模块：几何无衬线，圆、方、线与文字形成模块关系；黑白为底，少量红蓝黄承担结构功能。比例和重复有秩序，避免儿童积木般的混乱。
- 极简高端：精练标题、大量留白、一张有材质和光线的产品或肖像。使用细腻衬线或干净无衬线，中性色与克制金属色；避免廉价金色渐变和繁复边框。
- 装饰艺术：垂直中轴、对称几何、扇形或阶梯形装饰、精致展示字体；深色、象牙白和少量金属线条。适合舞台或活动海报，避免赌场式堆金与过密花纹。

用户提供其他视觉要求时，遵从其要求；不宣称此网页版本包含原仓库全部二十种模板。

## 可读性与约束

标题清楚，次要信息依次减弱，文字与背景有充分对比，重要内容留安全边距。不添加乱码小字、随机品牌、假二维码或无关装饰。

只有用户原文包含行动文案时才使用；不自动加入“立即购买”“敬请期待”等。行动文案排作静态海报文字，不装进按钮、胶囊、输入框或其他可点击界面。用户明确要求表现设备或产品界面时，可以把它作为海报内容呈现。

直接生成指定数量的最终海报，不输出配置菜单、工具发现、文件写入步骤或额外变体。
