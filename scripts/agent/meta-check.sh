#!/usr/bin/env bash
# Meta Check: Detect ineffective agent behavior patterns.
# Usage: scripts/agent/meta-check.sh [--report]
#
# Part of the Meta-cognition layer (DIF). Analyzes current session
# state for signs of spinning, drift, or ineffectiveness.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPORT="${1:-}"

echo "=== Meta-Cognition Check ==="
echo ""

WARNINGS=0

# Check 1: How many uncommitted changes?
UNCOMMITTED_COUNT=$(cd "$REPO_ROOT" && git status --short 2>/dev/null | wc -l | tr -d ' ')
echo "--- Scope Check ---"
echo "  Uncommitted files: $UNCOMMITTED_COUNT"
if [[ "$UNCOMMITTED_COUNT" -gt 15 ]]; then
  echo "  WARNING: More than 15 uncommitted files. Is the change too broad?"
  echo "  Consider: commit partial work, split into smaller tasks"
  WARNINGS=$((WARNINGS + 1))
elif [[ "$UNCOMMITTED_COUNT" -gt 10 ]]; then
  echo "  NOTICE: 10+ uncommitted files. Consider committing progress."
fi

# Check 2: Any files changed repeatedly? (sign of thrashing)
echo ""
echo "--- Thrashing Detection ---"
if command -v git &>/dev/null; then
  # Check recent reflog for repeated file edits
  RECENT_COMMITS=$(cd "$REPO_ROOT" && git log --oneline -20 --diff-filter=M --name-only 2>/dev/null || true)
  if [[ -n "$RECENT_COMMITS" ]]; then
    # Count files appearing in multiple recent commits
    REPEATED=$(echo "$RECENT_COMMITS" | grep -v "^[a-f0-9]" | sort | uniq -c | sort -rn | head -5)
    MAX_REPEATS=$(echo "$REPEATED" | head -1 | awk '{print $1}' | tr -d ' ')
    if [[ -n "$MAX_REPEATS" && "$MAX_REPEATS" -gt 3 ]]; then
      echo "  WARNING: Some files modified $MAX_REPEATS times in recent commits:"
      echo "$REPEATED" | head -3 | sed 's/^/    /'
      echo "  Consider: Is this file being edited, reverted, and re-edited?"
      WARNINGS=$((WARNINGS + 1))
    else
      echo "  OK: No excessive file thrashing detected"
    fi
  else
    echo "  OK: Not enough commit history to check"
  fi
fi

# Check 3: Time since last commit
echo ""
echo "--- Progress Check ---"
LAST_COMMIT_TIME=$(cd "$REPO_ROOT" && git log -1 --format=%ct 2>/dev/null || echo 0)
CURRENT_TIME=$(date +%s)
if [[ "$LAST_COMMIT_TIME" -gt 0 ]]; then
  MINUTES_SINCE=$((($CURRENT_TIME - $LAST_COMMIT_TIME) / 60))
  echo "  Minutes since last commit: $MINUTES_SINCE"
  if [[ "$MINUTES_SINCE" -gt 60 ]]; then
    echo "  WARNING: Over 60 minutes since last commit."
    echo "  Consider: Is progress being made? Should work be committed incrementally?"
    WARNINGS=$((WARNINGS + 1))
  elif [[ "$MINUTES_SINCE" -gt 30 ]]; then
    echo "  NOTICE: 30+ minutes since last commit. Consider saving progress."
  fi
fi

# Check 4: Build/test status
echo ""
echo "--- Quality Status ---"
echo "  Run 'scripts/agent/quality-gate.sh' for full verification"
echo "  Run 'scripts/agent/lint-fast.sh' for quick check"

# Summary
echo ""
echo "=== Summary ==="
if [[ $WARNINGS -gt 0 ]]; then
  echo "$WARNINGS warning(s) detected. Review recommendations above."
  echo ""
  echo "If stuck, consult: docs/agent/meta-cognition-protocol.md"
  echo "  - Try a different approach"
  echo "  - Delegate to a sub-agent with fresh context"
  echo "  - Save progress and escalate to human"
else
  echo "No concerns detected. Continue."
fi

if [[ "$REPORT" == "--report" ]]; then
  echo ""
  echo "=== Detailed Report ==="
  echo "Uncommitted: $UNCOMMITTED_COUNT files"
  echo "Warnings: $WARNINGS"
  echo "Time since commit: ${MINUTES_SINCE:-unknown} min"
fi

exit 0
