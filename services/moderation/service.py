"""Private CPU image screening service. Failures always require manual review."""
from contextlib import suppress
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import ipaddress
import json
import logging
import math
import os
from pathlib import Path
import socket
import threading
import warnings

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from models import MODEL_VERSION, verify_models

MAX_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 40_000_000
MAX_TEXT = 20_000
OCR_MAX_SIDE = 4096
OCR_DETECTOR_SIDE = 960
REQUEST_SECONDS = 30
INFERENCE_SECONDS = 30
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class ReviewRequired(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def decode_image(data: bytes) -> Image.Image:
    if not data or len(data) > MAX_BYTES:
        raise ReviewRequired("IMAGE_SIZE")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if source.width * source.height > MAX_PIXELS or source.width < 1 or source.height < 1:
                    raise ReviewRequired("IMAGE_PIXELS")
                if getattr(source, "n_frames", 1) != 1:
                    raise ReviewRequired("ANIMATED_IMAGE")
                if source.format not in {"JPEG", "PNG", "WEBP", "GIF", "BMP", "TIFF"}:
                    raise ReviewRequired("IMAGE_FORMAT")
                source.load()
                ImageOps.exif_transpose(source, in_place=True)
                # Bound full-color copies before alpha compositing a large decoded image.
                source.thumbnail((OCR_MAX_SIDE, OCR_MAX_SIDE), Image.Resampling.LANCZOS)
                if "A" in source.getbands() or "transparency" in source.info:
                    rgba = source.convert("RGBA")
                    background = Image.new("RGBA", rgba.size, "white")
                    return Image.alpha_composite(background, rgba).convert("RGB")
                return source.convert("RGB")
    except ReviewRequired:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ReviewRequired("IMAGE_DECODE") from None


def nsfw_input(image: Image.Image) -> np.ndarray:
    resized = image.resize((224, 224), Image.Resampling.BILINEAR)
    pixels = np.asarray(resized, dtype=np.float32) / np.float32(255)
    pixels = (pixels - np.float32(0.5)) / np.float32(0.5)
    return np.ascontiguousarray(pixels.transpose(2, 0, 1)[None, ...])


def nsfw_probability(logits: np.ndarray) -> float:
    values = np.asarray(logits, dtype=np.float64)
    if values.shape != (1, 2) or not np.isfinite(values).all():
        raise ReviewRequired("MODEL_OUTPUT")
    exponentials = np.exp(values[0] - values[0].max())
    return float(exponentials[1] / exponentials.sum())


class Engine:
    def __init__(self, directory: Path):
        verify_models(directory)
        import onnxruntime as ort
        from rapidocr import EngineType, ModelType, OCRVersion, RapidOCR

        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        options.enable_cpu_mem_arena = False
        self.nsfw = ort.InferenceSession(str(directory / "nsfw.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
        self.input_name = self.nsfw.get_inputs()[0].name
        # The pinned recognizer embeds its dictionary; an absent dictionary must not trigger a download.
        recognizer = ort.InferenceSession(str(directory / "ocr-rec.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
        if "character" not in recognizer.get_modelmeta().custom_metadata_map:
            raise RuntimeError("OCR dictionary is missing")
        del recognizer
        self.ocr = RapidOCR(params={
            "Global.log_level": "critical", "Global.max_side_len": OCR_MAX_SIDE,
            "Global.model_root_dir": str(directory),
            "EngineConfig.onnxruntime.intra_op_num_threads": 2,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            "EngineConfig.onnxruntime.enable_cpu_mem_arena": False,
            "EngineConfig.onnxruntime.use_cuda": False,
            # RapidOCR defaults to a minimum side, which leaves large detector inputs unbounded.
            "Det.limit_type": "max", "Det.limit_side_len": OCR_DETECTOR_SIDE,
            "Cls.cls_batch_num": 2, "Rec.rec_batch_num": 2,
            **{f"{kind}.model_path": str(directory / f"ocr-{kind.lower()}.onnx") for kind in ("Det", "Cls", "Rec")},
            **{f"{kind}.ocr_version": OCRVersion("PP-OCRv4") for kind in ("Det", "Cls", "Rec")},
            **{f"{kind}.model_type": ModelType("mobile") for kind in ("Det", "Cls", "Rec")},
            **{f"{kind}.engine_type": EngineType("onnxruntime") for kind in ("Det", "Cls", "Rec")},
        })
        # RapidOCR 3.10 loads lazily; health must wait for every inference session.
        self.ocr._load_det_model()
        self.ocr._load_cls_model()
        self.ocr._load_rec_model()

    def check(self, data: bytes, reject_threshold: float | None = None) -> dict:
        image = decode_image(data)
        try:
            score = nsfw_probability(self.nsfw.run(None, {self.input_name: nsfw_input(image)})[0])
            # A definitive rejection must not depend on a later OCR allocation or timeout.
            if reject_threshold is not None and score >= reject_threshold:
                return {"nsfwScore": score, "text": "", "modelVersion": MODEL_VERSION, "ocrSkipped": True}
            # RapidOCR expects OpenCV BGR arrays when called with an ndarray.
            result = self.ocr(np.asarray(image)[:, :, ::-1].copy())
            if result is None or not hasattr(result, "txts"):
                raise ReviewRequired("OCR_OUTPUT")
            words = result.txts
            if words is None:
                words = []
            if not isinstance(words, (list, tuple)) or not all(isinstance(word, str) for word in words):
                raise ReviewRequired("OCR_OUTPUT")
            text = "\n".join(words)
            if len(text) > MAX_TEXT:
                raise ReviewRequired("OCR_TEXT_TOO_LONG")
            return {"nsfwScore": score, "text": text, "modelVersion": MODEL_VERSION}
        finally:
            image.close()


def bounded_inference(engine, data: bytes, reject_threshold: float | None = None) -> dict:
    finished = threading.Event()
    def expire():
        if not finished.is_set():
            logging.critical("inference_timeout")
            # Native inference cannot safely be killed in a thread. The container supervisor restarts us.
            os._exit(70)
    watchdog = threading.Timer(INFERENCE_SECONDS, expire)
    watchdog.daemon = True
    watchdog.start()
    try:
        return engine.check(data) if reject_threshold is None else engine.check(data, reject_threshold=reject_threshold)
    finally:
        finished.set()
        watchdog.cancel()


class ModerationServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address, engine, token: str):
        if len(token) < 32:
            raise ValueError("COMMUNITY_MODERATION_TOKEN must contain at least 32 characters")
        self.engine = engine
        self.token = token
        self.inference = threading.BoundedSemaphore(1)
        self.connections = threading.BoundedSemaphore(8)
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        if not self.connections.acquire(blocking=False):
            with suppress(OSError):
                request.settimeout(0.2)
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\nRetry-After: 2\r\n\r\n")
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.connections.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.connections.release()

    def handle_error(self, request, client_address):
        logging.error("request_failed")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "CommunityModeration"
    sys_version = ""

    def handle(self):
        self.request.settimeout(10)
        # An absolute deadline also stops slow header/body trickles that evade socket inactivity timeouts.
        def expire():
            with suppress(OSError):
                self.request.shutdown(socket.SHUT_RDWR)
        deadline = threading.Timer(REQUEST_SECONDS, expire)
        deadline.daemon = True
        deadline.start()
        try:
            super().handle()
        finally:
            deadline.cancel()

    def log_message(self, format, *args):
        pass

    def send_error(self, code, message=None, explain=None):
        self.respond(code, {"error": "HTTP_REQUEST"})

    def respond(self, status: int, payload: dict):
        self.close_connection = True
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            if status == 503:
                self.send_header("Retry-After", "2")
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass

    def private_peer(self) -> bool:
        peer = ipaddress.ip_address(self.client_address[0])
        if not (peer.is_private or peer.is_loopback):
            self.respond(403, {"error": "PRIVATE_NETWORK_ONLY"})
            return False
        return True

    def handle_expect_100(self):
        self.respond(417, {"error": "EXPECT_UNSUPPORTED"})
        return False

    def do_GET(self):
        if not self.private_peer():
            return
        if self.path != "/healthz":
            self.respond(404, {"error": "NOT_FOUND"})
            return
        self.respond(200, {"ready": True, "modelVersion": MODEL_VERSION})

    def do_POST(self):
        if not self.private_peer():
            return
        if self.path != "/check":
            self.respond(404, {"error": "NOT_FOUND"})
            return
        authorization = self.headers.get_all("Authorization", [])
        if len(authorization) != 1 or not hmac.compare_digest(authorization[0].encode(), ("Bearer " + self.server.token).encode()):
            self.respond(401, {"error": "UNAUTHORIZED"})
            return
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/octet-stream" or self.headers.get("Content-Encoding"):
            self.respond(415, {"error": "CONTENT_TYPE"})
            return
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get("Transfer-Encoding") or len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
            self.respond(400, {"error": "CONTENT_LENGTH"})
            return
        length = int(lengths[0])
        if not 0 < length <= MAX_BYTES:
            self.respond(422, {"error": "IMAGE_SIZE"})
            return
        thresholds = self.headers.get_all("X-Moderation-Reject-Threshold", [])
        reject_threshold = None
        if thresholds:
            try:
                if len(thresholds) != 1:
                    raise ValueError
                reject_threshold = float(thresholds[0])
                if not math.isfinite(reject_threshold) or not 0 < reject_threshold <= 1:
                    raise ValueError
            except ValueError:
                self.respond(400, {"error": "REJECT_THRESHOLD"})
                return
        if not self.server.inference.acquire(blocking=False):
            self.respond(503, {"error": "BUSY"})
            return
        try:
            data = bytearray()
            while len(data) < length:
                chunk = self.rfile.read1(min(65536, length - len(data)))
                if not chunk:
                    self.respond(400, {"error": "INCOMPLETE_BODY"})
                    return
                data.extend(chunk)
            result = bounded_inference(self.server.engine, bytes(data), reject_threshold)
            self.respond(200, result)
        except ReviewRequired as error:
            self.respond(422, {"error": error.code})
        except (TimeoutError, OSError):
            self.respond(503, {"error": "REQUEST_FAILED"})
        except Exception:
            logging.error("inference_failed")
            self.respond(503, {"error": "INFERENCE_FAILED"})
        finally:
            self.server.inference.release()


def main():
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    token = os.environ.get("COMMUNITY_MODERATION_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("COMMUNITY_MODERATION_TOKEN must contain at least 32 characters")
    engine = Engine(Path(os.environ.get("MODERATION_MODEL_DIR", "/opt/models")))
    server = ModerationServer(("0.0.0.0", 8080), engine, token)
    print(json.dumps({"ready": True, "modelVersion": MODEL_VERSION}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
