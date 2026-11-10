---
name: photo-to-ink-painting
description: "保留照片主体与空间关系，以自然笔墨和宣纸留白重绘中国水墨画。"
license: MIT
source: https://github.com/lzhandcyx/photo-to-ink-painting-skill
upstream-revision: 01fb9a1d5e13f7866e692e27a96d6f642689ffec
adaptation: Chinese browser edition; condensed content-aware ink painting rules, user parameters override automatic defaults.
license-notice: |
  MIT License
  
  Copyright (c) 2026 LUO ZHONG HUI
  
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
# 水墨重绘

The user's explicit instructions and image request parameters take priority over these defaults, including aspect ratio, dimensions, resolution, background, output format and image count.

将用户上传的照片重新绘制为统一笔墨语言的中国水墨画。先识别实际主体、人数、动作、空间关系、前中远景与情绪，再决定笔墨。未上传照片时根据用户文字创作，不声称看到了参考照片。

## 内容与构图

- 保留主体语义和辨识特征，不为了国画感凭空添加山峰、船、松树、亭子、鸟或人物。照片中的现代建筑、车辆、电线和道路也要保留，并转换成笔墨语言。
- 自动比例时偏好 16:9 横幅；明确指定的比例优先。默认主体水墨区域约占视觉面积 45%-55%，聚于中部，其他区域为干净宣纸留白。
- 通过重组留白适应横幅，不拉伸主体、不裁掉重要对象。保留景物的远近、遮挡和相互关系。
- 墨迹边界使用自然渗染、飞白、破墨和干湿笔触渐次消散，不形成矩形蒙版、圆形相框或均匀毛边。

## 统一的笔墨语言

一幅画默认只用一种完整语言，不混合多位画家的风格。用户指定艺术语言时沿用；否则按主题选取：山水使用层叠泼墨与虚实空间，森林使用积墨密度，宁静山水使用疏淡干笔，城市建筑使用黑白点线与克制色块，人物和马使用结构准确的写意线条，花鸟与小动物使用生动简练的笔触，器物使用疏简构图。

近景结构与焦点清晰，中景减弱，远景淡墨化；色彩克制且来自照片。纸张轻微可见，不用发黄、脏污或过量噪点代替宣纸感。

## 避免

默认不添加题款、诗句、落款、书法、印章、签名、水印、二维码或平台标记。无用户明确要求时不添加文字。不做摄影滤镜、满屏厚墨、机械轮廓、塑料立体感或多种画风拼接。

直接生成最终水墨作品，不将分析步骤或提示词排进画面。
