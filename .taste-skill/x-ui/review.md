# UI refinement record — 2026-11-04

Question: Which approved AI work can I explore or discuss, and where can I submit my own?
Objects: video, image and resource works; real author identity, content, media, discussion link and reply count. Review state is server-owned. Public lists never include pending submissions.
Users: visitors browse, members submit/comment, moderators review. Navigation always names the three communities; AI tools remain explicitly reserved.
Identity: Misskey theme and typography plus the user's X screenshot composition. No X account warning, personal data or sample media was copied.
Signature: creator-aligned continuous feed and a real pre-review submission entry, with no invented engagement controls or statistics.

## Reference application
- Galaxy: Buttons/0x-Sarthak_hungry-penguin-30.html; adapt arrow movement, hover and press feedback, keep reduced-motion handling and MIT attribution. Avoid its purple paint and decorative expanding disk because the user asked for restraint.
- Taste Skill: app-screen workflow; draw True-black flat, seed 1803568725, no redraw. Keep palette,type preserves the existing Misskey theme and user preference instead of forcing black globally. Adopt flat surfaces, inverted primary, strong type hierarchy and minimal color. The X reference authorizes the thin selected-tab indicator; this is a community feed, not the sheet's suggested administrative table.
- Impeccable: context read the existing product record; craft-floor and quieter guide refinement. Operate mode for posting/review, content-led browsing for works. Detect returned [].

## Measured changes
Initial inspect failed contrast: green tab text and white-on-green primary were 2.5:1. Updated neutral foreground-on-panel/inverted pair passes: 5.656:1 light and 13.356:1 dark. Small supporting labels now 13px; dates are 12px on mobile.
Reviewer identified a sticky navigation focus risk. Browser reproduction found three obscured links under reverse Tab. Adding scroll-padding-block-start:72px to the actual scroll container resolves the reproduced issue; 15 reverse focus moves now pass.
Mobile entry is one action row. First work begins at y476.83 in an 844px viewport, before 60% of the screen, including the preview banner and shell.

## Verification
- Taste source lint: 0 FAIL / 0 WARN.
- Taste inspect: 3 bounded rounds. Last report 0 FAIL / 2 WARN. The edge warning on the preview brand was subsequently corrected from 12px to 16px and visually verified. The below-fold reminder is accepted: a continuous social feed scrolls; optional publishing guidance belongs after works, not above them. No exceptions were passed to hide detector findings.
- Impeccable detector: [].
- 12 existing browser behavior groups and design-test.cjs pass. Five populated layout screenshots, 320–1440px with light/dark checks; no page horizontal overflow.
- Three modified Vue SFCs compile; targeted TypeScript, theme-variable and SPDX checks pass. Independent Vue reviewer confirmed focus repair and mobile grid.
- Actual media playback, authentication, moderation backend and full-app build remain outside this isolated preview's verification.

## Context note
Impeccable reports PRODUCT.md uses an older record schema. Its optional init migration was not performed because this request is UI refinement. Existing confirmed product requirements remain authoritative.

## Data provenance
All example works in .community-preview/preview.js are explicitly labeled fixtures and use in-memory API responses. No real users, private account state or media from the user's screenshot were copied. Preview SVGs come from official Tabler source with its MIT license retained.
