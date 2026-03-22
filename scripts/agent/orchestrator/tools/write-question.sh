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

# Write a question to S3 for asynchronous human review.
#
# Usage: write-question.sh <question-id> <subtask-id> <context> <question> <options-json>
#
# Environment variables (required):
#   STORAGE_URI - Base URI for agent state (e.g., s3://bucket/agent/task-001)

set -euo pipefail

if [[ $# -lt 5 ]]; then
  echo "Usage: write-question.sh <question-id> <subtask-id> <context> <question> <options-json>" >&2
  echo "" >&2
  echo "  question-id   Unique question identifier (e.g., q-001)" >&2
  echo "  subtask-id    Which subtask triggered this question" >&2
  echo "  context       2-3 sentences of background" >&2
  echo "  question      The specific question" >&2
  echo "  options-json  JSON array of options" >&2
  exit 1
fi

QUESTION_ID="$1"
SUBTASK_ID="$2"
CONTEXT="$3"
QUESTION="$4"
OPTIONS_JSON="$5"

# Validate required environment variables
if [[ -z "${STORAGE_URI:-}" ]]; then
  echo "ERROR: Required environment variable STORAGE_URI is not set." >&2
  exit 1
fi

# Validate that options-json is valid JSON
if ! echo "$OPTIONS_JSON" | jq empty 2>/dev/null; then
  echo "ERROR: options-json is not valid JSON: $OPTIONS_JSON" >&2
  exit 1
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Build the question JSON object using jq
QUESTION_JSON=$(jq -n \
  --arg id "$QUESTION_ID" \
  --arg status "pending" \
  --arg asked "$TIMESTAMP" \
  --arg subtask "$SUBTASK_ID" \
  --arg context "$CONTEXT" \
  --arg question "$QUESTION" \
  --argjson options "$OPTIONS_JSON" \
  '{
    id: $id,
    status: $status,
    asked: $asked,
    subtask: $subtask,
    context: $context,
    question: $question,
    options: $options
  }')

# Write to a temp file and upload to S3
TEMP_FILE=$(mktemp /tmp/osmo-question-XXXXXX.json)
trap 'rm -f "$TEMP_FILE"' EXIT

echo "$QUESTION_JSON" > "$TEMP_FILE"

REMOTE_PATH="${STORAGE_URI}/questions/${QUESTION_ID}.json"

osmo data upload "$REMOTE_PATH" "$TEMP_FILE"

echo "Question $QUESTION_ID written to $REMOTE_PATH"
