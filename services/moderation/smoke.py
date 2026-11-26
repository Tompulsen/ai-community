"""Real offline CPU inference; no mocked model outputs and no external images."""
import argparse
import io
import json
import os
from pathlib import Path
import sys
import time

from PIL import Image, ImageDraw, ImageFont

from models import MODEL_VERSION
from service import Engine, ReviewRequired


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--font", type=Path)
    options = parser.parse_args()
    sys.dont_write_bytecode = True
    def offline_readonly(event, args):
        if event in {"socket.connect", "socket.getaddrinfo"}:
            raise RuntimeError("Runtime attempted an outbound connection")
        if event == "open" and args[0] != os.devnull and args[2] & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC):
            raise RuntimeError("Runtime attempted a file write")
    sys.addaudithook(offline_readonly)
    started = time.monotonic()
    engine = Engine(options.models)
    loaded = time.monotonic()
    image = Image.new("RGB", (800, 200), "white")
    font = ImageFont.truetype(str(options.font), 64) if options.font else ImageFont.load_default(size=64)
    ImageDraw.Draw(image).text((30, 45), "COMMUNITY TEST 2026", fill="black", font=font)
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    output = engine.check(stream.getvalue())
    assert 0 <= output["nsfwScore"] <= 1
    assert output["modelVersion"] == MODEL_VERSION
    assert "COMMUNITY" in output["text"].upper() and "2026" in output["text"], "Real OCR did not recover the synthetic test text"
    assert output["nsfwScore"] < 0.5, "Synthetic text card unexpectedly classified as NSFW"
    chinese = engine.check((Path(__file__).parent / "fixtures" / "ocr-chinese.png").read_bytes())
    assert "社区审核测试" in chinese["text"] and "2026" in chinese["text"], "Real OCR did not recover the Chinese fixture"
    try:
        engine.check(b"invalid image bytes")
        raise AssertionError("Malformed image passed")
    except ReviewRequired:
        pass
    print(json.dumps({"modelVersion": MODEL_VERSION, "loadSeconds": round(loaded - started, 3), "inferenceSeconds": round(time.monotonic() - loaded, 3), "nsfwScore": output["nsfwScore"], "ocrVerified": True, "chineseOCRVerified": True, "offlineReadOnly": True}))


if __name__ == "__main__":
    main()
