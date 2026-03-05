---
name: osmo-agent
description: >
  How to use the OSMO CLI to manage cloud compute resources for robotics development.
  Use this skill whenever the user asks about available resources, nodes, pools, GPUs,
  or compute capacity on OSMO — even if they don't say "OSMO" explicitly. Also use it
  when they ask what they can run, whether they have quota, want to check their profile
  or pool access, want to submit a workflow (SDG, RL training, or custom), want to
  check the status or logs of a running/completed workflow, list or browse recent
  workflow submissions, want to understand what a specific workflow does or is
  configured to do, or want to create an OSMO app from a workflow.
license: Apache-2.0
compatibility: >
  Requires osmo CLI installed and authenticated (osmo login).
metadata:
  author: nvidia
  version: "1.0.0"
---

# OSMO CLI Use Cases

OSMO is a cloud platform for robotics compute and data storage. This skill covers
common OSMO CLI use cases.

## Reference Files

The `agents/` directory contains instructions for specialized subagents. Read them when you need to spawn the relevant subagent.

- `agents/workflow-expert.md` — workflow generation, resource check, submission, failure diagnosis
- `agents/logs-reader.md` — log fetching and summarization for monitoring and failure diagnosis

The `references/` directory has additional documentation:

- `references/cookbook.md` — Real-world workflow examples to use as starting points
- `references/workflow-patterns.md` — Multi-task, parallel execution, data dependencies, Jinja templating
- `references/advanced-patterns.md` — Checkpointing, retry/exit behavior, node exclusion

---

## Intent Routing

- Asks about resources, pools, GPUs, or quota → Check Available Resources
- Wants to submit a job (simple, no monitoring) → Generate and Submit a Workflow
- Wants to submit + monitor + handle failures → Orchestrate a Workflow End-to-End
- Asks about a workflow's status or logs → Check Workflow Status
- Lists recent workflows → List Workflows
- Asks what a workflow does → Explain What a Workflow Does
- Wants to publish a workflow as an app → Create an App

---

## Use Case: Check Available Resources

**When to use:** The user asks what resources, nodes, GPUs, or pools are available
(e.g. "what resources are available?", "what nodes can I use?", "do I have GPU quota?",
"what pools do I have access to?").

### Steps

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

### Reading the output

The `osmo pool list` table columns mean:

| Column | Meaning |
|---|---|
| Quota Limit | Max GPUs for HIGH/NORMAL priority workflows |
| Quota Used | GPUs currently consumed by your workflows |
| Quota Free | GPUs you can still allocate |
| Total Capacity | All GPUs on nodes in the pool |
| Total Usage | GPUs used by everyone in the pool |
| Total Free | GPUs physically free on nodes |

When summarizing results for the user, highlight:
- Which pools they have access to
- Effective availability = min(Quota Free, Total Free) — this is the true number of
  GPUs a workflow can actually use, since both limits apply
- Any pools that appear at capacity
- **LOW priority opportunity:** if a pool has Quota Free = 0 but Total Free > 0, the
  user's quota is exhausted but physical GPUs are physically idle. They can still submit
  with `--priority LOW`, which bypasses quota limits and runs on available capacity.
  Mention this as an option whenever you see this condition.

### Output format (required for resource availability responses)

Use a grouped, table-first format similar to:
"You have access to <N> pools, <M> ONLINE. Here are the highlights by GPU type:"

Formatting requirements:
- Group results by GPU type with section headers like `GB200 Pools`, `H100 Pools`,
  `L40S Pools`, `L40 Pools` (and `Other Pools` when needed). Do not enforce a fixed
  ordering; use whatever order is most readable for the current result set.
- Render one fixed-width table per GPU type (box-drawing style preferred; markdown
  table is acceptable fallback).
- Include these columns in each table:
  - `Pool`
  - `Quota Free`
  - `Physically Free` (from `Total Free`; keep markers like `(shared)` when present)
  - `Effective` (computed as `min(Quota Free, Total Free)`)
- Sort rows within each GPU-type section by `Effective` descending.
- Add useful inline annotations in cells when relevant:
  - Append `(default)` to the user's default pool name.
  - Optionally mark the top pool in a section as `✅ Most available`.
- After the grouped tables, add a short callout for:
  - Pools at capacity (`Effective = 0`)
  - LOW-priority opportunities (`Quota Free = 0` and `Total Free > 0`)

Derive GPU type from pool names when possible:
- contains `gb200` -> `GB200`
- contains `h100` -> `H100`
- contains `l40s` -> `L40S`
- contains `l40` -> `L40`
- otherwise -> `Other`

---

## Use Case: Generate and Submit a Workflow

**When to use:** The user wants to submit a job to run on OSMO (e.g. "submit a workflow
to run SDG", "run RL training for me", "submit this yaml to OSMO").

If the user also wants monitoring, debugging, or reporting results, use the
"Orchestrate a Workflow End-to-End" use case instead.

### Steps

1. **Get or generate a workflow spec.**

   If the user provides a workflow YAML, use it as-is. Otherwise, generate one based on
   what they want to run. Write the spec to `workflow.yaml` in the current directory.

   **When generating a workflow spec:**
   - Consult `references/cookbook.md` for the closest real-world example and fetch its
     YAML via WebFetch as a starting point. Adapt it rather than generating from scratch.
     Fetch the README as well, substituting the YAML file name with README. Summarize the
     README, and add it as a comment in the generated workflow spec.
   - **Use cookbook metadata to decide submission count.** The cookbook table in
     `references/cookbook.md` annotates entries with throughput and constraint metadata
     (e.g. "60 images, 1 GPU ONLY"). Before deciding whether to submit one or multiple
     workflows, read those annotations:
     - If a throughput figure is present and the user has a target quantity + time
       budget, calculate: `num_submissions = ceil(target / (throughput_per_run * time_budget))`
       and submit the same YAML that many times.
     - If a constraint is present (e.g. "1 GPU ONLY"), respect it — do not scale by
       requesting more GPUs per workflow; scale by submitting more workflows instead.
     - If no metadata is present, submit a single workflow unless the user says otherwise.
   - If the workflow involves **multiple tasks, parallel execution, data dependencies
     between tasks, or Jinja templating**, read `references/workflow-patterns.md` for
     the correct spec patterns before writing anything.
   - If the user asks for **checkpointing, retry/exit behavior, or node exclusion**,
     read `references/advanced-patterns.md`.
   - If no cookbook example closely matches, fall back to the scaffold template below.

   The simple OSMO workflow spec format follows this structure:
   ```yaml
   workflow:
     name: <workflow-name>
     tasks:
     - name: <task-name>
       image: <container-image>
       command: ["bash"]
       args: ["/tmp/entry.sh"]
       environment:
         <ENV VARIABLE>: <VALUE>
       files:
       - contents: |
           <shell script to run>
         path: /tmp/entry.sh
       outputs:
       - dataset:
           name: <output-dataset-name>
     resources:
       default:
         cpu: <N>
         gpu: <N>
         memory: <NGi>
         storage: <NGi>
   ```

   Use `{{output}}` as a placeholder in the script wherever the task should write its
   output data — OSMO replaces this at runtime with the output dataset path.

2. **Ask the user what GPU type they want** (e.g. H100, L40, GB200), then check
   availability using the steps in the "Check Available Resources" use case to confirm
   the right pool to use.

3. **Ask the user for confirmation with this exact wording:**
   `Would you like me to submit this workflow to this pool?`
   Then execute the command yourself — do not tell the user to run it. Once confirmed, run:
   ```
   osmo workflow submit workflow.yaml --pool <pool_name>
   ```
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
   resources failed assertions, read the node capacity values from the error table and
   adjust the `resources` section of `workflow.yaml` using these rules, then resubmit:

   - **Storage / Memory:** use `floor(capacity * 0.9)` if capacity ≥ 50, otherwise `capacity - 2`
   - **CPU:** use `floor(capacity * 0.9)` if capacity ≥ 30, otherwise `capacity - 2`
   - **GPU:** always use a multiple of 2; do not adjust based on node capacity
   - **Proportionality:** after setting GPU, scale memory and CPU proportionally to the
     ratio of requested GPUs to total allocatable GPUs on the node
     (e.g. requesting 2 of 8 GPUs → use 25% of the adjusted memory/CPU values)

---

## Use Case: List Workflows

**When to use:** The user wants to see all their workflows or recent submissions (e.g.
"what are my workflows?", "show me my recent jobs", "what's the status of my workflows?").

### Steps

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

---

## Use Case: Check Workflow Status

**When to use:** The user asks about the status or logs of a workflow (e.g. "what's the
status of workflow abc-123?", "is my workflow done?", "show me the logs for xyz",
"show me the resource usage for my workflow", "give me the Kubernetes dashboard link").
Also used as the polling step when monitoring a workflow during end-to-end orchestration.

### Steps

1. **Get the workflow status:**
   ```
   osmo workflow query <workflow name> --format-type json
   ```
   **Cache the JSON result for the rest of the conversation.** If you have already queried
   this workflow with `osmo workflow query` earlier in the conversation, reuse that JSON
   — do not query again just to extract a field.

2. **Get recent logs** — Choose the log-fetching method based on task count
   (this rule applies everywhere logs are needed — monitoring, failure diagnosis, etc.):
   - **1 task:** fetch logs inline with `osmo workflow logs <workflow_id> -n 10000`.
   - **2+ tasks:** you MUST delegate to `/agents/logs-reader.md` subagents — do NOT
     fetch logs inline yourself. Spawn one logs-reader subagent per 5 tasks
     (e.g. 3 tasks → 1 subagent, 7 tasks → 2 subagents).

3. **Report to the user:**
   - State the current status clearly (e.g. RUNNING, COMPLETED, FAILED, PENDING)
   - Concisely summarize what the logs show — what stage the job is at, any errors,
     or what it completed successfully
   - If the workflow failed, highlight the error and suggest next steps if possible
   - **Resource usage / Grafana link:** If the user asks about resource usage, GPU
     utilization, or metrics for this workflow, extract `grafana_url` from the query
     JSON. If present, render it as a clickable link:
     `[View resource usage in Grafana](<grafana_url>)`
     If the field is empty or null, tell the user: "The Grafana resource usage link is
     not available for this workflow."
   - **Kubernetes dashboard link:** If the user asks for the Kubernetes dashboard,
     pod details, or a k8s link, extract `kubernetes_dashboard` from the query JSON.
     If present, render it as a clickable link:
     `[Open Kubernetes dashboard](<kubernetes_dashboard>)`
     If the field is empty or null, tell the user: "The Kubernetes dashboard link is
     not available for this workflow."
   - Proactively include both links in any detailed status report (e.g. when the
     workflow is RUNNING or has just COMPLETED) — users often want them without
     explicitly asking. If a field is empty or null, note it as not available rather
     than silently omitting it.
   - **If PENDING** (or the user asks why it isn't scheduling), run:
     ```
     osmo workflow events <workflow name>
     ```
     Translate Kubernetes events into plain language (e.g. "there aren't enough free
     GPUs in the pool" rather than "Insufficient nvidia.com/gpu"). Also check:
     ```
     osmo resource list -p <pool>
     ```
   - If COMPLETED, proceed to Step 4.

4. **Handle completed workflows:**

   Offer the output dataset for download:
   `Would you like me to download the output dataset now?`
   Ask whether they want a specific output folder (default to `~/`). Then run:
   ```
   osmo dataset download <dataset_name> <path>
   ```

   Also offer to create an OSMO app. Suggest a name derived from the workflow name
   (e.g. `sdg-run-42` → app name `sdg-run-42`) and generate a one-sentence description.
   If the user agrees, follow the "Create an App" use case.

   When monitoring multiple workflows from the same spec, offer app creation once
   (not per workflow) after all reach a terminal state. Do not skip this offer
   just because you were in a batch monitoring loop.

---

## Use Case: Orchestrate a Workflow End-to-End

**When to use:** The user wants to create a workflow, submit it, and monitor it to
completion (e.g. "train GR00T on my data", "submit and monitor my workflow",
"run end-to-end training", "submit this and tell me when it's done").

### Steps

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

---

## Use Case: Explain What a Workflow Does

**When to use:** The user asks what a workflow does, what it's configured to run, or
wants to understand its purpose (e.g. "what does workflow abc-123 do?", "explain this
workflow", "what is workflow xyz running?").

### Steps

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

---

## Use Case: Create an App

**When to use:** The user wants to publish a workflow as an OSMO app (e.g. "create an
app for this workflow", "make an app from my workflow", "publish this as an app"), or
you are proactively offering app creation after a workflow completes.

### Steps

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
