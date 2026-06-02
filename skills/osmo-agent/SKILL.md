---
name: osmo-agent
description: >
  Use the OSMO CLI for cloud robotics compute. Use when the user asks about
  accessible pools, quota, GPUs, CPUs, or nodes; workflow
  submit/list/query/monitor/debug/explain; logs, errors, failed, PENDING, or
  stuck workflows; output downloads; workflow apps; or Grafana/Kubernetes
  dashboard links. Do not use for general Kubernetes admin, OSMO
  install/deploy, non-OSMO compute, or general NVIDIA hardware questions.
---

# osmo-agent

Run OSMO CLI workflows from natural-language requests. Keep this file as a
router: load only the reference files needed for the current task.

## Operating Rules

- Read `references/cli-workflows.md` before running any `osmo` command; it
  routes each intent to the relevant command reference.
- Do not guess command names or flags from memory. Use the linked reference for
  the user's use case, then run the commands yourself.
- If `osmo --version` fails, tell the user the OSMO CLI is not available and
  stop. Never fabricate command output.
- If an `osmo` command returns an auth error, ask the user to run `osmo login`
  and stop until they confirm.
- Cache workflow query JSON during the conversation; do not re-query just to
  extract another field from the same response.
- Surface `grafana_url` and `dashboard_url` according to
  `references/workflow-status.md`; if either value is null, say it is
  unavailable instead of omitting it.
- Do not edit cluster config, node taints, quota policies, or non-OSMO
  Kubernetes resources. Those are admin-side operations.

## Routing Examples

Use these as examples of how to choose references; do not treat them as complete
command recipes.

| User asks | Route |
|---|---|
| "What GPUs can I use right now?" | `references/cli-workflows.md`, then `references/resource-check-format.md` |
| "Show my recent workflows" | `references/workflow-status.md` |
| "Is workflow gr00t-train-1 done? Show progress." | `references/workflow-status.md` |
| "Give me the Grafana or Kubernetes dashboard link" | `references/workflow-status.md` |
| "What does this workflow do?" | `references/workflow-status.md` |
| "Submit this workflow.yaml to a free H100 pool" | `references/workflow-submit.md`, with resource routing from `references/cli-workflows.md` |
| "Submit this Jinja workflow with 4 GPUs" | `references/workflow-submit.md`; pass values at submit time |
| "Generate synthetic data from a cookbook workflow and submit it" | `references/workflow-submit.md`, then `references/cookbook-fetching.md` |
| "Why is my workflow PENDING/stuck/failed?" | `references/workflow-status.md`, then `references/troubleshooting.md` |
| "What GPUs does NVIDIA sell?" | Do not use this skill |

## Error Handling Router

- CLI missing: report that `osmo` is unavailable and stop.
- Auth error: ask the user to run `osmo login`; do not retry until confirmed.
- Command output missing/null: say the specific field is unavailable; do not
  invent values.
- Validation error at submission: use `references/validation-error-recovery.md`.
- Failed, stuck, sparse-log, or PENDING workflow: use
  `references/troubleshooting.md`.
- App creation error: use `references/workflow-apps.md`.

## Reference Routing

Start with `references/cli-workflows.md` for all user intents. Load additional
files only when the current intent requires them:

| User intent | Read |
|---|---|
| Resources, pools, GPUs, quota | `references/cli-workflows.md`, then `references/resource-check-format.md` before responding |
| Submit a supplied or generated workflow | `references/workflow-submit.md` |
| Create or publish an app from a workflow | `references/workflow-apps.md` |
| Workflow structure, multi-task execution, dependencies, Jinja templates, checkpointing, exit/retry behavior, node exclusion, or topology placement | `references/workflow-patterns.md` first; it routes to `references/workflow-advanced-patterns.md` for niche patterns |
| Submission capacity validation errors | `references/validation-error-recovery.md` |
| Status, logs, Grafana links, Kubernetes dashboard links, PENDING diagnosis, completed follow-ups, recent workflows, or workflow explanation | `references/workflow-status.md` |
| Failed, stuck, sparse-log, or misbehaving workflows | `references/troubleshooting.md` |
| End-to-end submit/monitor/fix loops | `references/workflow-status.md`, then spawn or resume `agents/workflow-expert.md` as directed |
| Multi-task log summarization | Spawn `agents/logs-reader.md` subagents as directed |

The `agents/` files are prompts for specialized subagents. Read the relevant
agent file only when the selected reference calls for spawning or resuming that
agent.
