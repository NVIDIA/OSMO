---
name: osmo
description: >
  How to use the OSMO CLI to manage cloud compute resources for robotics development.
  Use this skill whenever the user asks about available resources, nodes, pools, GPUs,
  or compute capacity on OSMO — even if they don't say "OSMO" explicitly. Also use it
  when they ask what they can run, whether they have quota, want to check their profile
  or pool access, want to submit a workflow (SDG, RL training, or custom), want to
  check the status or logs of a running/completed workflow, list or browse recent
  workflow submissions, or want to understand what a specific workflow does or is
  configured to do.
---

# OSMO CLI Use Cases

OSMO is a cloud platform for robotics compute and data storage. This skill covers
common OSMO CLI workflows.

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

---

## Use Case: Generate and Submit a Workflow

**When to use:** The user wants to submit a job to run on OSMO (e.g. "submit a workflow
to run SDG", "run RL training for me", "submit this yaml to OSMO").

### Steps

1. **Get or generate a workflow spec.**

   If the user provides a workflow YAML, use it as-is. Otherwise, generate one based on
   what they want to run. Write the spec to `workflow.yaml` in the current directory.

   **When generating a workflow spec:**
   - Consult `references/cookbook.md` for the closest real-world example and fetch its
     YAML via WebFetch as a starting point. Adapt it rather than generating from scratch.
     Fetch the README as well, substituting the YAML file name with README. Summarize the
     README, and add it as a comment in the generated workflow spec.
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

3. **Ask the user if they want to submit**, then execute the command yourself — do not
   tell the user to run it. Once confirmed, run:
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
status of workflow abc-123?", "is my workflow done?", "show me the logs for xyz").
Also used as the polling step when monitoring a workflow during end-to-end orchestration.

### Steps

1. **Get the workflow status:**
   ```
   osmo workflow query <workflow name> --format-type json
   ```

2. **Get recent logs** — this command streams live, so run it with a 5-second timeout
   and use whatever output was captured. Check how many tasks are in the query response:
   - **1 task:** run the standard command:
     ```
     osmo workflow logs <workflow name> -n 10000
     ```
   - **2–5 tasks:** fetch logs per task in parallel for clearer separation:
     ```
     osmo workflow logs <workflow name> --task <task_name> -n 10000
     ```
   - **More than 5 tasks:** fall back to the standard command without `--task`.

3. **Report to the user:**
   - State the current status clearly (e.g. RUNNING, COMPLETED, FAILED, PENDING)
   - Concisely summarize what the logs show — what stage the job is at, any errors,
     or what it completed successfully
   - If the workflow failed, highlight the error and suggest next steps if possible
   - **If the workflow is COMPLETED and has output datasets**, ask the user if they
     would like to download the dataset and whether they want to specify an output
     folder. Then run the download yourself:
     ```
     osmo dataset download <dataset_name> <path>
     ```
     Use `~/` as the output path if the user doesn't specify one.

   **If the workflow is PENDING** (or the user asks why it isn't scheduling), run:
   ```
   osmo workflow events <workflow name>
   ```
   These are Kubernetes pod conditions and cluster events — translate them into plain
   language without Kubernetes jargon (e.g. "there aren't enough free GPUs in the pool
   to schedule your job" rather than "Insufficient nvidia.com/gpu"). Also direct the
   user to check resource availability in the pool their workflow is waiting in:
   ```
   osmo resource list -p <pool>
   ```

---

## Use Case: Orchestrate a Workflow End-to-End

**When to use:** The user wants to create, submit AND monitor a workflow to completion,
or requests an autonomous workflow cycle (e.g. "train GR00T on my data", "create a SDG workflow and run it",
"submit and monitor my workflow", "run end-to-end training", "submit this and
tell me when it's done").

### Phase-Split Pattern

The lifecycle is split between the **osmo-workflow-expert agent** (resource
check, YAML generation, submission, failure diagnosis) and **you** (live
monitoring so the user sees real-time updates). Follow these steps exactly:

#### Step 1: Spawn the osmo-workflow-expert for setup and submission

Use the Task tool to spawn the `osmo-workflow-expert` agent. Ask it to
**check resources and submit the workflow only**. Do NOT ask it to monitor,
poll status, or report results — that is your job.

Example prompt:
> Submit the workflow at workflow.yaml to an available GPU pool. Check
> resources first, then submit. Return the workflow ID when done.

The agent returns: workflow ID, pool name, and OSMO Web link.

#### Step 2: Monitor the workflow inline (you do this — user sees live updates)

After getting the workflow ID, use the "Check Workflow Status" use case to
poll and report. Repeat until a terminal state is reached.

Report each state transition to the user:
- `Status: SCHEDULING (queued 15s)`
- `Workflow transitioned: SCHEDULING → RUNNING`
- `Status: RUNNING (task "train" active, 2m elapsed)`

#### Step 3: Handle the outcome

**If COMPLETED:** Report results — workflow ID, OSMO Web link, output datasets.
Offer to download. Follow the COMPLETED handling in "Check Workflow Status".

**If FAILED:** Resume the workflow expert (use the `resume` parameter with the
agent ID from Step 1) and tell it: "Workflow <id> FAILED. Diagnose and fix."
It returns a new workflow ID. Resume monitoring from Step 2. Max 3 retries
before asking the user for guidance.

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
