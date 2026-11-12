---
name: dreamy-motion-editorial
description: "保留清晰主体，以可信的慢门拖影、玻璃反射与光色流动营造梦幻摄影。"
license: MIT
source: https://github.com/lzs0594/dreamy-motion-editorial
upstream-revision: a9cbb7cbc6543a15e48d6abac7f5785b079ab324
adaptation: Chinese browser edition; self-contained motion routes and prompt rules, direct image generation without local analysis scripts.
license-notice: |
  MIT License
  
  Copyright (c) 2026 Dreamy Motion Editorial contributors
  
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
# 梦幻慢门

The user's explicit instructions and image request parameters take priority over these defaults, including aspect ratio, dimensions, resolution, background, output format and image count.

把照片转成主体可辨、环境具有慢门拖影的摄影作品。只保留一个核心主体、一个关键动作或物件、一个原生强调色和最多两个环境线索。先决定哪些必须清晰、哪些转成动态残影、哪些移除，再形成画面。未上传照片时按用户描述创作，不虚构已经观察到的照片事实。

## 动态构图

默认主体占画面约 25%-40%；约 35%-55% 为有明确方向的运动氛围，约 15%-30% 为安静色调空间。保留两到四个可转化的次要形态，不是把所有背景删除后换成一块空白渐变。

建立前景掠影、中景拖影、背景光色流三个层次：近镜的衣料或环境边缘形成大块虚影，次要物体拉伸成无细节轮廓，远处光色沿同一方向流动。人脸平面、眼神、手势、产品边缘或花心中至少一个保持可读。

用户明确要求纪实或完整保真时，优先保留原场景和身份关系。默认可以简化构图，但不得换脸、改变年龄、服装、关键物体或人物数量。

## 选择一条物理机制

- 人群漂移：街道、车站、走动人物；让周围行人、衣袖或车辆方向性拖影，不重复主角。
- 花卉扩散：照片已有花草或用户明确要求时，以近镜植物和浅景深形成色彩薄幕。
- 玻璃记忆：照片有可信的窗口、玻璃或镜面时，加入一层克制反射，保留透视与主体。
- 逆光晕染：只围绕照片已有的太阳、窗光和轮廓高光形成局部扩散。
- 低机位色场：以已有天空或墙面形成简洁环境，使用低视角与单一色彩对照。
- 掠过动作：依照已有的转身、伸手、风动或衣料运动设置慢门，不添加无关道具。

一次只选一个主机制，最多一个相容的辅助机制。模糊必须有运动、玻璃、反射或光线依据，不能是整图均匀高斯模糊。

## 强度与交付

默认梦幻朦胧；产品与身份敏感肖像减弱处理，用户要求强烈实验时才增加拖影和折射。主体仍须清楚，肤色与重要产品颜色可信。

避免全局白雾、魔法光点、无关花朵、赛博霓虹、塑料皮肤、极端青橙调色和密集文字。仅当用户要求海报时才添加少量文字，且不遮挡脸、动作或产品。

直接生成最终照片风格作品，不输出分析报告、双语提示词包、配置参数或脚本步骤，不自动发起重试。
