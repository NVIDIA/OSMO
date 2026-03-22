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

# Submit a child agent workflow for a specific subtask.
#
# Uses the SAME orchestrator.yaml as the parent — every agent at every level
# runs the same workflow, same image, same meta-prompt. The only difference
# is SUBTASK_ID, which tells the child which entry in plan.json to work on.
#
# Usage: submit-child.sh <subtask-id> <module-name>
#
# Example: submit-child.sh "st-004" "utils-connectors"
#
# Environment variables (required):
#   GITHUB_REPO   - Repository URL
#   BRANCH_NAME   - Git branch
#   STORAGE_URI   - Storage URI for questions/interventions
#   KNOWLEDGE_DOC - Path to knowledge document
#   COMMIT_PREFIX - Commit message prefix

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: submit-child.sh <subtask-id> <module-name>" >&2
  echo "" >&2
  echo "  subtask-id   ID of the subtask in plan.json (e.g., st-004)" >&2
  echo "  module-name  Short name for the workflow (e.g., utils-connectors)" >&2
  exit 1
fi

SUBTASK_ID="$1"
MODULE_NAME="$2"

# Validate required environment variables
for var in GITHUB_REPO BRANCH_NAME STORAGE_URI KNOWLEDGE_DOC COMMIT_PREFIX; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: Required environment variable $var is not set." >&2
    exit 1
  fi
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORCHESTRATOR_YAML="$SCRIPT_DIR/../orchestrator.yaml"

if [[ ! -f "$ORCHESTRATOR_YAML" ]]; then
  echo "ERROR: orchestrator.yaml not found at $ORCHESTRATOR_YAML" >&2
  exit 1
fi

# Sanitize module name for workflow naming
SANITIZED_MODULE=$(echo "$MODULE_NAME" | tr '/' '-' | tr '[:upper:]' '[:lower:]')
WORKFLOW_NAME="agent-${SANITIZED_MODULE}"

# Submit using the SAME orchestrator.yaml with subtask_id set
OUTPUT=$(osmo workflow submit "$ORCHESTRATOR_YAML" \
  --set subtask_id="$SUBTASK_ID" \
  --set workflow_name="$WORKFLOW_NAME" \
  --set github_repo="$GITHUB_REPO" \
  --set branch_name="$BRANCH_NAME" \
  --set storage_uri="$STORAGE_URI" \
  --set knowledge_doc="$KNOWLEDGE_DOC" \
  --set commit_prefix="$COMMIT_PREFIX" \
  2>&1)

# Extract workflow ID from output
WORKFLOW_ID=$(echo "$OUTPUT" | grep -oE '[a-f0-9-]{36}' | head -1)

if [[ -z "$WORKFLOW_ID" ]]; then
  echo "ERROR: Failed to extract workflow ID from osmo output:" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

echo "$WORKFLOW_ID"
