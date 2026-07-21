#!/usr/bin/env bash
# Start a generic agent with its pinned static capabilities.
set -euo pipefail

readonly OSMO_SKILL_REPOSITORY='https://github.com/NVIDIA/OSMO.git'
readonly OSMO_SKILL_REF='3603b853f62dd38dfe1dc0a76cf68dfa3f07461a'
readonly AGENTS_FILE='/run/agent/AGENTS.md'

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
command -v osmo >/dev/null || { echo "OSMO CLI is not available in this task runtime" >&2; exit 2; }

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

kit_root="$(mktemp -d /tmp/agent-kit.XXXXXX)"
osmo_root="$(mktemp -d /tmp/osmo-user.XXXXXX)"
checkout_pinned "${STATIC_REPOSITORY_URL}" "${STATIC_REPOSITORY_REF}" "${kit_root}"
checkout_pinned "${OSMO_SKILL_REPOSITORY}" "${OSMO_SKILL_REF}" "${osmo_root}"
agentic_skill_root="${kit_root}/skills/osmo-agentic-workflow"
agentic_skill_file="${agentic_skill_root}/SKILL.md"
agentic_result_schema="${agentic_skill_root}/assets/agent-result.schema.json"
child_template="${agentic_skill_root}/assets/child-workflow-template.yaml"
osmo_skill_file="${osmo_root}/skills/osmo-user/SKILL.md"
[[ -f "${agentic_skill_file}" && -f "${agentic_result_schema}" && -f "${child_template}" && -f "${osmo_skill_file}" ]] || {
  echo "cloned sources do not provide the required agentic-workflow and OSMO skills" >&2
  exit 2
}
mkdir -p "${result_root}"
prompt_file="$(mktemp)"
trap 'rm -f "${prompt_file}"' EXIT
{
  printf '## Reusable OSMO agentic-workflow skill\n\n'
  cat "${agentic_skill_file}"
  printf '\n\n## OSMO operating skill\n\n'
  cat "${osmo_skill_file}"
  printf '\n\n## Task-scoped AGENTS instructions\n\n'
  cat "${AGENTS_FILE}"
  printf '\nThe full OSMO skill source, including its references, is at %s/skills/osmo-user. Before any OSMO operation, read the relevant reference there and use the existing OSMO CLI directly. The generic child workflow template is %s. Copy it to a new child YAML and edit the copy; its embedded task-scoped AGENTS.md is the complete handoff. Record child workflow IDs and output URLs in durable evidence before monitoring or retrying. Clone additional public, commit-pinned domain repositories only when the task-scoped AGENTS.md requires them. Do not place secret values in output.\n' "${osmo_root}" "${child_template}"
} > "${prompt_file}"

codex exec \
  --strict-config \
  --sandbox danger-full-access \
  --ask-for-approval never \
  --skip-git-repo-check \
  --ephemeral \
  --json \
  --output-schema "${agentic_result_schema}" \
  --output-last-message "${result_root}/agent-result.json" \
  -C "${kit_root}" \
  - < "${prompt_file}" > "${result_root}/codex-events.jsonl"
