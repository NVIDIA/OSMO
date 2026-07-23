#!/usr/bin/env bash
# Start a generic agent with its pinned static capabilities.
set -euo pipefail

readonly OSMO_SKILL_REPOSITORY='https://github.com/NVIDIA/OSMO.git'
readonly OSMO_SKILL_REF='3603b853f62dd38dfe1dc0a76cf68dfa3f07461a'
readonly AGENTS_FILE='/run/agent/AGENTS.md'
readonly DEFAULT_OSMO_SERVICE_URL='https://us-west-2-aws.osmo.nvidia.com'

result_root=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --result-root) result_root="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: run-agent.sh --result-root <directory>"
      exit 0
      ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -n "${result_root}" ]] || { echo "--result-root is required" >&2; exit 2; }
[[ -r "${AGENTS_FILE}" ]] || { echo "${AGENTS_FILE} is required and must be readable" >&2; exit 2; }
[[ -n "${INFERENCE_API_KEY:-}" ]] || { echo "INFERENCE_API_KEY is required at runtime" >&2; exit 2; }
[[ -n "${OSMO_AGENTIC_WORKFLOW_TOKEN:-}" ]] || {
  echo "OSMO_AGENTIC_WORKFLOW_TOKEN is required at runtime" >&2
  exit 2
}
command -v osmo >/dev/null || { echo "OSMO CLI is not available in this task runtime" >&2; exit 2; }

osmo_service_url="${OSMO_SERVICE_URL:-${DEFAULT_OSMO_SERVICE_URL}}"
[[ "${osmo_service_url}" =~ ^https://[A-Za-z0-9.-]+$ ]] || {
  echo "OSMO_SERVICE_URL must be an https service root without a path" >&2
  exit 2
}

# Pass the one-time credential through an inherited file descriptor rather than
# an argument or a file, then remove it from the environment before Codex runs.
osmo login "${osmo_service_url}" --method token --token-file /dev/fd/3 \
  3<<<"${OSMO_AGENTIC_WORKFLOW_TOKEN}" >/dev/null
unset OSMO_AGENTIC_WORKFLOW_TOKEN

checkout_pinned() {
  local repository_url="$1" repository_ref="$2" destination="$3"
  git clone --quiet --no-checkout "${repository_url}" "${destination}"
  git -C "${destination}" checkout --quiet --detach "${repository_ref}"
  [[ "$(git -C "${destination}" rev-parse HEAD)" == "${repository_ref}" ]] || {
    echo "checked out source does not match its pinned commit" >&2
    exit 2
  }
}

[[ "${STATIC_REPOSITORY_URL:-}" =~ ^https://github\.com/[^/]+/[^/]+(\.git)?$ ]] || {
  echo "STATIC_REPOSITORY_URL must be a public https://github.com/<owner>/<repo>[.git] URL" >&2
  exit 2
}
[[ "${STATIC_REPOSITORY_REF:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "STATIC_REPOSITORY_REF must be a full immutable Git commit SHA" >&2
  exit 2
}
static_repository_subdir="${STATIC_REPOSITORY_SUBDIR:-.}"
if [[ "${static_repository_subdir}" != "." ]] && \
  { ! [[ "${static_repository_subdir}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$ ]] || \
    [[ "/${static_repository_subdir}/" == *"/./"* || "/${static_repository_subdir}/" == *"/../"* ]]; }; then
  echo "STATIC_REPOSITORY_SUBDIR must be . or a relative, traversal-free path" >&2
  exit 2
fi

kit_root="$(mktemp -d /tmp/agent-kit.XXXXXX)"
osmo_root="$(mktemp -d /tmp/osmo-user.XXXXXX)"
checkout_pinned "${STATIC_REPOSITORY_URL}" "${STATIC_REPOSITORY_REF}" "${kit_root}"
checkout_pinned "${OSMO_SKILL_REPOSITORY}" "${OSMO_SKILL_REF}" "${osmo_root}"
kit_workdir="${kit_root}/${static_repository_subdir}"
agentic_skill_root="${kit_workdir}/skills/osmo-agentic-workflow"
agentic_skill_file="${agentic_skill_root}/SKILL.md"
agentic_result_schema="${agentic_skill_root}/assets/agent-result.schema.json"
child_template="${agentic_skill_root}/assets/child-workflow-template.yaml"
osmo_skill_file="${osmo_root}/skills/osmo-user/SKILL.md"
[[ -d "${kit_workdir}" && -f "${agentic_skill_file}" && -f "${agentic_result_schema}" && -f "${child_template}" && -f "${osmo_skill_file}" ]] || {
  echo "cloned sources do not provide the required agentic-workflow skill at STATIC_REPOSITORY_SUBDIR=${static_repository_subdir}" >&2
  exit 2
}
mkdir -p "${result_root}"
prompt_file="$(mktemp /tmp/agent-prompt.XXXXXX)"
iteration_result="$(mktemp /tmp/agent-result.XXXXXX)"
result_file="${result_root}/agent-result.json"
trap 'rm -f "${prompt_file}" "${iteration_result}"' EXIT

validate_agent_result() {
  python3 - "$1" <<'PY'
import json
import sys
from pathlib import Path

result_path = Path(sys.argv[1])
try:
    result = json.loads(result_path.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as error:
    raise SystemExit(f"invalid agent result: {error}")

required = {"outcome", "summary", "evidence", "nextAction"}
if not isinstance(result, dict) or set(result) != required:
    raise SystemExit("agent result must contain exactly outcome, summary, evidence, and nextAction")
if result["outcome"] not in {
    "Completed",
    "Retrying",
    "HumanInterventionRequired",
    "TerminalFailure",
}:
    raise SystemExit("agent result contains an unknown outcome")
if not isinstance(result["summary"], str) or not result["summary"].strip():
    raise SystemExit("agent result summary must be a non-empty string")
if not isinstance(result["evidence"], list) or not all(
    isinstance(item, str) for item in result["evidence"]
):
    raise SystemExit("agent result evidence must be an array of strings")
if result["nextAction"] is not None and not isinstance(result["nextAction"], str):
    raise SystemExit("agent result nextAction must be a string or null")
print(result["outcome"])
PY
}

write_prompt() {
  {
    printf '## Reusable OSMO agentic-workflow skill\n\n'
    cat "${agentic_skill_file}"
    printf '\n\n## OSMO operating skill\n\n'
    cat "${osmo_skill_file}"
    printf '\n\n## Task-scoped AGENTS instructions\n\n'
    cat "${AGENTS_FILE}"
    printf '\nThe full OSMO skill source, including its references, is at %s/skills/osmo-user. Before any OSMO operation, read the relevant reference there and use the existing OSMO CLI directly. The static-kit root is %s. The generic child workflow template is %s. Copy it to a new child YAML and edit the copy; preserve STATIC_REPOSITORY_URL, STATIC_REPOSITORY_REF, and STATIC_REPOSITORY_SUBDIR from this task. Its embedded task-scoped AGENTS.md is the complete handoff. Record child workflow IDs and output URLs in durable evidence before monitoring or retrying. Clone additional public, commit-pinned domain repositories only when the task-scoped AGENTS.md requires them. Do not place secret values in output.\n' "${osmo_root}" "${kit_workdir}" "${child_template}"
    if [[ -f "${result_file}" ]]; then
      printf '\n## Continuation\n\n'
      printf 'This is a continuation of the same bounded task, not a new goal. The previous typed result is below. Read it and its durable evidence before acting. Reconcile already-submitted child workflows before retrying or submitting a replacement. A `Retrying` result is not completion: perform the stated next action, then return a new typed result. Do not repeat a non-terminal child submission.\n\n'
      cat "${result_file}"
      printf '\n'
    fi
  } > "${prompt_file}"
}

iteration=1
while :; do
  write_prompt
  : > "${iteration_result}"
  echo "Starting Codex agent iteration ${iteration}" >&2
  if ! codex exec \
    --strict-config \
    --dangerously-bypass-approvals-and-sandbox \
    --skip-git-repo-check \
    --ephemeral \
    --json \
    --output-schema "${agentic_result_schema}" \
    --output-last-message "${iteration_result}" \
    -C "${kit_workdir}" \
    - < "${prompt_file}"; then
    echo "Codex agent iteration ${iteration} failed before producing a terminal result" >&2
    exit 1
  fi

  outcome="$(validate_agent_result "${iteration_result}")" || {
    echo "Codex agent iteration ${iteration} produced an invalid typed result" >&2
    exit 1
  }
  cp "${iteration_result}" "${result_file}"

  case "${outcome}" in
    Completed)
      echo "Agent completed after iteration ${iteration}" >&2
      exit 0
      ;;
    Retrying)
      echo "Agent requested continuation after iteration ${iteration}" >&2
      iteration=$((iteration + 1))
      ;;
    HumanInterventionRequired|TerminalFailure)
      echo "Agent reached ${outcome} after iteration ${iteration}" >&2
      exit 0
      ;;
  esac
done
