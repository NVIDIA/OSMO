#!/usr/bin/env bash
# Save Progress: Capture current state to progress file.
# Usage: scripts/agent/save-progress.sh "task description" "status" "context for next session"
#
# Part of the Continuity layer (DIF). Saves structured progress
# so the next session can pick up without human re-explanation.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROGRESS_FILE="$REPO_ROOT/.agent-progress.json"

TASK="${1:-}"
STATUS="${2:-in_progress}"
CONTEXT="${3:-}"

if [[ -z "$TASK" ]]; then
  echo "Usage: $0 \"task description\" [status] [context for next session]"
  echo "  status: in_progress (default) | completed | blocked"
  exit 1
fi

# Get current timestamp
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Get recently modified files
RECENT_FILES=$(cd "$REPO_ROOT" && git diff --name-only HEAD 2>/dev/null | head -20 | jq -R . | jq -s .)

# Get recent commits
RECENT_COMMITS=$(cd "$REPO_ROOT" && git log --oneline -5 2>/dev/null | jq -R . | jq -s .)

# Get current branch
BRANCH=$(cd "$REPO_ROOT" && git branch --show-current 2>/dev/null || echo "unknown")

# Build progress JSON
cat > "$PROGRESS_FILE" << EOF
{
  "task": $(echo "$TASK" | jq -R .),
  "status": "$STATUS",
  "branch": "$BRANCH",
  "updated": "$TIMESTAMP",
  "recent_files": $RECENT_FILES,
  "recent_commits": $RECENT_COMMITS,
  "context_for_next_session": $(echo "$CONTEXT" | jq -R .)
}
EOF

echo "Progress saved to .agent-progress.json"
echo "  Task: $TASK"
echo "  Status: $STATUS"
echo "  Branch: $BRANCH"
echo "  Updated: $TIMESTAMP"
