---
name: paper-cut-illustration
description: "将照片变成分层卡纸与暖白模切边插画，保留人物或宠物的辨识特征。"
license: MIT
source: https://github.com/kelegele/paper-cut-illustration-skill
upstream-revision: 4b73f4712c37998e0efba553b4f14140d94a9aa3
adaptation: Chinese browser edition; original visual prompt inlined verbatim; no local background-removal scripts or guaranteed alpha output.
license-notice: |
  MIT License
  
  Copyright (c) 2026 kelegele
  
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
# 剪纸插画

The user's explicit instructions and image request parameters take priority over these defaults, including aspect ratio, dimensions, resolution, background, output format and image count.

以用户照片为内容依据，生成分层卡纸人物或贴纸插画。以下英文母版与参考图共同使用；用户本次要求作为补充，覆盖冲突的比例、背景或主体设置。未提供照片时按文字原创，不声称进行照片还原。

## 原始视觉母版

Use the uploaded image as the sole content source and transform its main subject into a refined full-body handcrafted paper-cut fashion character. Preserve the subject’s identity cues, age category, gender presentation, skin tone, facial expression, hairstyle or head covering, pose, body orientation, clothing categories, garment layers, colors, patterns, accessories, footwear, and important carried objects. Preserve culturally specific clothing accurately: if the source includes a hijab, headscarf, traditional textile, batik, embroidery, jewelry, or modest layered garments, retain their recognizable wrapping, coverage, construction, motifs, and color relationships. Do not add a hijab, cultural garment, accessory, or pattern that is absent from the source.

Gently stylize the person into an elegant storybook fashion doll with a slightly enlarged head, softly rounded face, slender simplified body, graceful posture, and clean readable silhouette. Keep the person recognizable without copying photographic anatomy exactly. Render the face with large warm almond-shaped eyes, fine dark lashes, softly arched eyebrows, a tiny simplified nose, subtle rosy cheeks, and a small natural smile that matches the source expression. Keep facial features balanced and mature enough for the subject’s age; avoid infant-like proportions, extreme chibi anatomy, exaggerated eyes, or a generic identical doll face.

Construct the entire character as layered cut paper and lightly embossed cardstock. Use softly textured matte paper, delicate paper grain, precisely cut edges, overlapping garment layers, subtle folded-paper planes, shallow relief, and restrained edge shadows. Clothing should appear assembled from separate paper pieces, with broad clean shapes and a few carefully placed fold lines. Reproduce important fabric patterns as simplified, crisp printed or cut-paper motifs that follow the garment’s drape and panel structure. Preserve asymmetric hems, belts, brooches, scarves, sleeves, pleats, and layered panels when they are visually important. Keep hands anatomically simple but complete, with natural fingers and no fused or duplicated limbs.

Place the finished character upright and centered against a plain warm beige, cream, or light oatmeal paper background. Surround the complete silhouette with a narrow warm-white die-cut paper border, like a premium collectible sticker or mounted paper doll. Add a soft diffuse shadow falling slightly to the lower right so the figure appears gently raised above the background. Maintain generous negative space, a calm vertical composition, soft warm studio lighting, low contrast, muted natural colors, and a polished handmade editorial finish. The entire figure should be visible from head to footwear unless the source is already cropped; never invent body parts outside the source framing.

The final image should feel delicate, warm, sophisticated, tactile, and collectible: a contemporary paper-cut storybook portrait combining modest fashion illustration, subtle anime-inspired facial simplification, layered cardstock craftsmanship, and faithful clothing design. Avoid photorealism, 3D plastic dolls, glossy surfaces, clay, fabric embroidery, yarn, watercolor bleeding, rough sketch lines, heavy outlines, harsh cel shading, neon colors, busy scenery, extra people, invented accessories, altered clothing coverage, malformed hands, duplicated limbs, text, logos, signatures, frames, and watermarks. Output one finished vertical paper-cut character illustration only.

## 网页输出设置

- 默认直接生成一张，用户请求数量优先。不要求配置渲染器、安装工具或选择本地目录。
- 用户指定比例时通过调整画布留白适配，不反转比例、不拉伸人物、不为了全身效果补造照片外的身体。自动比例时沿用母版的竖构图。
- 默认背景为母版的柔和纸色；用户提供颜色或背景要求时覆盖。纯色或用户指定的背景都不得绘制棋盘格。
- 本网页版本不运行本地抠图脚本。透明背景仅作为交给所选生图模型的要求，不声称已执行抠图或验证 alpha 通道；用户明确背景参数始终优先。
- 宠物或其他非人物主题采用相同分层卡纸工艺，保留真实物种、毛色、花纹和姿态，不强行改为人类服装或人脸。
- 不自动追加重试、多版本、修复请求或额外图片。直接交付本次生成的插画。
