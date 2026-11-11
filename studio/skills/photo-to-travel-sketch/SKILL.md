---
name: photo-to-travel-sketch
description: "用松弛钢笔线、灰调干性马克笔和大量露纸，将照片提炼为现场旅行速写。"
license: MIT
source: https://github.com/liigoQi/photo-to-travel-sketch
upstream-revision: 12606b047c3cb95b1c35ff50982520d811163a7e
adaptation: Chinese browser edition; style-spec inlined, no automatic regeneration, no extra reference images.
license-notice: |
  MIT License
  
  Copyright (c) 2026 Liigo Qi
  
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
# 旅行速写

The user's explicit instructions and image request parameters take priority over these defaults, including aspect ratio, dimensions, resolution, background, output format and image count.

将用户上传的照片转成像在现场用 10-15 分钟画出的钢笔与干性马克笔旅行速写。照片仅提供内容；风格由以下规则决定，不需要其他参考图、工具配置或本地脚本。没有照片时按用户文字创作，不声称还原了不存在的原图。

## 观察与取舍

选择一个视觉锚点、两三个辅助块面和最多五个识别细节，主动省去 50%-70% 的次要信息。通过剪影、视角、前后遮挡与少量地标保留识别度，不逐一描绘窗户、瓦片、树叶或水纹。

直接输出独立插画，不画成桌面上的笔记本照片。保留原图大致方向和相互关系，可以轻微压缩透视、让建筑倾斜，但不改变主体身份。

## 线条

使用略不均匀的炭黑色细头笔线条。每条主要边界用一两笔松弛而游走的长线概括，允许弯曲、倾斜、漏角、断口、重启和少量错位。

焦点轮廓清楚，次要边缘逐渐消失。避免尺规直线、完美矩形、机械透视、整齐重复的窗格、均匀封闭轮廓和密集碎线修补。

## 干性马克笔颜色

- 从照片选择三到五个色系，向灰调降低饱和度；暖白纸面为主，至少 45% 的画面保持未上色。
- 仅给约 25%-40% 的可见物体上色；被选中的物体也只覆盖约 30%-70%。不要把每个物体都填满。
- 每块局部色群约由 3-12 条可数的干性笔触组成，笔端可见，间隙露纸，交叠处稍深，允许笔触越过或未触及黑线。
- 同一灰调颜色在两三个位置呼应。相对鲜艳的强调色不超过上色面积的约 10%-12%；不固定套用橄榄绿加朱红。
- 禁止湿水彩、透明晕染、色素积边、柔和渐变、光滑数字填色和整片连续填满的天空、水面、屋顶。

按“关键轮廓、焦点色群、稀疏辅助色群”的顺序在内部组织后停止。保留未完成感，不添加字幕、标签、箭头、票据、边框、手、文具或水印。

直接生成本次请求的最终速写，不追加自动重试或额外变体。
