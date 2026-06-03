"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import os
import tempfile
import unittest

import boto3  # type: ignore[import-not-found]

from test.oetf.sinks import (
    S3Sink,
    _cache_control,
    _maybe_gzip,
    _normalize_s3_endpoint,
)

try:
    from moto import mock_aws as _mock_aws  # type: ignore[import-not-found]
    _MOTO_AVAILABLE = True
except ImportError:
    _MOTO_AVAILABLE = False
    _mock_aws = None  # type: ignore[assignment]


@unittest.skipUnless(_MOTO_AVAILABLE, "moto not available")
class S3SinkTest(unittest.TestCase):
    def setUp(self):
        self.mock = _mock_aws()
        self.mock.start()
        self.s3 = boto3.client("s3", region_name="us-east-1")
        self.s3.create_bucket(Bucket="oetf-reports")
        self.sink = S3Sink(
            bucket="oetf-reports",
            prefix="",
            endpoint_url=None,
            access_key_id="x", secret_key="y", region="us-east-1",
            public_url_base="",
        )

    def tearDown(self):
        self.mock.stop()

    def test_upload_dir(self):
        with tempfile.TemporaryDirectory() as src:
            with open(os.path.join(src, "a.txt"), "w", encoding="utf-8") as fh:
                fh.write("hello")
            self.sink.upload_dir(src, "runs/r1")
            obj = self.s3.get_object(Bucket="oetf-reports", Key="runs/r1/a.txt")
            self.assertEqual(obj["Body"].read(), b"hello")

    def test_download_dir(self):
        self.s3.put_object(Bucket="oetf-reports", Key="latest/history/x.json",
                           Body=b'{"k":1}')
        with tempfile.TemporaryDirectory() as local:
            self.sink.download_dir("latest/history/", local)
            with open(os.path.join(local, "x.json"), encoding="utf-8") as fh:
                self.assertEqual(fh.read(), '{"k":1}')

    def test_upload_file_then_download_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as src:
            local_in = os.path.join(src, "history.jsonl")
            local_out = os.path.join(src, "downloaded.jsonl")
            with open(local_in, "w", encoding="utf-8") as fh:
                fh.write('{"run":1}\n{"run":2}\n')
            self.sink.upload_file(local_in, "users/testuser/history.jsonl")
            ok = self.sink.download_file(
                "users/testuser/history.jsonl", local_out)
            self.assertTrue(ok)
            with open(local_out, encoding="utf-8") as fh:
                self.assertEqual(fh.read(), '{"run":1}\n{"run":2}\n')

    def test_download_file_returns_false_on_missing(self):
        # First-run scenario: history.jsonl doesn't exist yet. download_file
        # must distinguish "not found" from "real error" so the caller can
        # proceed cleanly without parsing exception types.
        with tempfile.TemporaryDirectory() as local:
            target = os.path.join(local, "history.jsonl")
            ok = self.sink.download_file(
                "users/testuser/history.jsonl", target)
            self.assertFalse(ok)
            self.assertFalse(os.path.exists(target))

    def test_list_prefix(self):
        self.s3.put_object(Bucket="oetf-reports", Key="runs/r1/a", Body=b"")
        self.s3.put_object(Bucket="oetf-reports", Key="runs/r2/b", Body=b"")
        keys = sorted(self.sink.list_prefix("runs/"))
        self.assertEqual(keys, ["runs/r1/a", "runs/r2/b"])

    def test_public_url_default_form(self):
        sink = S3Sink(bucket="b", prefix="p",
                      endpoint_url="https://s3.example.com",
                      access_key_id="x", secret_key="y", region="us-east-1",
                      public_url_base="")
        self.assertEqual(sink.public_url("runs/r1/index.html"),
                         "https://s3.example.com/b/p/runs/r1/index.html")


class NormalizeEndpointTest(unittest.TestCase):
    def test_swift_url_with_path_becomes_https_host(self):
        # swift://host/tenant/... is osmo's report-upload URL shape; the
        # normalizer drops the tenant + path and rewrites scheme to https
        # so boto3 can speak to it as an S3 endpoint.
        self.assertEqual(
            _normalize_s3_endpoint(
                "swift://s3.example.com/AUTH_tenant/dev/testuser/local"),
            "https://s3.example.com",
        )

    def test_https_url_idempotent(self):
        self.assertEqual(
            _normalize_s3_endpoint("https://s3.example.com"),
            "https://s3.example.com",
        )

    def test_https_url_with_port_preserved(self):
        self.assertEqual(
            _normalize_s3_endpoint("https://minio.local:9000"),
            "https://minio.local:9000",
        )

    def test_https_url_with_path_strips_path(self):
        self.assertEqual(
            _normalize_s3_endpoint("https://s3.example.com/some/path"),
            "https://s3.example.com",
        )

    def test_empty_returns_empty(self):
        self.assertEqual(_normalize_s3_endpoint(""), "")


class GzipUploadHelpersTest(unittest.TestCase):
    """Verify the compression + caching policy applied by S3Sink.upload_dir."""

    def test_compresses_large_text_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "styles.css")
            # 5KB of repeating text — gzips to ~50 bytes
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(".foo { color: red; }\n" * 250)
            body, encoding = _maybe_gzip(path, "text/css")
            self.assertEqual(encoding, "gzip")
            self.assertLess(len(body), os.path.getsize(path) // 2)

    def test_skips_small_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "tiny.json")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("{}")
            _, encoding = _maybe_gzip(path, "application/json")
            self.assertIsNone(encoding)

    def test_skips_already_compressed_binaries(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "image.png")
            with open(path, "wb") as fh:
                fh.write(os.urandom(8000))  # incompressible random bytes
            _, encoding = _maybe_gzip(path, "image/png")
            self.assertIsNone(encoding)

    def test_cache_control_long_for_static_assets(self):
        self.assertEqual(_cache_control("app.js"), "public, max-age=86400")
        self.assertEqual(_cache_control("styles.css"), "public, max-age=86400")

    def test_cache_control_short_for_html(self):
        self.assertEqual(_cache_control("index.html"), "public, max-age=3600")
        self.assertEqual(_cache_control("summary.html"), "public, max-age=3600")


@unittest.skipUnless(_MOTO_AVAILABLE, "moto not available")
class S3SinkUploadHeadersTest(unittest.TestCase):
    """End-to-end: when upload_dir uploads a large CSS file, the resulting
    S3 object must have ContentEncoding=gzip and CacheControl set."""

    def setUp(self):
        self._mock = _mock_aws()
        self._mock.start()
        self._s3 = boto3.client("s3", region_name="us-east-1")
        self._s3.create_bucket(Bucket="oetf-reports")
        self._sink = S3Sink(
            bucket="oetf-reports", prefix="", endpoint_url="",
            access_key_id="x", secret_key="y", region="us-east-1",
            public_url_base="",
        )

    def tearDown(self):
        self._mock.stop()

    def test_large_css_uploaded_gzipped(self):
        with tempfile.TemporaryDirectory() as src:
            with open(os.path.join(src, "styles.css"), "w", encoding="utf-8") as fh:
                fh.write(".foo { color: red; }\n" * 250)
            self._sink.upload_dir(src, "runs/r1")
            head = self._s3.head_object(Bucket="oetf-reports", Key="runs/r1/styles.css")
            self.assertEqual(head.get("ContentEncoding"), "gzip")
            self.assertEqual(head.get("CacheControl"), "public, max-age=86400")
            self.assertEqual(head.get("ContentType"), "text/css")

    def test_small_json_uploaded_uncompressed(self):
        with tempfile.TemporaryDirectory() as src:
            with open(os.path.join(src, "tiny.json"), "w", encoding="utf-8") as fh:
                fh.write("{}")
            self._sink.upload_dir(src, "runs/r1")
            head = self._s3.head_object(Bucket="oetf-reports", Key="runs/r1/tiny.json")
            self.assertNotIn("ContentEncoding", head)


if __name__ == "__main__":
    unittest.main()
