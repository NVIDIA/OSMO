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

# Dry-run integration test for orchestrator DIF scripts.
#
# Validates the full orchestrator pipeline without actual OSMO workflow
# submissions or S3 writes. Uses mock commands on PATH.
#
# Usage: test-dry-run.sh
#
# Exit codes:
#   0 - All tests passed
#   1 - One or more tests failed

set -uo pipefail

# ---------- Setup ----------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLS_DIR="$(cd "$SCRIPT_DIR/../tools" && pwd)"

TEST_TMPDIR=$(mktemp -d "${TMPDIR:-/tmp}/osmo-dry-run-XXXXXX")
MOCK_BIN="$TEST_TMPDIR/mock-bin"
MOCK_S3="$TEST_TMPDIR/mock-s3"

mkdir -p "$MOCK_BIN" "$MOCK_S3"

cleanup() {
  rm -rf "$TEST_TMPDIR"
}
trap cleanup EXIT

# Counters
PASS_COUNT=0
FAIL_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  PASS: $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  FAIL: $1"
  if [[ -n "${2:-}" ]]; then
    echo "        $2"
  fi
}

# ---------- Mock commands ----------

# Mock osmo CLI
cat > "$MOCK_BIN/osmo" << 'MOCK_OSMO'
#!/usr/bin/env bash
# Mock osmo CLI for dry-run tests.
case "${1:-} ${2:-}" in
  "workflow submit")
    echo "Workflow submitted successfully."
    echo "Workflow ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    exit 0
    ;;
  "workflow query")
    echo "Name:    agent-child-lib-utils"
    echo "Status:  COMPLETED"
    echo "Created: 2026-03-20T00:00:00Z"
    exit 0
    ;;
  *)
    echo "ERROR: mock osmo does not handle: $*" >&2
    exit 1
    ;;
esac
MOCK_OSMO
chmod +x "$MOCK_BIN/osmo"

# Mock aws CLI — redirects S3 operations to local temp directory
cat > "$MOCK_BIN/aws" << MOCK_AWS
#!/usr/bin/env bash
# Mock aws CLI for dry-run tests. Uses local filesystem instead of S3.
MOCK_S3="$MOCK_S3"

if [[ "\${1:-}" != "s3" ]]; then
  echo "ERROR: mock aws only supports s3 subcommand" >&2
  exit 1
fi
shift  # consume "s3"

case "\${1:-}" in
  cp)
    shift  # consume "cp"
    SRC="\$1"
    DST="\$2"
    # Strip --quiet if present (ignored)
    # Determine direction: upload (local->s3) or download (s3->local)
    if [[ "\$SRC" == s3://* ]]; then
      # Download: s3 path -> local file
      LOCAL_PATH="\${MOCK_S3}/\${SRC#s3://}"
      if [[ ! -f "\$LOCAL_PATH" ]]; then
        echo "download failed: The specified key does not exist." >&2
        exit 1
      fi
      mkdir -p "\$(dirname "\$DST")"
      cp "\$LOCAL_PATH" "\$DST"
    elif [[ "\$DST" == s3://* ]]; then
      # Upload: local file -> s3 path
      LOCAL_PATH="\${MOCK_S3}/\${DST#s3://}"
      mkdir -p "\$(dirname "\$LOCAL_PATH")"
      cp "\$SRC" "\$LOCAL_PATH"
    else
      echo "ERROR: mock aws s3 cp requires one s3:// path" >&2
      exit 1
    fi
    exit 0
    ;;
  ls)
    shift  # consume "ls"
    S3_PATH="\${1:-}"
    LOCAL_DIR="\${MOCK_S3}/\${S3_PATH#s3://}"
    if [[ ! -d "\$LOCAL_DIR" ]]; then
      exit 0  # empty listing
    fi
    # Mimic aws s3 ls output format: date time size filename
    for f in "\$LOCAL_DIR"/*; do
      [[ -f "\$f" ]] || continue
      FNAME=\$(basename "\$f")
      echo "2026-03-20 00:00:00       1234 \$FNAME"
    done
    exit 0
    ;;
  *)
    echo "ERROR: mock aws s3 does not handle: \$*" >&2
    exit 1
    ;;
esac
MOCK_AWS
chmod +x "$MOCK_BIN/aws"

# Prepend mock bin to PATH so tools find our mocks first
export PATH="$MOCK_BIN:$PATH"

# ---------- Environment variables ----------

export GITHUB_REPO="https://github.com/test-org/test-repo"
export BRANCH_NAME="test-branch"
export S3_BUCKET="test-bucket"
export TASK_ID="task-dry-run-001"
export KNOWLEDGE_DOC="Follow coding standards from AGENTS.md"
export COMMIT_PREFIX="[agent]"
export LEARNED_DECISIONS="Use dataclasses instead of dicts."

# ---------- Tests ----------

echo ""
echo "=== Orchestrator Dry-Run Integration Tests ==="
echo ""

# --- Test 1: submit-child.sh ---
echo "--- Test: submit-child.sh ---"

SUBMIT_OUTPUT=$("$TOOLS_DIR/submit-child.sh" "lib-utils" "src/lib/utils/login.py,src/lib/utils/common.py" "Test migration" 2>&1)
SUBMIT_EXIT=$?

if [[ $SUBMIT_EXIT -eq 0 ]]; then
  pass "submit-child.sh exits 0"
else
  fail "submit-child.sh exits 0" "Got exit code $SUBMIT_EXIT, output: $SUBMIT_OUTPUT"
fi

# Check that a workflow ID is in the output (UUID pattern)
if echo "$SUBMIT_OUTPUT" | grep -qE '[a-f0-9-]{36}'; then
  pass "submit-child.sh outputs a workflow ID"
else
  fail "submit-child.sh outputs a workflow ID" "Output: $SUBMIT_OUTPUT"
fi

# Validate rendered YAML by finding the temp file pattern in submit-child output
# Since the script cleans up, we re-render to validate YAML structure.
# We do this by calling the template substitution logic ourselves.
YAML_CHECK_FILE="$TEST_TMPDIR/yaml-check.yaml"
ORCHESTRATOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_CONTENT=$(cat "$ORCHESTRATOR_DIR/child-workflow-template.yaml")
RENDERED="${TEMPLATE_CONTENT//__MODULE__/lib-utils}"
RENDERED="${RENDERED//__GITHUB_REPO__/$GITHUB_REPO}"
RENDERED="${RENDERED//__BRANCH__/$BRANCH_NAME}"
RENDERED="${RENDERED//__DESCRIPTION__/Test migration}"
RENDERED="${RENDERED//__COMMIT_PREFIX__/$COMMIT_PREFIX}"
RENDERED="${RENDERED//__FILES_LIST__/- src/lib/utils/login.py}"
RENDERED="${RENDERED//__KNOWLEDGE_DOC__/$KNOWLEDGE_DOC}"
RENDERED="${RENDERED//__LEARNED_DECISIONS__/$LEARNED_DECISIONS}"
RENDERED="${RENDERED//__PROMPT_CONTENTS__/placeholder prompt}"
echo "$RENDERED" > "$YAML_CHECK_FILE"

YAML_VALID=$(python3 -c "
import sys
try:
    import yaml
    with open('$YAML_CHECK_FILE') as f:
        yaml.safe_load(f)
    print('valid')
except ImportError:
    # PyYAML not installed — fall back to basic structure checks
    with open('$YAML_CHECK_FILE') as f:
        content = f.read()
    errors = []
    if 'name:' not in content:
        errors.append('missing name: key')
    if 'tasks:' not in content:
        errors.append('missing tasks: key')
    if 'image:' not in content:
        errors.append('missing image: key')
    if errors:
        print(f'invalid: {\", \".join(errors)}')
    else:
        print('valid')
except Exception as e:
    print(f'invalid: {e}')
" 2>&1)

if [[ "$YAML_VALID" == "valid" ]]; then
  pass "rendered child workflow YAML is valid"
else
  fail "rendered child workflow YAML is valid" "$YAML_VALID"
fi

echo ""

# --- Test 2: write-question.sh ---
echo "--- Test: write-question.sh ---"

QUESTION_OUTPUT=$("$TOOLS_DIR/write-question.sh" "q-001" "st-001" "Test context" "Test question?" '["A: Option A","B: Option B"]' 2>&1)
QUESTION_EXIT=$?

if [[ $QUESTION_EXIT -eq 0 ]]; then
  pass "write-question.sh exits 0"
else
  fail "write-question.sh exits 0" "Got exit code $QUESTION_EXIT, output: $QUESTION_OUTPUT"
fi

# Verify the question file exists in mock S3
QUESTION_FILE="$MOCK_S3/$S3_BUCKET/$TASK_ID/questions/q-001.json"
if [[ -f "$QUESTION_FILE" ]]; then
  pass "question file created in mock S3"
else
  fail "question file created in mock S3" "Expected: $QUESTION_FILE"
fi

# Verify JSON structure
if [[ -f "$QUESTION_FILE" ]]; then
  FIELDS_OK=$(python3 -c "
import json, sys
with open('$QUESTION_FILE') as f:
    q = json.load(f)
required = {'id', 'status', 'asked', 'subtask', 'context', 'question', 'options'}
missing = required - set(q.keys())
if missing:
    print(f'missing fields: {missing}')
    sys.exit(1)
if q['status'] != 'pending':
    print(f'expected status=pending, got {q[\"status\"]}')
    sys.exit(1)
if q['id'] != 'q-001':
    print(f'expected id=q-001, got {q[\"id\"]}')
    sys.exit(1)
if q['subtask'] != 'st-001':
    print(f'expected subtask=st-001, got {q[\"subtask\"]}')
    sys.exit(1)
print('ok')
" 2>&1)

  if [[ "$FIELDS_OK" == "ok" ]]; then
    pass "question JSON has all required fields with correct values"
  else
    fail "question JSON has all required fields with correct values" "$FIELDS_OK"
  fi
else
  fail "question JSON has all required fields with correct values" "file not found"
fi

echo ""

# --- Test 3: check-answers.sh (no answers) ---
echo "--- Test: check-answers.sh (no answers yet) ---"

CHECK_NONE_OUTPUT=$("$TOOLS_DIR/check-answers.sh" 2>&1)
CHECK_NONE_EXIT=$?

if [[ $CHECK_NONE_EXIT -eq 1 ]]; then
  pass "check-answers.sh returns exit 1 when no answers"
else
  fail "check-answers.sh returns exit 1 when no answers" "Got exit code $CHECK_NONE_EXIT"
fi

echo ""

# --- Test 3b: check-answers.sh (with answer) ---
echo "--- Test: check-answers.sh (with answered question) ---"

# Update the question file to answered status
if [[ -f "$QUESTION_FILE" ]]; then
  python3 -c "
import json
with open('$QUESTION_FILE', 'r') as f:
    q = json.load(f)
q['status'] = 'answered'
q['answer'] = 'A'
q['answered'] = '2026-03-20T01:00:00Z'
with open('$QUESTION_FILE', 'w') as f:
    json.dump(q, f, indent=2)
"
fi

CHECK_ANS_OUTPUT=$("$TOOLS_DIR/check-answers.sh" 2>/dev/null)
CHECK_ANS_EXIT=$?

if [[ $CHECK_ANS_EXIT -eq 0 ]]; then
  pass "check-answers.sh returns exit 0 when answer exists"
else
  fail "check-answers.sh returns exit 0 when answer exists" "Got exit code $CHECK_ANS_EXIT"
fi

if echo "$CHECK_ANS_OUTPUT" | jq -e '.[0].answer' >/dev/null 2>&1; then
  ANSWER_VAL=$(echo "$CHECK_ANS_OUTPUT" | jq -r '.[0].answer')
  if [[ "$ANSWER_VAL" == "A" ]]; then
    pass "check-answers.sh output contains the answer"
  else
    fail "check-answers.sh output contains the answer" "Got answer: $ANSWER_VAL"
  fi
else
  fail "check-answers.sh output contains the answer" "Output not valid JSON array: $CHECK_ANS_OUTPUT"
fi

echo ""

# --- Test 4: log-intervention.sh ---
echo "--- Test: log-intervention.sh ---"

INTERVENTION_OUTPUT=$("$TOOLS_DIR/log-intervention.sh" "q-001" "design_decision" "true" '{"type":"knowledge_doc","fix":"Add rule"}' 2>&1)
INTERVENTION_EXIT=$?

if [[ $INTERVENTION_EXIT -eq 0 ]]; then
  pass "log-intervention.sh exits 0"
else
  fail "log-intervention.sh exits 0" "Got exit code $INTERVENTION_EXIT, output: $INTERVENTION_OUTPUT"
fi

INTERVENTIONS_FILE="$MOCK_S3/$S3_BUCKET/$TASK_ID/interventions.json"
if [[ -f "$INTERVENTIONS_FILE" ]]; then
  pass "interventions.json created in mock S3"
else
  fail "interventions.json created in mock S3" "Expected: $INTERVENTIONS_FILE"
fi

if [[ -f "$INTERVENTIONS_FILE" ]]; then
  INTV_CHECK=$(python3 -c "
import json, sys
with open('$INTERVENTIONS_FILE') as f:
    data = json.load(f)
if 'interventions' not in data:
    print('missing interventions key')
    sys.exit(1)
if len(data['interventions']) != 1:
    print(f'expected 1 intervention, got {len(data[\"interventions\"])}')
    sys.exit(1)
intv = data['interventions'][0]
if intv['question_id'] != 'q-001':
    print(f'wrong question_id: {intv[\"question_id\"]}')
    sys.exit(1)
if intv['category'] != 'design_decision':
    print(f'wrong category: {intv[\"category\"]}')
    sys.exit(1)
if intv['avoidable'] is not True:
    print(f'wrong avoidable: {intv[\"avoidable\"]}')
    sys.exit(1)
if data['summary']['total'] != 1:
    print(f'wrong summary total: {data[\"summary\"][\"total\"]}')
    sys.exit(1)
print('ok')
" 2>&1)

  if [[ "$INTV_CHECK" == "ok" ]]; then
    pass "interventions.json has correct structure and values"
  else
    fail "interventions.json has correct structure and values" "$INTV_CHECK"
  fi
else
  fail "interventions.json has correct structure and values" "file not found"
fi

echo ""

# ---------- Summary ----------

TOTAL=$((PASS_COUNT + FAIL_COUNT))
echo "=== Results: $PASS_COUNT/$TOTAL passed ==="

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo "$FAIL_COUNT test(s) FAILED"
  exit 1
else
  echo "All tests PASSED"
  exit 0
fi
