# Private CPU image screening

This service provides actual NSFW model inference and Chinese/English OCR. The community backend applies policy thresholds and custom word matching; this service never publishes or rejects a community work itself. Images and recognized text are not written to disk or logs.

## Community policy

Administrators configure automatic screening under the community review settings (`/admin?tab=review`). `communityModeration` contains `enabled`, `sensitiveWords`, `reviewThreshold` (default `0.65`) and `rejectThreshold` (default `0.95`). Thresholds must be finite numbers with `0 < reviewThreshold < rejectThreshold <= 1`; a lower threshold is stricter. At or above the reject threshold, the backend returns HTTP 422 / `WORK_MODERATION_REJECTED` and creates no public work. At or above the review threshold, or if screening fails, the work stays private for human review. Lower scores still follow the site's existing publication mode.

Sensitive words are literal, NFKC-normalized and case-insensitive. They apply to public work text, public generation parameters, and OCR text from output/reference images. An empty list disables word matching; there is no general-purpose language-model text moderation. Videos and animations require human review. Drafts skip screening; edits are checked again, and a pending edit preserves the previous public version. Changing the policy during a check requires resubmission. Automatic rejections do not by themselves add account violations or bans.

## Contract

- Listen on `0.0.0.0:8080` inside the private container network. Do not publish the port on the host, attach a public proxy, or give the container internet access. The server also rejects peers whose socket address is not private or loopback; forwarded headers are not trusted.
- Set `COMMUNITY_MODERATION_TOKEN` to a shared secret of at least 32 characters. Keep the secret outside Git and out of browser requests. `MODERATION_MODEL_DIR` defaults to `/opt/models`.
- `GET /healthz`: 200 only after all four model checksums are verified and inference sessions are initialized.
- `POST /check`: `Authorization: Bearer <token>`, `Content-Type: application/octet-stream`, a single correct `Content-Length`, and raw original image bytes. Do not send URLs, base64 JSON, compressed HTTP bodies or chunked bodies.
- Success: `{ "nsfwScore": 0.0, "text": "recognized text", "modelVersion": "falconsai-vit-int8-1ceb3c7-ppocrv4-rapidocr3.10.0" }`. A score is a model output, not a calibrated probability of policy violation.
- Optional `X-Moderation-Reject-Threshold`: one finite number with `0 < threshold <= 1`, supplied by the authenticated backend from the current policy. A score at or above it returns immediately with `text: ""` and `ocrSkipped: true`, so an OCR failure cannot discard an already decisive NSFW result. The backend must check its rejection threshold first and route any remaining `ocrSkipped: true` result to human review; skipped OCR must never allow publication. Without the header, the service always performs full OCR. Invalid or duplicate threshold headers return 400.
- 422: unsupported/invalid image, pixel or byte limit, multiple animation/page frames, invalid model/OCR output or text above 20,000 characters. 503: busy, inference failure or request failure. These responses require manual review and must never be interpreted as clean content.
- 401/403/400/415/417 describe auth, network or request errors. Responses contain fixed error codes only, never exception details or extracted text.

## Bounds and limitations

One inference slot, at most eight HTTP handler threads, 20 MiB body limit and 40 million decoded pixels. There is a 10-second socket inactivity timeout and 30-second absolute connection deadline, including headers and upload. A request that already occupies the slot is not queued behind another inference. Invalid uploads release the slot. Container CPU/memory limits and backend deadlines must also be enabled.

After a complete authenticated body is read, a separate 30-second inference watchdog starts. If native model execution hangs, the process exits with code 70 so `restart: unless-stopped` can recover the only inference slot. A slow HTTP header/body never activates this process watchdog. The web backend must treat a dropped connection or container restart as manual review, never a clean result.

JPEG, single-frame PNG/WebP/GIF/BMP/TIFF are accepted. EXIF rotation is applied in place, then images are bounded to a 4096-pixel longest side before full-color copies or transparency compositing onto white. NSFW uses 224×224 RGB/bilinear normalization. OCR receives BGR pixels; its detector explicitly uses a maximum 960-pixel side, and classifier/recognizer batches are limited to two. CPU memory arenas are disabled. These limits prevent the default minimum-side detector resize from consuming the 1536 MiB service budget on large images. Small/obfuscated text can be missed. GIF/APNG/animated WebP and multi-page TIFF are returned for manual review instead of examining only their first frame. Videos and non-image content should be routed to manual review by the caller.

OCR exceptions return an error. Text is never silently truncated, because truncation could hide a policy match. An image without detected text legitimately returns an empty string. OCR and NSFW do not cover violence, politics, fraud, copyright or age; see `NOTICE.md`.

## Build and checks

From the repository root:

```sh
docker build -f deploy/moderation/Dockerfile -t community-moderation .
```

The build installs a CPU-only locked dependency set, downloads model files at fixed revisions, verifies SHA-256, and runs boundary tests plus real English and Chinese OCR/NSFW smoke checks. Only model binaries and runtime dependencies are copied into the final image; no training framework is installed. Model and license sources are recorded in `models.py` and `NOTICE.md`.

The final image runs as `10001:10001`. It needs no writable model directory or persistent storage. Deploy with a read-only root filesystem, a small `/tmp` tmpfs, private internal network, no host ports, `cap_drop: [ALL]`, `no-new-privileges`, and production CPU/memory/PID limits. Explicit local model paths and the embedded recognizer dictionary avoid runtime downloads. Model checksums are rechecked on every startup.

For a local Python 3.11 environment:

```sh
python -m pip install -r services/moderation/requirements.txt
python services/moderation/models.py /absolute/model-directory
cd services/moderation
python -m unittest -v test_service
python smoke.py --models /absolute/model-directory
python resource_smoke.py --models /absolute/model-directory
```

After building, verify real Linux inference under the production limits with a temporary container:

```sh
docker run --rm --network=none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=67108864 --memory=1536m --memory-swap=1536m --cpus=2 --pids-limit=96 --cap-drop=ALL --security-opt=no-new-privileges community-moderation python resource_smoke.py --require-cgroup-limit
```

This runs real OCR and NSFW on 1280-, 3072-, and 4096-pixel cards plus 40-million-pixel RGB and rotated transparent RGBA cases. It requires peak RSS below 1280 MiB, leaving headroom for the HTTP service within the 1536 MiB limit. The container is removed afterward.

The Chinese test fixture is a locally rendered synthetic phrase, `社区审核测试 2026`; it contains no user data or bundled font. Smoke checks establish real model execution and basic OCR correctness, not real-world moderation accuracy. Production thresholds require representative content validation.
