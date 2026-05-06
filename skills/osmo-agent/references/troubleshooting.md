# OSMO Workflow Troubleshooting

Catalog of common failure modes for OSMO workflows. Each entry has:
- **Signature** — what you'll see in logs, status, or events
- **Diagnosis** — what it means in plain language
- **Fix** — concrete recipe to resolve

Always start by running the standard status workflow first (`osmo workflow query`
+ `osmo workflow logs` and/or `osmo workflow events`) so the cached JSON is
available for diagnosis.

---

## Status: PENDING for an unusually long time

### Signature
- `osmo workflow query` shows `status: PENDING`, `start_time: null`.
- `osmo workflow events` shows repeated `FailedScheduling` or `Unschedulable` lines
  with phrases like `Insufficient nvidia.com/gpu`, `didn't have enough resources:
  GPUs`, or `didn't match Pod's node affinity/selector`.

### Diagnosis
The Kubernetes scheduler can't find a node that satisfies the workflow's resource
request. Two distinct causes look similar in events:

- **Quota exhausted, capacity available** — the user's quota in this pool is fully
  used, but other users' quota or the physical pool still has free GPUs.
- **Capacity exhausted** — every node in the pool has its GPUs/CPU/memory consumed
  by other workloads.

Distinguish by running `osmo pool list`:
- If `Quota Free = 0` but `Total Free > 0` → quota issue.
- If `Total Free = 0` (or close) → capacity issue.

### Fix
- **Quota issue**: resubmit with `--priority LOW` to bypass quota and run on idle
  capacity. LOW jobs may be preempted when quota holders need GPUs — explain that to
  the user.
- **Capacity issue**: `--priority LOW` will not help. Options:
  - Wait for capacity to free up (queue will schedule automatically).
  - Cancel and resubmit to a different pool with free GPUs (`osmo pool list --mode
    free` to compare).
  - Reduce the GPU request if the workflow's per-task GPU count exceeds what any
    single node currently has free.

---

## Exit code 137 (OOM kill)

### Signature
- Logs end abruptly, often mid-step.
- `osmo workflow query` shows the failed task with `exit_code: 137` and possibly a
  `failure_message` mentioning OOMKilled.
- Events for the pod include `OOMKilled` or `Reason: OOMKilled`.

### Diagnosis
The container exceeded its memory limit and the kernel killed it. Plain language:
"the workflow ran out of memory."

### Fix
- Increase the `memory` value in `resources.default` in `workflow.yaml`. Start by
  doubling it; if the workload's peak memory is known, set it ~20% above that peak.
- If memory is already at the node's cap, reduce per-task work (smaller batch size,
  fewer parallel workers, smaller chunks of input data) so peak usage drops.
- Validate the new memory value against `references/validation-error-recovery.md`
  sizing rules before submitting.

---

## Exit code 139 (segfault)

### Signature
- `exit_code: 139` on the failed task.
- Logs may show a stack trace or end abruptly with no error message.

### Diagnosis
The process received SIGSEGV — usually a native code crash (CUDA driver/library
mismatch, broken C extension, hardware fault, or an uncaught native exception).

### Fix
- Check that the container image's CUDA / cuDNN / NCCL versions match the GPU
  driver on the node (e.g. driver version visible in `nvidia-smi` output if the
  script logs it).
- If using a custom image, rebuild with versions known to work on the target nodes.
- If it's a transient hardware issue, resubmit once — repeated segfaults on the
  same node may indicate a bad GPU; ask the user to file a ticket with the node
  name and timestamp.

---

## Exit code 143 (SIGTERM)

### Signature
- `exit_code: 143`.
- Logs include `Killing: Stopping container <name>` from the kubelet.
- Workflow status often `FAILED_CANCELED` rather than `FAILED`.

### Diagnosis
The pod received SIGTERM — typically from cancellation, preemption (LOW priority
workloads), or a node going into maintenance.

### Fix
- If the user cancelled, no fix needed.
- If `--priority LOW` was used, expect occasional preemption — resubmit at NORMAL
  priority once quota is available, or accept the preemption risk.
- If neither — check `osmo workflow events` for node maintenance or eviction
  reasons, and ask the user to resubmit.

---

## Exit code 127 (command not found)

### Signature
- `exit_code: 127`.
- Logs show `<command>: command not found` near the end (e.g. `jq: command not
  found`, `python: command not found`).

### Diagnosis
The entry script invoked a binary that isn't in the container image's PATH. Common
victims: `jq`, `git`, `curl`, `wget`, language runtimes, `gcloud`/`aws`/`az` CLIs.

### Fix
- Add an install step at the top of the entry script, e.g.:
  ```bash
  apt-get update && apt-get install -y jq
  ```
  (Adjust for the distro: `apk add` for Alpine, `dnf install` for RHEL family.)
- Or rewrite the script to use a tool that's already in the image (e.g. pure bash
  in place of `jq`, `python -m json.tool` if Python is present).
- Or switch to a base image that includes the missing tool.

---

## ImagePullBackOff / ErrImagePull

### Signature
- Pod stuck before any user logs appear.
- Events show `Failed to pull image "<image>"` with reasons like `not found`,
  `unauthorized`, `denied`, or `manifest unknown`.

### Diagnosis
The container runtime cannot fetch the image:
- **Bad tag or path** — image name or tag doesn't exist in the registry.
- **Auth failure** — the cluster lacks credentials for a private registry.
- **Registry outage** — transient network or registry-side issue.

### Fix
- Verify the image exists at that exact tag (e.g. `docker pull <image>` from a
  workstation with the same credentials).
- If using a private registry, check that the cluster has the right pull secret
  configured. If not, the user needs to coordinate with their OSMO admin.
- For transient issues, resubmit once. If it keeps failing, switch to a known-good
  image as a smoke test before debugging further.

---

## Init container failure (Init:CrashLoopBackOff)

### Signature
- Pod shows `Init:CrashLoopBackOff` or `Init:Error` in events.
- Container `osmo-init` (or similar) appears in events with non-zero exit.
- User's task logs are empty because the user container never started.

### Diagnosis
OSMO uses an init container to set up the workflow environment (download inputs,
prepare mounts). If init fails, the user task never runs.

### Fix
- Common init failures:
  - **Input dataset missing or wrong name** — verify the dataset name in
    `inputs.dataset.name` matches an existing dataset (`osmo dataset list`).
  - **Storage backend auth** — credentials for the pool's storage backend may be
    misconfigured; this is an admin issue, ask the user to file a ticket.
  - **Network/permission issue** — events usually carry the underlying error.
- Read the init container's logs explicitly:
  ```
  osmo workflow logs <id> --task <task_name> -n 10000
  ```

---

## NCCL / multi-GPU communication timeout

### Signature
- Logs include `NCCL` errors, `nccl timeout`, `socketStartConnect`, or
  `IBV_WC_RETRY_EXC_ERR`.
- Multi-GPU training that worked at smaller scale fails at larger scale.

### Diagnosis
Inter-GPU communication is broken or too slow. Possible causes:
- Pods landed on nodes that aren't in the same fast-network domain (no shared
  RDMA / InfiniBand fabric).
- Network plugin misconfiguration on the cluster.
- Specific NCCL version incompatibility with the GPU/driver combination.

### Fix
- For pod placement, the workflow may need topology constraints — see
  `references/advanced-patterns.md` for `topology_keys` usage.
- Set NCCL env vars in the workflow's `environment:` block to debug:
  - `NCCL_DEBUG=INFO` (verbose logging)
  - `NCCL_SOCKET_IFNAME=eth0` (force a specific interface)
- If suspected version issue, pin a known-working NCCL version in the image.
- For RDMA-specific failures, the cluster may need admin attention.

---

## Output dataset empty or missing after COMPLETED

### Signature
- Workflow status `COMPLETED`, exit code `0`.
- The output dataset listed in the workflow spec exists but is empty, or the
  expected files aren't there.
- Common: the entry script created a directory like `{{outputs}}` or `output` as a
  literal name on the local filesystem instead of writing to the OSMO-mounted
  output path.

### Diagnosis
The script didn't write to the OSMO output mount. The workflow's `outputs` are
declared via `outputs.dataset.name`, and the script is expected to write into the
path indicated by the placeholder `{{output}}` (singular).

### Fix
- Audit the entry script for the placeholder. **The correct token is `{{output}}`
  (singular).** A common typo is `{{outputs}}` (plural) — that string is not
  substituted by OSMO at runtime, so the script ends up with a literal directory
  named `{{outputs}}` on local disk that's never uploaded.
- After fixing the placeholder, rerun. Output upload happens at task completion;
  watch `osmo workflow query` for `output_upload_start_time` to confirm.

---

## Validation error at submission time

### Signature
- `osmo workflow submit` returns a non-zero exit and prints a validation error
  table — typically resource-related, listing each task's requested values vs node
  capacity.

### Diagnosis
The cluster rejected the submission before the workflow ever started a pod. The
requested resources exceed what any node in the chosen pool can offer.

### Fix
- See `references/validation-error-recovery.md` for the sizing rules to apply.
- Adjust the hard-coded values in `workflow.yaml`'s `resources` block per the
  rules, then resubmit.
- Do not modify Jinja template variables (`{{num_gpu}}`, etc.) — those are
  resolved at runtime via `--set`.

---

## Logs are empty or sparse

### Signature
- `osmo workflow logs <id>` returns nothing or only container-startup banners.

### Diagnosis
- The workflow may still be in container startup (image pulling, init container
  running) — fetch events instead.
- Or the user's script may be producing stdout that's buffered and not yet
  flushed.
- Or this is a multi-task workflow and logs need to be fetched per-task.

### Fix
- For multi-task workflows, use `--task <task_name>` per task, or delegate to the
  `logs-reader` subagent (see `agents/logs-reader.md`).
- For buffered output, suggest the user add `python -u` (unbuffered) for Python
  scripts, or `stdbuf -oL` for general commands, in their entry script.
- If logs are truly empty, check pod events for what's blocking (image pull,
  scheduling, init failure).

---

## How to add a pattern to this catalog

When you see a new failure pattern in the wild that you had to figure out by hand,
add a section here with the same shape: **Signature / Diagnosis / Fix**. Keep
diagnoses in plain language, and keep fixes concrete enough that the next agent
can apply them mechanically.
