import http.client
import io
import json
import socket
import threading
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from models import MODEL_VERSION
from service import MAX_BYTES, ModerationServer, ReviewRequired, bounded_inference, decode_image, nsfw_input, nsfw_probability, Engine


def image_bytes(color="white", size=(32, 20), format="PNG"):
    output = io.BytesIO()
    Image.new("RGB", size, color).save(output, format=format)
    return output.getvalue()


class ImageTests(unittest.TestCase):
    def test_invalid_image_and_pixel_limit_require_review(self):
        for data in (b"", b"not an image"):
            with self.assertRaises(ReviewRequired):
                decode_image(data)
        with patch("service.MAX_PIXELS", 100):
            with self.assertRaises(ReviewRequired):
                decode_image(image_bytes())

    def test_animation_cannot_be_screened_by_first_frame(self):
        output = io.BytesIO()
        Image.new("RGB", (8, 8), "white").save(output, format="GIF", save_all=True, append_images=[Image.new("RGB", (8, 8), "black")], duration=50)
        with self.assertRaisesRegex(ReviewRequired, "ANIMATED_IMAGE"):
            decode_image(output.getvalue())

    def test_exif_orientation_and_alpha_are_applied(self):
        image = Image.new("RGB", (20, 10), "red")
        exif = image.getexif()
        exif[274] = 6
        output = io.BytesIO()
        image.save(output, format="JPEG", exif=exif)
        decoded = decode_image(output.getvalue())
        self.assertEqual(decoded.size, (10, 20))
        output = io.BytesIO()
        Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(output, format="PNG")
        self.assertEqual(decode_image(output.getvalue()).getpixel((0, 0)), (255, 255, 255))

    def test_preprocessing_and_stable_probability(self):
        result = nsfw_input(Image.new("RGB", (10, 40), (255, 0, 0)))
        self.assertEqual(result.shape, (1, 3, 224, 224))
        self.assertEqual(result.dtype, np.float32)
        np.testing.assert_array_equal(result[0, :, 0, 0], [1, -1, -1])
        self.assertAlmostEqual(nsfw_probability(np.array([[1000, 1000]])), 0.5)
        self.assertGreater(nsfw_probability(np.array([[-1000, 1000]])), 0.99)
        for invalid in (np.array([1, 2]), np.array([[0, np.nan]])):
            with self.assertRaises(ReviewRequired):
                nsfw_probability(invalid)

    def test_ocr_errors_and_truncation_never_pass(self):
        engine = object.__new__(Engine)
        engine.input_name = "pixel_values"
        engine.nsfw = type("Session", (), {"run": lambda *_: [np.array([[1, 0]])]})()
        engine.ocr = lambda *_: type("Output", (), {"txts": ["x" * 20001]})()
        with self.assertRaisesRegex(ReviewRequired, "OCR_TEXT_TOO_LONG"):
            engine.check(image_bytes())
        engine.ocr = lambda *_: None
        with self.assertRaisesRegex(ReviewRequired, "OCR_OUTPUT"):
            engine.check(image_bytes())
        def broken(_):
            raise RuntimeError("OCR failed")
        engine.ocr = broken
        with self.assertRaises(RuntimeError):
            engine.check(image_bytes())

    def test_reject_threshold_skips_ocr_only_after_a_definitive_score(self):
        engine = object.__new__(Engine)
        engine.input_name = "pixel_values"
        engine.nsfw = type("Session", (), {"run": lambda *_: [np.array([[0, 0]])]})()
        def broken(_):
            raise RuntimeError("OCR allocation failed")
        engine.ocr = broken
        result = engine.check(image_bytes(), reject_threshold=0.5)
        self.assertEqual(result, {"nsfwScore": 0.5, "text": "", "modelVersion": MODEL_VERSION, "ocrSkipped": True})
        for threshold in (None, 0.51, 1.0):
            with self.assertRaisesRegex(RuntimeError, "OCR allocation failed"):
                engine.check(image_bytes(), reject_threshold=threshold)

    def test_large_alpha_is_bounded_before_compositing(self):
        output = io.BytesIO()
        Image.new("RGBA", (800, 500), (0, 0, 0, 0)).save(output, format="PNG")
        with patch("service.OCR_MAX_SIDE", 100):
            decoded = decode_image(output.getvalue())
        self.assertEqual(decoded.size, (100, 63))
        self.assertEqual(decoded.getpixel((0, 0)), (255, 255, 255))


class InferenceDeadlineTests(unittest.TestCase):
    def test_stuck_inference_exits_for_container_restart(self):
        expired = threading.Event()
        engine = type("Blocked", (), {"check": lambda _, data: expired.wait(2)})()
        with patch("service.INFERENCE_SECONDS", 0.05), patch("service.os._exit", side_effect=lambda code: expired.set()) as terminate:
            bounded_inference(engine, b"image")
            self.assertTrue(expired.is_set())
            terminate.assert_called_once_with(70)

    def test_success_and_exception_cancel_watchdog(self):
        expired = threading.Event()
        engine = type("Success", (), {"check": lambda _, data: {"ok": True}})()
        with patch("service.INFERENCE_SECONDS", 0.05), patch("service.os._exit", side_effect=lambda code: expired.set()) as terminate:
            self.assertEqual(bounded_inference(engine, b"image"), {"ok": True})
            def broken(_):
                raise RuntimeError("failure")
            engine.check = broken
            with self.assertRaises(RuntimeError):
                bounded_inference(engine, b"image")
            self.assertFalse(expired.wait(0.15))
            terminate.assert_not_called()


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.token = "test-token-" + "x" * 32
        self.engine = type("Fake", (), {"check": lambda _, data: {"nsfwScore": 0.1, "text": "test", "modelVersion": MODEL_VERSION}})()
        self.server = ModerationServer(("127.0.0.1", 0), self.engine, self.token)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def request(self, path="/check", body=None, headers=None, method="POST"):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        options = {"Authorization": "Bearer " + self.token, "Content-Type": "application/octet-stream"}
        options.update(headers or {})
        connection.request(method, path, body if body is not None else image_bytes(), options)
        response = connection.getresponse()
        data = response.read()
        status = response.status
        connection.close()
        return status, json.loads(data)

    def test_health_auth_and_success_contract(self):
        self.assertEqual(self.request("/healthz", method="GET")[0], 200)
        self.assertEqual(self.request(body=b"", headers={"Authorization": "Bearer wrong"})[0], 401)
        status, result = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(set(result), {"nsfwScore", "text", "modelVersion"})
        self.assertEqual(result["modelVersion"], MODEL_VERSION)

    def test_reject_threshold_is_validated_and_forwarded(self):
        seen = []
        def check(data, reject_threshold=None):
            seen.append(reject_threshold)
            return {"nsfwScore": 0.99, "text": "", "modelVersion": MODEL_VERSION, "ocrSkipped": True}
        self.engine.check = check
        status, result = self.request(headers={"X-Moderation-Reject-Threshold": "0.95"})
        self.assertEqual(status, 200)
        self.assertIs(result["ocrSkipped"], True)
        self.assertEqual(seen, [0.95])
        for invalid in ("", "0", "-1", "1.01", "NaN", "inf", "1e999", "0.5,0.6", "invalid"):
            status, result = self.request(headers={"X-Moderation-Reject-Threshold": invalid})
            self.assertEqual((status, result), (400, {"error": "REJECT_THRESHOLD"}))
        self.assertEqual(seen, [0.95])

    def test_duplicate_reject_threshold_is_rejected(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        connection.putrequest("POST", "/check")
        for name, value in [("Authorization", "Bearer " + self.token), ("Content-Type", "application/octet-stream"),
                            ("Content-Length", "1"), ("X-Moderation-Reject-Threshold", "0.8"), ("X-Moderation-Reject-Threshold", "0.9")]:
            connection.putheader(name, value)
        connection.endheaders(b"x")
        response = connection.getresponse()
        self.assertEqual(response.status, 400)
        self.assertEqual(json.loads(response.read()), {"error": "REJECT_THRESHOLD"})
        connection.close()

    def test_size_encoding_and_routes_are_checked_before_inference(self):
        self.assertEqual(self.request(body=b"", headers={"Content-Length": str(MAX_BYTES + 1)})[0], 422)
        self.assertEqual(self.request(body=b"", headers={"Content-Encoding": "gzip"})[0], 415)
        self.assertEqual(self.request(body=b"", headers={"Content-Type": "image/png"})[0], 415)
        self.assertEqual(self.request("/check?x=1", body=b"")[0], 404)
        self.assertEqual(self.request(body=b"", headers={"Transfer-Encoding": "chunked"})[0], 400)

    def test_busy_does_not_queue_images_and_health_remains_available(self):
        self.server.inference.acquire()
        try:
            self.assertEqual(self.request(body=b"", headers={"Content-Length": "1"})[0], 503)
            self.assertEqual(self.request("/healthz", method="GET")[0], 200)
        finally:
            self.server.inference.release()
        self.assertEqual(self.request()[0], 200)

    def test_failure_releases_inference_slot(self):
        original = self.engine.check
        def broken(_):
            raise RuntimeError("private OCR text must never be exposed")
        self.engine.check = broken
        status, result = self.request()
        self.assertEqual(status, 503)
        self.assertEqual(result, {"error": "INFERENCE_FAILED"})
        self.engine.check = original
        self.assertEqual(self.request()[0], 200)

    def test_incomplete_upload_releases_slot(self):
        connection = socket.create_connection(("127.0.0.1", self.server.server_port), timeout=3)
        connection.sendall((f"POST /check HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {self.token}\r\nContent-Type: application/octet-stream\r\nContent-Length: 99\r\n\r\nabc").encode())
        connection.shutdown(socket.SHUT_WR)
        self.assertIn(b"400", connection.recv(4096).split(b"\r\n", 1)[0])
        connection.close()
        self.assertEqual(self.request()[0], 200)

    def test_short_token_is_rejected(self):
        with self.assertRaises(ValueError):
            ModerationServer(("127.0.0.1", 0), self.engine, "short")

    def test_absolute_header_deadline_closes_slow_upload(self):
        with patch("service.REQUEST_SECONDS", 0.1):
            connection = socket.create_connection(("127.0.0.1", self.server.server_port), timeout=3)
            connection.sendall(b"POST /check HTTP/1.1\r\nHost:")
            response = connection.recv(4096)
            self.assertNotIn(b"200", response)
            connection.close()
        self.assertEqual(self.request()[0], 200)


if __name__ == "__main__":
    unittest.main()
