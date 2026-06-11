"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# S3-compatible storage backend for the OETF reporter. Works against any
# service that speaks S3 (SwiftStack, AWS, MinIO, R2, B2).

import concurrent.futures
import gzip
import io
import os
from typing import List, Optional, Tuple
from urllib.parse import urlparse

import boto3  # type: ignore[import-not-found]
from botocore.config import Config  # type: ignore[import-not-found]


_S3_PARALLELISM = 8  # boto3 is thread-safe; SwiftStack handles concurrent puts.


def _normalize_s3_endpoint(endpoint: Optional[str]) -> str:
    """Accept either a bare https:// URL or a swift:// URL with path,
    return a bare https:// URL suitable for boto3.

    swift://host/AUTH_team/container/prefix  →  https://host
    https://host                              →  https://host
    https://host:8080/some/path               →  https://host:8080
    None / empty string                       →  ''
    """
    if not endpoint:
        return ""
    parsed = urlparse(endpoint)
    if not parsed.netloc:
        # Caller passed something non-URL-shaped; let boto3 surface the error.
        return endpoint
    # SwiftStack: anything we receive collapses to scheme://host[:port].
    # Translate swift:// to https:// since SwiftStack always serves S3 over TLS.
    scheme = "https" if parsed.scheme in ("swift", "swift+https", "") else parsed.scheme
    return f"{scheme}://{parsed.netloc}"


class S3Sink:
    """boto3-backed S3 sink. Compatible with SwiftStack, AWS, MinIO, R2, B2.

    SwiftStack requires SigV4 + payload_signing_enabled=True; we set both
    unconditionally — they're harmless on AWS/MinIO/R2.
    """

    def __init__(
        self, bucket: str, prefix: str, endpoint_url: Optional[str],
        access_key_id: str, secret_key: str, region: str,
        public_url_base: str,
    ) -> None:
        self._bucket = bucket
        self._prefix = prefix.strip("/") if prefix else ""
        self._endpoint_url = _normalize_s3_endpoint(endpoint_url)
        self._public_url_base = public_url_base.rstrip("/")
        self._s3 = boto3.client(
            "s3",
            endpoint_url=self._endpoint_url or None,
            aws_access_key_id=access_key_id or None,
            aws_secret_access_key=secret_key or None,
            region_name=region or "us-east-1",
            config=Config(
                signature_version="s3v4",
                s3={"payload_signing_enabled": True},
            ),
        )

    def _key(self, remote: str) -> str:
        stripped = remote.lstrip("/")
        if self._prefix:
            return f"{self._prefix}/{stripped}"
        return stripped

    def upload_dir(self, local_path: str, remote_prefix: str) -> None:
        prefix = remote_prefix.rstrip("/")
        upload_jobs: List[Tuple[str, str, str]] = []
        for dirpath, _, files in os.walk(local_path):
            for file_name in files:
                full = os.path.join(dirpath, file_name)
                relative = os.path.relpath(full, local_path).replace(os.sep, "/")
                key = self._key(f"{prefix}/{relative}")
                upload_jobs.append((full, key, file_name))
        if not upload_jobs:
            return
        # Allure bundles run ~80-120 small files; sequential boto3 puts
        # take ~150ms each over WAN. Parallelise — boto3 client is
        # thread-safe and SwiftStack handles concurrent writes.
        workers = min(_S3_PARALLELISM, len(upload_jobs))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(self._upload_one, *job) for job in upload_jobs]
            for future in concurrent.futures.as_completed(futures):
                future.result()  # propagate exceptions

    def _upload_one(self, local_file: str, key: str, file_name: str) -> None:
        """Upload a single file with content-aware compression + caching headers.

        For text-y assets (HTML/CSS/JS/JSON/SVG/XML), gzip-compress in memory
        and set Content-Encoding: gzip — Allure's app.js + styles.css alone
        compress ~60%, which is the dominant first-load cost on SwiftStack
        (no on-the-fly compression).
        """
        content_type = _content_type(file_name)
        cache_control = _cache_control(file_name)
        body, encoding = _maybe_gzip(local_file, content_type)
        extra = {
            "ContentType": content_type,
            "ACL": "public-read",
            "CacheControl": cache_control,
        }
        if encoding:
            extra["ContentEncoding"] = encoding
            self._s3.upload_fileobj(
                io.BytesIO(body), self._bucket, key, ExtraArgs=extra,
            )
        else:
            self._s3.upload_file(local_file, self._bucket, key, ExtraArgs=extra)

    def upload_file(self, local_file: str, remote_key: str) -> None:
        """Upload a single local file to remote_key. Same content-type +
        cache-control + gzip handling as upload_dir's per-file path.
        """
        key = self._key(remote_key)
        file_name = os.path.basename(local_file)
        self._upload_one(local_file, key, file_name)

    def download_file(self, remote_key: str, local_path: str) -> bool:
        """Download a single object to local_path. Returns True on success,
        False if the object doesn't exist (404) — distinguishes "first run,
        nothing to download" from a real error so the caller can swallow
        cleanly without parsing exception types.
        """
        key = self._key(remote_key)
        os.makedirs(os.path.dirname(local_path) or ".", exist_ok=True)
        try:
            self._s3.download_file(self._bucket, key, local_path)
            return True
        except self._s3.exceptions.ClientError as exc:
            err = exc.response.get("Error", {}) if hasattr(exc, "response") else {}
            if err.get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise

    def download_dir(self, remote_prefix: str, local_path: str) -> None:
        prefix_key = self._key(remote_prefix.rstrip("/") + "/")
        os.makedirs(local_path, exist_ok=True)
        paginator = self._s3.get_paginator("list_objects_v2")
        download_jobs: List[Tuple[str, str]] = []
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix_key):
            for obj in page.get("Contents", []):
                relative = obj["Key"][len(prefix_key):]
                if not relative:
                    continue
                target = os.path.join(local_path, relative)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                download_jobs.append((obj["Key"], target))
        if not download_jobs:
            return
        workers = min(_S3_PARALLELISM, len(download_jobs))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [
                pool.submit(self._s3.download_file, self._bucket, key, target)
                for key, target in download_jobs
            ]
            for future in concurrent.futures.as_completed(futures):
                future.result()

    def list_prefix(self, remote_prefix: str) -> List[str]:
        prefix_key = self._key(remote_prefix)
        paginator = self._s3.get_paginator("list_objects_v2")
        keys: List[str] = []
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix_key):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if self._prefix:
                    key = key[len(self._prefix) + 1:]
                keys.append(key)
        return keys

    def public_url(self, remote_key: str) -> str:
        key = remote_key.lstrip("/")
        if self._public_url_base:
            return f"{self._public_url_base}/{key}"
        if not self._endpoint_url:
            return ""
        endpoint = self._endpoint_url.rstrip("/")
        return f"{endpoint}/{self._bucket}/{self._key(remote_key)}"


# Static MIME map for the small set of types Allure produces. We don't use
# stdlib `mimetypes.guess_type` here because its results vary by OS
# (e.g. .js → text/javascript on macOS vs application/javascript on Linux),
# and we want the same Content-Type set on every uploaded report regardless
# of where the upload runs.
_CONTENT_TYPES = {
    ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
    ".json": "application/json", ".svg": "image/svg+xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2",
    ".txt": "text/plain", ".xml": "application/xml",
}


# MIME types that gzip well. Already-compressed binary types (PNG, JPG, WOFF2)
# are excluded — gzip on them adds overhead with no size win.
_COMPRESSIBLE_TYPES = frozenset({
    "text/html", "text/css", "application/javascript",
    "application/json", "image/svg+xml", "text/plain", "application/xml",
})

_GZIP_MIN_BYTES = 1024  # below this, the gzip header dominates — skip.


def _content_type(file_name: str) -> str:
    ext = os.path.splitext(file_name)[1]
    return _CONTENT_TYPES.get(ext, "application/octet-stream")


def _cache_control(file_name: str) -> str:
    """Per-asset Cache-Control. Each run lives at a unique URL prefix
    (.../runs/<run_id>/...) so even per-run assets are cache-safe.
    """
    ext = os.path.splitext(file_name)[1]
    if ext in (".js", ".css", ".woff2", ".svg", ".png", ".jpg"):
        # Static assets — same content per Allure CLI version. Cache aggressively.
        return "public, max-age=86400"  # 1 day
    # HTML entry pages + data/widget JSON — moderate cache (1 hour).
    return "public, max-age=3600"


def _maybe_gzip(local_file: str, content_type: str) -> Tuple[bytes, Optional[str]]:
    """Return (body, encoding). When encoding is None, caller should upload
    the file from disk as-is (avoids reading large binaries into memory).

    Skip gzip for non-text MIME, files smaller than _GZIP_MIN_BYTES, or
    files that don't compress (already-compressed payloads).
    """
    if content_type not in _COMPRESSIBLE_TYPES:
        return b"", None
    try:
        size = os.path.getsize(local_file)
    except OSError:
        return b"", None
    if size < _GZIP_MIN_BYTES:
        return b"", None
    with open(local_file, "rb") as fh:
        raw = fh.read()
    compressed = gzip.compress(raw, compresslevel=6)
    # Don't gzip if the result is bigger than the original (rare for text).
    if len(compressed) >= len(raw):
        return b"", None
    return compressed, "gzip"
