---
name: osmo-agent
description: >
  Use the OSMO CLI to manage cloud robotics compute: discover pools, quota,
  GPUs, CPUs, and nodes; submit, list, query, monitor, debug, and explain OSMO
  workflows; inspect workflow logs/status/errors; surface workflow Grafana and
  Kubernetes dashboard links; download outputs; and create OSMO apps from
  workflows. Use when the user asks about available resources, pools, quota,
  workflow submission/status/logs, failed/PENDING/stuck workflows, OSMO errors,
  OSMO apps, recent submissions, or workflow dashboard links, even if they do
  not say "OSMO" explicitly. Do not use for general Kubernetes setup unrelated
  to an OSMO workflow, NVIDIA hardware/product questions unrelated to OSMO,
  non-OSMO compute platforms, or OSMO deployment/install tasks covered by the
  osmo-deploy skill.
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
