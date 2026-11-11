---
name: film-print-2383
description: "以电影印相密度、自然肤色、局部暖色光晕和细颗粒处理照片，默认全画幅。"
license: MIT
source: https://github.com/n1ko724/kodak-2383-film-look
upstream-revision: e4c0657a69a895d0491e71cd19602e7e4b85c6ab
adaptation: Chinese browser edition; full-frame prompt-only grade by default; no deterministic compositor, official LUT or pixel-fidelity claims.
license-notice: |
  MIT License
  
  Copyright (c) 2026 Niko
  
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
# 2383 胶片质感

The user's explicit instructions and image request parameters take priority over these defaults, including aspect ratio, dimensions, resolution, background, output format and image count.

以用户上传照片为唯一内容依据，制作受 2383 电影印相观感启发的摄影图像。网页版本默认全画幅处理，保持原构图和比例，不运行本地拼版脚本，不承诺精确 LUT、像素级调色或原图像素完全不变。

这是独立、非官方的创意风格，不是 Kodak、Blackmagic 或任何模型厂商的官方仿真或背书。不要在画面上自动添加相关商标、品牌标签或技术编号。

## 内容与色调

保留人物身份、表情、姿势、服装、物体数量、产品外形、车辆几何、建筑结构、可读标识、机位和景深。只改变明暗响应、色彩密度、高光过渡、细微光学柔化与颗粒。

建立有密度但仍可辨细节的暗部，中间调扎实，高光平滑收束而不灰蒙。保留皮肤自然立体感，产品与服装的识别色可信。颜色更深、更有实体感，但不霓虹化。

根据原场景保留真实光色：日光清晰，夕阳保留暖光，钨丝灯保持局部温暖，霓虹夜景保留各光源的颜色。可有克制的冷暖分离，但不套统一青橙滤镜或全局红色偏色。

## 局部光晕

只在真实强光与暗区交界处出现细窄、不均匀的暖红橙边缘，最亮的局部再带一层更宽但低饱和的柔和扩散。可作用于灯泡、逆光发丝、玻璃、金属、水面反射、亮窗及日光硬边，不给所有物体或普通面部轮廓描红边。

默认中等强度：正常观看能看出局部暖边，底图依然锐利，高光和暗部保留细节。原图已高反差或重处理时降低强度；用户明确要求轻微或强烈时相应调整，但不把作用范围扩大到整张画面。

## 胶片完成度

细微、有机、非均匀颗粒服从明暗区域，轻微降低手机锐化的生硬感，不模糊主体、文字或结构。默认不加灰尘、划痕、齿孔、旧胶片破损、漏光边框或假日期。

若用户明确要求印相板，只将同一照片的未调色观感与胶片观感组织成上下层次，背景取自原图的克制色调；这是模型生成的设计表达，不保证未经调色的原始像素或严格拼版坐标。不擅自改变请求的比例、分辨率或张数。

直接生成本次请求的最终图片，不输出色彩节点、滑杆、脚本、模型配置或自动追加版本。
