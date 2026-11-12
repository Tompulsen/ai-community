---
name: van-gogh-oil-painting-transformation
description: "保留照片主体和构图，用厚涂油彩、旋转笔触与鲜明蓝黄关系重绘梵高风格油画。"
license: MIT
source: https://github.com/KShang29/van_gogh_oil_painting_transformation
upstream-revision: c5ff3e4f183fab46152d64708287bae048867c0b
adaptation: Chinese browser edition; preserves the upstream composition and impasto style rules, omits local filesystem and Python workflows.
license-notice: |
  MIT License

  Copyright (c) 2026 Kevin Shang

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
# 梵高油画

The user's explicit instructions and image request parameters take priority over these defaults, including aspect ratio, dimensions, resolution, background, output format and image count.

将用户提供的照片重绘为具有梵高启发的后印象派布面油画。照片是编辑目标，不是松散参考：保留主体位置、透视、原始取景、裁切边缘和重要物体之间的空间关系。没有上传照片时，根据用户的文字创作，不声称看到了参考图。

## 笔触与色彩

- 使用厚实的堆叠油彩、清晰凸起的颜料脊、密集短弧笔触、逗号形笔触和顺着物体形态流动的线条。画布纹理轻微可见，整体像手绘油画，而非照片滤镜。
- 保持饱和钴蓝、群青、青色、蓝绿色与赭黄、金黄、土黄、赭石、乳白之间的关系，并保留原图的特征色与光线情绪。深蓝灰轮廓服务于结构，不给所有物体机械描边。
- 复杂细节只简化到足以统一油画语言的程度，主体仍可辨认；不能变成平面拼色、马赛克、瓷砖或低多边形拼贴。

## 按场景处理

- 天空与云：旋转流动的钴蓝与天蓝笔触、卷曲乳白云脊、蓝灰阴影和暖象牙白高光，不用平滑喷枪渐变。
- 水面：沿波浪方向叠加弯曲色带、断续反光短笔触和乳白浪花，保留真实倒影与远近关系。
- 建筑：以有纪律的短横竖笔触、蓝灰轮廓和局部蓝绿反光保留结构，避免扭曲透视。
- 树木与植物：短促闪动笔触、深色枝干、赭黄与黄绿亮部；复杂叶片适度归纳，不逐叶照相式描绘。
- 食物与静物：笔触跟随体积，暖金赭与琥珀色表现凸起，乳白高光、赭石褶皱和少量厚点表现细节。
- 花卉：用层叠花瓣色团、深色花心和有节奏的轮廓保留原有排列。
- 远处人物、动物与车辆：以准确的姿态和简练笔触保持辨识度，不强行补画微小五官或文字。

## 约束与局部修改

不擅自加入星空、向日葵、幻想物体、边框、签名、水印或新文字。原场景中的招牌可保留为协调的绘画细节，不要求额外锐化。避免光滑照片滤镜、过度柔焦、喷绘效果和抹掉主体的抽象化。

用户只要求提高清晰度、移除局部对象或小范围修改时，保持既有笔触与其他构图不变。涉及精确肖像或大量可读文字时，优先保留用户明确指定的身份特征和文字，不承诺像素级复原。

直接生成最终作品，不把分析步骤、风格说明或提示词排进画面。
