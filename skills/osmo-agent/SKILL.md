---
name: osmo-agent
description: >
  Use the OSMO CLI for cloud robotics compute. Trigger on requests about
  resources (pools, quota, GPUs, CPUs, nodes); workflow
  submit/list/query/status/monitor/debug/explain; recent submissions; logs or
  errors; failed, PENDING, queued, or stuck workflows; output downloads;
  workflow apps; or Grafana/Kubernetes dashboard links. Also use when the user
  omits "OSMO" but asks about resources or workflows here. Do not use for
  Kubernetes admin, OSMO install/deploy, non-OSMO compute, or general NVIDIA
  hardware.
---

# osmo-agent

Run OSMO CLI workflows from natural-language requests. Keep this file as a
router: load only the reference files needed for the current task.

## Operating Rules

- Read `references/cli-workflows.md` before running any `osmo` command; it
  routes each intent to the relevant command reference.
- Do not guess command names or flags from memory. Use the linked reference for
  the user's use case, then run the commands yourself.
- Obtain workflow and resource state (status, logs, events, capacity, spec) by
  running the `osmo` CLI yourself. Do not infer OSMO state by reading, cat-ing,
  or grepping files in the workspace — run the command and use its output.
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
- Do not edit server-side OSMO configuration (`osmo config`): pod or group
  templates, resource validations, pool/backend config, roles, or dataset
  buckets. That is the OSMO admin surface — say it is out of scope and do not
  attempt it here.

## Default Workflow

1. Classify the user request into one intent in "Routing Examples" or
   "Reference Routing".
2. Read only `references/cli-workflows.md` plus the selected reference files.
3. Confirm `osmo --version` before the first OSMO command in the conversation.
4. Run the OSMO commands yourself unless the selected reference says to spawn a
   subagent.
5. Summarize the result in the user's terms: available capacity, workflow state,
   progress, error cause, dashboard link, output, or next action.
6. For submit/monitor/fix loops, keep monitoring in the main conversation and
   delegate only setup, submission, or log summarization as directed.

## Routing Examples

Use these as examples of how to choose references. They are route examples, not
complete command recipes.

| User wording | Route | First responsibility |
|---|---|---|
| "What resources are available to me?", "Any H100s free?", "Do I have quota?" | `references/cli-workflows.md`, then `references/resource-check-format.md` | Discover profile/pools and report effective capacity |
| "Show my recent workflows", "What's still running?", "What finished?" | `references/workflow-status.md` | List workflows and summarize status/duration |
| "Is workflow gr00t-train-1 done?", "How is my run going?", "Show progress" | `references/workflow-status.md` | Query workflow, fetch logs, summarize state |
| "How much memory/GPU is it using?", "Open metrics" | `references/workflow-status.md` | Surface `grafana_url`; do not invent live utilization |
| "Give me the Kubernetes dashboard link", "I want to inspect the pod" | `references/workflow-status.md` | Surface `dashboard_url` or say it is unavailable |
| "What does this workflow do?", "Explain this run before I rerun it" | `references/workflow-status.md` | Fetch the templated spec and summarize purpose/image/command/output |
| "Submit workflow.yaml", "Pick a free H100 pool", "No need to ask" | `references/workflow-submit.md` plus resource routing from `references/cli-workflows.md` | Read supplied YAML as-is, choose pool, submit only if authorized |
| "Submit this Jinja workflow with 4 GPUs" | `references/workflow-submit.md` | Preserve Jinja placeholders and pass values at submit time |
| "Generate 1000 Isaac Sim images and submit" | `references/workflow-submit.md`, then `references/cookbook-fetching.md` | Fetch/adapt cookbook workflow and compute run count |
| "Monitor this from submit to completion", "Fix and resubmit if it fails" | `references/workflow-status.md`, then `agents/workflow-expert.md` as directed | Keep final monitoring/reporting in the main conversation |
| "Why is it PENDING/queued/stuck?", "Why won't it schedule?" | `references/workflow-status.md`, then `references/troubleshooting.md` | Compare query/events/spec/resources in plain language |
| "The logs are empty", "Why did it fail?", "Exit code 137/139/143/127" | `references/troubleshooting.md` | Match the failure signature and propose a concrete fix |
| "Create an app from this workflow", "Publish this completed run" | `references/workflow-apps.md` | Create app only from the selected completed workflow |
| "What GPUs does NVIDIA sell?", "How do I deploy OSMO?", "Configure Kubernetes taints", "Edit a pod template / pool quota / `osmo config`" | Do not use this skill | Answer with another skill or general help; do not run `osmo`; server-side config is the OSMO admin surface |

## Error Handling Router

| Problem observed | Action |
|---|---|
| `osmo --version` fails or `osmo` is missing | Tell the user the OSMO CLI is unavailable and stop |
| Authentication or profile error | Ask the user to run `osmo login`; do not retry until they confirm |
| Pool/resource output is empty or ambiguous | Re-check profile/pool access via `references/cli-workflows.md`; state uncertainty instead of guessing |
| `grafana_url` or `dashboard_url` is null | Say the specific link is unavailable; do not omit or fabricate it |
| Logs or events time out or return sparse output | Follow `references/workflow-status.md`; for failures or sparse logs, route to `references/troubleshooting.md` |
| Submission capacity validation error | Use `references/validation-error-recovery.md`; edit only allowed hard-coded `resources` values |
| Workflow is PENDING, queued, stuck, or unschedulable | Use `references/workflow-status.md`, then `references/troubleshooting.md` |
| Workflow failed after a submit/monitor/fix loop | Fetch logs as directed, resume `agents/workflow-expert.md`, and stop after three failures |
| Multi-task logs are needed | Spawn `agents/logs-reader.md` subagents as directed; do not inline all logs |
| App creation fails or the source workflow is not complete | Use `references/workflow-apps.md` and explain the prerequisite or error |
| The request asks for admin-side cluster changes | Do not run commands that edit cluster config, node taints, quota policies, or Kubernetes resources |

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
