#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

# Light Bazel bridge for CI: builds and pushes the web-ui Docker image (arm64).
# Accepts the same --repository / --tag interface as oci_push-generated scripts,
# so ci/push_images.py can invoke it identically.

set -euo pipefail

REPO=""
TAGS=()
PLATFORM="linux/arm64"

while [[ $# -gt 0 ]]; do
    case $1 in
        --repository) REPO="$2"; shift 2 ;;
        --tag) TAGS+=("$2"); shift 2 ;;
        *) shift ;;
    esac
done

if [[ -z "$REPO" || ${#TAGS[@]} -eq 0 ]]; then
    echo "Usage: $0 --repository REPO --tag TAG [--tag TAG ...]" >&2
    exit 1
fi

# Locate the UI source directory (works from both root repo and external workspace)
if [ -d "${BUILD_WORKSPACE_DIRECTORY}/external/src/ui" ]; then
    UI_DIR="${BUILD_WORKSPACE_DIRECTORY}/external/src/ui"
else
    UI_DIR="${BUILD_WORKSPACE_DIRECTORY}/src/ui"
fi

TAG_ARGS=""
for TAG in "${TAGS[@]}"; do
    TAG_ARGS="$TAG_ARGS -t $REPO:$TAG"
done

echo "Building and pushing web-ui for $PLATFORM..."
echo "  UI source: $UI_DIR"
echo "  Tags: ${TAGS[*]}"
# shellcheck disable=SC2086
docker buildx build --platform "$PLATFORM" $TAG_ARGS --push "$UI_DIR"
