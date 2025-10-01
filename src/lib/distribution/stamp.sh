#!/bin/sh
#
# # SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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
# NOTE: This script is used to stamp the version of the package.
#
# It can be used in two modes:
# 1. When building a release wheel for distribution
# 2. When building a development version
#
# The version string can come in two flavors:
#
# 1. Official release: major.minor.revision (e.g. 4.0.1)
#    - This is a stable version that is ready for production use.
#    - It will be recognized by `pip install` without additional flags.
#    - This is meant for an automated pipeline to execute by setting the RELEASE_WHEEL environment variable to `true`.
#
# 2. Development version: major.minor.revision.dev<timestamp>+git.<hash> (e.g. 4.0.1.dev202503090000+git.1234567)
#    - This is a development version that is not ready for production use.
#    - It will be recognized by `pip install` with the `--pre` flag.
#    - The wheel will be rebuilt if the code has changed or if the hash has changed.
#
# The version string is constructed as follows:
# {STABLE_VERSION}{STABLE_DEV_LABEL}{VOLATILE_TIMESTAMP}{STABLE_HASH_SUFFIX}
#
# - STABLE_VERSION: The stable version of the package.
# - STABLE_DEV_LABEL: The development label of the package.
# - VOLATILE_TIMESTAMP: The timestamp of the package.
# - STABLE_HASH_SUFFIX: The hash suffix of the package.
#
# If any of the STABLE fields changes, the wheel will be rebuilt.
# If the VOLATILE fields change, the wheel will be not rebuilt unless the code has changed.
#
# Reference: https://bazel.build/docs/user-manual#workspace-status


# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Set VERSION_FILE relative to this script's directory
VERSION_FILE="$SCRIPT_DIR/../utils/version.yaml"

if [ ! -f "$VERSION_FILE" ]; then
    echo "Warning: $VERSION_FILE not found" >&2
    exit 1
fi

# Extract main version information from version.yaml
major=$(sed -n 's/^major: *//p' "$VERSION_FILE")
minor=$(sed -n 's/^minor: *//p' "$VERSION_FILE")
revision=$(sed -n 's/^revision: *//p' "$VERSION_FILE")

# Check if environment variable RELEASE_WHEEL is set
# This means we are building a release wheel for distribution
if [ ! -z "$RELEASE_WHEEL" ] && [ "$RELEASE_WHEEL" = "true" ]; then
    echo "RELEASE_WHEEL is set to $RELEASE_WHEEL" >&2

    # Set irrelevant fields to empty (first)
    echo "STABLE_DEV_LABEL "
    echo "VOLATILE_TIMESTAMP "
    echo "STABLE_HASH_SUFFIX "

    # Then set the official release version
    echo "STABLE_VERSION $major.$minor.$revision"

    exit 0
fi

# Construct version string
hash=$(sed -n 's/^hash: *//p' "$VERSION_FILE" | tr -d '"')
if [ ! -z "$hash" ] && [ "$hash" != "\"\"" ]; then
    clean_hash=$(echo "$hash" | tr -d '"')
    echo "STABLE_HASH_SUFFIX +git.${clean_hash}"
else
    echo "STABLE_HASH_SUFFIX "
fi
echo "STABLE_VERSION $major.$minor.$revision"
echo "STABLE_DEV_LABEL .dev"
echo "VOLATILE_TIMESTAMP $(date +%Y%m%d%H%M%S)"
