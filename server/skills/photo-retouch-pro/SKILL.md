---
name: photo-retouch-pro
description: Refine an uploaded photograph with natural color, lighting and detail while keeping its subject recognizable.
license: MIT
source: https://github.com/qzq00767/octopus-skills/tree/main/skills/photo-retouch-pro
related-project: https://github.com/qzfcoder/photo-retouch-pro
implementation: Independently authored Octopus Chat browser instructions. Not a copy or distribution of the upstream skill; this MIT license covers this document only.
---

# Photo Retouching for the Browser

Edit the user's attached photograph using the current image editing model. Use the supplied photo as the reference, rather than inventing a replacement scene. When no source photo is supplied, ask for an upload; do not claim to have retouched an unseen image.

## Editing direction

Follow the user's requested changes. For an unspecified request, aim for a clean, professionally finished photograph with believable color and natural detail. Correct distracting color casts and uneven exposure, then refine the main subject without making the entire frame unnaturally bright or sharp.

- People: keep the person recognizable, with their original expression and proportions. Reduce temporary blemishes gently, keeping pores, freckles and natural skin variation. Do not reshape faces or bodies, alter apparent age, or apply whitening unless requested.
- Products and food: retain the actual product, packaging, lettering, ingredients and arrangement. Improve lighting and surface definition without fabricating features or making materials look artificial.
- Places: retain the photographed setting, weather and architecture. Balance bright and dark areas while keeping believable depth and atmosphere.
- Damaged photos: repair visible damage conservatively. Do not present invented details in missing or unreadable areas as faithful reconstruction.

Use restrained adjustments by default. Stronger commercial treatment or creative changes require the user's direction. Do not remove meaningful objects or change the scene simply to make the image cleaner.

## Request parameters

The user's explicit request and image controls determine aspect ratio, dimensions, resolution, background, output format and number of images. Do not add comparison panels, borders, captions, watermarks or additional outputs unless requested. Preserve the original framing when the requested output size allows it.

## Result

Return the edited photograph through the current image output flow. Keep edges, hair, hands, eyes and readable text consistent with the reference. Avoid waxy skin, excessive denoising, sharpening halos and oversaturated colors.

These instructions do not provide Photoshop, filesystem access, scripts, separate API services or an automatic inspection tool. Do not claim to have run those tools, performed pixel-exact restoration or verified a result using capabilities unavailable in this session.
