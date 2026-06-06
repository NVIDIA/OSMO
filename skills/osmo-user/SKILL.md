---
name: osmo-user
description: >
  Drive the OSMO CLI for cloud-robotics compute on behalf of an end user:
  check resources, submit/monitor/debug/explain workflows, fetch logs and
  Grafana/Kubernetes links, inspect direct data storage, manage workflow apps,
  and set workflow credentials.
  Use whenever the user asks about OSMO pools, quota, GPUs, or nodes, or about
  submitting, listing, querying, monitoring, or troubleshooting workflows —
  including failed, PENDING, queued, stuck, or image-pull-blocked workflows, or
  when they ask to inspect or transfer direct storage URIs such as `s3://...`,
  even when they describe a workflow, cluster resource, or storage URI without
  saying "OSMO".
  Do not use for Kubernetes admin, server-side `osmo config` changes, OSMO
  install/deploy, non-OSMO compute, or general NVIDIA hardware questions.
---

# osmo-user

Run OSMO CLI workflows from natural-language requests. Keep this file as a
router: load only the reference files needed for the current task.

## Prerequisites

Before the first OSMO command in a conversation:

0. For cancel/delete/force/destructive requests, ask for explicit confirmation
   before running any `osmo` command, including `osmo --version` or query
   commands. After confirmation, continue with the checks below.
1. Confirm the CLI is available: `osmo --version`. If it fails, tell the user
   the OSMO CLI is unavailable and stop.
2. If any command returns an authentication error, ask the user to run
   `osmo login` and stop until they confirm.
3. Resource and workflow operations rely on the user's profile and pool access
   (`osmo profile list`, `osmo pool list`).

## Operating Rules

- Classify the request using the Reference Routing section below, then load only
  the reference file(s) it names before running commands.
- Do not guess command names or flags from memory. Use the linked reference for
  the user's use case, then run the commands yourself.
- Obtain workflow and resource state (status, logs, events, capacity, spec) by
  running the `osmo` CLI yourself. Do not infer OSMO state by reading, cat-ing,
  or grepping files in the workspace — run the command and use its output.
- Never fabricate command output; report only what the `osmo` commands actually returned.
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

1. Complete the Prerequisites above (CLI check, auth, profile/pool access)
   before the first OSMO command.
2. Classify the request and read only the reference file(s) named in the
   Reference Routing section below.
3. Run the `osmo` commands yourself — cache the query JSON and never infer state
   from workspace files — unless the selected reference says to spawn a subagent.
4. Verify the outputs before reporting: surface `grafana_url`/`dashboard_url`
   (or say a null one is unavailable), confirm returned workflow IDs, and check
   status and exit codes.
5. Summarize in the user's terms: available capacity, workflow state, progress,
   error cause and concrete fix, dashboard link, output, or next action.
6. For submit -> monitor -> fix loops, keep monitoring and final reporting in
   the main conversation; delegate only setup, submission, or log summarization.

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

### `references/cli-commands.md`
Safe end-user OSMO command lookup when no dedicated reference applies.
- "Check whether I can read from s3://...", "Download this s3:// path", "What is the command for data download?", "How do I list direct storage?", "Set my default pool" — use this for auth/version/profile/data/task syntax.
- For workflow, app, credential, resource, or troubleshooting details, follow this file's routing to the dedicated reference.
- If the requested command is `osmo config`, `osmo user`, role/bucket/admin mutation, or Kubernetes administration, treat it as out of scope.

### `references/workflow-commands.md`
Workflow submit/list/query/log/event/spec subcommand and flag lookup.
- "Validate this workflow", "Dry run it", "What flags does workflow list support?", "How do I fetch logs?", "Show the rendered spec"
- Use for command syntax only; use `references/workflow-submit.md`, `references/workflow-status.md`, or `references/troubleshooting.md` for procedures.

### `references/workflow-runtime-commands.md`
Live workflow runtime operations.
- "Cancel workflow X", "Exec into task Y", "Port-forward task Z", "Rsync files into this workflow", "Add a tag to this workflow"
- Ask for confirmation before cancellation and other destructive operations. A
  bare request like "Cancel workflow X" is not confirmation.

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
- For private-image pull failures, establish the failure here, then read `references/workflow-registry-credentials.md`.

### `references/workflow-credentials.md`
Workflow credential types and generic/data credential setup: `REGISTRY` overview, `GENERIC` for task secrets, and `DATA` for object-storage access.
- "What credential type do I need?", "Set an API token", "Set a data credential" — check existing credentials and create only the needed workflow credential.
- Never print secret values; prefer environment variables and ask for secrets only after automatic sources are exhausted.

### `references/workflow-registry-credentials.md`
Private image-pull and registry credential setup.
- "Use this private nvcr.io image", "Set up NGC credentials", "Create an OSMO registry credential", "ImagePullBackOff unauthorized", "pull access denied" — check existing registry credentials and create or fix only the needed OSMO registry credential.
- Registry image-pull credentials are managed by OSMO outside workflow YAML.

### `references/validation-error-recovery.md`
Submission capacity validation errors.
- `osmo workflow submit` returns a capacity validation error — edit only the allowed hard-coded `resources` values and resubmit.

### `references/workflow-apps.md`
Workflow app lifecycle.
- "Create an app from this workflow", "Publish this completed run", "List apps", "Show app parameters", "Update app", "Submit app", "Rename/delete app" — use the app lifecycle reference.
- Ask for confirmation before create/update/submit/rename/delete unless the user already clearly authorized the action.

### `references/workflow-spec.md`
Workflow YAML schema and field shapes.
- "Is this workflow YAML valid?", "Add files/environment/resources", "What shape do tasks/resources/groups use?" — use this as a compact field map.
- For URL inputs/outputs, also read `references/workflow-io-spec.md`; for topology placement, also read `references/workflow-advanced-patterns.md`.
- For design examples, continue to `references/workflow-patterns.md`; for checkpointing/topology/node exclusion, continue to `references/workflow-advanced-patterns.md`.

### `references/workflow-io-spec.md`
Workflow data flow, runtime tokens, and Jinja parameter fields.
- "Where does `default-values` go?", "What shape do inputs/outputs use?", "How do `{{output}}` or `{{input:0}}` work?", "How do I use `--set`?" — use this as the compact IO/template map.
- For full workflow design examples, continue to `references/workflow-patterns.md`.

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
- "What GPUs does NVIDIA sell?", "How do I deploy OSMO?", "Set up AKS / Kubernetes / NIM Operator infrastructure", "Configure Kubernetes taints", "Edit a pod template / pool quota / `osmo config`" — answer with general help or another skill; do not run `osmo`. Server-side config, cluster admin, and infrastructure scaffolding are outside this skill.
