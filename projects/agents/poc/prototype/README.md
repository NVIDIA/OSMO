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
  bash -n runtime/run-agent.sh
  python3 -m json.tool runtime-lock.json >/dev/null
  python3 -m json.tool skills/osmo-agentic-workflow/assets/agent-result.schema.json >/dev/null
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
  ! rg -Fq 'agentic_skill_root="${kit_root}/skills/osmo-agentic-workflow"' runtime/run-agent.sh
  ! rg -n 'codex-events\.jsonl' runtime/run-agent.sh
  rg -Fq -- '--dangerously-bypass-approvals-and-sandbox' runtime/run-agent.sh
  ! rg -Fq -- '--ask-for-approval' runtime/run-agent.sh
  test "$(python3 -c 'import json; print(json.load(open("runtime-lock.json"))["agentRuntime"]["osmoUserSkill"]["ref"])')" = "$(sed -n "s/^readonly OSMO_SKILL_REF='\\([0-9a-f]\\{40\\}\\)'$/\\1/p" runtime/run-agent.sh)"
  rg -q '^  result_url: "swift://pdx\.s8k\.io/AUTH_team-osmo/dev/fernandol/agents_poc/' agentic-vla-workflow-spec.yaml
  rg -Fq '{{ goal_prompt | indent(8) }}' agentic-vla-workflow-spec.yaml
  rg -q 'url: "swift://REPLACE_WITH_SWIFT_HOST/REPLACE_WITH_SWIFT_NAMESPACE/REPLACE_WITH_CONTAINER/' skills/osmo-agentic-workflow/assets/child-workflow-template.yaml
  ! rg -n 'https://.*STORAGE_ROOT' agentic-vla-workflow-spec.yaml skills/osmo-agentic-workflow/assets/child-workflow-template.yaml
  rg -Fq '03_IllegalOccupation_020_10FPS.mp4' goal.md
  rg -Fq 'goal_0086_0hz_6sec.mp4' goal.md
  ! rg -n -i '(^|[[:space:]])(auth|access_key|password|token):' goal.md
  test ! -e roles
  ! rg -n -- '--role|--subgoal|ROLE: pipeline|ROLE: lead' agentic-vla-workflow-spec.yaml runtime/run-agent.sh skills/osmo-agentic-workflow
  ! rg -n -i 'orchestratorctl|reservation|submission.?key|goalcontract|pipelinecontract|childrequest|TODO' agentic-vla-workflow-spec.yaml runtime skills
  printf '%s\n' 'static checks passed'
)
```

Expected: the runtime script, JSON configuration, root YAML, child template,
and skill metadata parse locally. It also rejects mutable image references,
credential-value fields, old role selection, and obsolete controller machinery.
This command does not invoke OSMO, Docker, storage, inference, or a network
service.

## Later live activation — prerequisites

| Need | Outcome |
|---|---|
| Public static-kit repository | Every agent clones one public GitHub URL at one full 40-character commit SHA and uses the configured relative kit directory (`.` for repository root). |
| Runtime image | A locally built `linux/amd64` `nvcr.io/nvstaging/osmo/agent-runtime:<tag>` has a resolved digest. |
| OSMO pool and platform | The selected pool can schedule the `lead` resource profile. |
| Output URL | A writable OSMO-supported output location is selected for this run. |
| Credentials | `ngc_cred` pulls the private runtime image; `nvidia_inference` injects `INFERENCE_API_KEY` at task runtime. |

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

```bash
osmo credential set ngc_cred --type REGISTRY \
  --payload registry=nvcr.io username='$oauthtoken' auth="${NGC_API_KEY:?set NGC_API_KEY}"
osmo credential set nvidia_inference --type GENERIC \
  --payload INFERENCE_API_KEY="${INFERENCE_API_KEY:?set INFERENCE_API_KEY}"
```

Expected: OSMO manages the `nvcr.io` image-pull credential outside workflow
YAML; the inference value is injected only at task runtime. Neither secret is
written into this repository or an artifact.

## Later live activation — inspect then submit the entry YAML

```bash
mkdir -p .local
export STATIC_REPOSITORY_URL='https://github.com/<owner>/<repository>.git'
export STATIC_REPOSITORY_REF='<full-40-character-commit-sha>'
export STATIC_REPOSITORY_SUBDIR='projects/agents/poc/prototype'
export AGENT_RUNTIME_IMAGE='nvcr.io/nvstaging/osmo/agent-runtime@sha256:b9f2d724368d91b9e34bcaef15df8555383ad558bea224e6c9fc0c0ac43dc3ff'
export POOL='isaac-dev-l40-03'
export PLATFORM='ovx-l40'
export RUN_ID='<dns-safe-run-id>'
export WORKFLOW_NAME="agentic-vla-$RUN_ID"
export RESULT_URL="swift://pdx.s8k.io/AUTH_team-osmo/dev/fernandol/agents_poc/datasets/vda-poc-two-video-outputs/run-${RUN_ID}/agent/lead/"
export GOAL_PROMPT="$(<./goal.md)"

set_values=(
  --set-string
  "workflow_name=$WORKFLOW_NAME"
  "agent_runtime_image=$AGENT_RUNTIME_IMAGE"
  "goal_prompt=$GOAL_PROMPT"
  "static_repository_url=$STATIC_REPOSITORY_URL"
  "static_repository_ref=$STATIC_REPOSITORY_REF"
  "static_repository_subdir=$STATIC_REPOSITORY_SUBDIR"
  "run_id=$RUN_ID"
  "platform=$PLATFORM"
  "result_url=$RESULT_URL"
)

osmo workflow submit agentic-vla-workflow-spec.yaml --pool "$POOL" \
  --dry-run --format-type json "${set_values[@]}" | tee .local/entry.preview.json
osmo workflow validate agentic-vla-workflow-spec.yaml --pool "$POOL" \
  "${set_values[@]}" | tee .local/entry.validation.txt
```

Expected: OSMO renders and validates one readable lead-task workflow. Nothing
has run yet.

```bash
osmo workflow submit agentic-vla-workflow-spec.yaml --pool "$POOL" \
  --format-type json "${set_values[@]}" | tee .local/entry.submission.json
```

Expected: one lead workflow ID. The lead owns dynamic delegation; do not submit
child workflows manually. Every child embeds a bounded, task-scoped `AGENTS.md`
in its YAML, is previewed and validated, then is submitted and reconciled by
its owning agent. A retry uses a new child YAML only after the agent has queried
the previous child and found it terminal.
