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
evidence. Preserve the child template's runtime-image, static-repository URL,
commit SHA, and `STATIC_REPOSITORY_SUBDIR` (use `.` when the kit is at the
repository root) unless the parent task instructions explicitly supply
replacements.

Preserve the `agentic_workflow_submit` credential mapping. Replace the child
template's `REPLACE_WITH_OSMO_SERVICE_HOST` with the parent task's
`OSMO_SERVICE_URL` host. Together they give the child its runtime-only ability
to authenticate to OSMO and recursively delegate; never copy a token value
into YAML, instructions, evidence, or artifacts.

Give every child its own control URL beneath that child's result URL. The
control URL is a non-secret object-storage location for a checkpointed human
request and matched response; it is not inherited from the parent and is not a
credential.

## Pass verified evidence by reference

Pass a parent artifact to a child only as its immutable URL and SHA-256. Put
those two values in the child `AGENTS.md`; do not copy derived fields from the
artifact into prose or reconstruct a URL from a prefix. The child must download
the referenced bytes, verify the SHA-256, parse the verified artifact locally,
and use the fields it contains exactly as written.

For example, an environment handoff passes only `environmentReadyUrl` and
`environmentReadySha256`. A video child verifies that one document, then reads
its exact artifact-root, payload, manifest, result, and lock values from that
document. This rule applies to every artifact type, not only environments.

## Create one child

1. Bound the child to one clear subgoal, acceptance criteria, and relevant
   parent evidence. Escalate ambiguity that cannot be resolved safely.
2. Copy `assets/child-workflow-template.yaml` to a new child YAML.
3. Replace every `REPLACE_*` value and write the bounded subgoal into
   `/run/agent/AGENTS.md` in that YAML. Include immutable parent-evidence URLs
   and SHA-256 values only. Do not put secret values or copied artifact fields
   in it.
4. Read the relevant `osmo-user` reference, then use the existing OSMO CLI to
   preview, validate, and submit the child YAML.
5. Persist the returned workflow ID and output URL in the parent result's
   evidence before monitoring it.

## Monitor, recurse, and retry

Use `osmo-user` and the existing CLI to query child state, inspect logs/events
when needed, and collect its output. A child agent may repeat this same
process for a further bounded subgoal.

Before retrying, query the previous child and reconcile its typed result and
referenced evidence. A terminal OSMO workflow status alone is not a successful
subgoal. Create a new immutable child YAML only after the previous child is
terminal. There is no numeric retry limit.

Return `Retrying` for known non-terminal conditions, including an existing
child that is pending, temporarily out of capacity, or still producing its
declared result. State the exact reconciliation or recovery action in
`nextAction`. The runtime applies a controlled delay before starting another
Codex turn with the prior typed result, so read that result and its evidence
instead of restating the plan or treating prior children as new.

Return `Completed` only after reconciling every child needed for the assigned
acceptance criteria. Return `HumanInterventionRequired` only for an ambiguity
that cannot be resolved safely from the task contract, evidence, and OSMO
state. Its `nextAction` must be a concrete question and the safe choices the
human must decide. The runtime writes a request with a content-derived request
ID to the task's checkpointed control URL, then waits for the matching
`human-response-<request-id>.json`; it does not complete the OSMO task. A
valid response has exactly `schemaVersion: "v1"`, that `requestId`,
`action: "continue"`, and a non-empty `instruction`. The next Codex turn gets
that instruction and continues the same bounded task.

## Boundaries

Do not create hidden sidecars, controller wrappers, state ledgers,
or workflow contracts. The child YAML is the complete immutable
handoff. Do not mutate OSMO pools, quotas, credentials, server configuration,
or Kubernetes resources.

## Assets

- `assets/child-workflow-template.yaml`: copy and complete for each child.
- `assets/agent-result.schema.json`: final response shape for agents.
- `assets/human-response.schema.json`: required operator response shape.
