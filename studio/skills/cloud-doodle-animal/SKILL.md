---
name: cloud-doodle-animal
description: "顺着真实云朵的轮廓，用几笔黑色细线点化出可爱的动物。"
license: MIT
source: https://github.com/haomiaomou-cmd/cloud-doodle-animal
upstream-revision: 7b4f89e3121be8bcd13bc23079a5113bda6eeefd
adaptation: Chinese browser edition; reference-image generation without automatic base-image creation, retries, guaranteed pixel preservation or unsupported inspection tools.
license-notice: |
  MIT License

  Copyright (c) 2026 cloud-doodle-animal contributors

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

# 云朵动物涂鸦

The user's explicit instructions and image request parameters take priority over these defaults, including aspect ratio, dimensions, resolution, background, output format and image count.

以用户上传的云朵照片为参考。保留天空、云形、光影、地面和构图的摄影观感，仅在云朵上添加少量黑色细线，让偶然的轮廓显现为一只动物。目标是发现云中已有的形态，而不是重画一个动物形状的云。

## 线条与匹配

- 圆胖云可匹配猫或熊，长条云可匹配兔子，顶部突起可匹配牛角；根据实际形状与用户偏好选择一个主体。
- 只补必要的耳朵、眼睛、鼻子、胡须、爪子或尾巴，通常几笔即可。线条略带手绘抖动，细、黑、简单，不给整朵云描外轮廓。
- 云朵本身就是身体，不增加写实毛发，不填充彩色动物，不加立体阴影或渐变涂色。
- 表情安静、松弛、好奇或慵懒。只在用户需要时加极小面积的柔和腮红或简短睡眠符号。
- 保留原天空与背景的自然细节、大面积留白和单一焦点。不要凭空增加动物群、文字、滤镜或复杂贴纸。

没有参考图时，可根据用户明确要求生成原创天空与涂鸦的一张完成图，但不把它描述成对原照片的保留编辑，也不自动分成两次生图。

当前流程是图片模型的生成式编辑，不能保证原图像素完全不变。不运行本地叠图、裁剪水印或自动多次重试；输出数量由用户当前设置决定。
