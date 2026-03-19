#!/usr/bin/env bash
# Route Context: Given a file path, output relevant AGENTS.md and docs.
# Usage: scripts/agent/route-context.sh <file-path>
#
# Part of the Context layer (DIF). Maps file paths to relevant documentation
# so agents don't waste turns searching for information.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FILE_PATH="${1:-}"

if [[ -z "$FILE_PATH" ]]; then
  echo "Usage: $0 <file-path>"
  echo "Returns relevant context files for the given source file."
  exit 1
fi

# Normalize path relative to repo root
REL_PATH="${FILE_PATH#"$REPO_ROOT"/}"

echo "=== Context for: $REL_PATH ==="
echo ""

# Always include root AGENTS.md
echo "--- Root Context ---"
echo "  AGENTS.md"

# Route by directory prefix
case "$REL_PATH" in
  src/service/core/*)
    echo ""
    echo "--- Service Context ---"
    echo "  src/service/core/AGENTS.md"
    echo "  docs/agent/architecture-intent.md (if changing architecture)"
    echo "  docs/agent/cross-service-impact.md (if changing shared interfaces)"
    # Identify submodule
    SUBMODULE=$(echo "$REL_PATH" | sed -n 's|src/service/core/\([^/]*\)/.*|\1|p')
    if [[ -n "$SUBMODULE" ]]; then
      echo ""
      echo "--- Submodule: $SUBMODULE ---"
      case "$SUBMODULE" in
        auth)    echo "  Related: utils/roles/ (Go RBAC), service/authz_sidecar/" ;;
        workflow) echo "  Related: utils/job/ (execution framework), service/worker/ (job consumer)" ;;
        config)  echo "  Related: service/core/workflow/ (consumes configs)" ;;
        data)    echo "  Related: lib/data/storage/, lib/data/dataset/" ;;
        app)     echo "  Related: service/core/workflow/ (apps submit workflows)" ;;
        profile) echo "  Related: service/core/auth/ (identity)" ;;
      esac
    fi
    ;;

  src/service/router/*|src/service/worker/*|src/service/agent/*|src/service/logger/*|src/service/delayed_job_monitor/*)
    echo ""
    echo "--- Supporting Service ---"
    SERVICE=$(echo "$REL_PATH" | sed -n 's|src/service/\([^/]*\)/.*|\1|p')
    echo "  Service: $SERVICE"
    echo "  docs/agent/cross-service-impact.md"
    ;;

  src/lib/*)
    echo ""
    echo "--- Library Context ---"
    echo "  src/lib/AGENTS.md"
    echo "  docs/agent/cross-service-impact.md (libraries affect many consumers)"
    ;;

  src/runtime/*)
    echo ""
    echo "--- Runtime Context ---"
    echo "  src/runtime/AGENTS.md"
    echo "  docs/agent/architecture-intent.md (IPC and container boundaries)"
    ;;

  src/utils/*)
    echo ""
    echo "--- Utilities Context ---"
    # Detect Go vs Python by file extension
    if [[ "$REL_PATH" == *.go ]]; then
      echo "  Language: Go"
      echo "  Related: src/runtime/AGENTS.md (if roles/ or postgres/ or redis/)"
    else
      echo "  Language: Python"
      echo "  docs/agent/cross-service-impact.md (utilities affect many consumers)"
    fi
    ;;

  src/cli/*)
    echo ""
    echo "--- CLI Context ---"
    echo "  Check corresponding API endpoint in service/core/"
    echo "  Related: lib/utils/ (ServiceClient for HTTP/WS requests)"
    ;;

  src/ui/*)
    echo ""
    echo "--- Frontend Context ---"
    echo "  src/ui/AGENTS.md"
    echo "  src/lib/api/adapter/BACKEND_TODOS.md (backend quirks)"
    ;;

  src/operator/*)
    echo ""
    echo "--- Operator Context ---"
    echo "  Related: service/agent/ (backend integration)"
    echo "  Related: service/worker/ (job execution)"
    ;;

  src/service/authz_sidecar/*)
    echo ""
    echo "--- Authorization Context ---"
    echo "  Language: Go (gRPC service)"
    echo "  Related: utils/roles/ (RBAC implementation)"
    echo "  docs/agent/architecture-intent.md (auth flow)"
    ;;

  *)
    echo ""
    echo "--- No specific context mapping for this path ---"
    echo "  Check docs/agent/decision-tree.md for task-based routing"
    ;;
esac

echo ""
echo "--- Always Check ---"
echo "  docs/agent/decision-tree.md (task-type routing)"
echo "  docs/agent/cross-service-impact.md (if touching shared code)"
