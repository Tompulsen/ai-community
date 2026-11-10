# Web skills

This directory is published to the public `qzq00767/octopus-skills` repository
at `skills/` and excluded from deployment images.
Skill documents include original instructions and explicitly attributed browser
adaptations of MIT-licensed upstream skills. Adapted documents retain their source,
upstream revision, modification notice and full license inside YAML frontmatter.
The model receives the instructions after that metadata is removed.

`catalog.json` contains the public directory. Publish documents first, then update their catalog version and SHA-256 checksum to offer explicit client updates. Checksums use the exact UTF-8 document bytes. Existing installed copies remain unchanged until the user updates them. Set `NEXT_PUBLIC_SKILL_CATALOG_URL` at build time to use another GitHub raw catalog.

Supported kinds: `prompt`, `image-style`, `web`, `papers`. Documents are plain instructions only; scripts, arbitrary tools, local filesystem access and arbitrary network endpoints are never executed.

Web search uses Tavily through New API and bills the signed-in user's selected token. It defaults to `tavily-quick`; set `SKILLS_WEB_SEARCH_MODEL=tavily-deep` for advanced search. See [Tavily setup](../deploy/tavily/README.md). Paper search uses Crossref metadata, not full-text papers. Queries are sent to the selected retrieval service; downloaded skills remain in the browser.

For development only, `/api/skills/preview/...` serves this local directory so unpublished changes can be tested. This route returns 404 in production. Publish this directory to the public skills repository before deploying the marketplace.

Production reads this repository's catalog and skill documents through
`/api/skills/resources/...` on the app's own origin. The read-only route fetches
only the fixed public GitHub skills directory, with bounded sizes and a timeout;
it does not save skill files on the server. Users no longer need direct GitHub
connectivity to browse or install these skills. Installed documents remain in
the user's browser, and their SHA-256 verification is unchanged. Custom catalogs
outside this repository and optional upstream preview images keep their
original URLs.

The four external repositories in the marketplace are client resources. Their tools, licenses and runtime requirements must be checked before use in a desktop client.

## Browser Adaptations

The first common-skills expansion adds eight prompt-only skills:

| Local ID | Upstream | Browser scope |
| --- | --- | --- |
| humanizer | blader/humanizer | Rewrite supplied prose faithfully |
| copywriting | coreyhaines31/marketingskills: copywriting | Draft from supplied product context |
| copy-editing | coreyhaines31/marketingskills: copy-editing | Edit supplied copy |
| brainstorming | obra/superpowers: brainstorming | Explore ideas within the conversation |
| code-review | obra/superpowers: requesting-code-review | Review supplied snippets or diffs |
| systematic-debugging | obra/superpowers: systematic-debugging | Explain diagnostic and repair steps |
| prompt-engineer | Jeffallan/claude-skills: prompt-engineer | Produce reusable prompt templates |
| sql-assistant | Jeffallan/claude-skills: sql-pro | Write and explain SQL without executing it |

These adaptations do not run commands, dispatch agents, inspect repositories,
connect to databases, or gain network access through their prompt text.
They do not promise tested accuracy or runtime behavior.

The expanded catalog uses `writing`, `coding`, and `productivity` categories.
Publish the local `catalog.json` as `skills/catalog-v2.json` in the public
repository. The updated app reads that versioned URL. Preserve the public
`skills/catalog.json` for existing clients, whose schema rejects new categories.
The development preview route maps `catalog-v2.json` to the local `catalog.json`.
Publish documents and the v2 catalog before deploying the updated app.

## Image Styles

Image adapters use the existing `image-style` request path. Their instructions
are appended to the outbound image prompt; attachments and the user's original
message are preserved. Explicit ratio, dimensions, resolution, background,
format and image count take precedence over style defaults.
These are generative interpretations, not deterministic photo compositing or
guarantees that source pixels remain unchanged. They do not execute upstream
scripts, paid integrations or client tools.

| Local ID | Upstream |
| --- | --- |
| gc-minimal-zine-poster | LiamGvchi/gc-minimal-zine-poster |
| photo-relic-editorial | wnby/photo-relic-editorial |
| pixel-style-poster | v92388375-gif/pixel-style-poster-skill |
| kimi-inspired-poster | Fannie0715/kimi-inspired-poster |
| qiaomu-mondo-poster | joeseesun/qiaomu-mondo-poster-design |
| heytea-doodle-poster | Hchen1218/heytea-style |
| dreamcore-collage-poster | AndrwewHan/dreamcore-collage-poster |
| watercolor-travel-card | GZ-L/photo-to-poster-skills |
| impasto-miniature-landscape | GZ-L/photo-to-poster-skills |
| surreal-pop-collage | 2998980-hue/surreal-pop-collage |
| vinyl-image-generator | liigoQi/vinyl-image-generator |
| taxue-halftone | taxueseek/taxue-halftone |
| photo-to-zine-postcard | Whiplashzeb/photo-to-zine-postcard |
| neil-quentin | Nealsun1993/neil-quentin |
| neil-night | Nealsun1993/neil-night-skill |
| photo-riso-poster | luckdvr/photo-riso-poster |
| photo-stamp-archive | Dlcccc71913/skill-make-photo-stamp-archive |
| photo-memory-archive | sbj61188-lab/compose-photo-memory-archive |
| editorial-print-studio | liuzihe849-png/ai-editorial-print-studio |
| silhouette-group-collage | liuzihe849-png/silhouette-group-collage |
| photo-to-ink-painting | lzhandcyx/photo-to-ink-painting-skill |
| paper-cut-illustration | kelegele/paper-cut-illustration-skill |
| solar-polaroid | taxueseek/taxue-solar-polaroid |
| commercial-poster | howardz27/poster-generator-skill |
| photo-to-travel-sketch | liigoQi/photo-to-travel-sketch |
| dreamy-motion-editorial | lzs0594/dreamy-motion-editorial |
| film-print-2383 | n1ko724/kodak-2383-film-look |
| photo-to-minimal-illustration | iamkong/photo-to-minimal-illustration |

Each document pins the verified upstream revision and retains its MIT notice.
The existing `photo-revival` is not duplicated. `heytea-creative-style` exposes
the same `heytea-style` skill and is represented by `heytea-doodle-poster`.
The screenshot spelling `Lmnastapeiniature-Landscape` is interpreted as
`impasto-miniature-landscape`, found alongside `watercolor-travel-card`.

The four additions retain catalog positions 36-39. Ink painting condenses the
upstream content-aware rules. Paper-cut illustration inlines the complete
original visual prompt; the browser edition does not run local background
removal or promise verified transparency. Solar Polaroid incorporates the
hybrid archive and photography rules without the upstream default signature.
Commercial Poster includes four verified style routes (Swiss editorial,
Bauhaus modular, luxury minimal and Art Deco), rather than claiming all twenty
upstream templates. All are self-contained image instructions with no client
scripts, renderer setup or automatic extra requests.

These four repositories license their published materials under MIT without
separate asset exclusions in the checked revisions. Only generated examples
are linked as previews; source reference photos are not copied.

The follow-up selection from `tluy/skill-zine-summary` occupies positions 40-43:
travel sketch, dreamy motion editorial, 2383-inspired film finish and minimal
field-study illustration. Original repositories, rather than the index, are
the attribution and license authority. Their source URLs do not duplicate
existing entries.

Travel sketch includes its dry-marker reference rules; dreamy motion includes
its motion mechanism and preservation rules without its optional analyzer.
The 2383 adapter defaults to full-frame model generation and retains the
upstream unofficial/trademark distinction. It does not execute ImageMagick
or promise exact LUT behavior, unchanged pixels or deterministic panel geometry.
Only minimal illustration has eligible, pinned result previews; no illustrative
icons, external attachments or source photos substitute for the other skills'
missing repository preview assets.

Not included from this selection: `cinema-dna-21x9x3`,
`handdrawn-photo-poster`, `poetic-line-zine-poster` and `reality-restaged`
(no explicit redistribution license found in the checked revisions);
`selective-ink-sketch` (prior written authorization required for commercial use);
`travel-memory-sticker-card` (personal-use terms prohibit marketplace
redistribution); and `flash4start_light` (no clear redistribution license,
requires a local scan-and-render pipeline).

Not redistributed: `photo-abstract-editorial` (CC BY-NC-SA), gathered/distillation
zine skills and `scene-to-art-lab` (personal noncommercial),
`antibes-holiday` and `sunwoven-reverie` (PolyForm Noncommercial),
current `Punk-Skill` (personal-use restrictions), and `travel-photo-abstraction`
(custom restrictions on adaptation and redistribution). A fork's MIT label
does not supersede the original author's restrictions.

Hold skills without clear redistribution permission, including the checked
CRT interface, photo-distill, photo-deconstruct and soft-abstraction sources.
The eachlabs collection requires its own service and credentials, so it is
not included as a prompt-only image style.

Also held: `travel-memory-card-duo` (personal noncommercial restrictions),
`photo-ink-echo` (partly derived from restricted photo-abstract-editorial),
and ambiguous `Aigc-Skills` collections. `8bit-pixel-art` and the identified
`ink-wash-poster` are AGPL-3.0; this expansion only includes permissive MIT
adapters and does not imply those projects are unlicensed or unusable.
The checked paper-spirit, daily-photo, minimal-magazine, material-art and
eastern-ink sources do not provide clear redistribution permission.

## Writing Expansion

The writing selection adds `humanizer-zh`, `stop-slop`, `no-ai-slop`,
`academic-humanizer` and `shuorenhua` as MIT browser adaptations, with pinned
upstream revisions and full notices. The existing `humanizer` ("自然化润色")
already represents blader/humanizer and is not duplicated or renumbered.
The adapters retain distinct Chinese editing, English rule-based editing,
personal voice, academic evidence discipline and annotation-only workflows.
They are self-contained prompts, not AI authorship detectors.

`lieflat-less-ai-tone` is a `client` source-link entry only. The checked revision
uses CC BY-NC 4.0 and depends on local detection/report scripts. No upstream
instructions, scripts, data or assets are redistributed, and the marketplace
offers its repository link rather than web enablement. Commercial licensing
must be resolved with its author before incorporating upstream materials.

## Style Previews

The next image batch appends positions 47-50 without renumbering existing skills:
`xiutu`, `flat-cartoon-photo-mashup`, `cloud-doodle-animal`, and
`child-photo-doodle-collage`. Each retains a pinned source revision and the
upstream MIT notice. Xiutu provides targeted cleanup, lighting, beauty and flash
directions rather than duplicating the broader photo-retouch entry. Its local
prompt synchronization, confirmation workflow and six-headshot automation are
not part of the image-only browser edition.

The cartoon adapter uses generative editing rather than local deterministic
compositing. Cloud doodles do not promise unchanged source pixels. Interactive
portraits retain pose-aware contacts but do not quote upstream credit costs,
download bundled reference photos or automatically retry generation.
The flat-cartoon repository explicitly excludes its third-party reference
screenshots from MIT; none are used. This batch adds no asset previews.

Skipped as already installed: `pixel-style-poster-skill` (`pixel-style-poster`).
Held on this check: `editorial-hero-type-poster` (CC BY-NC 4.0),
`gathered-scenes-zine-skill` (personal noncommercial terms),
and `tait-crt-interface-skill` (no explicit redistribution license found).
`paper-spirit-zine` declares MIT in README, but its linked LICENSE is absent
and no copyright/license notice was found in its skill directory; obtain a
complete notice before redistributing an adaptation.

`social-card` is an independently authored image-model skill for social covers
and information cards, added after reviewing `op7418/guizang-social-card-skill`.
It does not redistribute that project's AGPL instructions, templates or assets,
and does not claim to implement its HTML renderer, batch export or Live Photo
workflow. Its MIT license applies only to the new browser instructions.
The related project is identified in document metadata, not as this skill's
implementation source. Existing image controls determine output parameters.

`photo-retouch-pro` adds a photo-retouching entry using independently authored
browser instructions. Its related-project metadata identifies the project requested by the
user; the upstream repository did not state redistribution terms when checked.
No upstream instructions, reference files or example assets are redistributed.
The MIT label applies only to our browser document, not the upstream repository.
This entry uses the existing image editing flow and requires a reference photo
and a model that supports editing images. It does not run desktop tools or
automatically create comparison panels or extra images.

Optional `preview` metadata contains up to four immutable GitHub raw image URLs,
captions, asset credit, asset license and its source notice. Asset permissions
are checked separately from the skill's software license. For example,
heytea-style examples use CC BY 4.0; its private reference cutouts are excluded.
Taxue visual examples explicitly reserve rights and are not embedded.

The marketplace keeps style examples collapsed until the user opens a skill's
name control. Only one inline gallery is expanded at a time; filters and
pagination collapse it. Example images load directly in the browser, with lazy
loading, no referrer and fixed thumbnail dimensions. It does not proxy images
through the app server or embed them in model instructions. Images without
verified previews retain the text listing. The enlarged view shows complete
images, individual captions, provenance and the asset license. Network failures
show a stable fallback without blocking skill enablement.
