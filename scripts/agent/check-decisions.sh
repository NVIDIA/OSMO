#!/usr/bin/env bash
# Check Decisions: Verify changes respect architectural boundaries.
# Usage: scripts/agent/check-decisions.sh [--staged | --all]
#
# Part of the Decision layer (DIF). Catches architectural violations
# before they land in code review.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:---staged}"

echo "=== Architecture Decision Check ==="
echo ""

ERRORS=0

# Get list of changed files
if [[ "$MODE" == "--staged" ]]; then
  CHANGED_FILES=$(cd "$REPO_ROOT" && git diff --cached --name-only 2>/dev/null || git diff --name-only)
elif [[ "$MODE" == "--all" ]]; then
  CHANGED_FILES=$(cd "$REPO_ROOT" && git diff --name-only HEAD~1 2>/dev/null || git diff --name-only)
else
  CHANGED_FILES="$MODE"
fi

if [[ -z "$CHANGED_FILES" ]]; then
  echo "No changed files detected."
  exit 0
fi

# Check 1: No direct imports between services
echo "--- Check: No cross-service imports ---"
for file in $CHANGED_FILES; do
  if [[ "$file" == src/service/*/  && "$file" == *.py ]]; then
    # Check if this service file imports from another service
    FULL_PATH="$REPO_ROOT/$file"
    if [[ -f "$FULL_PATH" ]]; then
      SERVICE_DIR=$(echo "$file" | sed -n 's|src/service/\([^/]*\)/.*|\1|p')
      if grep -n "from service\." "$FULL_PATH" 2>/dev/null | grep -v "from service\.$SERVICE_DIR" | grep -v "^#" > /dev/null 2>&1; then
        echo "  VIOLATION: $file imports from another service directly"
        echo "  Services must communicate via HTTP/Redis/WebSocket, not imports"
        ERRORS=$((ERRORS + 1))
      fi
    fi
  fi
done
[[ $ERRORS -eq 0 ]] && echo "  OK"

# Check 2: No new Python imports inside functions
echo ""
echo "--- Check: No function-level imports (Python) ---"
IMPORT_ERRORS=0
for file in $CHANGED_FILES; do
  if [[ "$file" == *.py ]]; then
    FULL_PATH="$REPO_ROOT/$file"
    if [[ -f "$FULL_PATH" ]]; then
      # Look for import statements that are indented (inside functions/methods)
      if grep -n "^[[:space:]]\+import \|^[[:space:]]\+from .* import " "$FULL_PATH" 2>/dev/null | grep -v "^[[:space:]]*#" | head -5 > /dev/null 2>&1; then
        MATCHES=$(grep -n "^[[:space:]]\+import \|^[[:space:]]\+from .* import " "$FULL_PATH" 2>/dev/null | grep -v "^[[:space:]]*#" | head -5)
        if [[ -n "$MATCHES" ]]; then
          echo "  WARNING: $file may have function-level imports (verify manually):"
          echo "$MATCHES" | sed 's/^/    /'
          IMPORT_ERRORS=$((IMPORT_ERRORS + 1))
        fi
      fi
    fi
  fi
done
[[ $IMPORT_ERRORS -eq 0 ]] && echo "  OK"

# Check 3: No assert in production Python code (OK in tests)
echo ""
echo "--- Check: No assert in production code ---"
ASSERT_ERRORS=0
for file in $CHANGED_FILES; do
  if [[ "$file" == *.py && "$file" != *test* && "$file" != *tests/* ]]; then
    FULL_PATH="$REPO_ROOT/$file"
    if [[ -f "$FULL_PATH" ]]; then
      if grep -n "^[[:space:]]*assert " "$FULL_PATH" 2>/dev/null | head -3 > /dev/null 2>&1; then
        MATCHES=$(grep -n "^[[:space:]]*assert " "$FULL_PATH" 2>/dev/null | head -3)
        if [[ -n "$MATCHES" ]]; then
          echo "  VIOLATION: $file uses assert in production code"
          echo "$MATCHES" | sed 's/^/    /'
          echo "  Use 'raise ValueError(...)' instead"
          ASSERT_ERRORS=$((ASSERT_ERRORS + 1))
        fi
      fi
    fi
  fi
done
[[ $ASSERT_ERRORS -eq 0 ]] && echo "  OK"

# Check 4: Frontend files use absolute imports
echo ""
echo "--- Check: Frontend absolute imports ---"
UI_ERRORS=0
for file in $CHANGED_FILES; do
  if [[ "$file" == src/ui/src/*.ts || "$file" == src/ui/src/*.tsx ]]; then
    FULL_PATH="$REPO_ROOT/$file"
    if [[ -f "$FULL_PATH" ]]; then
      if grep -n "^import.*from ['\"]\.\./" "$FULL_PATH" 2>/dev/null > /dev/null 2>&1 || \
         grep -n "^import.*from ['\"]\./" "$FULL_PATH" 2>/dev/null > /dev/null 2>&1; then
        echo "  VIOLATION: $file uses relative imports"
        echo "  Must use absolute @/ imports"
        UI_ERRORS=$((UI_ERRORS + 1))
      fi
    fi
  fi
done
[[ $UI_ERRORS -eq 0 ]] && echo "  OK"

# Check 5: Shared library changes — warn about downstream impact
echo ""
echo "--- Check: Shared library changes (impact warning) ---"
SHARED_CHANGES=0
for file in $CHANGED_FILES; do
  case "$file" in
    src/lib/utils/*|src/lib/data/storage/*|src/utils/job/*|src/utils/connectors/*)
      echo "  WARNING: $file is shared library code"
      echo "  Check docs/agent/cross-service-impact.md for downstream consumers"
      SHARED_CHANGES=$((SHARED_CHANGES + 1))
      ;;
  esac
done
[[ $SHARED_CHANGES -eq 0 ]] && echo "  No shared library changes"

# Summary
echo ""
echo "=== Summary ==="
TOTAL_ERRORS=$((ERRORS + ASSERT_ERRORS + UI_ERRORS))
if [[ $TOTAL_ERRORS -gt 0 ]]; then
  echo "FAILED: $TOTAL_ERRORS violation(s) found"
  exit 1
else
  echo "PASSED: No violations found"
  if [[ $IMPORT_ERRORS -gt 0 || $SHARED_CHANGES -gt 0 ]]; then
    echo "($IMPORT_ERRORS warning(s) to review manually)"
  fi
  exit 0
fi
