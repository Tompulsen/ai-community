"""Download immutable, hash-checked model artifacts at image build time only."""
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.request

MODEL_VERSION = "falconsai-vit-int8-1ceb3c7-ppocrv4-rapidocr3.10.0"
NSFW_REVISION = "1ceb3c7fe1e9f3f2507e6df577437f23a9149fd5"
OCR_BASE = "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.3.0/onnx/PP-OCRv4"
MODELS = {
    "nsfw.onnx": {
        "url": f"https://huggingface.co/onnx-community/nsfw_image_detection-ONNX/resolve/{NSFW_REVISION}/onnx/model_quantized.onnx",
        "sha256": "d9afb1e057104e6cc8616d174f0f6a8b8b0389c839eea7d5efa4bdf1a77efd27",
    },
    "ocr-det.onnx": {
        "url": f"{OCR_BASE}/det/ch_PP-OCRv4_det_infer.onnx",
        "sha256": "d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9",
    },
    "ocr-cls.onnx": {
        "url": f"{OCR_BASE}/cls/ch_ppocr_mobile_v2.0_cls_infer.onnx",
        "sha256": "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c",
    },
    "ocr-rec.onnx": {
        "url": f"{OCR_BASE}/rec/ch_PP-OCRv4_rec_infer.onnx",
        "sha256": "48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b",
    },
}


def verify_models(directory: Path) -> None:
    for name, expected in MODELS.items():
        path = directory / name
        if not path.is_file():
            raise RuntimeError(f"Model missing or checksum mismatch: {name}")
        with path.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != expected["sha256"]:
                raise RuntimeError(f"Model missing or checksum mismatch: {name}")


def download_models(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for name, item in MODELS.items():
        target = directory / name
        if target.is_file():
            with target.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() == item["sha256"]:
                    continue
        temporary = target.with_suffix(".part")
        try:
            request = urllib.request.Request(item["url"], headers={"User-Agent": "community-moderation-model-build/1"})
            digest = hashlib.sha256()
            size = 0
            with urllib.request.urlopen(request, timeout=60) as response, temporary.open("wb") as stream:
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > 400 * 1024 * 1024:
                        raise RuntimeError("Model exceeds build download limit")
                    digest.update(chunk)
                    stream.write(chunk)
            if digest.hexdigest() != item["sha256"]:
                raise RuntimeError(f"Model checksum mismatch: {name}")
            os.replace(temporary, target)
            print(json.dumps({"model": name, "bytes": size, "verified": True}), flush=True)
        finally:
            temporary.unlink(missing_ok=True)
    verify_models(directory)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python models.py MODEL_DIRECTORY")
    download_models(Path(sys.argv[1]))
