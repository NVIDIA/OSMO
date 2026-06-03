---
name: osmo-user
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

# osmo-user

Run OSMO CLI workflows from natural-language requests. Keep this file as a
router: load only the reference files needed for the current task.

## Operating Rules

- Classify the request using the Reference Routing section below, then load only
  the reference file(s) it names before running commands.
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

1. Classify the user request to a reference using the Reference Routing section
   below.
2. Read only the reference file(s) named by the Reference Routing section below.
3. Confirm `osmo --version` before the first OSMO command in the conversation.
4. Run the OSMO commands yourself unless the selected reference says to spawn a
   subagent.
5. Summarize the result in the user's terms: available capacity, workflow state,
   progress, error cause, dashboard link, output, or next action.
6. For submit/monitor/fix loops, keep monitoring in the main conversation and
   delegate only setup, submission, or log summarization as directed.

## Reference Routing

Classify the request and read only the reference file(s) for the matched intent.
Each heading is a reference file; the bullets under it are the user intents and
example wordings that route there. Error and failure cases are listed under the
reference that handles them. These are routing cues, not complete command recipes.

### `references/resource-check-format.md`
Resources, pools, GPUs, nodes, or quota.
- "What resources are available to me?", "Any H100s free?", "Do I have quota?"
- Discover profile/pool access and report effective capacity (`min(Quota Free, Total Free)`).
- If pool/resource output is empty or ambiguous, re-check access here and state uncertainty instead of guessing.

### `references/workflow-submit.md`
Submit a supplied or generated workflow.
- "Submit workflow.yaml", "Pick a free H100 pool", "No need to ask" — read the supplied YAML as-is, choose a pool (use `references/resource-check-format.md` for pool selection), and submit only if authorized.
- "Submit this Jinja workflow with 4 GPUs" — preserve Jinja placeholders and pass values at submit time.

### `references/cookbook-fetching.md`
Generate a workload from an OSMO cookbook example.
- "Generate 1000 Isaac Sim images and submit" — fetch/adapt the cookbook workflow, compute the run count, then submit via `references/workflow-submit.md`.

### `references/workflow-status.md`
Status, logs, links, live metrics, recent workflows, and workflow explanation.
- "Show my recent workflows", "What's still running?", "What finished?"
- "Is workflow gr00t-train-1 done?", "How is my run going?", "Show progress" — query, fetch logs, summarize state.
- "How much memory/GPU is it using?", "Open metrics" — surface `grafana_url`; do not invent live utilization.
- "Give me the Kubernetes dashboard link", "I want to inspect the pod" — surface `dashboard_url` or say it is unavailable.
- "What does this workflow do?", "Explain this run before I rerun it" — fetch the templated spec and summarize purpose/image/command/output.
- "Why is it PENDING/queued/stuck?", "Why won't it schedule?" — establish state here, then `references/troubleshooting.md`.
- Logs or events are sparse or time out — establish state here; for failures route to `references/troubleshooting.md`.

### `references/troubleshooting.md`
Failed, stuck, sparse-log, or misbehaving workflows.
- "The logs are empty", "Why did it fail?", "Exit code 137/139/143/127" — match the failure signature and propose a concrete fix.

### `references/validation-error-recovery.md`
Submission capacity validation errors.
- `osmo workflow submit` returns a capacity validation error — edit only the allowed hard-coded `resources` values and resubmit.

### `references/workflow-apps.md`
Create or publish an app from a workflow.
- "Create an app from this workflow", "Publish this completed run" — create the app only from the selected completed workflow.
- App creation fails or the source workflow is not complete — explain the prerequisite or error.

### `references/workflow-patterns.md`
Workflow structure and authoring patterns.
- Workflow structure, multi-task execution, dependencies, Jinja templates, checkpointing, exit/retry behavior, node exclusion, or topology placement — start here; it routes to `references/workflow-advanced-patterns.md` for niche patterns.

### `references/workflow-expert.md` (subagent prompt)
End-to-end submit / monitor / fix loops.
- "Monitor this from submit to completion", "Fix and resubmit if it fails" — spawn or resume this subagent for setup/submission; keep final monitoring and reporting in the main conversation. After a failed loop, fetch logs as directed, resume the subagent, and stop after three failures.

### `references/logs-reader.md` (subagent prompt)
Multi-task log summarization.
- A workflow has two or more tasks and logs are needed — spawn `logs-reader` subagents as directed; do not inline all logs.

### When NOT to use this skill
- "What GPUs does NVIDIA sell?", "How do I deploy OSMO?", "Configure Kubernetes taints", "Edit a pod template / pool quota / `osmo config`" — answer with general help or another skill; do not run `osmo`. Server-side config and cluster admin are the OSMO admin surface.
