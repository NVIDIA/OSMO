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

# Log a human intervention for post-run analysis.
#
# Usage: log-intervention.sh <question-id> <category> <avoidable> <framework-fix-json>
#
# Categories: design_decision, ambiguity, bug, failure, steering
#
# Environment variables (required):
#   STORAGE_URI - Base URI for agent state (e.g., s3://bucket/agent/task-001)

set -euo pipefail

if [[ $# -lt 4 ]]; then
  echo "Usage: log-intervention.sh <question-id> <category> <avoidable> <framework-fix-json>" >&2
  echo "" >&2
  echo "  question-id       The question that triggered the intervention" >&2
  echo "  category          One of: design_decision, ambiguity, bug, failure, steering" >&2
  echo "  avoidable         true or false" >&2
  echo "  framework-fix-json  JSON describing how to prevent this in the future" >&2
  exit 1
fi

QUESTION_ID="$1"
CATEGORY="$2"
AVOIDABLE="$3"
FRAMEWORK_FIX_JSON="$4"

# Validate required environment variables
for var in S3_BUCKET TASK_ID; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: Required environment variable $var is not set." >&2
    exit 1
  fi
done

# Validate category
VALID_CATEGORIES="design_decision ambiguity bug failure steering"
if ! echo "$VALID_CATEGORIES" | grep -qw "$CATEGORY"; then
  echo "ERROR: Invalid category '$CATEGORY'. Must be one of: $VALID_CATEGORIES" >&2
  exit 1
fi

# Validate avoidable
if [[ "$AVOIDABLE" != "true" && "$AVOIDABLE" != "false" ]]; then
  echo "ERROR: avoidable must be 'true' or 'false', got '$AVOIDABLE'" >&2
  exit 1
fi

# Validate framework-fix-json
if ! echo "$FRAMEWORK_FIX_JSON" | jq empty 2>/dev/null; then
  echo "ERROR: framework-fix-json is not valid JSON: $FRAMEWORK_FIX_JSON" >&2
  exit 1
fi

REMOTE_PATH="s3://${S3_BUCKET}/${TASK_ID}/interventions.json"
TEMP_DIR=$(mktemp -d /tmp/osmo-intervention-XXXXXX)
trap 'rm -rf "$TEMP_DIR"' EXIT

INTERVENTIONS_FILE="${TEMP_DIR}/interventions.json"

# Download existing interventions or create empty structure
if osmo data download "$REMOTE_PATH" "$TEMP_DIR" 2>/dev/null; then
  echo "Downloaded existing interventions log." >&2
else
  echo '{"interventions":[],"summary":{"total":0,"avoidable":0,"categories":{}}}' > "$INTERVENTIONS_FILE"
  echo "Created new interventions log." >&2
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Determine the next intervention ID by counting existing entries
CURRENT_COUNT=$(jq '.interventions | length' "$INTERVENTIONS_FILE")
NEXT_NUM=$((CURRENT_COUNT + 1))
INTERVENTION_ID=$(printf "int-%03d" "$NEXT_NUM")

# Build the new intervention record
NEW_INTERVENTION=$(jq -n \
  --arg id "$INTERVENTION_ID" \
  --arg question_id "$QUESTION_ID" \
  --arg category "$CATEGORY" \
  --argjson avoidable "$AVOIDABLE" \
  --argjson framework_fix "$FRAMEWORK_FIX_JSON" \
  --arg timestamp "$TIMESTAMP" \
  '{
    id: $id,
    question_id: $question_id,
    category: $category,
    avoidable: $avoidable,
    framework_fix: $framework_fix,
    timestamp: $timestamp
  }')

# Append the intervention and update summary counts
UPDATED=$(jq \
  --argjson new_intervention "$NEW_INTERVENTION" \
  --arg category "$CATEGORY" \
  --argjson avoidable "$AVOIDABLE" \
  '
  .interventions += [$new_intervention] |
  .summary.total += 1 |
  .summary.avoidable += (if $avoidable then 1 else 0 end) |
  .summary.categories[$category] = ((.summary.categories[$category] // 0) + 1)
  ' "$INTERVENTIONS_FILE")

echo "$UPDATED" > "$INTERVENTIONS_FILE"

# Upload back to storage
osmo data upload "$REMOTE_PATH" "$INTERVENTIONS_FILE"

echo "Logged intervention $INTERVENTION_ID (question: $QUESTION_ID, category: $CATEGORY, avoidable: $AVOIDABLE)"
