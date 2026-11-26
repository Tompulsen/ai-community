"""Real large-image inference and peak RSS checks; run inside the production memory limit."""
import argparse
import io
import json
import os
from pathlib import Path
import sys
import time

from PIL import Image, ImageDraw, ImageFont

from service import Engine


def peak_mib():
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes
        class Counters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [(name, ctypes.c_size_t) for name in
                ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
                 "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage", "PrivateUsage")]
        value = Counters()
        value.cb = ctypes.sizeof(value)
        ctypes.windll.kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        ctypes.windll.psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        assert ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(value), value.cb)
        return value.PeakWorkingSetSize / 1048576
    import resource
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", type=Path, default=Path("/opt/models"))
    parser.add_argument("--require-cgroup-limit", action="store_true")
    args = parser.parse_args()
    sys.dont_write_bytecode = True
    memory_limit = None
    for path in (Path("/sys/fs/cgroup/memory.max"), Path("/sys/fs/cgroup/memory/memory.limit_in_bytes")):
        if path.is_file() and path.read_text().strip().isdigit():
            memory_limit = int(path.read_text())
            break
    if args.require_cgroup_limit:
        assert memory_limit is not None and 0 < memory_limit <= 1536 * 1048576, "Run with --memory=1536m or a tighter cgroup limit"

    def offline_readonly(event, values):
        if event in {"socket.connect", "socket.getaddrinfo"}:
            raise RuntimeError("Inference attempted network access")
        if event == "open" and values[0] != os.devnull and values[2] & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC):
            raise RuntimeError("Inference attempted a file write")
    sys.addaudithook(offline_readonly)
    engine = Engine(args.models)
    assert engine.ocr.text_det.limit_type == "max" and engine.ocr.text_det.limit_side_len == 960
    results = []
    for width, height, mode in ((1280, 853, "RGB"), (3072, 2048, "RGB"), (4096, 2731, "RGB"),
                                (8000, 5000, "RGB"), (8000, 5000, "RGBA")):
        image = Image.new(mode, (width, height), "white" if mode == "RGB" else (255, 255, 255, 0))
        ImageDraw.Draw(image).text((width // 30, height // 5), "COMMUNITY TEST 2026", fill="black", font=ImageFont.load_default(size=width // 18))
        stream = io.BytesIO()
        exif = image.getexif()
        exif[274] = 6 if mode == "RGBA" else 1
        image.save(stream, format="PNG", exif=exif)
        image.close()
        data = stream.getvalue()
        stream.close()
        started = time.monotonic()
        output = engine.check(data, reject_threshold=1.0)
        elapsed = time.monotonic() - started
        assert not output.get("ocrSkipped") and "COMMUNITY" in output["text"].upper() and "2026" in output["text"]
        assert 0 <= output["nsfwScore"] < 0.65
        assert elapsed < 12, "A single image exceeded the backend request budget"
        peak = peak_mib()
        assert peak < 1280, "Leave at least 256 MiB of headroom within the 1536 MiB service limit"
        result = {"width": width, "height": height, "mode": mode, "seconds": round(elapsed, 3), "peakRssMiB": round(peak, 2), "ocrVerified": True}
        results.append(result)
        print(json.dumps(result), flush=True)
    skipped = engine.check(data, reject_threshold=1e-12)
    assert skipped["ocrSkipped"] is True and skipped["text"] == "" and skipped["nsfwScore"] >= 1e-12
    print(json.dumps({"passed": True, "cases": len(results), "memoryLimitBytes": memory_limit,
                      "peakRssMiB": round(peak_mib(), 2), "realThresholdShortCircuit": True, "offlineReadOnly": True}), flush=True)


if __name__ == "__main__":
    main()
