---
name: osmo-agent
description: >
  Operate the OSMO CLI to discover GPU resources, submit and monitor workflows,
  debug PENDING/FAILED/stuck workflows, interpret OSMO errors, and publish workflows
  as OSMO apps. Trigger when the user asks about OSMO pools, quota, GPUs, workflow
  status/logs/submission, OSMO errors, or OSMO apps — even if they don't say "OSMO"
  explicitly. Do NOT use for kubectl, Kubernetes, NVIDIA hardware, or non-OSMO
  platforms.
version: "1.0.0"
author: nvidia
tags: [osmo, cli, workflows, gpu-compute, debugging]
tools: [Bash, Read, Write, Edit, WebFetch, Task]
license: Apache-2.0
compatibility: >
  Requires osmo CLI installed and authenticated (osmo login).
---

# osmo-agent

## Purpose

Run, monitor, and debug OSMO workflows from natural-language requests. OSMO is
NVIDIA's cloud platform for robotics compute and data storage; this skill maps
user requests to the right `osmo` CLI commands and walks the user through failure
diagnosis when workflows go wrong.

## Prerequisites

- `osmo` CLI installed and on `PATH` (verify: `osmo --version`).
- Authenticated session (`osmo login`). If commands return auth errors, the user must
  re-run `osmo login` themselves.
- Profile has access to at least one ONLINE pool (verify: `osmo profile list` and
  `osmo pool list`).

## Limitations

- No live GPU/CPU/memory utilization via the CLI — point the user to the
  workflow's Grafana dashboard for live metrics.
- Workflows cannot be edited after submission. Cancel and resubmit a corrected
  version instead.
- Only OSMO-managed clusters are supported. For other Kubernetes platforms, the
  user needs `kubectl` or that platform's own tooling.
- `grafana_url` and `dashboard_url` can be `null` for workflows that haven't
  started yet or completed long enough ago that metrics were retired. Surface as
  "not available" — never silently omit.
- The skill does not edit cluster config, node taints, or quota policies — those
  are admin-side operations.

## Reference Files

The `agents/` directory contains instructions for specialized subagents. Read them when you need to spawn the relevant subagent.

- `agents/workflow-expert.md` — workflow generation, resource check, submission, failure diagnosis
- `agents/logs-reader.md` — log fetching and summarization for monitoring and failure diagnosis

The `references/` directory has additional documentation:

- `references/workflow-patterns.md` — Multi-task, parallel execution, data dependencies, Jinja templating
- `references/advanced-patterns.md` — Checkpointing, retry/exit behavior, node exclusion
- `references/cookbook-fetching.md` — How to fetch a cookbook example and decide submission count
- `references/resource-check-format.md` — Output format spec for resource availability responses
- `references/troubleshooting.md` — Catalog of common failure modes, exit codes, and fixes
- `references/validation-error-recovery.md` — Resource sizing rules when submission fails capacity assertions
- `references/workflow-status-handling.md` — Link rendering, PENDING diagnosis, post-completion follow-ups

## Instructions

Pick the matching use case below by the user's intent (see Intent Routing), follow
its steps in order, and consult the linked reference file when the steps say so.
For diagnosing failures, jump straight to "Debug a Failed or Stuck Workflow" or
the Troubleshooting section near the bottom.

### Intent Routing

- Asks about resources, pools, GPUs, or quota → Check Available Resources
- Wants to submit a job (simple, no monitoring) → Generate and Submit a Workflow
- Wants to submit + monitor + handle failures → Orchestrate a Workflow End-to-End
- Asks about a workflow's status or logs → Check Workflow Status
- Lists recent workflows → List Workflows
- Asks why a workflow failed, is stuck, or how to fix an OSMO error → Debug a Failed or Stuck Workflow
- Asks what a workflow does → Explain What a Workflow Does
- Wants to publish a workflow as an app → Create an App

## Use Case: Check Available Resources

**When to use:** The user asks what resources, nodes, GPUs, or pools are available
(e.g. "what resources are available?", "what nodes can I use?", "do I have GPU quota?",
"what pools do I have access to?").

1. **Check accessible pools** — run to see which pools the user's profile has access to:
   ```
   osmo profile list
   ```
   This returns the user's profile settings, including which pools they belong to.

2. **Check pool resources** — run to see GPU availability across all accessible pools:
   ```
   osmo pool list
   ```
   By default this shows used/total GPU counts. To see what's free instead:
   ```
   osmo pool list --mode free
   ```

### Reading the output and formatting the response

Effective availability = `min(Quota Free, Total Free)` — both quota and physical
limits apply. Always highlight any **LOW-priority opportunity**: when a pool has
`Quota Free = 0` but `Total Free > 0`, the user can still submit with
`--priority LOW` to run on idle capacity (with preemption risk).

`references/resource-check-format.md` is required reading before generating the
response — it defines column meanings, the grouped-table layout, sorting,
callouts, and GPU-type derivation rules.

## Use Case: Generate and Submit a Workflow

**When to use:** The user wants to submit a job to run on OSMO (e.g. "submit a workflow
to run SDG", "run RL training for me", "submit this yaml to OSMO").

If the user also wants monitoring, debugging, or reporting results, use the
"Orchestrate a Workflow End-to-End" use case instead.

1. **Get or generate a workflow spec.**

   If the user provides a workflow YAML, use it as-is. Otherwise, generate one based on
   what they want to run. Write the spec to `workflow.yaml` in the current directory.

   **When generating a workflow spec:**
   - Prefer adapting an existing example from the OSMO cookbook over writing from
     scratch. The procedure for fetching a cookbook example, preserving Jinja
     template variables, and computing submission count from throughput metadata is
     in `references/cookbook-fetching.md`. Read it before generating.
   - If the workflow involves **multiple tasks, parallel execution, data dependencies
     between tasks, or Jinja templating**, read `references/workflow-patterns.md` for
     the correct spec patterns.
   - If the user asks for **checkpointing, retry/exit behavior, or node exclusion**,
     read `references/advanced-patterns.md`.
   - If no cookbook example matches, fall back to the scaffold template at the
     bottom of `references/cookbook-fetching.md`. Use `{{output}}` as the
     placeholder for the output mount path — OSMO substitutes it at runtime.

2. **Ask the user what GPU type they want** (e.g. H100, L40, GB200), then check
   availability using the steps in the "Check Available Resources" use case to confirm
   the right pool to use.

3. **Ask the user for confirmation with this exact wording:**
   `Would you like me to submit this workflow to this pool?`
   Then execute the command yourself — do not tell the user to run it. Once confirmed, run:
   ```
   osmo workflow submit workflow.yaml --pool <pool_name> --set key=value other_key=value
   ```
   Include `--set` only when the workflow has Jinja template variables to override
   (e.g. `--set num_gpu=4`). Omit it if the YAML has no template variables.
   If the user wants to run the same workflow multiple times (e.g. "submit 2 of these"),
   submit the same YAML file multiple times — do not create duplicate YAML files.
   Report each workflow ID returned by the CLI so the user can track them.

   **When quota is exhausted but GPUs are physically free (Quota Free = 0, Total Free > 0):**
   Offer to submit with `--priority LOW`, which bypasses quota limits and schedules on
   idle capacity. LOW priority jobs may be preempted if quota-holding jobs need those
   GPUs, so let the user know before proceeding. If they agree, run:
   ```
   osmo workflow submit workflow.yaml --pool <pool_name> --priority LOW
   ```

   **Validation errors:** If submission fails with a validation error indicating that
   resources failed assertions, read the node capacity values from the error table,
   adjust the hard-coded values in the `resources` section of `workflow.yaml`, and
   resubmit. The exact sizing rules (storage/memory/CPU caps, GPU pairing, proportional
   scaling) are in `references/validation-error-recovery.md`. Do not touch Jinja
   template variables like `{{num_gpu}}` — those are resolved at runtime via `--set`.

## Use Case: List Workflows

**When to use:** The user wants to see all their workflows or recent submissions (e.g.
"what are my workflows?", "show me my recent jobs", "what's the status of my workflows?").

1. **List all workflows:**
   ```
   osmo workflow list --format-type json
   ```

2. **Summarize results** in a table showing workflow name, pool, status, and duration.
   Group or sort by status if helpful. Use clear symbols to indicate outcome:
   - ✅ COMPLETED
   - ❌ FAILED / FAILED_CANCELED / FAILED_EXEC_TIMEOUT / FAILED_SERVER_ERROR
   - 🔄 RUNNING
   - ⏳ PENDING

## Use Case: Check Workflow Status

**When to use:** The user asks about the status or logs of a workflow (e.g. "what's
the status of workflow abc-123?", "is my workflow done?", "show me the logs for xyz",
"show me the resource usage for my workflow", "give me the Kubernetes dashboard link").
Also used as the polling step during end-to-end orchestration.

1. **Query the workflow:**
   ```
   osmo workflow query <workflow name> --format-type json
   ```
   Cache the JSON for the rest of the conversation — do not re-query just to extract
   a field.

2. **Fetch logs** based on task count:
   - **1 task:** inline with `osmo workflow logs <workflow_id> -n 10000`.
   - **2+ tasks:** delegate to `agents/logs-reader.md` subagents (one per 5 tasks).
     Do not fetch logs inline yourself in the main conversation.

3. **Report to the user.** State the current status, summarize logs concisely, and
   include the Grafana and Kubernetes dashboard links by default for detailed
   reports. Exact phrasing for link rendering, null handling, and resource-usage
   triggers is in `references/workflow-status-handling.md`. If the status is
   `PENDING`, follow that reference's pending-diagnosis steps (events + resource
   list, translated to plain language).

4. **For COMPLETED workflows**, offer the output dataset download and proactively
   suggest creating an OSMO app from the workflow. Exact prompts, name suggestion
   rules, and batch-monitoring behavior are in
   `references/workflow-status-handling.md`.

## Use Case: Orchestrate a Workflow End-to-End

**When to use:** The user wants to create a workflow, submit it, and monitor it to
completion (e.g. "train GR00T on my data", "submit and monitor my workflow",
"run end-to-end training", "submit this and tell me when it's done").

The lifecycle is split between the `workflow-expert` subagent (workflow generation,
resource check, submission, failure diagnosis) and **you** (live monitoring so the
user sees real-time updates).

1. **Spawn the workflow-expert subagent for setup and submission.**

   Ask it to **write workflow YAML if needed, check resources, and submit only**.
   Do NOT ask it to monitor, poll status, or report results — that is your job.

   Example prompt:
   > Create a workflow based on user's request, if any. Check resources first,
   > then submit the workflow to an available resource pool. Return the workflow
   > ID when done.

   The subagent returns: workflow ID, pool name, and OSMO Web link.

2. **Monitor the workflow inline (you do this — user sees live updates).**

   Use the "Check Workflow Status" use case to poll and report. Repeat until a
   terminal state is reached. Adjust the polling interval based on how long you
   expect the workflow to take — poll more frequently for short jobs (every 10-15s)
   and less frequently for long training runs (every 30-60s). Report each state
   transition to the user:
   - `Status: SCHEDULING (queued 15s)`
   - `Workflow transitioned: SCHEDULING → RUNNING`
   - `Status: RUNNING (task "train" active, 2m elapsed)`

3. **Handle the outcome.**

   **If COMPLETED:** Report results — workflow ID, OSMO Web link, output datasets.
   Then follow Step 4 of "Check Workflow Status" (download offer + app creation).

   **If FAILED:** First, fetch logs using the log-fetching rule from "Check Workflow
   Status" Step 2 (1 task = inline, 2+ tasks = delegate to logs-reader subagents).
   Then resume the `workflow-expert` subagent (use the `resume` parameter with the
   agent ID from Step 1) and pass the logs summary: "Workflow <id> FAILED. Here is
   the logs summary: <summary>. Diagnose and fix." It returns a new workflow ID.
   Resume monitoring from Step 2. Max 3 retries before asking the user for guidance.

## Use Case: Debug a Failed or Stuck Workflow

**When to use:** The user asks why a workflow failed, why it's stuck, or how to fix
an OSMO error (e.g. "my workflow keeps failing", "what does this OSMO error mean?",
"my pod won't start", "training crashed with exit 137", "image pull keeps failing").
This is the manual debugging path. If the user wants you to also fix and resubmit
automatically, use "Orchestrate a Workflow End-to-End" instead.

1. **Establish current state.** Run the steps from "Check Workflow Status" to get
   the workflow's status, recent logs, and (for PENDING workflows) events. Cache the
   query JSON so you don't re-fetch.

2. **Match the symptom.** Open `references/troubleshooting.md` and look up the
   matching pattern by symptom — exit code, error keyword, status, or behavior.
   Common patterns covered there:
   - `PENDING` for an unusually long time (scheduling block, quota exhausted)
   - Exit code `137` (OOM kill), `139` (segfault), `143` (SIGTERM / preempted), `127`
     (command not found)
   - `ImagePullBackOff` / `ErrImagePull`
   - `Init:CrashLoopBackOff` (init container failure)
   - NCCL / multi-GPU communication timeouts
   - Output dataset empty or missing after COMPLETED
   - Validation rejection at submit time (see also
     `references/validation-error-recovery.md`)

3. **Explain the diagnosis in plain language.** State the root cause without raw
   Kubernetes jargon. Say "the container ran out of memory and was killed" rather
   than "exit 137 / OOMKilled". If multiple causes are plausible from the logs, list
   them in order of likelihood and explain how to confirm each.

4. **Recommend a concrete fix.** Pull the fix recipe from the matched troubleshooting
   pattern. If the fix involves editing `workflow.yaml`, show the user the exact diff
   you would apply. Do not edit the YAML without confirmation unless the user
   pre-authorized you to fix-and-resubmit.

5. **Offer to apply the fix and resubmit.** Ask the user whether to apply the fix
   yourself. If they agree, edit `workflow.yaml` per the troubleshooting recipe and
   submit using the steps in "Generate and Submit a Workflow".

### When to escalate

- If the symptom doesn't match any pattern in the troubleshooting reference, gather
  the workflow query JSON, full logs (or per-task logs via `logs-reader` subagent for
  multi-task workflows), and recent events, then ask the user how they want to
  proceed. Do not invent fixes.
- If the same workflow has failed and been resubmitted with fixes 3+ times in this
  conversation, stop auto-retrying and ask the user — repeated failure with patches
  usually indicates a deeper issue (bad image, broken dataset, capacity outage)
  that needs human judgment.

## Use Case: Explain What a Workflow Does

**When to use:** The user asks what a workflow does, what it's configured to run, or
wants to understand its purpose (e.g. "what does workflow abc-123 do?", "explain this
workflow", "what is workflow xyz running?").

1. **Fetch the workflow template:**
   ```
   osmo workflow spec <workflow name> --template
   ```
   This returns the original workflow spec YAML that was used to submit the job,
   including the container image, entrypoint scripts, environment variables, and
   resource requests.

2. **Read and summarize the spec.** Based on the YAML output, give the user a concise
   plain-language summary covering:
   - **What it does**: the high-level task (e.g. "runs SDG data generation using the
     Isaac container", "trains a policy with RL")
   - **How it runs**: the container image, the entrypoint script or command, and any
     notable environment variables that control its behavior
   - **What it produces**: any declared outputs (datasets, artifacts)

   Keep the summary short — a few sentences or a brief bullet list. The user asked
   what it does, not for a line-by-line YAML walkthrough.

## Use Case: Create an App

**When to use:** The user wants to publish a workflow as an OSMO app (e.g. "create an
app for this workflow", "make an app from my workflow", "publish this as an app"), or
you are proactively offering app creation after a workflow completes.

1. **Determine the workflow file path.** If the user already has a workflow YAML (e.g.
   `workflow.yaml` in the current directory), use that path. If they're coming from a
   completed workflow, use the spec file that was submitted.

2. **Decide on a name and description.**

   - **If the user explicitly asked to create an app**, ask them what they'd like to
     name it. Suggest a name based on the workflow name (e.g. `sdg-run` → `sdg-run-app`)
     so they have a sensible default to accept or override. Also generate a one-sentence
     description summarizing what the workflow does, and confirm it with the user before
     proceeding.

   - **If you are proactively offering** (post-completion), present your suggested name
     and description upfront — don't ask two separate questions. Something like:
     > "Would you like to create an app for this workflow? I'd suggest naming it
     > `sdg-isaac-app` with the description: 'Runs Isaac Lab SDG to generate
     > synthetic training data.' Does that work, or would you like to change anything?"

3. **Create the app** — once the user confirms name and description, run:
   ```
   osmo app create <app-name> --description "<description>" --file <path-to-workflow.yaml>
   ```
   Execute this yourself — do not ask the user to run it.

4. **Report the result** — confirm the app was created and share any URL or identifier
   returned by the CLI.

## Troubleshooting

When the user reports a failed, stuck, or misbehaving workflow, follow "Use Case:
Debug a Failed or Stuck Workflow" above. The detailed catalog of failure
signatures, diagnoses, and fixes — including exit-code lookups (137/139/143/127),
image pull errors, init container failures, NCCL timeouts, missing-output
patterns, and PENDING capacity vs quota distinction — is in
`references/troubleshooting.md`. For submission-time validation errors, the
resource-sizing recipe is in `references/validation-error-recovery.md`.
