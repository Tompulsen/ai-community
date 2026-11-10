---
name: child-photo-doodle-collage
description: "保留照片人物，用蜡笔小动物与真实动作、衣物和道具互动，制作童趣写真。"
license: MIT
source: https://github.com/haomiaomou-cmd/child-photo-doodle-collage
upstream-revision: 9362e56ddb3322d63d73411670eb09e9ff2d0b83
adaptation: Chinese browser edition; condenses scene decisions and contact-based doodle rules without bundled reference photos, local tools, watermark cleanup, fixed credit quotes or automatic retries.
license-notice: |
  MIT License

  Copyright (c) 2026 Lawless

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

# 互动涂鸦写真

The user's explicit instructions and image request parameters take priority over these defaults, including aspect ratio, dimensions, resolution, background, output format and image count.

使用上传照片作为人物参考，保留真实面容、表情、发型、姿势与服装，将扁平蜡笔插画融入摄影画面。儿童与成人均可使用。没有原图时不声称保留了人物身份，需要用户提供照片才能编辑。

## 场景与质感

先判断背景是否承载主题。服装与墙面配色、海边、游乐场、真实气球等是画面核心时保留实景。普通杂乱室内照可在用户允许或没有保留背景要求时改为浅灰白摄影棚背景与柔和地面影子。用户的背景要求始终优先。

涂鸦使用蜡笔或彩铅质感、平涂色块、稚拙线条与少量纸面颗粒，不做 3D、写实动物或精细动漫。使用四至五种协调颜色；摄影棚模式偏暖橙、芥末黄、草绿、砖红，实景模式选择能与背景区分的奶白、天蓝或粉色。保留呼吸空间。

## 互动是主体

从照片的动作与真实道具中挑选两到三个接触点，避免只是贴上漂浮贴纸：

- 手掌握着手绘花朵，手指与花柄贴合；小鸟停在伸出的指尖。
- 小猫趴在肩膀上抓住衣物，或从真实包口探头并扒住边缘。
- 鸟站在真实气球或鞋尖上，小动物抓住照片中真实存在的绳子。
- 草叶轻触鞋边；踢腿时手绘球接触脚尖并带短弧线。
- 跳跃时用风线、羽毛和伸手接触表现腾空，不把草贴在悬空脚下。
- 躺卧或倒挂时，小伙伴呼应同一姿势，运动标记符合实际重力方向。

遵守遮挡、落点和人物结构，不为互动扭曲面部与肢体。可加入少量星星、爱心，用户需要文字时使用短而准确的手写词，不遮挡面部，不强制添加英文装饰。

通过当前图片模型返回完成图，不运行本地保存、参考素材下载或自动质检重试，不宣称固定积分消耗或像素完全不变。后续修改尽量继续参考用户原图，避免重复重绘导致身份漂移。
