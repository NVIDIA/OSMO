# Agent Workflow POC

[agentic-vla-workflow-spec.yaml](agentic-vla-workflow-spec.yaml) is the only
operator-submitted workflow. It starts one lead agent with the overarching
prompt. The lead delegates bounded subgoals to child agents. Each agent may
create a newly rendered, immutable one-task YAML workflow for its own child.
The reusable child-capsule procedure and template live in
[osmo-agentic-workflow](skills/osmo-agentic-workflow/SKILL.md); it relies on
the upstream `osmo-user` skill and existing OSMO CLI rather than a custom
controller.

## Run now — local checks only

```bash
cd /Users/fernandol/Workspace/osmo/external/projects/agents/poc/prototype
(
  set -euo pipefail
  materializer_dir=../model-artifact-materializer
  bash -n runtime/run-agent.sh
  bash -n "$materializer_dir/materialize-model-artifacts.sh"
  python3 -m json.tool runtime-lock.json >/dev/null
  python3 -m json.tool skills/osmo-agentic-workflow/assets/agent-result.schema.json >/dev/null
  python3 -m json.tool skills/osmo-agentic-workflow/assets/human-response.schema.json >/dev/null
  python3 -m json.tool "$materializer_dir/model-artifact-sources-v1.json" >/dev/null
  python3 -c 'from pathlib import Path; path=Path("../model-artifact-materializer/verify-vda-cache.py"); compile(path.read_text(encoding="utf-8"), str(path), "exec")'
  python3 "$materializer_dir/verify-vda-cache.py" --help >/dev/null
  python3 -c 'import json; schema=json.load(open("skills/osmo-agentic-workflow/assets/agent-result.schema.json")); assert set(schema["required"]) == set(schema["properties"]); assert schema["properties"]["nextAction"]["type"] == ["string", "null"]'
  python3 -c 'import json; schema=json.load(open("skills/osmo-agentic-workflow/assets/human-response.schema.json")); assert set(schema["required"]) == set(schema["properties"]); assert schema["properties"]["action"]["const"] == "continue"'
  python3 -c 'import json; source=json.load(open("../model-artifact-materializer/model-artifact-sources-v1.json")); assert source["materializer"]["entrypointVersion"] == "v2"; assert source["publication"]["schemaVersion"] == "v2"; assert source["publication"]["consumerReadinessSchemaVersion"] == "v1"'
  test ! -e runtime/model-catalog.json
  ! rg -n 'model_catalog_json|model-catalog\.json' Dockerfile runtime runtime-lock.json
  ruby -e '
    require "yaml"
    skill = File.read(ARGV.shift)
    match = skill.match(/\A---\n(.*?)\n---\n/m) or abort "invalid skill frontmatter"
    metadata = YAML.safe_load(match[1], permitted_classes: [], aliases: false)
    abort "invalid skill metadata" unless metadata.keys.sort == ["description", "name"] && metadata["name"] == "osmo-agentic-workflow"
    ARGV.each { |path| YAML.load_file(path) }
  ' skills/osmo-agentic-workflow/SKILL.md agentic-vla-workflow-spec.yaml \
    skills/osmo-agentic-workflow/assets/child-workflow-template.yaml \
    skills/osmo-agentic-workflow/agents/openai.yaml
  rg -q '^  agent_runtime_image: ".*@sha256:(REPLACE_WITH_64_HEX|[0-9a-f]{64})"$' agentic-vla-workflow-spec.yaml
  ! rg -n '^[[:space:]]*image:' skills/osmo-agentic-workflow/assets/child-workflow-template.yaml | rg -v '@sha256:(REPLACE_WITH_64_HEX|[0-9a-f]{64})"$'
  ! rg -n -i '(^|[[:space:]])(auth|access_key|password):' agentic-vla-workflow-spec.yaml skills/osmo-agentic-workflow/assets/child-workflow-template.yaml
  rg -q '\$osmo-agentic-workflow' skills/osmo-agentic-workflow/agents/openai.yaml
  rg -Fq "readonly AGENTS_FILE='/run/agent/AGENTS.md'" runtime/run-agent.sh
  rg -Fq 'STATIC_REPOSITORY_SUBDIR' runtime/run-agent.sh agentic-vla-workflow-spec.yaml \
    skills/osmo-agentic-workflow/assets/child-workflow-template.yaml
  rg -Fq 'agentic_workflow_submit:' agentic-vla-workflow-spec.yaml \
    skills/osmo-agentic-workflow/assets/child-workflow-template.yaml
  rg -Fq 'OSMO_AGENTIC_WORKFLOW_TOKEN: OSMO_AGENTIC_WORKFLOW_TOKEN' agentic-vla-workflow-spec.yaml \
    skills/osmo-agentic-workflow/assets/child-workflow-template.yaml
  rg -Fq 'OSMO_SERVICE_URL' runtime/run-agent.sh agentic-vla-workflow-spec.yaml \
    skills/osmo-agentic-workflow/assets/child-workflow-template.yaml
  rg -Fq -- '--control-url' runtime/run-agent.sh agentic-vla-workflow-spec.yaml \
    skills/osmo-agentic-workflow/assets/child-workflow-template.yaml
  rg -Fq 'install -m 0644 "${iteration_result}" "${result_file}"' runtime/run-agent.sh
  rg -Fq 'HumanInterventionRequired)' runtime/run-agent.sh
  rg -Fq 'Agent reached TerminalFailure' runtime/run-agent.sh
  rg -Fq 'Before delegating, reconcile workflow and durable artifact evidence' agentic-vla-workflow-spec.yaml
  rg -Fq 'human-response-<request-id>.json' skills/osmo-agentic-workflow/SKILL.md
  rg -Fq 'CPU-only capsule at `HIGH` priority' goal.md
  rg -Fq 'GPU-requesting deterministic VDA capsule at `LOW` priority' goal.md
  rg -Uq 'all OSMO pools and resource\s+profiles accessible to the user' goal.md
  rg -Fq -- '--priority HIGH' README.md
  rg -Fq 'declared resource profile' skills/osmo-agentic-workflow/SKILL.md
  rg -Fq 'capacity-migration authority' skills/osmo-agentic-workflow/SKILL.md
  rg -Fq '"workflow cancel"' runtime-lock.json
  rg -Fq 'checkpoint:' agentic-vla-workflow-spec.yaml \
    skills/osmo-agentic-workflow/assets/child-workflow-template.yaml
  ! rg -Fq 'agentic_skill_root="${kit_root}/skills/osmo-agentic-workflow"' runtime/run-agent.sh
  ! rg -n 'codex-events\.jsonl' runtime/run-agent.sh
  rg -Fq -- '--json' runtime/run-agent.sh
  rg -Fq 'Agent requested continuation' runtime/run-agent.sh
  rg -Fq 'Return `Retrying` for known non-terminal conditions' skills/osmo-agentic-workflow/SKILL.md
  rg -Fq 'Pass verified evidence by reference' skills/osmo-agentic-workflow/SKILL.md
  rg -Fq 'environmentReadyUrl' skills/osmo-agentic-workflow/SKILL.md goal.md
  rg -Fq 'consumerReadinessVerifier' goal.md "$materializer_dir/materialize-model-artifacts.sh"
  rg -Fq 'AUGMENT_CONFIG' goal.md
  rg -Fq 'it is not a reason to stop after a fixed retry count' goal.md
  rg -Fq 'augmentation caption/prompt inference' goal.md
  rg -Fq 'or `localhost` URL' goal.md
  rg -Fq -- '--dangerously-bypass-approvals-and-sandbox' runtime/run-agent.sh
  ! rg -Fq -- '--ask-for-approval' runtime/run-agent.sh
  test "$(python3 -c 'import json; print(json.load(open("runtime-lock.json"))["agentRuntime"]["osmoUserSkill"]["ref"])')" = "$(sed -n "s/^readonly OSMO_SKILL_REF='\\([0-9a-f]\\{40\\}\\)'$/\\1/p" runtime/run-agent.sh)"
  rg -q '^  result_url: "swift://pdx\.s8k\.io/AUTH_team-osmo/dev/fernandol/agents_poc/' agentic-vla-workflow-spec.yaml
  rg -q '^  control_url: "swift://pdx\.s8k\.io/AUTH_team-osmo/dev/fernandol/agents_poc/' agentic-vla-workflow-spec.yaml
  rg -Fq '{{ goal_prompt | indent(8) }}' agentic-vla-workflow-spec.yaml
  rg -q 'url: "swift://REPLACE_WITH_SWIFT_HOST/REPLACE_WITH_SWIFT_NAMESPACE/REPLACE_WITH_CONTAINER/' skills/osmo-agentic-workflow/assets/child-workflow-template.yaml
  ! rg -n 'https://.*STORAGE_ROOT' agentic-vla-workflow-spec.yaml skills/osmo-agentic-workflow/assets/child-workflow-template.yaml
  rg -Fq '03_IllegalOccupation_020_10FPS.mp4' goal.md
  rg -Fq 'goal_0086_0hz_6sec.mp4' goal.md
  ! rg -Fq 'isaac-dev-l40-03' goal.md README.md
  ! rg -n -i '(^|[[:space:]])(auth|access_key|password|token):' goal.md
  test ! -e roles
  ! rg -n -- '--role|--subgoal|ROLE: pipeline|ROLE: lead' agentic-vla-workflow-spec.yaml runtime/run-agent.sh skills/osmo-agentic-workflow
  ! rg -n -i 'orchestratorctl|reservation|submission.?key|goalcontract|pipelinecontract|childrequest|TODO' agentic-vla-workflow-spec.yaml runtime skills
  printf '%s\n' 'static checks passed'
)
```

Expected: the runtime script, JSON configuration, root YAML, child template,
skill metadata, and VDA materializer sources parse locally. It also confirms
the generic retry, human-control, output-permission, and evidence rules while
rejecting mutable image references, credential-value fields, old role
selection, and obsolete controller machinery. This command does not invoke
OSMO, Docker, storage, inference, or a network service.

## Later live activation — prerequisites

| Need | Outcome |
|---|---|
| Public static-kit repository | Every agent clones one public GitHub URL at one full 40-character commit SHA and uses the configured relative kit directory (`.` for repository root). |
| Runtime image | A locally built `linux/amd64` `nvcr.io/nvstaging/osmo/agent-runtime:<tag>` has a resolved digest. |
| Recovery source revision | The published static-kit commit includes `run-agent.sh`, the generic skill, and the sibling `model-artifact-materializer` v2 source. |
| OSMO pool and platform | An initial visible pool/platform can schedule the `lead` resource profile. The lead selects and records a verified eligible pool/platform for each child capsule. |
| Output URL | A writable OSMO-supported output location is selected for this run. |
| Credentials | `ngc_cred` pulls the private runtime image; `nvidia_inference` injects `INFERENCE_API_KEY`; `agentic_workflow_submit` injects the short-lived OSMO submission token; `swift_osmo_cred` covers the Swift output/control prefix. All values remain runtime-only. |

## Later live activation — build and credentials

```bash
export UBUNTU_BASE='ubuntu:22.04@sha256:<resolved-64-hex-digest>'
export RUNTIME_TAG='nvcr.io/nvstaging/osmo/agent-runtime:<tag>'
docker buildx build --platform linux/amd64 --file Dockerfile \
  --build-arg "UBUNTU_BASE_IMAGE=$UBUNTU_BASE" --tag "$RUNTIME_TAG" --push .
docker buildx imagetools inspect "$RUNTIME_TAG"
```

Expected: one digest-pinned runtime image is available for the lead and every
agent-created child workflow.

Use a new run ID after publishing the recovery source. The lead computes a new
cache lock from that commit's materializer sources and only publishes a new
immutable cache generation; it must not reuse the prior cache prefix.

```bash
osmo credential set ngc_cred --type REGISTRY \
  --payload registry=nvcr.io username='$oauthtoken' auth="${NGC_API_KEY:?set NGC_API_KEY}"
osmo credential set nvidia_inference --type GENERIC \
  --payload INFERENCE_API_KEY="${INFERENCE_API_KEY:?set INFERENCE_API_KEY}"

# One time: create a short-lived OSMO PAT and store its one-time value directly
# in the runtime-only generic credential. Do not print or save the token.
osmo token set agentic-vla-child-submit \
  --expires-at <YYYY-MM-DD> \
  --description 'Recursive workflow submission for agent POC' \
  --format-type json \
  | jq -er '.token' \
  | osmo credential set agentic_workflow_submit --type GENERIC \
      --payload-file OSMO_AGENTIC_WORKFLOW_TOKEN=/dev/stdin
```

Expected: OSMO manages the `nvcr.io` image-pull credential outside workflow
YAML; the inference and OSMO-submission values are injected only at task
runtime. Neither secret is written into this repository or an artifact.

## Later live activation — inspect then submit the entry YAML

```bash
mkdir -p .local
export STATIC_REPOSITORY_URL='https://github.com/<owner>/<repository>.git'
export STATIC_REPOSITORY_REF='<full-40-character-commit-sha>'
export STATIC_REPOSITORY_SUBDIR='projects/agents/poc/prototype'
export OSMO_SERVICE_URL='https://us-west-2-aws.osmo.nvidia.com'
export AGENT_RUNTIME_IMAGE='nvcr.io/nvstaging/osmo/agent-runtime@sha256:098afe976ab1dcc746a06835ad0b7e806eeeb7b410fddd84ad6132a3a8d9c20f'
# Inspect every user-accessible pool, then select the current best fit for the
# small CPU-only lead profile. This is the operator-selected entry placement;
# every agent-created child makes its own fresh best-fit selection.
osmo pool list --mode free --format-type json
export POOL='<initial-eligible-pool>'
osmo resource list --pool "$POOL" --all --format-type json
export PLATFORM='<platform-reported-by-that-pool>'
export RUN_ID='vda-recovery-<dns-safe-unique-suffix>'
export WORKFLOW_NAME="agentic-vla-$RUN_ID"
export RESULT_URL="swift://pdx.s8k.io/AUTH_team-osmo/dev/fernandol/agents_poc/datasets/vda-poc-two-video-outputs/run-${RUN_ID}/agent/lead/"
export CONTROL_URL="${RESULT_URL}control/"
export GOAL_PROMPT="$(<./goal.md)"

set_values=(
  --set-string
  "workflow_name=$WORKFLOW_NAME"
  "agent_runtime_image=$AGENT_RUNTIME_IMAGE"
  "goal_prompt=$GOAL_PROMPT"
  "static_repository_url=$STATIC_REPOSITORY_URL"
  "static_repository_ref=$STATIC_REPOSITORY_REF"
  "static_repository_subdir=$STATIC_REPOSITORY_SUBDIR"
  "osmo_service_url=$OSMO_SERVICE_URL"
  "run_id=$RUN_ID"
  "platform=$PLATFORM"
  "result_url=$RESULT_URL"
  "control_url=$CONTROL_URL"
)

osmo workflow submit agentic-vla-workflow-spec.yaml --pool "$POOL" \
  --dry-run "${set_values[@]}" | tee .local/entry.preview.yaml
osmo workflow validate agentic-vla-workflow-spec.yaml --pool "$POOL" \
  "${set_values[@]}" | tee .local/entry.validation.txt
```

Expected: OSMO renders and validates one readable lead-task workflow. Nothing
has run yet.

```bash
osmo workflow submit agentic-vla-workflow-spec.yaml --pool "$POOL" \
  --priority HIGH --format-type json "${set_values[@]}" | tee .local/entry.submission.json
```

Expected: one lead workflow ID. The lead owns dynamic delegation; do not submit
child workflows manually. Every child embeds a bounded, task-scoped `AGENTS.md`
in its YAML, is previewed and validated, then is submitted and reconciled by
its owning agent at the priority required by its declared resource profile:
`HIGH` for CPU-only capsules and `LOW` for GPU-requesting deterministic VDA
capsules. Before every child submission, its owner compares all pools accessible
to the user and selects the best fit for that capsule; it does not default to
the creator's pool. Every capsule records that selection and its justification.
A retry uses a new child YAML only after the agent has queried the previous
child and found it terminal; an explicitly authorized, non-running
capacity-blocked child may first be canceled without `--force` and replaced on
another eligible pool. Agent JSONL streams to task stdout and stderr during
every Codex iteration; the typed `agent-result.json` and durable workflow
evidence are uploaded to the declared output URL, while a human request
checkpoints only to its paired control URL.

## Later live activation — respond to a genuine ambiguity

The agent does not finish when it returns `HumanInterventionRequired`. Its
native OSMO checkpoint writes a request under `CONTROL_URL`, and the runtime
waits without starting additional Codex turns. Known transient scheduling or
quota conditions use `Retrying`, not this channel.

```bash
osmo data list "$CONTROL_URL" --recursive --no-pager

# Copy the 64-hex ID from human-request-<REQUEST_ID>.json, then inspect it.
export REQUEST_ID='<64-hex-request-id>'
mkdir -p .local/human-control
osmo data download "${CONTROL_URL}human-request-${REQUEST_ID}.json" .local/human-control
jq . ".local/human-control/human-request-${REQUEST_ID}.json"

jq -n \
  --arg request_id "$REQUEST_ID" \
  --arg instruction 'Continue monitoring the existing workflow IDs. Do not submit replacements.' \
  '{schemaVersion:"v1", requestId:$request_id, action:"continue", instruction:$instruction}' \
  > ".local/human-control/human-response-${REQUEST_ID}.json"
osmo data upload "$CONTROL_URL" \
  ".local/human-control/human-response-${REQUEST_ID}.json"
```

Expected: the runtime validates that exact response, adds it to one continuation
turn, and resumes the same bounded task. Never reuse a response file for a
different request ID or put secret values in the request or response.
