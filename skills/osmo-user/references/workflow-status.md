# Workflow Status, Monitoring, and Inspection

Use this reference when the user asks about workflow status, logs, live metrics,
dashboard links, recent workflows, end-to-end monitoring, or what a workflow
does.

## List Workflows

Use when the user wants to see all or recent workflows.

1. Fetch workflows:
   ```bash
   osmo workflow list --format-type json
   ```
2. Summarize in a table with workflow ID, pool, status, and duration. Group or
   sort by status when helpful. Use clear text labels for outcomes:
   COMPLETED, FAILED, FAILED_CANCELED, FAILED_EXEC_TIMEOUT,
   FAILED_SERVER_ERROR, RUNNING, and PENDING.

## Check Workflow Status

Use when the user asks about status, logs, progress, dashboard links, or live
resource metrics. Also use this as the polling loop during end-to-end
orchestration.

1. Query the workflow and cache the JSON:
   ```bash
   osmo workflow query <workflow_id> --format-type json
   ```
   Use the cached JSON's `pool` field as `<pool>` for later resource
   diagnostics.
2. Fetch logs based on task count:
   - For one task, fetch inline:
     ```bash
     osmo workflow logs <workflow_id> -n 10000
     ```
   - For two or more tasks, delegate to `references/logs-reader.md` subagents, one
     subagent per five tasks. Do not fetch multi-task logs inline in the main
     conversation.
3. Report the status using the rules below. Include Grafana and Kubernetes
   dashboard links by default for detailed status reports.
4. For PENDING workflows, follow "PENDING diagnosis" below.
5. For COMPLETED workflows, follow "Completed workflow follow-ups" below.

## Reporting Status

When you've fetched the query JSON and logs, the report should include:

- The current status (RUNNING, COMPLETED, FAILED, PENDING) stated up front.
- A concise summary of what the logs show: what stage the job is at, any errors,
  or what it completed successfully.
- If the workflow failed, the error highlighted and a suggested next step.

## Link Rendering

Both `grafana_url` and `dashboard_url` come from the workflow query JSON. Render
them as clickable markdown links proactively in any detailed status report
(RUNNING or just-completed workflows).

| Field | When to render | Markdown |
|---|---|---|
| `grafana_url` | User asks about resource usage, GPU/CPU/memory utilization, metrics, dashboards, OR you're producing a detailed status report | `[View resource usage in Grafana](<grafana_url>)` |
| `dashboard_url` | User asks about the Kubernetes dashboard, pod details, or a k8s link, OR you're producing a detailed status report | `[Open Kubernetes dashboard](<dashboard_url>)` |

If the field is `null`:

- For Grafana: say "The Grafana resource usage link is not available for this
  workflow."
- For Kubernetes dashboard: say "The Kubernetes dashboard link is not available
  for this workflow."

Do not silently omit a missing field; name it as unavailable.

## Resource-Usage Questions

When the user asks about live GPU/CPU/memory utilization:

- Surface the Grafana link as the answer. That is where live metrics live.
- Do not fabricate utilization numbers. The CLI does not expose live metrics.
- If `grafana_url` is null, say so explicitly.

## PENDING Diagnosis

When status is `PENDING` or the user asks why a workflow isn't scheduling, also
fetch:

```bash
osmo workflow events <workflow_id>
osmo pool list
osmo resource list -p <pool>
```

Use `<pool>` from the cached workflow query JSON.

Translate Kubernetes-speak into plain language. Examples:

| Raw event | Plain-language translation |
|---|---|
| `Insufficient nvidia.com/gpu` | "the pool is out of free GPUs" |
| `didn't have enough resources: GPUs` | "the pool is out of free GPUs" |
| `didn't match Pod's node affinity/selector` | "no nodes match the workflow's hardware requirements" |
| `Preemption is not helpful for scheduling` | "no lower-priority workflows can be evicted to free GPUs" |

Compare `osmo pool list` with `osmo resource list -p <pool>` to determine
whether this is quota exhaustion or physical capacity exhaustion. See
`references/troubleshooting.md` for the distinction and recommended fixes.

## Completed Workflow Follow-Ups

After a workflow reaches `COMPLETED`:

1. Offer the output dataset download. Ask: `Would you like me to download the
   output dataset now?` Default the destination to `~/`. Run:
   ```bash
   osmo dataset download <dataset_name> <path>
   ```
2. Offer to create an OSMO app. Suggest a name derived from the workflow and a
   one-sentence description. If the user agrees, follow "Create an App" in
   `references/workflow-apps.md`.
3. When monitoring multiple workflows from the same spec, offer app creation
   once after all of them reach a terminal state, not once per workflow.

## Orchestrate a Workflow End-to-End

Use when the user wants you to create or submit a workflow, monitor it to a
terminal state, handle failures, and report the result.

1. Spawn the `references/workflow-expert.md` subagent for setup and submission only.
   Ask it to write workflow YAML if needed, check resources, and submit. Do not
   ask it to monitor, poll, or report final results.
2. The subagent returns the workflow ID, pool name, OSMO Web link, and output
   datasets.
3. Monitor inline in the main conversation using "Check Workflow Status". If
   the user gives a cadence, honor it. Otherwise poll every 10-15 seconds for
   smoke tests, simple commands, and jobs expected to finish in minutes; poll
   every 30 seconds for training or data-generation runs, and back off to 60
   seconds after several unchanged RUNNING or PENDING polls. Report state
   transitions to the user.
4. If the workflow completes, report the workflow ID, OSMO Web link, output
   datasets, and completed follow-ups.
5. If the workflow fails:
   - Fetch logs using the log-fetching rule from "Check Workflow Status".
   - Resume the same `workflow-expert` subagent and pass the logs summary:
     `Workflow <id> FAILED. Here is the logs summary: <summary>. Diagnose and fix.`
   - The subagent returns a new workflow ID. Resume monitoring.
   - Stop automatic retries after three failures and ask the user for guidance.

## Explain What a Workflow Does

Use when the user asks what a workflow does or wants to understand a submitted
workflow.

1. Fetch the original template:
   ```bash
   osmo workflow spec <workflow_id> --template
   ```
2. Summarize the spec in plain language:
   - What it does
   - How it runs: image, command, entrypoint, and notable environment variables
   - What it produces: datasets or artifacts

Keep the summary concise. Do not provide a line-by-line YAML walkthrough unless
the user asks.
