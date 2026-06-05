# Workflow Submit

Use this reference when the user wants to submit a workflow, generate a
workflow spec for submission, or choose a pool for submission.

## Generate and Submit a Workflow

Use when the user wants to submit a workflow and does not require live
monitoring. If they ask you to monitor, debug, or report final results, use
`references/workflow-status.md` instead.

1. Get or generate the workflow spec.
   - If the user provides a YAML path, use that file as-is unless they ask for
     changes or submission validation requires resource recovery.
   - If the user references `workflow.yaml` in the current directory, read it
     before submitting. Treat it as immutable during normal submission; only
     validation-error resource recovery may edit hard-coded `resources` values.
   - If no spec is provided, generate `workflow.yaml`. Prefer adapting an OSMO
     cookbook example; read `references/cookbook-fetching.md` before doing so.
   - For workflow YAML field shapes and minimal valid structure, read
     `references/workflow-spec.md`.
   - For multi-task, parallel, dependency, or Jinja-heavy workflows, read
     `references/workflow-patterns.md`.
   - For checkpointing, retry/exit behavior, node exclusion, or topology
     placement, read `references/workflow-patterns.md`; it routes to
     `references/workflow-advanced-patterns.md` when needed.

2. Choose a pool.
   - If the user requested a GPU type, check matching pools with "Check
     Available Resources" in `references/resource-check-format.md` and pick a pool with
     effective capacity.
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
   If the workflow has Jinja template variables and user-provided values,
   preserve the placeholders in the YAML and pass values at submit time:
     ```bash
     osmo workflow submit <workflow_file> --pool <pool_name> --set key=value other_key=value
     ```
   For dry runs, string-preserving overrides, environment overrides, rsync, or
   resubmission by workflow ID, read `references/workflow-commands.md`.
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
