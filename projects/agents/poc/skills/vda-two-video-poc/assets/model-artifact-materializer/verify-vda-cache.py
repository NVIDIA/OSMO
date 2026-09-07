#!/usr/bin/env python3
# Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
#
# SPDX-License-Identifier: Apache-2.0

"""Verify a materialized VDA cache from the perspective of a PAIDF consumer."""

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


class ValidationError(Exception):
    """Describe a cache contract or local-payload validation failure."""


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-root", required=True, type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument(
        "--component",
        choices=("all", "augmentation", "auto-labeling"),
        default="all",
        help="Validate the model subset required by this PAIDF component.",
    )
    parser.add_argument(
        "--verify-payload",
        action="store_true",
        help="Hash every declared payload file in addition to consumer readiness.",
    )
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValidationError(f"cannot read JSON {path}: {error}") from error
    if not isinstance(value, dict):
        raise ValidationError(f"JSON document {path} must be an object")
    return value


def require_object(value: object, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{name} must be an object")
    return value


def require_string(value: object, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValidationError(f"{name} must be a non-empty string")
    return value


def safe_relative_path(value: object, name: str) -> Path:
    text = require_string(value, name)
    relative_path = Path(text)
    if relative_path.is_absolute() or ".." in relative_path.parts or "." in relative_path.parts:
        raise ValidationError(f"{name} must be a traversal-free relative path")
    return relative_path


def safe_local_path(cache_root: Path, relative_path: Path) -> Path:
    root = cache_root.resolve()
    candidate = (root / relative_path).resolve(strict=False)
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValidationError(f"cache path escapes cache root: {relative_path}") from error
    return candidate


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_manifest(manifest: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    if manifest.get("schemaVersion") != "v2":
        raise ValidationError("cache manifest must use the consumer-ready v2 schema")

    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise ValidationError("cache manifest files must be a non-empty array")

    records: dict[str, dict[str, Any]] = {}
    for index, record in enumerate(files):
        record_name = f"files[{index}]"
        record_object = require_object(record, record_name)
        if set(record_object) != {"path", "bytes", "sha256"}:
            raise ValidationError(f"{record_name} must contain only path, bytes, and sha256")
        relative_path = safe_relative_path(record_object["path"], f"{record_name}.path")
        if not isinstance(record_object["bytes"], int) or record_object["bytes"] < 0:
            raise ValidationError(f"{record_name}.bytes must be a non-negative integer")
        digest = require_string(record_object["sha256"], f"{record_name}.sha256")
        if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
            raise ValidationError(f"{record_name}.sha256 must be lowercase SHA-256")
        normalized_path = relative_path.as_posix()
        if normalized_path in records:
            raise ValidationError(f"cache manifest repeats {normalized_path}")
        records[normalized_path] = record_object

    readiness = require_object(manifest.get("consumerReadiness"), "consumerReadiness")
    if readiness.get("schemaVersion") != "v1":
        raise ValidationError("consumerReadiness must use schema v1")
    components = require_object(readiness.get("components"), "consumerReadiness.components")
    for component_name in ("augmentation", "auto-labeling"):
        require_object(components.get(component_name), f"consumerReadiness.components.{component_name}")
    return records, components


def verify_record(
    cache_root: Path,
    records: dict[str, dict[str, Any]],
    relative_name: str,
    verify_hash: bool,
) -> None:
    record = records.get(relative_name)
    if record is None:
        raise ValidationError(f"consumer-required file is absent from manifest: {relative_name}")
    local_path = safe_local_path(cache_root, Path(relative_name))
    if not local_path.is_file():
        raise ValidationError(f"consumer-required file is absent locally: {relative_name}")
    if local_path.stat().st_size != record["bytes"]:
        raise ValidationError(f"consumer-required file has an unexpected size: {relative_name}")
    if verify_hash and sha256(local_path) != record["sha256"]:
        raise ValidationError(f"consumer-required file has an unexpected SHA-256: {relative_name}")


def select_prefix_records(
    records: dict[str, dict[str, Any]],
    prefixes: object,
    component_name: str,
) -> set[str]:
    if not isinstance(prefixes, list) or not prefixes:
        raise ValidationError(f"{component_name}.requiredPathPrefixes must be a non-empty array")
    selected: set[str] = set()
    for index, prefix in enumerate(prefixes):
        normalized_prefix = safe_relative_path(prefix, f"{component_name}.requiredPathPrefixes[{index}]").as_posix()
        normalized_prefix = f"{normalized_prefix}/"
        matches = {name for name in records if name.startswith(normalized_prefix)}
        if not matches:
            raise ValidationError(f"{component_name} has no manifest entries under {normalized_prefix}")
        selected.update(matches)
    return selected


def verify_auto_labeling(
    cache_root: Path,
    records: dict[str, dict[str, Any]],
    component: dict[str, Any],
    verify_hash: bool,
) -> int:
    required_files = component.get("requiredFiles")
    if not isinstance(required_files, list) or not required_files:
        raise ValidationError("auto-labeling.requiredFiles must be a non-empty array")
    names = {safe_relative_path(item, "auto-labeling.requiredFiles").as_posix() for item in required_files}
    for name in sorted(names):
        verify_record(cache_root, records, name, verify_hash)
    return len(names)


def verify_augmentation(
    cache_root: Path,
    records: dict[str, dict[str, Any]],
    component: dict[str, Any],
    verify_hash: bool,
) -> int:
    selected = select_prefix_records(
        records,
        component.get("requiredPathPrefixes"),
        "augmentation",
    )
    for name in sorted(selected):
        verify_record(cache_root, records, name, verify_hash)

    hub_cache_relative_path = safe_relative_path(
        component.get("hubCacheRelativePath"),
        "augmentation.hubCacheRelativePath",
    )
    hub_cache_path = safe_local_path(cache_root, hub_cache_relative_path)
    if not hub_cache_path.is_dir():
        raise ValidationError(f"augmentation Hugging Face cache is absent: {hub_cache_relative_path}")

    try:
        from huggingface_hub import hf_hub_download, snapshot_download
    except ImportError as error:
        raise ValidationError(
            "augmentation consumer readiness requires huggingface_hub in the PAIDF image"
        ) from error

    hub_downloads = component.get("hubDownloads")
    snapshots = component.get("snapshots")
    if not isinstance(hub_downloads, list) or not isinstance(snapshots, list):
        raise ValidationError("augmentation hubDownloads and snapshots must be arrays")
    for index, item in enumerate(hub_downloads):
        item_object = require_object(item, f"augmentation.hubDownloads[{index}]")
        try:
            hf_hub_download(
                repo_id=require_string(item_object.get("repo"), "hub download repo"),
                repo_type="model",
                revision=require_string(item_object.get("revision"), "hub download revision"),
                filename=require_string(item_object.get("file"), "hub download file"),
                cache_dir=str(hub_cache_path),
                local_files_only=True,
            )
        except Exception as error:  # huggingface_hub exposes several cache-miss types.
            raise ValidationError(f"augmentation cache cannot resolve hub download {index}: {error}") from error
    for index, item in enumerate(snapshots):
        item_object = require_object(item, f"augmentation.snapshots[{index}]")
        try:
            snapshot_download(
                repo_id=require_string(item_object.get("repo"), "snapshot repo"),
                repo_type="model",
                revision=require_string(item_object.get("revision"), "snapshot revision"),
                cache_dir=str(hub_cache_path),
                local_files_only=True,
            )
        except Exception as error:  # huggingface_hub exposes several cache-miss types.
            raise ValidationError(f"augmentation cache cannot resolve snapshot {index}: {error}") from error
    return len(selected)


def main() -> int:
    arguments = parse_arguments()
    cache_root = arguments.cache_root
    if not cache_root.is_dir():
        raise ValidationError(f"cache root is not a directory: {cache_root}")
    manifest_path = arguments.manifest or cache_root / "cache-manifest.json"
    records, components = parse_manifest(read_json(manifest_path))

    checked_files = 0
    selected_components = (
        ("augmentation", "auto-labeling")
        if arguments.component == "all"
        else (arguments.component,)
    )
    for component_name in selected_components:
        component = require_object(components[component_name], f"consumer component {component_name}")
        if component_name == "augmentation":
            checked_files += verify_augmentation(
                cache_root,
                records,
                component,
                arguments.verify_payload,
            )
        else:
            checked_files += verify_auto_labeling(
                cache_root,
                records,
                component,
                arguments.verify_payload,
            )

    if arguments.verify_payload:
        for name in sorted(records):
            verify_record(cache_root, records, name, True)
        checked_files = len(records)

    print(
        json.dumps(
            {
                "outcome": "Completed",
                "component": arguments.component,
                "manifest": str(manifest_path),
                "checkedFiles": checked_files,
                "verifiedPayloadSha256": arguments.verify_payload,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValidationError as error:
        print(f"cache readiness validation failed: {error}", file=sys.stderr)
        raise SystemExit(2) from error
