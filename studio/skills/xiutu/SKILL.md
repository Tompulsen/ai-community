---
name: xiutu
description: "按用户需求组合去杂物、调光、自然美颜与直闪效果，编辑上传照片。"
license: MIT
source: https://github.com/Chase-qisiai/xiutu.skill
upstream-revision: 919879b6defdea0d17e313d71c7b694962e921d3
adaptation: Chinese browser edition; inlines the core prompt library, omits local synchronization and six-image automation. Ambiguous requests use conservative corrections rather than an unsupported confirmation workflow.
license-notice: |
  MIT License

  Copyright (c) 2026 Chase-qisiai

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

# 修图提示词

The user's explicit instructions and image request parameters take priority over these defaults, including aspect ratio, dimensions, resolution, background, output format and image count.

以用户上传的图片为编辑参考，只执行明确要求的变化。识别实际存在的问题，不虚构游客、皮肤问题或过曝。没有原图时不声称已看见照片；需要用户提供参考图才能执行原图修饰。

## 四类可组合处理

- **去除干扰**：仅当用户要求时，清理指定的背景游客、杂物或遮挡，合理补全背景；保留主要人物、主体道具和场景关系。
- **自动调光**：修正实际存在的曝光、白平衡、光色与清晰度问题，保留自然肤色、亮部和阴影层次，不把所有场景统一提亮。
- **自然美颜**：按实际五官与气质，适度淡化临时痘印、眼下暗沉和肤色不均，保持皮肤纹理与身份。发型、眉形、妆容等变化需遵循用户明确要求，默认不改变脸型、年龄、体型和服装。
- **直闪氛围**：用户指定直闪时，让近处主体受到正面小型闪光灯照明，背景相对欠曝约 1–1.5 档，有小而清晰的阴影和自然表面高光。保留画面对象，不为直闪效果凭空新增物品。

一般组合次序为清理、光色、局部修饰、风格。直闪背景欠曝与整体提亮冲突时，以用户的明确风格要求为准。用户只说“优化一下”时，采用保守的曝光与色彩修正，不自动去人、换背景或改变外貌。

## 网页边界

通过当前图片编辑模型返回结果，保留用户原始附件与文本，不运行提示词同步脚本或本地软件。不自动发起六次职业头像生成；图数与参数由当前界面设置决定。不报告未实际进行的工具检查，不承诺重绘区域或文字像素完全不变。
