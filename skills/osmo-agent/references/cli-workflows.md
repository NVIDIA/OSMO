# OSMO CLI Workflows

This is the canonical command-sequence reference for the `osmo-agent` skill.
Use it to map the user's intent to the right `osmo` commands, then load any
additional reference files named by the use case.

## Prerequisites

Before the first OSMO operation in a conversation:

1. Verify the CLI is available:
   ```bash
   osmo --version
   ```
2. If auth fails on any command, ask the user to run `osmo login` and stop until
   they confirm.
3. For resource-dependent operations, check profile and pool access:
   ```bash
   osmo profile list
   osmo pool list
   ```

## Intent Map

| User asks for | Use case |
|---|---|
| Resources, pools, GPUs, nodes, quota | Check Available Resources |
| Submit a job or workflow, without ongoing monitoring | Generate and Submit a Workflow |
| Submit, monitor, fix failures, and report completion | Orchestrate a Workflow End-to-End |
| Workflow status, logs, Grafana link, Kubernetes dashboard link, live metrics | Check Workflow Status |
| Recent workflows or all workflows | List Workflows |
| Failed, stuck, PENDING, or confusing OSMO errors | Debug a Failed or Stuck Workflow |
| What a workflow does | Explain What a Workflow Does |
| Publish/create an app from a workflow | Create an App |

## Check Available Resources

Use when the user asks what resources, nodes, GPUs, pools, or quota are
available.

1. Check the user's profile and pool access:
   ```bash
   osmo profile list
   ```
2. Check GPU availability across accessible pools:
   ```bash
   osmo pool list
   ```
   To inspect free capacity instead of used/total counts:
   ```bash
   osmo pool list --mode free
   ```
3. Before responding, read `references/resource-check-format.md`. It defines
   column meanings, effective availability, grouping, sorting, and LOW-priority
   callouts.

Effective availability is `min(Quota Free, Total Free)`. When `Quota Free = 0`
but `Total Free > 0`, highlight that the user may submit with `--priority LOW`
to use idle capacity, with preemption risk.

## Generate and Submit a Workflow

Use when the user wants to submit a workflow and does not require live
monitoring. If they ask you to monitor, debug, or report final results, use
"Orchestrate a Workflow End-to-End" instead.

1. Get or generate the workflow spec.
   - If the user provides a YAML path, use that file as-is unless they ask for
     changes or submission validation requires resource recovery.
   - If the user references `workflow.yaml` in the current directory, read it
     before submitting and do not modify it.
   - If no spec is provided, generate `workflow.yaml`. Prefer adapting an OSMO
     cookbook example; read `references/cookbook-fetching.md` before doing so.
   - For multi-task, parallel, dependency, or Jinja-heavy workflows, read
     `references/workflow-patterns.md`.
   - For checkpointing, retry/exit behavior, node exclusion, or topology
     placement, read `references/workflow-patterns.md`; it routes to
     `references/workflow-advanced-patterns.md` when needed.

2. Choose a pool.
   - If the user requested a GPU type, check matching pools with "Check
     Available Resources" and pick a pool with effective capacity.
   - If the user did not specify a GPU type, ask what GPU type they want unless
     the request or YAML makes the choice obvious.

3. Submit only after confirmation unless the user already pre-authorized
   submission with wording like "go ahead", "submit it now", or "no need to ask".
   When confirmation is needed, ask exactly:
   `Would you like me to submit this workflow to this pool?`

4. Run the submit command yourself:
   ```bash
   osmo workflow submit <workflow_file> --pool <pool_name>
   ```
   If the workflow has Jinja template variables and the user supplied values,
   preserve the placeholders in the YAML and pass values at submit time:
   ```bash
   osmo workflow submit <workflow_file> --pool <pool_name> --set key=value other_key=value
   ```
   Submit the same YAML multiple times when the user asks for multiple runs; do
   not duplicate the YAML file.

5. If quota is exhausted but GPUs are physically free, offer LOW priority:
   ```bash
   osmo workflow submit <workflow_file> --pool <pool_name> --priority LOW
   ```
   Explain that LOW priority bypasses quota on idle capacity but may be
   preempted.

6. If submission fails with a capacity-assertion validation error, read
   `references/validation-error-recovery.md`, adjust only hard-coded values in
   the `resources` section, and resubmit. Do not change Jinja variables such as
   `{{num_gpu}}`.

7. Report every workflow ID returned by the CLI.

## List Workflows

Use when the user wants to see all or recent workflows.

1. Fetch workflows:
   ```bash
   osmo workflow list --format-type json
   ```
2. Summarize in a table with workflow name, pool, status, and duration. Group or
   sort by status when helpful. Use clear text labels for outcomes:
   COMPLETED, FAILED, FAILED_CANCELED, FAILED_EXEC_TIMEOUT,
   FAILED_SERVER_ERROR, RUNNING, and PENDING.

## Check Workflow Status

Use when the user asks about status, logs, progress, dashboard links, or live
resource metrics. Also use this as the polling loop during end-to-end
orchestration.

1. Query the workflow and cache the JSON:
   ```bash
   osmo workflow query <workflow_name> --format-type json
   ```
2. Fetch logs based on task count:
   - For one task, fetch inline:
     ```bash
     osmo workflow logs <workflow_id> -n 10000
     ```
   - For two or more tasks, delegate to `agents/logs-reader.md` subagents, one
     subagent per five tasks. Do not fetch multi-task logs inline in the main
     conversation.
3. Read `references/workflow-status-handling.md` before reporting. It covers
   status phrasing, Grafana/dashboard link rendering, null handling, resource
   usage questions, PENDING diagnosis, and completed-workflow follow-ups.
4. For PENDING workflows, follow the reference's pending-diagnosis steps:
   ```bash
   osmo workflow events <workflow_name>
   osmo resource list -p <pool>
   ```
5. For COMPLETED workflows, offer output dataset download and app creation using
   the prompts in `references/workflow-status-handling.md`.

## Orchestrate a Workflow End-to-End

Use when the user wants you to create or submit a workflow, monitor it to a
terminal state, handle failures, and report the result.

1. Spawn the `agents/workflow-expert.md` subagent for setup and submission only.
   Ask it to write workflow YAML if needed, check resources, and submit. Do not
   ask it to monitor, poll, or report final results.
2. The subagent returns the workflow ID, pool name, OSMO Web link, and output
   datasets.
3. Monitor inline in the main conversation using "Check Workflow Status". Poll
   every 10-15 seconds for short jobs and every 30-60 seconds for long training
   runs. Report state transitions to the user.
4. If the workflow completes, report the workflow ID, OSMO Web link, output
   datasets, and completed follow-ups from `references/workflow-status-handling.md`.
5. If the workflow fails:
   - Fetch logs using the log-fetching rule from "Check Workflow Status".
   - Resume the same `workflow-expert` subagent and pass the logs summary:
     `Workflow <id> FAILED. Here is the logs summary: <summary>. Diagnose and fix.`
   - The subagent returns a new workflow ID. Resume monitoring.
   - Stop automatic retries after three failures and ask the user for guidance.

## Debug a Failed or Stuck Workflow

Use when the user asks why a workflow failed, why it is stuck, or how to fix an
OSMO error. If they want automatic fix-and-resubmit, use "Orchestrate a Workflow
End-to-End" instead.

1. Establish current state with "Check Workflow Status"; cache the query JSON.
2. Open `references/troubleshooting.md` and match the symptom by status, exit
   code, error keyword, log signature, or behavior.
3. Explain the likely root cause in plain language, avoiding raw Kubernetes
   jargon when possible.
4. Recommend a concrete fix from the troubleshooting pattern. If the fix edits
   `workflow.yaml`, show the exact diff you would apply.
5. Ask before applying the fix and resubmitting unless the user has already
   authorized autonomous fix-and-resubmit.

Escalate to the user when the symptom does not match any troubleshooting
pattern, or when the same workflow has already failed after three fix attempts.

## Explain What a Workflow Does

Use when the user asks what a workflow does or wants to understand a submitted
workflow.

1. Fetch the original template:
   ```bash
   osmo workflow spec <workflow_name> --template
   ```
2. Summarize the spec in plain language:
   - What it does
   - How it runs: image, command, entrypoint, and notable environment variables
   - What it produces: datasets or artifacts

Keep the summary concise; do not provide a line-by-line YAML walkthrough unless
the user asks.

## Create an App

Use when the user wants to publish a workflow as an OSMO app, or when you offer
app creation after a completed workflow.

1. Determine the workflow YAML path. If the user already has a YAML file, use
   that path. If the app is based on a completed workflow, use the submitted spec
   file from the current workflow cycle.
2. Decide on a name and description.
   - If the user explicitly asked to create an app, ask for the name and suggest
     a default derived from the workflow name.
   - If offering post-completion, present a suggested name and one-sentence
     description in a single prompt.
3. After confirmation, run:
   ```bash
   osmo app create <app_name> --description "<description>" --file <workflow_yaml>
   ```
4. Report the app identifier or URL returned by the CLI.
