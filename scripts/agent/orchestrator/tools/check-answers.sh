#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

# Check S3 for any answered questions.
#
# Usage: check-answers.sh
#
# Exit codes:
#   0 - One or more answered questions found (printed as JSON array to stdout)
#   1 - No answers found
#
# Environment variables (required):
#   STORAGE_URI - Base URI for agent state (e.g., s3://bucket/agent/task-001)

set -euo pipefail

# Validate required environment variables
if [[ -z "${STORAGE_URI:-}" ]]; then
  echo "ERROR: Required environment variable STORAGE_URI is not set." >&2
  exit 1
fi

REMOTE_PREFIX="${STORAGE_URI}/questions/"
TEMP_DIR=$(mktemp -d /tmp/osmo-answers-XXXXXX)
trap 'rm -rf "$TEMP_DIR"' EXIT

# List question files
FILE_LIST=$(osmo data list "$REMOTE_PREFIX" --no-pager 2>/dev/null || true)

if [[ -z "$FILE_LIST" ]]; then
  echo "No question files found in $REMOTE_PREFIX" >&2
  exit 1
fi

# Download each question file and check for answered status
ANSWERED_QUESTIONS="[]"
FOUND_ANSWERS=false

while IFS= read -r FILEPATH; do
  FILENAME=$(basename "$FILEPATH")
  if [[ -z "$FILENAME" || "$FILENAME" != *.json ]]; then
    continue
  fi

  LOCAL_FILE="${TEMP_DIR}/${FILENAME}"
  osmo data download "${REMOTE_PREFIX}${FILENAME}" "$TEMP_DIR" 2>/dev/null || continue

  # Check if the question has been answered
  STATUS=$(jq -r '.status // empty' "$LOCAL_FILE" 2>/dev/null || true)

  if [[ "$STATUS" == "answered" ]]; then
    FOUND_ANSWERS=true
    ANSWERED_QUESTIONS=$(echo "$ANSWERED_QUESTIONS" | jq --slurpfile q "$LOCAL_FILE" '. + $q')
  fi
done <<< "$FILE_LIST"

if $FOUND_ANSWERS; then
  echo "$ANSWERED_QUESTIONS" | jq .
  exit 0
else
  echo "No answered questions found." >&2
  exit 1
fi
