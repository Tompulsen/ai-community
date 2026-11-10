---
name: photo-to-minimal-illustration
description: "提取照片的姿态与空间记忆，用少量色块、稀疏墨线和干净留白生成极简插画。"
license: MIT
source: https://github.com/iamkong/photo-to-minimal-illustration
upstream-revision: 0b0fde8a1a3783810130ba579b373c469a32ea61
adaptation: Chinese browser edition; self-contained field-study rules, generated illustration only without source/result comparison layout.
license-notice: |
  MIT License
  
  Copyright (c) 2026 iamkong
  
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
# 极简观察插画

The user's explicit instructions and image request parameters take priority over these defaults, including aspect ratio, dimensions, resolution, background, output format and image count.

将照片中最有记忆点的主体、姿态、轮廓和空间关系，提炼为极简编辑式观察插画。不是完整重画照片，而是保留一眼能辨认的最小关系。没有照片时按用户文字原创，不声称看到了参考图。

## 留白、颜色与线条

- 默认干净平整的暖奶油背景 #F0EBDD，不画纸纹、颗粒、折痕、边框或旧纸效果；用户背景设置优先。
- 主体和辅助元素通常占画面 20%-40%，小型单体约 8%-20%；保留大量留白，偏心放置，不强制居中。
- 从照片提取两到五种低饱和主色，以简洁平涂色块和轻微不规则边缘呈现。每个物体原则上一种主色，少量局部强调色。
- 用稀疏、细而略不稳定的墨线表达关键轮廓、结构或表情。多数主体用约 3-12 条关键线即可，不密集排线或重复勾边。
- 不使用渐变、真实投影、体积光、皮肤毛发细节、复杂反光或摄影材质。

## 按主体调整

动物或人物保留最有辨识度的姿态、朝向、表情与动作，身体压缩为少量色块，不美化成统一可爱角色。窗边探出的主体只保留开口轮廓、内部暗部和关键关系，不重建整栋建筑。

建筑、车辆和船只压缩为连续剪影或少量几何块，只留下最有辨识度的屋顶、车身、船体方向和比例，删除窗格、砖纹和零件。

风景保留前后关系、轮廓、地平线与主要色彩。群体用少量重复形状表达数量节奏；烟花与灯光保留方向和扩散关系，不增加不属于照片的山、树、太阳或其他实体。

## 输出约束

画面标记在接近边缘前自然停止，不铺满画布。不输出原图与插画的上下对比，不画照片、桌面、画册、贴纸包装、色卡、编号、标签、文字、签名或 UI。

保持成熟、克制、观察性的视觉语言，不做写实渲染、完整水彩风景、儿童绘本或 Q 版卡通。

只生成用户指定数量的最终插画，主体来自本次输入，不携带上一张照片的场景元素，不自动追加版本。
