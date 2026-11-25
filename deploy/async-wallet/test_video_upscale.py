"""Signed DMC upscale admission preserves the original wire; no live models."""
import asyncio
import base64
from email import policy
from email.parser import BytesParser
import itertools
import json
import sys

import httpx
import pytest

from test_community_wallet import settings, signed_headers, signature, TOKEN
from test_proxy_integration import load_service, RealAsyncClient


MODEL = "DMC \u89c6\u9891\u8d85\u5206"
PATH = "/async-videos/v1/tasks"
MP4 = b"\x00\x00\x00\x18ftypisom" + b"video-fixture"
NONCES = itertools.count(1)


@pytest.fixture
def service(monkeypatch):
    api, core, _ = load_service(monkeypatch, "video")
    return api, core


def multipart(prompt=None, model=MODEL, metadata=None, videos=None, extras=()):
    fields = [("model", (None, model)),
              ("metadata", (None, json.dumps(metadata or {"operation": "upscale"})))]
    if prompt is not None:
        fields.append(("prompt", (None, prompt)))
    fields.extend(videos if videos is not None else [("input_videos", ("source.mp4", MP4, "video/mp4"))])
    fields.extend(extras)
    request = httpx.Request("POST", "http://proxy" + PATH, files=fields)
    return request.read(), request.headers["Content-Type"]


def post(api, body, content_type="application/json", signed=True, idem="request-test-00001", tamper=False):
    headers = {"Authorization": "Bearer " + TOKEN, "Idempotency-Key": idem,
               "Content-Type": content_type}
    if signed:
        headers.update(signed_headers(body, PATH, nonce=f"{next(NONCES):032x}"))
        headers["Idempotency-Key"] = idem
        headers["Content-Type"] = content_type
        headers["X-Community-Signature"] = signature(headers, PATH, body)
        if tamper:
            headers["X-Community-Signature"] = "0" * 64

    async def invoke():
        async with RealAsyncClient(transport=httpx.ASGITransport(api.app), base_url="http://proxy") as client:
            return await client.post(PATH, headers=headers, content=body)
    return asyncio.run(invoke())


@pytest.mark.parametrize("prompt", [None, "", "optional description", "\u4e2d" * 8000])
def test_only_verified_dmc_upload_accepts_optional_prompt_and_keeps_bytes(service, prompt):
    api, core = service
    body, content_type = multipart(prompt=prompt)
    response = post(api, body, content_type)
    assert response.status_code == 202, response.text
    row = api.video_row(response.json()["id"])
    saved = core.unseal(row["payload"])
    assert base64.b64decode(saved["wire"]["body"]) == body
    assert saved["wire"]["content_type"] == content_type
    assert saved["request"]["prompt"] == prompt
    assert saved["wallet"]["user"] == "17"
    assert row["reserved"] >= api.MAX_VIDEO + len(row["payload"]) + 4096
    repeated = post(api, body, content_type)
    assert repeated.status_code == 202 and repeated.json()["id"] == row["id"]
    changed, changed_type = multipart(prompt="changed request")
    assert post(api, changed, changed_type).status_code == 409

    calls = []
    def upstream(request):
        calls.append(request)
        assert request.url.path == "/v1/videos"
        assert request.read() == body
        assert request.headers["Content-Type"] == content_type
        assert request.headers["X-Community-Signature"] == signature(request.headers, "/v1/videos", body)
        return httpx.Response(202, json={"id": "upscale-upstream-id", "status": "queued"})

    async def run():
        async with RealAsyncClient(transport=httpx.MockTransport(upstream)) as client:
            claimed, claim = api.claim_video()
            await api.process_video(client, claimed, claim)
    asyncio.run(run())
    assert api.video_row(row["id"])["status"] == "generating"
    assert len(calls) == 1


@pytest.mark.parametrize("prompt", ["a" * 24001, "\u4e2d" * 8001])
def test_upscale_prompt_limit_counts_utf8_bytes(service, prompt):
    api, core = service
    body, content_type = multipart(prompt=prompt)
    assert post(api, body, content_type).status_code == 422
    with core.db() as connection:
        assert connection.execute("SELECT count(*) FROM video_jobs").fetchone()[0] == 0


@pytest.mark.parametrize("variant", [
    "ordinary-json", "signed-json", "unsigned-multipart", "wrong-model", "wrong-operation",
    "missing-file", "file-as-string", "duplicate-file", "duplicate-metadata", "wrong-mime",
    "not-mp4", "input-alias", "file-alias", "metadata-reference", "metadata-content",
])
def test_empty_prompt_exemption_rejects_other_request_shapes(service, variant):
    api, core = service
    if variant in ("ordinary-json", "signed-json"):
        body = json.dumps({"model": MODEL, "prompt": "", "metadata": {"operation": "upscale"},
                           "input_videos": ["source.mp4"], "upscale": True}).encode()
        response = post(api, body, signed=variant == "signed-json")
    else:
        kwargs = {}
        if variant == "wrong-model": kwargs["model"] = "ordinary-video"
        elif variant == "wrong-operation": kwargs["metadata"] = {"operation": "generate"}
        elif variant == "missing-file": kwargs["videos"] = []
        elif variant == "file-as-string": kwargs["videos"] = [("input_videos", (None, "source.mp4"))]
        elif variant == "duplicate-file":
            kwargs["videos"] = [("input_videos", ("source.mp4", MP4, "video/mp4"))] * 2
        elif variant == "duplicate-metadata":
            kwargs["extras"] = [("metadata", (None, '{"operation":"upscale"}'))]
        elif variant == "wrong-mime": kwargs["videos"] = [("input_videos", ("source.mp4", MP4, "video/webm"))]
        elif variant == "not-mp4": kwargs["videos"] = [("input_videos", ("source.mp4", b"not-an-mp4-file", "video/mp4"))]
        elif variant == "input-alias": kwargs["extras"] = [("input_videos[]", (None, "other.mp4"))]
        elif variant == "file-alias": kwargs["extras"] = [("reference_videos", ("source.mp4", MP4, "video/mp4"))]
        elif variant == "metadata-reference": kwargs["metadata"] = {"operation": "upscale", "reference_videos": ["other.mp4"]}
        elif variant == "metadata-content": kwargs["metadata"] = {"operation": "upscale", "content": [{"type": "image_url", "image_url": "private.png"}]}
        body, content_type = multipart(prompt="", **kwargs)
        response = post(api, body, content_type, signed=variant != "unsigned-multipart")
    assert response.status_code == 422, response.text
    with core.db() as connection:
        assert connection.execute("SELECT count(*) FROM video_jobs").fetchone()[0] == 0


def test_invalid_signature_cannot_admit_optional_prompt(service):
    api, core = service
    body, content_type = multipart()
    assert post(api, body, content_type, tamper=True).status_code == 403
    with core.db() as connection:
        assert connection.execute("SELECT count(*) FROM video_jobs").fetchone()[0] == 0


def test_internal_upscale_flag_without_wallet_cannot_skip_prompt_validation(service):
    api, core = service
    with pytest.raises(core.AdmissionError):
        api.submit_video(core.owner_for(TOKEN), "no-wallet-request", {"model": MODEL}, TOKEN,
                         "127.0.0.1", upscale=True)
    with pytest.raises(core.AdmissionError) as error:
        api.submit_video(core.owner_for(TOKEN), "no-wallet-request", {"model": MODEL}, TOKEN,
                         "127.0.0.1", wire={"body": "e30=", "content_type": "multipart/form-data"}, upscale=True)
    assert error.value.status == 403


def test_maximum_64mib_mp4_including_form_overhead_is_admitted_and_resigned(service, monkeypatch):
    api, core = service
    wallet = sys.modules[api.__package__ + ".community_wallet"]
    seen = []
    def admit(owner, idem, payload, token, origin, wire=None, upscale=False):
        assert wallet.current_wallet(token)["user"] == "17"
        assert upscale is True
        seen.append(wire)
        return {"id": "large-upload", "status": "queued", "progress": 0,
                "created": api.timestamp(), "expires": api.timestamp() + 100}
    monkeypatch.setattr(api, "submit_video", admit)
    source = MP4 + b"\x00" * (64 * 1024**2 - len(MP4))
    body, content_type = multipart(videos=[("input_videos", ("source.mp4", source, "video/mp4"))])
    assert 64 * 1024**2 < len(body) < 65 * 1024**2
    response = post(api, body, content_type)
    assert response.status_code == 202, response.text
    assert base64.b64decode(seen[0]["body"]) == body
    intent = {"client": wallet._config()[1], "user": "17", "idem": "request-test-00001",
              "token_hash": wallet._token_hash(TOKEN)}
    forwarded = wallet.sign_request(intent, TOKEN, "http://new-api:3000/v1/videos",
                                    {"Content-Type": content_type}, content=body)
    assert forwarded["content"] == body
    assert forwarded["headers"]["X-Community-Signature"] == signature(forwarded["headers"], "/v1/videos", body)


def test_signed_body_above_65mib_is_rejected_before_admission(service):
    api, core = service
    async def chunks():
        for _ in range(66):
            yield b"x" * 1024**2
    async def invoke():
        headers = signed_headers(b"", PATH, nonce=f"{next(NONCES):032x}")
        async with RealAsyncClient(transport=httpx.ASGITransport(api.app), base_url="http://proxy") as client:
            return await client.post(PATH, headers=headers, content=chunks())
    assert asyncio.run(invoke()).status_code == 413
    with core.db() as connection:
        assert connection.execute("SELECT count(*) FROM video_jobs").fetchone()[0] == 0


def test_unsigned_json_body_keeps_existing_1mib_limit(service):
    api, _ = service
    prefix = b'{"model":"ordinary-video","prompt":"test","reference":"'
    suffix = b'"}'
    body = prefix + b"a" * (1024**2 - len(prefix) - len(suffix)) + suffix
    assert post(api, body, signed=False).status_code == 202
    assert post(api, body + b" ", signed=False, idem="oversized-unsigned-request").status_code == 413


def test_ordinary_generation_keeps_existing_nonempty_prompt_limit(service):
    api, _ = service
    body = json.dumps({"model": "ordinary-video", "prompt": "a" * 32000}).encode()
    assert post(api, body, signed=False).status_code == 202
    for prompt in (None, "", "a" * 32001):
        body = json.dumps({"model": "ordinary-video", "prompt": prompt}).encode()
        assert post(api, body, signed=False, idem="invalid-generation-request").status_code == 422


def test_signed_generation_preserves_mixed_reference_wire_and_worker_signature(service):
    api, core = service
    audio = b"RIFF\x00\x00\x00\x00WAVEreference-audio\x00\xff"
    image = b"\x89PNG\r\n\x1a\nreference-image"
    body, content_type = multipart(
        prompt="Generate with the supplied media", model="ordinary-video",
        metadata={"aspect_ratio": "16:9"},
        extras=[("seconds", (None, "6")),
                ("input_audios", ("reference.wav", audio, "audio/wav")),
                ("input_reference", ("reference.png", image, "image/png"))],
    )
    response = post(api, body, content_type)
    assert response.status_code == 202, response.text
    row = api.video_row(response.json()["id"])
    saved = core.unseal(row["payload"])
    assert saved["request"] == {"model": "ordinary-video", "prompt": "Generate with the supplied media"}
    assert saved["wallet"]["user"] == "17"
    assert base64.b64decode(saved["wire"]["body"]) == body
    assert saved["wire"]["content_type"] == content_type

    calls = []
    def upstream(request):
        calls.append(request)
        assert request.url.path == "/v1/videos"
        forwarded = request.read()
        assert forwarded == body
        assert request.headers["Content-Type"] == content_type
        assert request.headers["Authorization"] == "Bearer " + TOKEN
        assert request.headers["X-Community-User"] == "17"
        assert request.headers["X-Community-Signature"] == signature(request.headers, "/v1/videos", forwarded)
        message = BytesParser(policy=policy.default).parsebytes(
            b"Content-Type: " + content_type.encode() + b"\r\nMIME-Version: 1.0\r\n\r\n" + forwarded)
        parts = {part.get_param("name", header="content-disposition"): part for part in message.iter_parts()}
        assert parts["model"].get_payload(decode=True) == b"ordinary-video"
        assert parts["prompt"].get_payload(decode=True) == b"Generate with the supplied media"
        assert parts["seconds"].get_payload(decode=True) == b"6"
        assert json.loads(parts["metadata"].get_payload(decode=True)) == {"aspect_ratio": "16:9"}
        for field, filename, data, media_type in (
            ("input_videos", "source.mp4", MP4, "video/mp4"),
            ("input_audios", "reference.wav", audio, "audio/wav"),
            ("input_reference", "reference.png", image, "image/png"),
        ):
            assert parts[field].get_filename() == filename
            assert parts[field].get_content_type() == media_type
            assert parts[field].get_payload(decode=True) == data
        return httpx.Response(202, json={"id": "mixed-upstream-id", "status": "queued"})

    async def run():
        async with RealAsyncClient(transport=httpx.MockTransport(upstream)) as client:
            claimed, claim = api.claim_video()
            await api.process_video(client, claimed, claim)
    asyncio.run(run())
    assert api.video_row(row["id"])["status"] == "generating"
    assert len(calls) == 1


@pytest.mark.parametrize("file_count,expected_status", [(10, 202), (11, 400)])
def test_signed_generation_enforces_ten_reference_file_limit(service, file_count, expected_status):
    api, core = service
    files = [("input_videos", (f"clip-{index}.mp4", MP4, "video/mp4"))
             for index in range(file_count - 2)]
    files.extend([("input_audios", ("reference.wav", b"RIFFfixtureWAVE", "audio/wav")),
                  ("input_reference", ("reference.png", b"\x89PNG\r\n\x1a\n", "image/png"))])
    body, content_type = multipart(prompt="Generate", model="ordinary-video",
                                   metadata={"aspect_ratio": "16:9"}, videos=files)
    response = post(api, body, content_type)
    assert response.status_code == expected_status, response.text
    with core.db() as connection:
        assert connection.execute("SELECT count(*) FROM video_jobs").fetchone()[0] == (expected_status == 202)
