#!/usr/bin/env bash
# Load Progress: Bootstrap session from saved state.
# Usage: scripts/agent/load-progress.sh
#
# Part of the Continuity layer (DIF). Outputs saved state so the
# agent can continue without human re-explanation.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROGRESS_FILE="$REPO_ROOT/.agent-progress.json"

echo "=== Session Bootstrap ==="
echo ""

# Check for progress file
if [[ ! -f "$PROGRESS_FILE" ]]; then
  echo "No progress file found (.agent-progress.json)"
  echo "This appears to be a fresh session."
  echo ""
  echo "Current state:"
  echo "  Branch: $(cd "$REPO_ROOT" && git branch --show-current 2>/dev/null || echo 'unknown')"
  echo "  Recent commits:"
  (cd "$REPO_ROOT" && git log --oneline -5 2>/dev/null) | sed 's/^/    /'
  echo ""
  echo "  Uncommitted changes:"
  (cd "$REPO_ROOT" && git status --short 2>/dev/null) | sed 's/^/    /'
  exit 0
fi

# Output progress
echo "--- Saved Progress ---"
cat "$PROGRESS_FILE" | python3 -m json.tool 2>/dev/null || cat "$PROGRESS_FILE"
echo ""

# Cross-reference with git state
echo "--- Current Git State ---"
echo "  Branch: $(cd "$REPO_ROOT" && git branch --show-current 2>/dev/null || echo 'unknown')"
echo "  Uncommitted changes:"
UNCOMMITTED=$(cd "$REPO_ROOT" && git status --short 2>/dev/null)
if [[ -z "$UNCOMMITTED" ]]; then
  echo "    (none)"
else
  echo "$UNCOMMITTED" | sed 's/^/    /'
fi
echo ""
echo "  Recent commits (verify against saved progress):"
(cd "$REPO_ROOT" && git log --oneline -5 2>/dev/null) | sed 's/^/    /'

echo ""
echo "=== Ready to continue ==="
