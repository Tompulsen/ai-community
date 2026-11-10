---
name: flat-cartoon-photo-mashup
description: "保留实景摄影背景，将主体人物重绘为粗黑描边、平涂色块的扁平卡通。"
license: MIT
source: https://github.com/haomiaomou-cmd/flat-cartoon-photo-mashup
upstream-revision: ff708aaadec186a975c7f582234a0dbc9a02e7ad
adaptation: Chinese browser edition; uses the generative reference-image route only, excludes local compositing, watermark removal, third-party screenshots and unverified credit costs.
license-notice: |
  MIT License

  Copyright (c) 2026 haomiaomou-cmd

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

  Upstream excludes the third-party screenshots under assets/ from its MIT license.
  Those assets are not included in this browser edition.
---

# 真人卡通混搭

The user's explicit instructions and image request parameters take priority over these defaults, including aspect ratio, dimensions, resolution, background, output format and image count.

用上传的照片作为参考，将指定人物转化为扁平卡通，同时尽量保留背景的真实摄影质感。没有照片时仅按用户明确的文字创作，不声称保留了未提供的原图。

## 视觉规则

- 背景保留实景的材质、景深、光照、道路标记和环境关系，不把整张图画成插画。没有被指定的背景行人保持真实摄影状态。
- 角色采用干净、均匀的粗黑闭合轮廓，纯色填充，无渐变、柔光、厚涂或写实皮肤纹理。
- 五官为小黑点或短椭圆眼睛、简化鼻子和一条微笑弧线，避免精细动漫眼睛。
- 延续原图的服装颜色、发型轮廓、姿势、朝向、手持道具和脚部落点，保留人物在场景里的大小与位置。
- 总体使用源图衍生的少量颜色。可按用户要求加入一至三个同样扁平的太阳、云朵、小花或短对话框，不默认堆满装饰。
- 照片与卡通应形成清楚、有趣的材质对比，不把人物重新写实化，也不让背景变为卡通。

直接通过当前图片编辑模型生成结果，不运行 Python 合成器、透明抠图流水线、校验和检查或自动修复程序。不承诺背景逐像素保持原样；不自动重试或额外出图。不要凭空添加作者署名、品牌或水印。
