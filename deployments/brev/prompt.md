# OSMO Brev Provider Compatibility Test

Run a compatibility test of the OSMO Brev launchable across GPU providers. No user interaction — proceed through all phases without interruption.

## Environment

| Variable | Value |
|----------|-------|
| Instance prefix | `osmo-compat-{{GITHUB_RUN_ID}}` |
| OSMO binary (on instances) | `/usr/local/bin/osmo` |
| NGC credential name | `ci-ngc-cred` |
| NGC key env var (CI runner) | `NGC_SERVICE_KEY` |
| setup.sh (local path) | `deployments/brev/setup.sh` |
| disk-fill workflow (local path) | `deployments/brev/disk-fill-test.yaml` |
| Hello world workflow URL | `https://raw.githubusercontent.com/NVIDIA/OSMO/{{GITHUB_SHA}}/cookbook/tutorials/hello_world.yaml` |
| GPU workflow URL | `https://raw.githubusercontent.com/NVIDIA/OSMO/{{GITHUB_SHA}}/cookbook/dnn_training/single_node/train.yaml` |
| GPU training script URL | `https://raw.githubusercontent.com/NVIDIA/OSMO/{{GITHUB_SHA}}/cookbook/dnn_training/single_node/train.py` |

## Skill usage

Use `/brev-cli` for **all** brev operations (search, create, exec, delete, status).

OSMO runs on remote instances — never locally. Consult `/osmo-agent` for OSMO CLI
syntax only, then pass those commands through `brev exec`. Do not hardcode brev or
OSMO CLI flags; delegate through these skills so this prompt stays stable as CLIs evolve.

## Phase 1 — Discover instance types

Use `/brev-cli` to search for available instances. Target:
- All available **L40** instance types across all providers (1 GPU each)
- All available **L40S** instance types across all providers (1 GPU each)

For each unique provider+GPU combination select the cheapest available type.
Present a candidate table (provider, type, GPU, disk, $/hr) and proceed immediately
without waiting for confirmation.

## Phase 2 — Create instances (parallel)

Create all instances in parallel. Name each:
`osmo-compat-{{GITHUB_RUN_ID}}-<provider>-<gpu-slug>`
(e.g. `osmo-compat-{{GITHUB_RUN_ID}}-hyperstack-l40-1g`)

Do **not** use `--startup-script` — setup.sh exceeds the 16 KB limit.
Create bare instances, then run setup.sh via `brev exec @file` once READY.

If creation fails for a specific type, retry up to 3 times before giving up.
After 3 failed attempts, record all tests as `❌` with the error note.

## Phase 3 — Setup each instance (parallel across instances)

For each successfully created instance:

### 3a. Run setup script
```
brev exec <instance> @deployments/brev/setup.sh
```
This installs Docker, KIND, GPU operator, KAI scheduler, and OSMO (~15 min).

### 3b. Wait for OSMO pods
Poll until all pods in namespace `osmo` are Running/Completed (max 30 min).

### 3c. Configure NGC credential
Pass the key via the runner's environment variable — never print it:
```bash
brev exec <instance> -- bash -c \
  "osmo credential set ci-ngc-cred --type REGISTRY \
   --payload registry=nvcr.io username='\$oauthtoken' auth='$NGC_SERVICE_KEY'"
```

## Phase 4 — Test suite (parallel across instances, sequential per instance)

If any step fails for an instance, record `❌` and skip all remaining steps
for that instance. Run instances in parallel.

### Test A: Hello World (CPU)

Fetch the hello world workflow from the cookbook URL above, copy to the instance,
and submit it. Parse the workflow ID from `osmo workflow submit` stdout:
```
Workflow ID - <id>
```
Poll by that specific ID (not by name) every 30 s. Timeout: 15 min.

Record: ✅ / ❌

### Test B: Disk Fill (~40 GB)

Copy `deployments/brev/disk-fill-test.yaml` to the instance, submit it.
This pulls `nvcr.io/nvidia/nemo:24.12` using `ci-ngc-cred`, validating that the
Docker data-root relocation in setup.sh prevents root-partition exhaustion.
Poll by workflow ID. Timeout: 90 min.

Record: ✅ / ❌

### Test C: GPU Workload

First run `osmo pool list` and verify at least one GPU is available in the default
pool. If not, record `❌` with note "no GPUs in default pool" and stop — do
not submit the workflow.

Otherwise, fetch the GPU training workflow and script from the cookbook URLs above.
Copy both to the instance. Submit the workflow.
Poll by workflow ID. Timeout: 30 min.

If `brev exec` fails with a ControlPath/socket-path error for a specific instance,
record `❌` with note "brev SSH socket-path error".

Record: ✅ / ❌ / `—` (CPU-only instance, GPU test not applicable)

## Phase 5 — Teardown

Delete all instances created in Phase 2 after tests complete. Always delete, even
if earlier phases failed. Do not ask for confirmation.

## Phase 6 — Write results

Update `deployments/brev/README.md`. Find the `## Compatibility Matrix` section and
replace the table with current results. Preserve all text outside that section.

Table columns:
```
| Provider | Instance Type | GPU | Hello World | Disk Fill | GPU Workload | Notes |
```

Set "Last updated" to today's date. Sort rows so fully-passing instances appear
first, partial failures next, and fully-failed instances last. Keep Notes brief
(≤8 words); omit notes for fully-passing instances.

Status codes:
- ✅ — test passed
- ❌ — failure; include a note explaining the cause (OSMO bug, brev SSH error,
  instance creation failure, etc.)
- `—` — not applicable (e.g. GPU test on a CPU-only instance)

After writing README.md, compare results against the previous matrix that was in
`deployments/brev/README.md` before this run. Write a single line to
`compat-result.txt` in the current working directory:
- `FAIL` if any instance that previously had ✅ now has ❌
- `PASS` otherwise (new instances and previously-failing instances do not affect the result)
