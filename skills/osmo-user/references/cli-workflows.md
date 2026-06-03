# OSMO CLI Workflows

This is the command router for the `osmo-user` skill. Use it to map the
user's intent to the right reference file, then load only that reference and any
additional files it names.

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

| User asks for | Read |
|---|---|
| Resources, pools, GPUs, nodes, or quota | This file, then `references/resource-check-format.md` before responding |
| Submit a supplied or generated workflow | `references/workflow-submit.md` |
| Create or publish an app from a workflow | `references/workflow-apps.md` |
| Workflow status, logs, Grafana link, Kubernetes dashboard link, live metrics, recent workflows, or workflow explanation | `references/workflow-status.md` |
| Submit, monitor, fix failures, and report completion | `references/workflow-status.md`, then spawn or resume `references/workflow-expert.md` as directed |
| Failed, stuck, PENDING, sparse-log, or misbehaving workflows | `references/troubleshooting.md` |
| Workflow structure, multi-task execution, dependencies, Jinja templates, checkpointing, exit/retry behavior, node exclusion, or topology placement | `references/workflow-patterns.md` |

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
