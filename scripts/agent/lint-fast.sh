#!/usr/bin/env bash
# Lint Fast: Quick syntax and style check (<5 seconds).
# Usage: scripts/agent/lint-fast.sh [file-or-dir...]
#
# Part of the Quality layer (DIF). Provides immediate feedback
# on style violations without running full builds.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGETS=("${@:-}")

echo "=== Lint Fast ==="

ERRORS=0

# Detect which languages are affected
HAS_PYTHON=false
HAS_GO=false
HAS_TS=false

if [[ ${#TARGETS[@]} -eq 0 || -z "${TARGETS[0]}" ]]; then
  # Check staged files
  CHANGED=$(cd "$REPO_ROOT" && git diff --cached --name-only 2>/dev/null || git diff --name-only)
  for f in $CHANGED; do
    case "$f" in
      *.py) HAS_PYTHON=true ;;
      *.go) HAS_GO=true ;;
      *.ts|*.tsx) HAS_TS=true ;;
    esac
  done
else
  for t in "${TARGETS[@]}"; do
    case "$t" in
      *.py|*/lib/*|*/service/*|*/cli/*|*/operator/*) HAS_PYTHON=true ;;
      *.go|*/runtime/*|*/utils/*.go) HAS_GO=true ;;
      *.ts|*.tsx|*/ui/*) HAS_TS=true ;;
    esac
  done
fi

# Python: ruff check (fast linter)
if $HAS_PYTHON; then
  echo ""
  echo "--- Python (ruff) ---"
  if command -v ruff &>/dev/null; then
    if (cd "$REPO_ROOT/src" && ruff check --quiet . 2>&1); then
      echo "  OK"
    else
      ERRORS=$((ERRORS + 1))
    fi
  else
    echo "  SKIP: ruff not found (install with: pip install ruff)"
  fi
fi

# Go: go vet (fast static analysis)
if $HAS_GO; then
  echo ""
  echo "--- Go (go vet) ---"
  if command -v go &>/dev/null; then
    if (cd "$REPO_ROOT/src" && go vet ./... 2>&1); then
      echo "  OK"
    else
      ERRORS=$((ERRORS + 1))
    fi
  else
    echo "  SKIP: go not found"
  fi
fi

# TypeScript: tsc --noEmit (type check only)
if $HAS_TS; then
  echo ""
  echo "--- TypeScript (type-check) ---"
  UI_DIR="$REPO_ROOT/src/ui"
  if [[ -f "$UI_DIR/package.json" ]]; then
    if (cd "$UI_DIR" && pnpm type-check 2>&1); then
      echo "  OK"
    else
      ERRORS=$((ERRORS + 1))
    fi
  else
    echo "  SKIP: ui/package.json not found"
  fi
fi

# Summary
echo ""
echo "=== Summary ==="
if [[ $ERRORS -gt 0 ]]; then
  echo "FAILED: $ERRORS language(s) had lint errors"
  exit 1
else
  echo "PASSED: All lint checks clean"
  exit 0
fi
