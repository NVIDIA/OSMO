#!/usr/bin/env bash
# Verify: Full build and test verification for affected services.
# Usage: scripts/agent/verify.sh [service|language|all]
#
# Part of the Quality layer (DIF). Runs comprehensive verification
# for the specified scope. Use lint-fast.sh for quick feedback first.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCOPE="${1:-auto}"

echo "=== Full Verification ==="
echo "Scope: $SCOPE"
echo ""

ERRORS=0
SKIPPED=0

# Auto-detect scope from changed files
if [[ "$SCOPE" == "auto" ]]; then
  CHANGED=$(cd "$REPO_ROOT" && git diff --cached --name-only 2>/dev/null || git diff --name-only)
  SCOPE=""
  for f in $CHANGED; do
    case "$f" in
      src/service/core/*|src/lib/*|src/utils/*.py|src/cli/*|src/operator/*) SCOPE="$SCOPE python" ;;
      src/runtime/*|src/utils/*.go|src/service/authz_sidecar/*) SCOPE="$SCOPE go" ;;
      src/ui/*) SCOPE="$SCOPE frontend" ;;
    esac
  done
  # Deduplicate
  SCOPE=$(echo "$SCOPE" | tr ' ' '\n' | sort -u | tr '\n' ' ')
  if [[ -z "$SCOPE" ]]; then
    echo "No source changes detected. Nothing to verify."
    exit 0
  fi
  echo "Auto-detected: $SCOPE"
  echo ""
fi

# Python verification
if [[ "$SCOPE" == *python* || "$SCOPE" == *all* ]]; then
  echo "--- Python ---"

  # Lint
  echo "  [1/3] Linting (ruff)..."
  if command -v ruff &>/dev/null; then
    if ! (cd "$REPO_ROOT/src" && ruff check . 2>&1); then
      echo "  FAIL: ruff found issues"
      ERRORS=$((ERRORS + 1))
    else
      echo "  OK"
    fi
  else
    echo "  SKIP: ruff not installed"
    SKIPPED=$((SKIPPED + 1))
  fi

  # Type check (if mypy or pyright available)
  echo "  [2/3] Type checking..."
  echo "  SKIP: Python type checking via Bazel (run: bazel test //src/...)"
  SKIPPED=$((SKIPPED + 1))

  # Tests
  echo "  [3/3] Tests..."
  if command -v bazel &>/dev/null; then
    if ! (cd "$REPO_ROOT" && bazel test //src/service/core/... --test_output=errors 2>&1 | tail -5); then
      echo "  FAIL: Python tests failed"
      ERRORS=$((ERRORS + 1))
    else
      echo "  OK"
    fi
  else
    echo "  SKIP: bazel not installed (run tests manually)"
    SKIPPED=$((SKIPPED + 1))
  fi
  echo ""
fi

# Go verification
if [[ "$SCOPE" == *go* || "$SCOPE" == *all* ]]; then
  echo "--- Go ---"

  # Vet
  echo "  [1/3] Vetting (go vet)..."
  if command -v go &>/dev/null; then
    if ! (cd "$REPO_ROOT/src" && go vet ./... 2>&1); then
      echo "  FAIL: go vet found issues"
      ERRORS=$((ERRORS + 1))
    else
      echo "  OK"
    fi
  else
    echo "  SKIP: go not installed"
    SKIPPED=$((SKIPPED + 1))
  fi

  # Build
  echo "  [2/3] Building..."
  if command -v go &>/dev/null; then
    if ! (cd "$REPO_ROOT/src" && go build ./... 2>&1); then
      echo "  FAIL: Go build failed"
      ERRORS=$((ERRORS + 1))
    else
      echo "  OK"
    fi
  else
    echo "  SKIP: go not installed"
    SKIPPED=$((SKIPPED + 1))
  fi

  # Tests
  echo "  [3/3] Tests..."
  if command -v bazel &>/dev/null; then
    if ! (cd "$REPO_ROOT" && bazel test //src/runtime/... --test_output=errors 2>&1 | tail -5); then
      echo "  FAIL: Go tests failed"
      ERRORS=$((ERRORS + 1))
    else
      echo "  OK"
    fi
  else
    echo "  SKIP: bazel not installed"
    SKIPPED=$((SKIPPED + 1))
  fi
  echo ""
fi

# Frontend verification
if [[ "$SCOPE" == *frontend* || "$SCOPE" == *all* ]]; then
  echo "--- Frontend ---"
  UI_DIR="$REPO_ROOT/src/ui"

  if [[ ! -f "$UI_DIR/package.json" ]]; then
    echo "  SKIP: ui/package.json not found"
    SKIPPED=$((SKIPPED + 1))
  else
    # Type check
    echo "  [1/3] Type checking (tsc)..."
    if ! (cd "$UI_DIR" && pnpm type-check 2>&1); then
      echo "  FAIL: TypeScript type check failed"
      ERRORS=$((ERRORS + 1))
    else
      echo "  OK"
    fi

    # Lint
    echo "  [2/3] Linting (eslint)..."
    if ! (cd "$UI_DIR" && pnpm lint 2>&1); then
      echo "  FAIL: ESLint found issues"
      ERRORS=$((ERRORS + 1))
    else
      echo "  OK"
    fi

    # Tests
    echo "  [3/3] Tests (vitest)..."
    if ! (cd "$UI_DIR" && pnpm test --run 2>&1); then
      echo "  FAIL: Vitest tests failed"
      ERRORS=$((ERRORS + 1))
    else
      echo "  OK"
    fi
  fi
  echo ""
fi

# Summary
echo "=== Verification Summary ==="
if [[ $ERRORS -gt 0 ]]; then
  echo "FAILED: $ERRORS check(s) failed"
  [[ $SKIPPED -gt 0 ]] && echo "($SKIPPED check(s) skipped — tools not available)"
  exit 1
else
  echo "PASSED: All checks passed"
  [[ $SKIPPED -gt 0 ]] && echo "($SKIPPED check(s) skipped — tools not available)"
  exit 0
fi
