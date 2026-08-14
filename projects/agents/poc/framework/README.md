# OSMO Agentic Workflow Framework

This is the reusable product surface for a long-lived OSMO agent that plans,
delegates, reconciles, and safely retries bounded child workflows. It contains
the runtime contract, generic recursive-workflow skill, typed result/control
schemas, child-workflow template, and one generic entry capsule.

It intentionally contains no domain workflow, worker image, input data,
model-cache, output contract, or domain-specific scheduling policy. A task
loads a public, commit-pinned domain skill only when its task-scoped
`AGENTS.md` explicitly requires one.

## Contents

- [agentic-workflow-spec.yaml](agentic-workflow-spec.yaml): the one
  operator-submitted lead capsule.
- [skills/osmo-agentic-workflow](skills/osmo-agentic-workflow): generic child
  creation, evidence, reconciliation, retry, and human-control rules.
- [runtime/run-agent.sh](runtime/run-agent.sh): the generic runtime entrypoint.

## Local static checks

```bash
cd /Users/fernandol/Workspace/osmo/external/projects/agents/poc/framework
(
  set -euo pipefail
  bash -n runtime/run-agent.sh
  test "$(find skills -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" = 1
  test -d skills/osmo-agentic-workflow
  python3 -m json.tool runtime-lock.json >/dev/null
  python3 -m json.tool skills/osmo-agentic-workflow/assets/agent-result.schema.json >/dev/null
  python3 -m json.tool skills/osmo-agentic-workflow/assets/human-response.schema.json >/dev/null
  python3 -c 'import json; schema=json.load(open("skills/osmo-agentic-workflow/assets/agent-result.schema.json")); assert set(schema["required"]) == set(schema["properties"])'
  python3 -c 'import json; schema=json.load(open("skills/osmo-agentic-workflow/assets/human-response.schema.json")); assert schema["properties"]["action"]["const"] == "continue"'
  ruby -e '
    require "yaml"
    skill = File.read(ARGV.shift)
    match = skill.match(/\A---\n(.*?)\n---\n/m) or abort "invalid skill frontmatter"
    metadata = YAML.safe_load(match[1], permitted_classes: [], aliases: false)
    abort "invalid skill metadata" unless metadata.keys.sort == ["description", "name"] && metadata["name"] == "osmo-agentic-workflow"
    ARGV.each { |path| YAML.load_file(path) }
  ' skills/osmo-agentic-workflow/SKILL.md agentic-workflow-spec.yaml \
    skills/osmo-agentic-workflow/assets/child-workflow-template.yaml \
    skills/osmo-agentic-workflow/agents/openai.yaml
  rg -q '^  agent_runtime_image: ".*@sha256:(REPLACE_WITH_64_HEX|[0-9a-f]{64})"$' agentic-workflow-spec.yaml
  ! rg -n '^[[:space:]]*image:' skills/osmo-agentic-workflow/assets/child-workflow-template.yaml | rg -v '@sha256:(REPLACE_WITH_64_HEX|[0-9a-f]{64})"$'
  ! rg -n -i '(^|[[:space:]])(auth|access_key|password):' agentic-workflow-spec.yaml skills/osmo-agentic-workflow/assets/child-workflow-template.yaml
  rg -Fq 'STATIC_REPOSITORY_SUBDIR' runtime/run-agent.sh agentic-workflow-spec.yaml skills/osmo-agentic-workflow/assets/child-workflow-template.yaml
  rg -Fq 'agentic_workflow_submit:' agentic-workflow-spec.yaml skills/osmo-agentic-workflow/assets/child-workflow-template.yaml
  rg -Fq 'There is no numeric retry limit' skills/osmo-agentic-workflow/SKILL.md
  rg -Fq 'human-response-<request-id>.json' skills/osmo-agentic-workflow/SKILL.md
  rg -Fq -- '--dangerously-bypass-approvals-and-sandbox' runtime/run-agent.sh
  ! rg -Fq -- '--ask-for-approval' runtime/run-agent.sh
  test "$(python3 -c 'import json; print(json.load(open("runtime-lock.json"))["agentRuntime"]["osmoUserSkill"]["ref"])')" = "$(sed -n "s/^readonly OSMO_SKILL_REF='\([0-9a-f]\{40\}\)'$/\1/p" runtime/run-agent.sh)"
  rg -q '^  result_url: "swift://pdx\.s8k\.io/AUTH_team-osmo/dev/fernandol/agents_poc/agentic-workflows/' agentic-workflow-spec.yaml
  rg -q '^  control_url: "swift://pdx\.s8k\.io/AUTH_team-osmo/dev/fernandol/agents_poc/agentic-workflows/' agentic-workflow-spec.yaml
  rg -Fq '{{ goal_prompt | indent(8) }}' agentic-workflow-spec.yaml
  printf '%s\n' 'framework static checks passed'
)
```

These checks are local only: they do not call OSMO, storage, inference, or
Docker.

## Activate a domain goal

Use a public repository and full commit SHA for both this framework and any
domain skill. The task-scoped goal names the domain-skill repository, commit,
and path, then directs the lead to read that skill before planning or
delegating. The framework does not implicitly discover or load domain skills.

```bash
export STATIC_REPOSITORY_URL='https://github.com/NVIDIA/OSMO.git'
export STATIC_REPOSITORY_REF='<full-40-character-commit-sha>'
export STATIC_REPOSITORY_SUBDIR='projects/agents/poc/framework'
export AGENT_RUNTIME_IMAGE='nvcr.io/nvstaging/osmo/agent-runtime@sha256:098afe976ab1dcc746a06835ad0b7e806eeeb7b410fddd84ad6132a3a8d9c20f'
export OSMO_SERVICE_URL='https://us-west-2-aws.osmo.nvidia.com'
export RUN_ID='agentic-<dns-safe-unique-suffix>'
export WORKFLOW_NAME="agentic-${RUN_ID}"
export RESULT_URL="swift://pdx.s8k.io/AUTH_team-osmo/dev/fernandol/agents_poc/agentic-workflows/run-${RUN_ID}/agent/lead/"
export CONTROL_URL="${RESULT_URL}control/"
export GOAL_PROMPT='<bounded goal with an explicit domain-skill source when needed>'

set_values=(
  --set-string "workflow_name=$WORKFLOW_NAME"
  --set-string "agent_runtime_image=$AGENT_RUNTIME_IMAGE"
  --set-string "goal_prompt=$GOAL_PROMPT"
  --set-string "static_repository_url=$STATIC_REPOSITORY_URL"
  --set-string "static_repository_ref=$STATIC_REPOSITORY_REF"
  --set-string "static_repository_subdir=$STATIC_REPOSITORY_SUBDIR"
  --set-string "osmo_service_url=$OSMO_SERVICE_URL"
  --set-string "run_id=$RUN_ID"
  --set-string 'platform=<visible-compatible-platform>'
  --set-string "result_url=$RESULT_URL"
  --set-string "control_url=$CONTROL_URL"
)

osmo workflow submit agentic-workflow-spec.yaml --pool '<eligible-pool>' --dry-run "${set_values[@]}"
osmo workflow validate agentic-workflow-spec.yaml --pool '<eligible-pool>' "${set_values[@]}"
osmo workflow submit agentic-workflow-spec.yaml --pool '<eligible-pool>' --priority HIGH --format-type json "${set_values[@]}"
```

The operator submits only the lead. The lead and descendants own domain
planning, child construction, pool selection, reconciliation, and replacement.
