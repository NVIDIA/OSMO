#!/usr/bin/env bash
# Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
#
# SPDX-License-Identifier: Apache-2.0

# Materialize model artifacts into one new local cache root. OSMO uploads the
# result to the content-addressed Swift artifact prefix declared by the capsule.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
sources_file="${MODEL_ARTIFACT_SOURCES_FILE:-${script_dir}/model-artifact-sources-v1.json}"
cache_root="${CACHE_ROOT:?CACHE_ROOT is required}"
cache_lock="${CACHE_LOCK:?CACHE_LOCK is required}"
result_path="${CACHE_RESULT_PATH:-${cache_root}/cache-result.json}"
manifest_path="${CACHE_MANIFEST_PATH:-${cache_root}/cache-manifest.json}"

case "${cache_root}" in
  /|.|..)
    echo "CACHE_ROOT must name a dedicated cache directory" >&2
    exit 2
    ;;
esac

if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "HF_TOKEN is required for the model-artifact materializer task" >&2
  exit 2
fi

if [[ ! -f "${sources_file}" ]]; then
  echo "Cache source manifest is missing: ${sources_file}" >&2
  exit 2
fi

mkdir -p "${cache_root}"
if [[ -n "$(find "${cache_root}" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "Refusing to write a non-empty cache root: ${cache_root}" >&2
  exit 2
fi

completed=0
write_failure_result() {
  if [[ "${completed}" -eq 0 ]]; then
    mkdir -p "$(dirname -- "${result_path}")"
    printf '{"outcome":"TerminalFailure","cacheLock":"%s","summary":"model-artifact materialization failed; inspect task logs"}\n' \
      "${cache_lock}" > "${result_path}"
  fi
}
trap write_failure_result EXIT

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends python3 python3-pip ca-certificates

hub_version="$(python3 - "${sources_file}" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["materializer"]["huggingfaceHubVersion"])
PY
)"
python3 -m pip install --no-cache-dir --disable-pip-version-check "huggingface_hub==${hub_version}"

CACHE_ROOT="${cache_root}" \
CACHE_LOCK="${cache_lock}" \
MODEL_ARTIFACT_SOURCES_FILE="${sources_file}" \
CACHE_MANIFEST_PATH="${manifest_path}" \
CACHE_RESULT_PATH="${result_path}" \
MODEL_ARTIFACT_MATERIALIZER_SCRIPT="${BASH_SOURCE[0]}" \
HF_HOME="${cache_root}/cosmos_transfer" \
python3 - <<'PY'
import hashlib
import json
import os
import shutil
import urllib.request
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def download_direct(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".partial")
    request = urllib.request.Request(url, headers={"User-Agent": "osmo-agents-poc/1"})
    with urllib.request.urlopen(request, timeout=300) as response, temporary.open("wb") as output:
        shutil.copyfileobj(response, output)
    temporary.replace(destination)


root = Path(os.environ["CACHE_ROOT"])
lock = os.environ["CACHE_LOCK"]
sources_path = Path(os.environ["MODEL_ARTIFACT_SOURCES_FILE"])
manifest_path = Path(os.environ["CACHE_MANIFEST_PATH"])
result_path = Path(os.environ["CACHE_RESULT_PATH"])
script_path = Path(os.environ["MODEL_ARTIFACT_MATERIALIZER_SCRIPT"])
sources = json.loads(sources_path.read_text(encoding="utf-8"))

if sources["materializer"]["superResolution"] or sources["materializer"]["seedvrVariant"] != "none":
    raise SystemExit("this POC materializer supports superResolution=false and seedvrVariant=none only")

token = os.environ["HF_TOKEN"]
cosmos_root = root / "cosmos_transfer"
auto_label_root = root / "auto_labeling"
cosmos_root.mkdir(parents=True)
auto_label_root.mkdir(parents=True)
os.environ["HF_HOME"] = str(cosmos_root)

from huggingface_hub import hf_hub_download, snapshot_download

for item in sources["cosmos"]["hubDownloads"]:
    hf_hub_download(
        repo_id=item["repo"],
        repo_type="model",
        revision=item["revision"],
        filename=item["file"],
        token=token,
    )

for item in sources["cosmos"]["snapshots"]:
    snapshot_download(
        repo_id=item["repo"],
        repo_type="model",
        revision=item["revision"],
        token=token,
    )

# Hugging Face's cache uses symlinks. Object storage does not preserve them, so
# materialize each link as an ordinary file before OSMO uploads the cache.
hub_root = cosmos_root / "hub"
for link in sorted(hub_root.rglob("*")):
    if link.is_symlink():
        target = link.resolve(strict=True)
        if not target.is_file():
            raise SystemExit(f"unsupported non-file Hugging Face symlink: {link}")
        link.unlink()
        shutil.copy2(target, link)

for item in sources["autoLabeling"]["directDownloads"]:
    download_direct(item["url"], auto_label_root / item["path"])

files = []
for path in sorted(root.rglob("*")):
    if path.is_file() and path not in {manifest_path, result_path}:
        files.append({
            "path": str(path.relative_to(root)),
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        })

manifest = {
    "schemaVersion": "v1",
    "cacheLock": lock,
    "sourcesManifest": {
        "path": sources_path.name,
        "sha256": sha256(sources_path),
    },
    "materializerScript": {
        "path": script_path.name,
        "sha256": sha256(script_path),
    },
    "source": sources["source"],
    "materializer": sources["materializer"],
    "files": files,
}
atomic_json(manifest_path, manifest)
atomic_json(result_path, {
    "outcome": "Completed",
    "cacheLock": lock,
    "manifest": manifest_path.name,
    "manifestSha256": sha256(manifest_path),
    "fileCount": len(files),
})
PY

completed=1
echo "Model-artifact materialization completed for ${cache_lock}"
