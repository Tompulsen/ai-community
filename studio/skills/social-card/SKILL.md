---
name: social-card
description: Compose a readable social media cover or information card from supplied text and reference images.
license: MIT
source: https://github.com/qzq00767/octopus-skills/tree/main/skills/social-card
related-project: https://github.com/op7418/guizang-social-card-skill
implementation: Independently authored Octopus Chat image-model instructions. Does not include or reproduce the related project's instructions, templates, assets or rendering workflow.
---

# Social Information Card

Create a single polished social media image from the user's content through the current image generation or image editing model. The subject, wording and visual evidence supplied by the user are the basis of the design.

## Content

Make the main idea easy to understand on a phone. Use a clear headline, a small amount of supporting information and an appropriate visual. When the user supplies a long passage, extract a concise title and a few essential points without changing their meaning. Keep exact wording when requested.

Do not invent statistics, quotes, endorsements, sources, logos or product claims. Use supplied photos and screenshots as references when present. Do not pretend to have retrieved or verified external information. Do not add publishing instructions, design notes or production labels inside the image.

## Composition

Adapt the composition to the topic and requested mood. Use consistent alignment, readable contrast, generous internal spacing and a clear distinction between title and supporting copy. For an instructional card, use a short ordered sequence. For a comparison, make corresponding items easy to compare. For a cover, favor one main visual and one main headline.

Keep important text and faces away from cropped edges. Leave enough space between labels and illustrations. Reduce copy rather than squeezing dense paragraphs into small type. Preserve the meaning of supplied screenshots and avoid covering their important controls or data.

Honor requested brand colors and style. Without a specific direction, choose a restrained palette appropriate to the subject and keep decorative elements subordinate to the information. Do not imitate a named creator's proprietary templates or imply this result is an official product of the related project.

## Output controls

Explicit user instructions and the selected image controls take priority over these defaults: aspect ratio, dimensions, resolution, background, output format and image count. If all sizing is automatic and no platform is specified, use a portrait composition suitable for a social feed.

Return one finished card per requested image. Do not automatically split the task into multiple model requests, create extra cover variants or squeeze a requested sequence into an unreadable contact sheet. A user asking for a series may specify which page to generate next using the same visual direction.

## Capability boundaries

This is an image-model workflow, not an HTML/CSS renderer or a publishing tool. Do not claim to run browser screenshots, local files, layout validators, font installation, video editing or Live Photo packaging. Text fidelity depends on the selected image model; do not promise pixel-perfect lettering or deterministic layout.
