# Video parameter limits

Verified on 2026-11-11. `app/config/video-models.ts` is the single capability
registry for **all current and future video models**. `app/utils/video-capabilities.ts` is shared by the
composer, restored drafts, and final generation validation. The existing request
serializer also serves historical gallery publishing, so validation runs only at
generation entry points and never rewrites historical results.

Sources:

- xAI: https://docs.x.ai/developers/model-capabilities/video/overview and
  https://docs.x.ai/developers/model-capabilities/video/reference-to-video
- Seedance: https://docs.volcengine.com/docs/82379/1330310 and
  https://docs.volcengine.com/docs/ark/video-generation-tutorial
- Veo: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate
  and https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-references
- Sora-compatible historical API: https://developers.openai.com/api/reference/resources/videos/methods/create
  (official service retired; these limits do not assert channel availability).
- The site's public `/api/pricing` record currently lists `grok-imagine-video-1.5`
  at 480p / 720p / 1080p, 1–15 seconds, matching its text/image generation profile.

Grok reference/pinned-frame generation is capped at 720p. Version 1.5 supports
up to 15 seconds; the older version supports up to 10 seconds for references.
Seedance 2.0 Fast/Mini have separate resolution limits.
Veo reference generation uses a fixed eight seconds. Sora uses discrete 4/8/12
second options; its higher resolution is 1024p, not 1080p.

These are explicit known-model profiles, not capabilities inferred from an API
protocol. Unconfigured models show a missing-configuration message, disable
resolution/duration selection and reject new generation before any API request.
Historical serializers remain compatible and do not rewrite old results.

## Adding a video model

The site's video group also has two channel-specific IDs, verified on 2026-11-11:

- `sd2.0-mini-720p`: the configured channel is `api.kunrouai.com`. Its official
  documentation at https://doc.kunrouai.com/#sd-doc specifies **720p only** and
  integer durations **4–15 seconds**, including reference-image requests.
  The upstream uses `/v1/tasks/sora` with polling through `/v1/videos/{id}`;
  routing availability must be confirmed through New API, independently of these limits.
- `wan3.0`: the configured channel is https://zhiyingai.xyz. Its public generation
  UI's `wan3.0` configuration (the homepage's
  `/_next/static/chunks/app/page-line4-grey-0515a7b4cc5f48ea.js`) specifies **720p/1080p**
  and integer durations **5–30 seconds**, with up to ten reference images.
  Reference-video generation additionally requires output duration plus total
  reference-video duration to stay within 30 seconds. The community remix accepts
  image references only; this profile does not enable or validate video/audio uploads.

The shared billing schema at https://zhangyuapi.com/api/pricing lists generic
resolution tiers. It is not proof that every channel supports every tier; it must
not enable 480p for WAN or 1080p for the SD 720p model.

1. Confirm the actual upstream channel's supported resolutions and seconds;
   a marketing model name alone is not evidence of channel support.
2. Add its exact model ID to `VIDEO_MODEL_PROFILES` in
   `app/config/video-models.ts`. Verified aliases can share the `models` list.
   Configure `resolutions` in ascending order and `durations` either as discrete
   values (`[4, 8, 12]`) or an inclusive integer range (`{ min: 1, max: 15 }`).
3. Add any mode-specific resolution/duration overrides under `modes`; record
   the upstream source and verified date here. A channel limited to 720p must
   use a profile capped at 720p even if another channel supports 1080p.
4. Run `test/video-capabilities.test.ts` and verify model switching in the
   shared parameter panel. No additional UI or submit-handler changes are needed.
