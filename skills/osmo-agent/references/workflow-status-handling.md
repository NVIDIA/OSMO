# Workflow Status Reporting Rules

Detailed rules for the "Check Workflow Status" use case — link rendering, null
handling, PENDING diagnosis, and completed-workflow follow-ups.

## Reporting status

When you've fetched the query JSON and logs, the report should include:

- The current status (RUNNING, COMPLETED, FAILED, PENDING) stated up front.
- A concise summary of what the logs show — what stage the job is at, any errors,
  or what it completed successfully.
- If the workflow failed, the error highlighted and a suggested next step.

## Link rendering

Both `grafana_url` and `dashboard_url` come from the workflow query JSON. Render
them as clickable markdown links proactively in any detailed status report (RUNNING
or just-completed workflows) — users often want them without explicitly asking.

| Field | When to render | Markdown |
|---|---|---|
| `grafana_url` | User asks about resource usage, GPU/CPU/memory utilization, metrics, dashboards, OR you're producing a detailed status report | `[View resource usage in Grafana](<grafana_url>)` |
| `dashboard_url` | User asks about the Kubernetes dashboard, pod details, or a k8s link, OR you're producing a detailed status report | `[Open Kubernetes dashboard](<dashboard_url>)` |

If the field is `null`:

- For Grafana: say "The Grafana resource usage link is not available for this
  workflow."
- For Kubernetes dashboard: say "The Kubernetes dashboard link is not available
  for this workflow."

Do not silently omit a missing field — name it as unavailable.

## Resource-usage questions

When the user asks about live GPU/CPU/memory utilization (e.g. "how much memory
is workflow X using?"):

- Surface the Grafana link as the answer — that's where live metrics live.
- Do **not** fabricate utilization numbers. The CLI does not expose live metrics.
- If `grafana_url` is null, say so explicitly.

## PENDING diagnosis

When status is `PENDING` or the user asks why a workflow isn't scheduling, also
fetch:

```
osmo workflow events <workflow name>
osmo resource list -p <pool>
```

Translate Kubernetes-speak into plain language. Examples:

| Raw event | Plain-language translation |
|---|---|
| `Insufficient nvidia.com/gpu` | "the pool is out of free GPUs" |
| `didn't have enough resources: GPUs` | "the pool is out of free GPUs" |
| `didn't match Pod's node affinity/selector` | "no nodes match the workflow's hardware requirements" |
| `Preemption is not helpful for scheduling` | "no lower-priority workflows can be evicted to free GPUs" |

Cross-check `osmo pool list` to determine whether this is quota exhaustion or
physical capacity exhaustion (see `references/troubleshooting.md` PENDING section
for the distinction and recommended fixes).

## Completed workflow follow-ups

After a workflow reaches `COMPLETED`:

1. **Offer the output dataset download.** Ask: *"Would you like me to download the
   output dataset now?"* Default the destination to `~/`. Run:
   ```
   osmo dataset download <dataset_name> <path>
   ```

2. **Offer to create an OSMO app.** Suggest a name derived from the workflow
   (e.g. `sdg-run-42` → app name `sdg-run-42`) and a one-sentence description.
   If the user agrees, follow "Use Case: Create an App" in SKILL.md.

3. **Batch monitoring.** When monitoring multiple workflows from the same spec,
   offer app creation **once** after all of them reach a terminal state — not
   once per workflow. Do not skip the offer just because you were in a batch
   loop.
