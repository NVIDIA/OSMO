#!/usr/bin/env bash
# Start a generic agent with its pinned static capabilities.
set -euo pipefail

readonly OSMO_SKILL_REPOSITORY='https://github.com/NVIDIA/OSMO.git'
readonly OSMO_SKILL_REF='3603b853f62dd38dfe1dc0a76cf68dfa3f07461a'
readonly AGENTS_FILE='/run/agent/AGENTS.md'
readonly DEFAULT_OSMO_SERVICE_URL='https://us-west-2-aws.osmo.nvidia.com'
readonly STORAGE_URL_PATTERN='^(swift|s3|gs|tos|azure)://[^/:[:space:]]+(/[^[:space:]]+)*/*$'

result_root=""
control_url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --result-root) result_root="$2"; shift 2 ;;
    --control-url) control_url="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: run-agent.sh --result-root <directory> --control-url <storage-url>"
      exit 0
      ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -n "${result_root}" ]] || { echo "--result-root is required" >&2; exit 2; }
[[ -n "${control_url}" ]] || { echo "--control-url is required" >&2; exit 2; }
[[ -r "${AGENTS_FILE}" ]] || { echo "${AGENTS_FILE} is required and must be readable" >&2; exit 2; }
[[ -n "${INFERENCE_API_KEY:-}" ]] || { echo "INFERENCE_API_KEY is required at runtime" >&2; exit 2; }
[[ -n "${OSMO_AGENTIC_WORKFLOW_TOKEN:-}" ]] || {
  echo "OSMO_AGENTIC_WORKFLOW_TOKEN is required at runtime" >&2
  exit 2
}
command -v osmo >/dev/null || { echo "OSMO CLI is not available in this task runtime" >&2; exit 2; }

[[ "${control_url}" =~ ${STORAGE_URL_PATTERN} ]] || {
  echo "--control-url must be an OSMO storage URL without credentials" >&2
  exit 2
}
control_url="${control_url%/}/"

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
human_response_schema="${agentic_skill_root}/assets/human-response.schema.json"
child_template="${agentic_skill_root}/assets/child-workflow-template.yaml"
osmo_skill_file="${osmo_root}/skills/osmo-user/SKILL.md"
[[ -d "${kit_workdir}" && -f "${agentic_skill_file}" && -f "${agentic_result_schema}" && -f "${human_response_schema}" && -f "${child_template}" && -f "${osmo_skill_file}" ]] || {
  echo "cloned sources do not provide the required agentic-workflow skill at STATIC_REPOSITORY_SUBDIR=${static_repository_subdir}" >&2
  exit 2
}

python3 - "${human_response_schema}" <<'PY'
import json
import sys
from pathlib import Path

schema = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
expected = {"schemaVersion", "requestId", "action", "instruction"}
if schema.get("required") != ["schemaVersion", "requestId", "action", "instruction"]:
    raise SystemExit("human response schema has an unexpected required-field contract")
if set(schema.get("properties", {})) != expected:
    raise SystemExit("human response schema has an unexpected property contract")
if schema["properties"]["schemaVersion"].get("const") != "v1":
    raise SystemExit("human response schema must pin schemaVersion v1")
if schema["properties"]["action"].get("const") != "continue":
    raise SystemExit("human response schema must pin action continue")
PY

mkdir -p "${result_root}"
prompt_file="$(mktemp /tmp/agent-prompt.XXXXXX)"
iteration_result="$(mktemp /tmp/agent-result.XXXXXX)"
human_response_file="$(mktemp /tmp/human-response.XXXXXX)"
control_request_dir="/tmp/agent-control"
result_file="${result_root}/agent-result.json"
mkdir -p "${control_request_dir}"
chmod 0755 "${control_request_dir}"
trap 'rm -f "${prompt_file}" "${iteration_result}" "${human_response_file}"' EXIT

positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

retry_delay_seconds="${AGENT_RETRY_DELAY_SECONDS:-60}"
control_poll_seconds="${AGENT_CONTROL_POLL_SECONDS:-60}"
positive_integer "${retry_delay_seconds}" || {
  echo "AGENT_RETRY_DELAY_SECONDS must be a positive integer" >&2
  exit 2
}
positive_integer "${control_poll_seconds}" || {
  echo "AGENT_CONTROL_POLL_SECONDS must be a positive integer" >&2
  exit 2
}

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
    printf '\nThe full OSMO skill source, including its references, is at %s/skills/osmo-user. Before any OSMO operation, read the relevant reference there and use the existing OSMO CLI directly. The static-kit root is %s. The generic child workflow template is %s. Copy it to a new child YAML and edit the copy; preserve STATIC_REPOSITORY_URL, STATIC_REPOSITORY_REF, and STATIC_REPOSITORY_SUBDIR from this task. Its embedded task-scoped AGENTS.md is the complete handoff. Record child workflow IDs and output URLs in durable evidence before monitoring or retrying. Clone additional public, commit-pinned domain repositories only when the task-scoped AGENTS.md requires them. Do not place secret values in output. For a genuine unresolved ambiguity, return HumanInterventionRequired with the exact question and safe choices in nextAction. The runtime will publish that request and wait for a matched human response; do not treat that outcome as completion.\n' "${osmo_root}" "${kit_workdir}" "${child_template}"
    if [[ -f "${result_file}" ]]; then
      printf '\n## Continuation\n\n'
      printf 'This is a continuation of the same bounded task, not a new goal. The previous typed result is below. Read it and its durable evidence before acting. Reconcile already-submitted child workflows before retrying or submitting a replacement. A `Retrying` result is not completion: perform the stated next action, then return a new typed result. Do not repeat a non-terminal child submission.\n\n'
      cat "${result_file}"
      printf '\n'
    fi
    if [[ -s "${human_response_file}" ]]; then
      printf '\n## Human response\n\n'
      printf 'The runtime validated this response for the prior human-intervention request. Apply it to the same bounded task, reconcile current OSMO state first, and continue safely.\n\n'
      cat "${human_response_file}"
      printf '\n'
    fi
  } > "${prompt_file}"
}

create_human_request() {
  local request_id
  request_id="$(python3 - "${iteration_result}" "${control_url}" "${control_request_dir}" <<'PY'
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

result_path = Path(sys.argv[1])
control_url = sys.argv[2].rstrip("/")
request_dir = Path(sys.argv[3])
result = json.loads(result_path.read_text(encoding="utf-8"))

if result.get("outcome") != "HumanInterventionRequired":
    raise SystemExit("human request requires HumanInterventionRequired")
question = result.get("nextAction")
if not isinstance(question, str) or not question.strip():
    raise SystemExit("HumanInterventionRequired requires a non-empty nextAction")

fingerprint = {
    "summary": result["summary"],
    "evidence": result["evidence"],
    "question": question,
}
request_id = hashlib.sha256(
    json.dumps(fingerprint, sort_keys=True, separators=(",", ":")).encode("utf-8")
).hexdigest()
request = {
    "schemaVersion": "v1",
    "requestId": request_id,
    "summary": result["summary"],
    "evidence": result["evidence"],
    "question": question,
    "responseUrl": f"{control_url}/human-response-{request_id}.json",
}
request_dir.mkdir(parents=True, exist_ok=True)
target = request_dir / f"human-request-{request_id}.json"
descriptor, temporary_name = tempfile.mkstemp(prefix=".human-request-", dir=request_dir)
try:
    with os.fdopen(descriptor, "w", encoding="utf-8") as temporary:
        json.dump(request, temporary, sort_keys=True, separators=(",", ":"))
        temporary.write("\n")
    os.chmod(temporary_name, 0o644)
    os.replace(temporary_name, target)
except BaseException:
    try:
        os.unlink(temporary_name)
    except FileNotFoundError:
        pass
    raise

print(request_id)
PY
)" || return 1
  printf '%s\n' "${request_id}"
}

validate_human_response() {
  python3 - "$1" "$2" <<'PY'
import json
import sys
from pathlib import Path

response_path = Path(sys.argv[1])
request_id = sys.argv[2]
try:
    response = json.loads(response_path.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as error:
    raise SystemExit(f"invalid human response: {error}")

required = {"schemaVersion", "requestId", "action", "instruction"}
if not isinstance(response, dict) or set(response) != required:
    raise SystemExit("human response must contain exactly schemaVersion, requestId, action, and instruction")
if response["schemaVersion"] != "v1":
    raise SystemExit("human response has an unsupported schemaVersion")
if response["requestId"] != request_id:
    raise SystemExit("human response requestId does not match the active request")
if response["action"] != "continue":
    raise SystemExit("human response action must be continue")
if not isinstance(response["instruction"], str) or not response["instruction"].strip():
    raise SystemExit("human response instruction must be a non-empty string")
PY
}

wait_for_human_response() {
  local request_id="$1"
  local response_url="${control_url}human-response-${request_id}.json"
  local response_dir response_path poll_count=0

  echo "Agent requires human intervention; request ID: ${request_id}" >&2
  echo "Human request will checkpoint to: ${control_url}human-request-${request_id}.json" >&2
  echo "Awaiting matched human response at: ${response_url}" >&2
  osmo data check "${control_url}" --access-type READ >/dev/null || {
    echo "Human control inbox is not readable: ${control_url}" >&2
    return 1
  }

  while :; do
    response_dir="$(mktemp -d /tmp/human-response-download.XXXXXX)"
    if osmo data download "${response_url}" "${response_dir}" >"${response_dir}/download.log" 2>&1; then
      response_path="$(find "${response_dir}" -type f -name "human-response-${request_id}.json" -print -quit)"
      if [[ -n "${response_path}" ]] && validate_human_response "${response_path}" "${request_id}"; then
        install -m 0600 "${response_path}" "${human_response_file}"
        rm -rf "${response_dir}"
        echo "Received valid human response for request ID: ${request_id}" >&2
        return 0
      fi
      echo "Ignoring an invalid human response for request ID: ${request_id}" >&2
    fi
    rm -rf "${response_dir}"
    poll_count=$((poll_count + 1))
    if (( poll_count % 5 == 0 )); then
      echo "Still awaiting human response for request ID: ${request_id}" >&2
    fi
    sleep "${control_poll_seconds}"
  done
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

  # A human response is a one-turn continuation input. Later turns must rely
  # on the newly returned typed result and durable evidence instead.
  : > "${human_response_file}"

  outcome="$(validate_agent_result "${iteration_result}")" || {
    echo "Codex agent iteration ${iteration} produced an invalid typed result" >&2
    exit 1
  }
  install -m 0644 "${iteration_result}" "${result_file}"

  case "${outcome}" in
    Completed)
      echo "Agent completed after iteration ${iteration}" >&2
      exit 0
      ;;
    Retrying)
      echo "Agent requested continuation after iteration ${iteration}; waiting ${retry_delay_seconds}s" >&2
      sleep "${retry_delay_seconds}"
      iteration=$((iteration + 1))
      ;;
    HumanInterventionRequired)
      request_id="$(create_human_request)" || {
        echo "Unable to publish a valid human-intervention request" >&2
        exit 1
      }
      wait_for_human_response "${request_id}" || exit 1
      iteration=$((iteration + 1))
      ;;
    TerminalFailure)
      echo "Agent reached TerminalFailure after iteration ${iteration}" >&2
      exit 1
      ;;
    *)
      echo "Agent produced an unsupported outcome after iteration ${iteration}" >&2
      exit 1
      ;;
  esac
done
