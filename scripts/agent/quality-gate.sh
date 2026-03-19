#!/usr/bin/env bash
# Quality Gate: Orchestrates the full verification pipeline.
# Usage: scripts/agent/quality-gate.sh [scope]
#
# Part of the Quality layer (DIF). Runs lint-fast -> verify -> decisions check.
# Agent should only declare "done" when this exits 0.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCOPE="${1:-auto}"

echo "========================================="
echo "  OSMO Quality Gate"
echo "========================================="
echo ""

STEP=0
ERRORS=0
START_TIME=$(date +%s)

# Step 1: Decision check (architectural boundaries)
STEP=$((STEP + 1))
echo "[$STEP] Architecture decision check..."
if "$SCRIPT_DIR/check-decisions.sh" --all 2>&1; then
  echo "  -> PASSED"
else
  echo "  -> FAILED"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Step 2: Fast lint (syntax and style)
STEP=$((STEP + 1))
echo "[$STEP] Fast lint check..."
if "$SCRIPT_DIR/lint-fast.sh" 2>&1; then
  echo "  -> PASSED"
else
  echo "  -> FAILED"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Step 3: Full verification (build + test)
STEP=$((STEP + 1))
echo "[$STEP] Full verification ($SCOPE)..."
if "$SCRIPT_DIR/verify.sh" "$SCOPE" 2>&1; then
  echo "  -> PASSED"
else
  echo "  -> FAILED"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Summary
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "========================================="
echo "  Quality Gate Summary"
echo "========================================="
echo "  Steps run: $STEP"
echo "  Duration: ${DURATION}s"
echo ""

if [[ $ERRORS -gt 0 ]]; then
  echo "  RESULT: FAILED ($ERRORS step(s) failed)"
  echo ""
  echo "  Do NOT declare the task complete."
  echo "  Fix the failures and re-run this gate."
  exit 1
else
  echo "  RESULT: PASSED"
  echo ""
  echo "  Safe to declare the task complete."
  exit 0
fi
