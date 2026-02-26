---
name: osmo
description: >
  How to use the OSMO CLI to manage cloud compute resources for robotics development.
  Use this skill whenever the user asks about available resources, nodes, pools, GPUs,
  or compute capacity on OSMO — even if they don't say "OSMO" explicitly. Also use it
  when they ask what they can run, whether they have quota, want to check their profile
  or pool access, want to submit a workflow (SDG, RL training, or custom), or want to
  check the status or logs of a running/completed workflow.
---

# OSMO Skill

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

---

## Use Case: Generate and Submit a Workflow

**When to use:** The user wants to submit a job to run on OSMO (e.g. "submit a workflow
to run SDG", "run RL training for me", "submit this yaml to OSMO").

### Steps

1. **Get or generate a workflow spec.**

   If the user provides a workflow YAML, use it as-is. Otherwise, generate one based on
   what they want to run. Write the spec to `workflow.yaml` in the current directory.

   **When generating a workflow spec, consult `references/cookbook.md` for the closest
   example and fetch its YAML as a starting point via WebFetch. Adapt it to the user's
   request rather than generating from scratch. If no example closely matches, fall back
   to the scaffold template below.**

   The OSMO workflow spec format follows this structure:
   ```yaml
   workflow:
     name: <workflow-name>
     tasks:
     - name: <task-name>
       image: <container-image>
       command: ["bash"]
       args: ["/tmp/entry.sh"]
       environment:
         ACCEPT_EULA: Y
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

3. **Submit the workflow:**
   ```
   osmo workflow submit workflow.yaml --pool <pool_name>
   ```
   If the user wants to run the same workflow multiple times (e.g. "submit 2 of these"),
   submit the same YAML file multiple times — do not create duplicate YAML files.
   Report each workflow ID returned by the CLI so the user can track them.

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

## Use Case: Check Workflow Status

**When to use:** The user asks about the status or logs of a workflow (e.g. "what's the
status of workflow abc-123?", "is my workflow done?", "show me the logs for xyz").

### Steps

1. **Get the workflow status:**
   ```
   osmo workflow query <workflow_id> --format-type json
   ```

2. **Get recent logs** — this command streams live, so run it with a 10-second timeout
   and use whatever output was captured:
   ```
   osmo workflow logs <workflow_id> -n 10000
   ```

3. **Report to the user:**
   - State the current status clearly (e.g. RUNNING, COMPLETED, FAILED)
   - Concisely summarize what the logs show — what stage the job is at, any errors,
     or what it completed successfully
   - If the workflow failed, highlight the error and suggest next steps if possible
