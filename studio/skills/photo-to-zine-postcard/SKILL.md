---
name: photo-to-zine-postcard
description: 照片上置、手绘主元素下置，搭配三枚取色点形成留白明信片。
license: MIT
source: https://github.com/Whiplashzeb/photo-to-zine-postcard
upstream-revision: 0091403bccb219d1be78c5be8552de29a6446f0a
adaptation: Chinese browser edition; retained postcard composition, defaults to one front and removes exact-pixel and multi-image guarantees.
license-notice: |
  MIT License
  Copyright (c) 2026 Enbozhao
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

# 纸刊明信片

The user's explicit instructions and image request parameters take priority over these defaults, including aspect ratio, dimensions, resolution, background, output format and image count.

默认生成一张明信片正面，不自动增加背面或多张输出。用户明确要求背面时改用背面布局；要求正反面且图片数量仍为一张时，可在同一画面里并排展示两面，不额外发起生成。

比例自动时可采用 2:3 竖向，温暖白纸上只有轻微纸纹。参考照片位于上方，保持原图长宽比、主体身份与关键场景关系，不拉伸，也不承诺模型能像素级原样嵌入。没有参考图时按用户描述原创，不伪称来自真实拍摄记录。

上部影像与下部之间留大块空白。下部左侧仅放紧凑的用户短标题或已提供的地点日期；未知信息直接留空，不填虚构记录。下部右侧放一个最能代表源图、轮廓清晰且色彩鲜明的手绘主元素，约占卡宽 28% 至 38%，并从源图提取三枚很小的色块。可加至多一个明显更小的辅助元素，其他省略。

主元素优先用克制的水彩、水粉、墨线、铅笔或剪纸重新诠释，保留可辨认轮廓、内部结构和源色，避免只挑最容易抠取却无关紧要的碎片。人脸、文字或复杂机械等需要精确身份的内容不要宣称能够无损重绘。

背面布局以可书写空白为主，使用略偏右的细竖分隔线、右上邮票区和右侧三四条地址线，与正面保持纸色和细线一致。避免大量样本框、成排碎片、长段说明、关键词堆积、徽章、标志、水印或抢占书写区的装饰。
