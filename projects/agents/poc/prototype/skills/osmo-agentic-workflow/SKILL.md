---
name: osmo-agentic-workflow
description: Create, submit, monitor, and recursively delegate OSMO child workflows for a bounded agent subgoal. Use when an agent must turn part of its goal into a new OSMO workflow, embed a child AGENTS.md, monitor a child, or safely retry a terminal child workflow.
---

# OSMO Agentic Workflow

Use this skill with `osmo-user`. `osmo-user` owns correct OSMO CLI usage;
this skill owns the recursive-agent handoff.

## Bounded child authority

When the task-scoped `AGENTS.md` supplies a bounded child subgoal, own exactly that
subgoal. Plan and execute it, including further bounded delegation when it is
needed. Do not change the parent goal or execute a different subgoal.

Select a domain skill, script, or deterministic worker only from a public
repository pinned to a full commit SHA, and record that source in durable
evidence. Preserve the child template's runtime-image and static-repository
references unless the parent task instructions explicitly supply replacements.

## Create one child

1. Bound the child to one clear subgoal, acceptance criteria, and relevant
   parent evidence. Escalate ambiguity that cannot be resolved safely.
2. Copy `assets/child-workflow-template.yaml` to a new child YAML.
3. Replace every `REPLACE_*` value and write the bounded subgoal into
   `/run/agent/AGENTS.md` in that YAML. Do not put secret values in it.
4. Read the relevant `osmo-user` reference, then use the existing OSMO CLI to
   preview, validate, and submit the child YAML.
5. Persist the returned workflow ID and output URL in the parent result's
   evidence before monitoring it.

## Monitor, recurse, and retry

Use `osmo-user` and the existing CLI to query child state, inspect logs/events
when needed, and collect its output. A child agent may repeat this same
process for a further bounded subgoal.

Before retrying, query the previous child. Create a new immutable child YAML
only after the previous child is terminal. There is no numeric retry limit.

## Boundaries

Do not create hidden sidecars, controller wrappers, state ledgers,
or workflow contracts. The child YAML is the complete immutable
handoff. Do not mutate OSMO pools, quotas, credentials, server configuration,
or Kubernetes resources.

## Assets

- `assets/child-workflow-template.yaml`: copy and complete for each child.
- `assets/agent-result.schema.json`: final response shape for agents.
