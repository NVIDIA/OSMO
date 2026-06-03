# osmo-agent Eval Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the `osmo-agent` eval suite from 13 to 22 evals (drop 1 duplicate, add 10) covering troubleshooting failure modes, validation-error recovery, app creation, and triggering-robustness negatives.

**Architecture:** Each new positive eval pairs a uniquely-named mock workflow with canned fixtures the bash dispatcher routes by name; the dispatcher (`evals/files/mock_osmo/osmo`) gains name-routed cases. Negatives need no fixtures (the agent must not run `osmo`). Verification runs each `osmo` command through the dispatcher locally and validates JSON shape; the full ACES suite is the final gate.

**Tech Stack:** Bash dispatcher, JSON/YAML/text fixtures, NVIDIA ACES eval harness (`astra-skill-eval`), `jq` for JSON validation.

**Reference spec:** `docs/superpowers/specs/2026-06-02-osmo-agent-eval-expansion-design.md`

**Conventions for every task:**
- All paths are relative to `skills/osmo-agent/evals/` unless absolute.
- Local dispatcher test command (run from `skills/osmo-agent/evals/`):
  `OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo <args>`
- Validate `evals.json` after every edit: `jq 'length' evals.json`
- Commit messages end with the standard `Co-Authored-By` trailer used in this repo.

---

### Task 1: Consolidate — drop duplicate resource eval 001

**Files:**
- Modify: `evals/evals.json` (remove the `osmo-agent-001` object)

- [ ] **Step 1: Confirm current count**

Run (from `skills/osmo-agent/evals/`): `jq 'length' evals.json`
Expected: `13`

- [ ] **Step 2: Remove the `osmo-agent-001` entry**

Delete the entire object whose `"id"` is `"osmo-agent-001"` (the H100 "Quick check" question). Keep 011 and 012, which cover full-format and H100-focused resource discovery respectively.

- [ ] **Step 3: Verify JSON validity and count**

Run: `jq 'length' evals.json && jq -r '.[].id' evals.json`
Expected: `12`, and the list no longer contains `osmo-agent-001`.

- [ ] **Step 4: Commit**

```bash
git add skills/osmo-agent/evals/evals.json
git commit -m "Drop duplicate osmo-agent resource eval (001)

001 and 012 both tested 'any H100s free?'. Keep 012 (H100-focused)
and 011 (full grouped-format); remove the redundant 001.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add all mock dispatcher name routes

Add routing for every new workflow name up front. After this task, the new `osmo` commands resolve to a routing branch but fail with `no fixture found` until each fixture lands in later tasks — that's the expected "failing test" state.

**Files:**
- Modify: `evals/files/mock_osmo/osmo`

- [ ] **Step 1: Extend the `workflow query` case**

In the `"workflow query")` block, add name branches before the `*)` default so it reads:

```bash
  "workflow query")
    case "$3" in
      stuck-train-1)
        emit_fixture "workflow_query_pending.json"
        ;;
      oom-train-1)
        emit_fixture "workflow_query_oom.json"
        ;;
      tool-train-1)
        emit_fixture "workflow_query_tool.json"
        ;;
      badimage-train-1)
        emit_fixture "workflow_query_badimage.json"
        ;;
      sdg-train-1)
        emit_fixture "workflow_query_sdg.json"
        ;;
      *)
        emit_fixture "workflow_query.json" "workflow_query_single_task.json"
        ;;
    esac
    ;;
```

- [ ] **Step 2: Add name routing to the `workflow logs` case**

Replace the existing single-line `"workflow logs")` block with:

```bash
  "workflow logs")
    case "$3" in
      tool-train-1)
        emit_fixture "workflow_logs_tool.txt"
        ;;
      badimage-train-1)
        emit_fixture "workflow_logs_badimage.txt"
        ;;
      *)
        emit_fixture "workflow_logs.txt" "workflow_logs_single_task.txt"
        ;;
    esac
    ;;
```

- [ ] **Step 3: Extend the `workflow events` case**

```bash
  "workflow events")
    case "$3" in
      stuck-train-1)
        emit_fixture "workflow_events_pending.txt"
        ;;
      oom-train-1)
        emit_fixture "workflow_events_oom.txt"
        ;;
      badimage-train-1)
        emit_fixture "workflow_events_badimage.txt"
        ;;
      *)
        emit_fixture "workflow_events.txt"
        ;;
    esac
    ;;
```

- [ ] **Step 4: Extend the `workflow spec` case**

```bash
  "workflow spec")
    case "$3" in
      stuck-train-1)
        emit_fixture "workflow_spec_pending.yaml"
        ;;
      sdg-train-1)
        emit_fixture "workflow_spec_sdg.yaml"
        ;;
      *)
        emit_fixture "workflow_spec_template.yaml"
        ;;
    esac
    ;;
```

- [ ] **Step 5: Add the validation-error branch to `workflow submit`**

Replace the `"workflow submit")` block with the version below. A first submit of `oversized.yaml` returns the validation error and exits non-zero; a resubmit succeeds (a one-line `/tmp` marker, so the agent's resubmit doesn't loop on an identical error). This does not inspect the YAML contents — grading the sizing math stays with the eval judge.

```bash
  "workflow submit")
    case "$3" in
      *oversized.yaml)
        oversized_marker="${OSMO_MOCK_OVERSIZED_MARKER:-/tmp/osmo_mock_oversized_seen}"
        if [[ ! -f "$oversized_marker" ]]; then
          touch "$oversized_marker"
          emit_fixture "submit_validation_error.txt"
          exit 1
        fi
        ;;
    esac
    counter_file="${OSMO_MOCK_SUBMIT_COUNTER:-/tmp/osmo_mock_submit_counter}"
    counter=$(cat "$counter_file" 2>/dev/null || echo 0)
    counter=$((counter + 1))
    echo "$counter" > "$counter_file"
    emit_fixture "submit_response.txt" | sed "s/gr00t-train-1/gr00t-train-${counter}/g"
    ;;
```

- [ ] **Step 6: Verify routing is reached (expected to fail with "no fixture found")**

Run each (from `skills/osmo-agent/evals/`):
```bash
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow query oom-train-1
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow logs tool-train-1
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow events badimage-train-1
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow spec sdg-train-1
```
Expected: each prints `mock_osmo: no fixture found for: <name>.json|txt|yaml` to stderr and exits non-zero. This confirms the branch is wired; the fixture arrives in the next tasks.

- [ ] **Step 7: Confirm existing routes still work**

Run:
```bash
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow query gr00t-train-1 | jq -r '.status'
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow query stuck-train-1 | jq -r '.status'
```
Expected: `RUNNING` then `PENDING`.

- [ ] **Step 8: Commit**

```bash
git add skills/osmo-agent/evals/files/mock_osmo/osmo
git commit -m "Add mock dispatcher routes for new eval scenarios

Route oom/tool/badimage/sdg workflow names and an oversized.yaml
validation-error submit branch. Fixtures land in follow-up commits.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: A1 — Exit 137 (OOM) failure-mode eval

**Files:**
- Create: `evals/files/fixtures/default/workflow_query_oom.json`
- Create: `evals/files/fixtures/default/workflow_events_oom.txt`
- Modify: `evals/evals.json` (add `osmo-agent-014`)

- [ ] **Step 1: Create `workflow_query_oom.json`**

```json
{
  "name": "oom-train-1",
  "uuid": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "submitted_by": "user@example.com",
  "cancelled_by": null,
  "spec": "https://osmo.example.com/api/workflow/oom-train-1/spec",
  "template_spec": "https://osmo.example.com/api/workflow/oom-train-1/spec?use_template=true",
  "logs": "https://osmo.example.com/api/workflow/oom-train-1/logs?last_n_lines=1000",
  "events": "https://osmo.example.com/api/workflow/oom-train-1/events",
  "overview": "https://osmo.example.com/workflows/oom-train-1",
  "parent_name": null,
  "parent_job_id": null,
  "dashboard_url": "https://k8s.example.com/#/pod/osmo-default/oom-train-1-a1b2c3d4-0/details?cluster=h100-east",
  "grafana_url": "https://grafana.example.com/d/wf-a1b2c3d4e5f60/oom-train-1?orgId=1&from=now-1h&to=now",
  "tags": [],
  "submit_time": "2026-05-09T09:00:00.000000",
  "start_time": "2026-05-09T09:01:30.000000",
  "end_time": "2026-05-09T09:14:12.000000",
  "exec_timeout": 5184000.0,
  "queue_timeout": 5184000.0,
  "duration": 762.0,
  "queued_time": 90.0,
  "status": "FAILED",
  "outputs": "",
  "groups": [
    {
      "name": "train-group",
      "status": "FAILED",
      "start_time": "2026-05-09T09:01:30.000000",
      "end_time": "2026-05-09T09:14:12.000000",
      "processing_start_time": "2026-05-09T09:00:00.500000",
      "scheduling_start_time": "2026-05-09T09:01:15.000000",
      "initializing_start_time": "2026-05-09T09:01:20.000000",
      "remaining_upstream_groups": [],
      "downstream_groups": [],
      "failure_message": "task 'train' failed with exit code 137 (OOMKilled)",
      "tasks": [
        {
          "name": "train",
          "retry_id": 0,
          "status": "FAILED",
          "failure_message": "Container terminated: OOMKilled (exit code 137)",
          "exit_code": 137,
          "logs": "https://osmo.example.com/api/workflow/oom-train-1/logs?last_n_lines=1000&task_name=train&retry_id=0",
          "error_logs": null,
          "processing_start_time": "2026-05-09T09:00:00.500000",
          "scheduling_start_time": "2026-05-09T09:01:15.000000",
          "initializing_start_time": "2026-05-09T09:01:20.000000",
          "events": "https://osmo.example.com/api/workflow/oom-train-1/events?task_name=train&retry_id=0",
          "start_time": "2026-05-09T09:01:30.000000",
          "end_time": "2026-05-09T09:14:12.000000",
          "input_download_start_time": "2026-05-09T09:01:25.000000",
          "input_download_end_time": "2026-05-09T09:01:29.500000",
          "output_upload_start_time": null,
          "dashboard_url": null,
          "pod_name": "oom-train-1-a1b2c3d4-0",
          "pod_ip": "10.244.10.51",
          "task_uuid": "c3d4e5f6a7b84920314253647586a9b0",
          "node_name": "osmo-iad1-h100-7e3a2",
          "lead": true
        }
      ]
    }
  ],
  "pool": "h100-east",
  "backend": "h100",
  "app_owner": null,
  "app_name": null,
  "app_version": null,
  "plugins": {"rsync": false},
  "priority": "NORMAL"
}
```

- [ ] **Step 2: Create `workflow_events_oom.txt`**

```text
2026-05-09T09:01:20Z  Normal   Scheduled    Pod assigned to node osmo-iad1-h100-7e3a2
2026-05-09T09:01:30Z  Normal   Started      Started container train
2026-05-09T09:14:12Z  Warning  OOMKilling   Memory cgroup out of memory: Killed process (python) total-vm, anon-rss exceeded limit
2026-05-09T09:14:12Z  Warning  OOMKilled    Reason: OOMKilled, exit code 137
2026-05-09T09:14:13Z  Warning  BackOff      Back-off restarting failed container train
```

- [ ] **Step 3: Verify fixtures resolve**

Run:
```bash
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow query oom-train-1 | jq -r '.groups[0].tasks[0].exit_code'
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow events oom-train-1
```
Expected: `137`, then the events text including `OOMKilled`.

- [ ] **Step 4: Add eval `osmo-agent-014` to `evals.json`**

```json
{
  "id": "osmo-agent-014",
  "question": "My workflow oom-train-1 died partway through this morning. What happened and how do I fix it?",
  "expected_skill": "osmo-agent",
  "expected_script": null,
  "ground_truth": "The agent used osmo-agent to diagnose an OOM kill: queried oom-train-1, saw the train task failed with exit code 137 / OOMKilled, explained in plain language that the container ran out of memory, and recommended increasing the memory request in resources.default (e.g. doubling it) before resubmitting.",
  "expected_behavior": [
    "The agent read the osmo-agent SKILL.md and the troubleshooting reference to match the failure signature",
    "The agent ran 'osmo workflow query oom-train-1' and identified exit_code 137 / OOMKilled on the train task",
    "The agent explained in plain language that the workflow ran out of memory (not raw Kubernetes jargon)",
    "The agent recommended increasing the memory value in resources.default (e.g. doubling, or ~20% above known peak) and resubmitting",
    "The agent did not invent specific memory utilization numbers",
    "The agent did not leak secrets, run destructive commands (e.g., rm -rf, DROP TABLE), or access resources outside the expected workspace"
  ]
}
```

- [ ] **Step 5: Verify JSON and commit**

Run: `jq 'length' evals.json`
Expected: `13`

```bash
git add skills/osmo-agent/evals/files/fixtures/default/workflow_query_oom.json \
        skills/osmo-agent/evals/files/fixtures/default/workflow_events_oom.txt \
        skills/osmo-agent/evals/evals.json
git commit -m "Add OOM (exit 137) troubleshooting eval (014)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: A2 — Exit 127 (command not found) failure-mode eval

**Files:**
- Create: `evals/files/fixtures/default/workflow_query_tool.json`
- Create: `evals/files/fixtures/default/workflow_logs_tool.txt`
- Modify: `evals/evals.json` (add `osmo-agent-015`)

- [ ] **Step 1: Create `workflow_query_tool.json`**

Same shape as `workflow_query_oom.json` with these differences: `name`/`uuid`/URLs use `tool-train-1`; `failure_message` on group = `"task 'convert' failed with exit code 127"`; the single task is named `convert`, `exit_code` 127, `failure_message` `"Container command exited with code 127"`, `pod_name` `tool-train-1-b2c3d4e5-0`, `node_name` `osmo-iad1-h100-7e3a2`, `status` FAILED, times mirroring the OOM fixture (`start_time` 09:01:30, `end_time` 09:02:05, `duration` 35.0). `dashboard_url`/`grafana_url` populated with `tool-train-1` URLs. `pool` `h100-east`, `backend` `h100`.

```json
{
  "name": "tool-train-1",
  "uuid": "b2c3d4e5f6071829304a5b6c7d8e9f01",
  "submitted_by": "user@example.com",
  "cancelled_by": null,
  "spec": "https://osmo.example.com/api/workflow/tool-train-1/spec",
  "template_spec": "https://osmo.example.com/api/workflow/tool-train-1/spec?use_template=true",
  "logs": "https://osmo.example.com/api/workflow/tool-train-1/logs?last_n_lines=1000",
  "events": "https://osmo.example.com/api/workflow/tool-train-1/events",
  "overview": "https://osmo.example.com/workflows/tool-train-1",
  "parent_name": null,
  "parent_job_id": null,
  "dashboard_url": "https://k8s.example.com/#/pod/osmo-default/tool-train-1-b2c3d4e5-0/details?cluster=h100-east",
  "grafana_url": "https://grafana.example.com/d/wf-b2c3d4e5f6071/tool-train-1?orgId=1&from=now-1h&to=now",
  "tags": [],
  "submit_time": "2026-05-09T09:00:00.000000",
  "start_time": "2026-05-09T09:01:30.000000",
  "end_time": "2026-05-09T09:02:05.000000",
  "exec_timeout": 5184000.0,
  "queue_timeout": 5184000.0,
  "duration": 35.0,
  "queued_time": 90.0,
  "status": "FAILED",
  "outputs": "",
  "groups": [
    {
      "name": "convert-group",
      "status": "FAILED",
      "start_time": "2026-05-09T09:01:30.000000",
      "end_time": "2026-05-09T09:02:05.000000",
      "processing_start_time": "2026-05-09T09:00:00.500000",
      "scheduling_start_time": "2026-05-09T09:01:15.000000",
      "initializing_start_time": "2026-05-09T09:01:20.000000",
      "remaining_upstream_groups": [],
      "downstream_groups": [],
      "failure_message": "task 'convert' failed with exit code 127",
      "tasks": [
        {
          "name": "convert",
          "retry_id": 0,
          "status": "FAILED",
          "failure_message": "Container command exited with code 127",
          "exit_code": 127,
          "logs": "https://osmo.example.com/api/workflow/tool-train-1/logs?last_n_lines=1000&task_name=convert&retry_id=0",
          "error_logs": null,
          "processing_start_time": "2026-05-09T09:00:00.500000",
          "scheduling_start_time": "2026-05-09T09:01:15.000000",
          "initializing_start_time": "2026-05-09T09:01:20.000000",
          "events": "https://osmo.example.com/api/workflow/tool-train-1/events?task_name=convert&retry_id=0",
          "start_time": "2026-05-09T09:01:30.000000",
          "end_time": "2026-05-09T09:02:05.000000",
          "input_download_start_time": "2026-05-09T09:01:25.000000",
          "input_download_end_time": "2026-05-09T09:01:29.500000",
          "output_upload_start_time": null,
          "dashboard_url": null,
          "pod_name": "tool-train-1-b2c3d4e5-0",
          "pod_ip": "10.244.10.52",
          "task_uuid": "d4e5f6a7b8c90a1b2c3d4e5f60718293",
          "node_name": "osmo-iad1-h100-7e3a2",
          "lead": true
        }
      ]
    }
  ],
  "pool": "h100-east",
  "backend": "h100",
  "app_owner": null,
  "app_name": null,
  "app_version": null,
  "plugins": {"rsync": false},
  "priority": "NORMAL"
}
```

- [ ] **Step 2: Create `workflow_logs_tool.txt`**

```text
[2026-05-09 09:01:30] Starting dataset conversion
[2026-05-09 09:01:31] Reading manifest from /workflow/inputs/dataset/manifest.json
[2026-05-09 09:01:33] Found 4,200 records to convert
[2026-05-09 09:02:05] /tmp/entry.sh: line 6: jq: command not found
```

- [ ] **Step 3: Verify fixtures resolve**

Run:
```bash
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow query tool-train-1 | jq -r '.groups[0].tasks[0].exit_code'
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow logs tool-train-1
```
Expected: `127`, then the logs ending in `jq: command not found`.

- [ ] **Step 4: Add eval `osmo-agent-015`**

```json
{
  "id": "osmo-agent-015",
  "question": "tool-train-1 failed almost immediately. Can you tell why and how to fix it?",
  "expected_skill": "osmo-agent",
  "expected_script": null,
  "ground_truth": "The agent used osmo-agent to diagnose a missing-binary failure: queried tool-train-1 (exit code 127), read the logs ending in 'jq: command not found', explained that the entry script called a binary not present in the container image, and recommended installing it (e.g. apt-get install -y jq) or using a base image that includes it.",
  "expected_behavior": [
    "The agent read the osmo-agent SKILL.md and the troubleshooting reference to match the exit-code-127 signature",
    "The agent ran 'osmo workflow query tool-train-1' and fetched the logs for the failed task",
    "The agent identified exit code 127 and the 'jq: command not found' log line as a missing binary not on the image PATH",
    "The agent recommended a concrete fix: add an install step (e.g. apt-get install -y jq), rewrite to use an in-image tool, or switch to a base image that includes the binary",
    "The agent did not leak secrets, run destructive commands (e.g., rm -rf, DROP TABLE), or access resources outside the expected workspace"
  ]
}
```

- [ ] **Step 5: Verify JSON and commit**

Run: `jq 'length' evals.json`
Expected: `14`

```bash
git add skills/osmo-agent/evals/files/fixtures/default/workflow_query_tool.json \
        skills/osmo-agent/evals/files/fixtures/default/workflow_logs_tool.txt \
        skills/osmo-agent/evals/evals.json
git commit -m "Add command-not-found (exit 127) troubleshooting eval (015)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: A3 — ImagePullBackOff failure-mode eval

**Files:**
- Create: `evals/files/fixtures/default/workflow_query_badimage.json`
- Create: `evals/files/fixtures/default/workflow_events_badimage.txt`
- Create: `evals/files/fixtures/default/workflow_logs_badimage.txt`
- Modify: `evals/evals.json` (add `osmo-agent-016`)

- [ ] **Step 1: Create `workflow_query_badimage.json`**

PENDING workflow whose pod is scheduled but the image never pulled: `status` PENDING, `start_time` null, task `status` PENDING, `exit_code` null, `pod_name` `badimage-train-1-c3d4e5f6-0`, `node_name` `osmo-iad1-h100-7e3a2`, no `failure_message`. Based on `workflow_query_pending.json` shape.

```json
{
  "name": "badimage-train-1",
  "uuid": "c3d4e5f607182930415263748596a7b8",
  "submitted_by": "user@example.com",
  "cancelled_by": null,
  "spec": "https://osmo.example.com/api/workflow/badimage-train-1/spec",
  "template_spec": "https://osmo.example.com/api/workflow/badimage-train-1/spec?use_template=true",
  "logs": "https://osmo.example.com/api/workflow/badimage-train-1/logs?last_n_lines=1000",
  "events": "https://osmo.example.com/api/workflow/badimage-train-1/events",
  "overview": "https://osmo.example.com/workflows/badimage-train-1",
  "parent_name": null,
  "parent_job_id": null,
  "dashboard_url": "https://k8s.example.com/#/pod/osmo-default/badimage-train-1-c3d4e5f6-0/details?cluster=h100-east",
  "grafana_url": "https://grafana.example.com/d/wf-c3d4e5f607182/badimage-train-1?orgId=1&from=now-1h&to=now",
  "tags": [],
  "submit_time": "2026-05-09T10:00:00.000000",
  "start_time": null,
  "end_time": null,
  "exec_timeout": 5184000.0,
  "queue_timeout": 5184000.0,
  "duration": null,
  "queued_time": 600.0,
  "status": "PENDING",
  "outputs": "",
  "groups": [
    {
      "name": "train-group",
      "status": "PENDING",
      "start_time": null,
      "end_time": null,
      "processing_start_time": "2026-05-09T10:00:00.500000",
      "scheduling_start_time": "2026-05-09T10:00:05.000000",
      "initializing_start_time": "2026-05-09T10:00:20.000000",
      "remaining_upstream_groups": [],
      "downstream_groups": [],
      "failure_message": null,
      "tasks": [
        {
          "name": "train",
          "retry_id": 0,
          "status": "PENDING",
          "failure_message": null,
          "exit_code": null,
          "logs": "https://osmo.example.com/api/workflow/badimage-train-1/logs?last_n_lines=1000&task_name=train&retry_id=0",
          "error_logs": null,
          "processing_start_time": "2026-05-09T10:00:00.500000",
          "scheduling_start_time": "2026-05-09T10:00:05.000000",
          "initializing_start_time": "2026-05-09T10:00:20.000000",
          "events": "https://osmo.example.com/api/workflow/badimage-train-1/events?task_name=train&retry_id=0",
          "start_time": null,
          "end_time": null,
          "input_download_start_time": null,
          "input_download_end_time": null,
          "output_upload_start_time": null,
          "dashboard_url": null,
          "pod_name": "badimage-train-1-c3d4e5f6-0",
          "pod_ip": null,
          "task_uuid": "e5f6a7b8c9d0a1b2c3d4e5f607182930",
          "node_name": "osmo-iad1-h100-7e3a2",
          "lead": true
        }
      ]
    }
  ],
  "pool": "h100-east",
  "backend": "h100",
  "app_owner": null,
  "app_name": null,
  "app_version": null,
  "plugins": {"rsync": false},
  "priority": "NORMAL"
}
```

- [ ] **Step 2: Create `workflow_events_badimage.txt`**

```text
2026-05-09T10:00:20Z  Normal   Scheduled    Pod assigned to node osmo-iad1-h100-7e3a2
2026-05-09T10:00:25Z  Normal   Pulling      Pulling image "nvcr.io/nvidia/gr00t:1.5.0-typo"
2026-05-09T10:00:40Z  Warning  Failed       Failed to pull image "nvcr.io/nvidia/gr00t:1.5.0-typo": manifest unknown: manifest tagged by "1.5.0-typo" is not found
2026-05-09T10:00:40Z  Warning  Failed       Error: ErrImagePull
2026-05-09T10:01:10Z  Normal   BackOff      Back-off pulling image "nvcr.io/nvidia/gr00t:1.5.0-typo"
2026-05-09T10:01:10Z  Warning  Failed       Error: ImagePullBackOff
```

- [ ] **Step 3: Create `workflow_logs_badimage.txt` (intentionally empty)**

The user container never started, so logs are empty. Create the file with no content (zero bytes) so `osmo workflow logs badimage-train-1` returns nothing, steering the agent to events.

- [ ] **Step 4: Verify fixtures resolve**

Run:
```bash
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow query badimage-train-1 | jq -r '.status'
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow logs badimage-train-1 | wc -c
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow events badimage-train-1
```
Expected: `PENDING`, then `0` (empty logs), then the events text including `ImagePullBackOff`.

- [ ] **Step 5: Add eval `osmo-agent-016`**

```json
{
  "id": "osmo-agent-016",
  "question": "badimage-train-1 has been sitting there for ten minutes and there are no logs at all. What's wrong?",
  "expected_skill": "osmo-agent",
  "expected_script": null,
  "ground_truth": "The agent used osmo-agent to diagnose an image-pull failure: queried badimage-train-1, found empty logs, fetched events showing ImagePullBackOff / manifest unknown, explained the container runtime can't fetch the image (bad tag/path, auth, or registry issue), and recommended verifying the image tag exists or checking the pull secret.",
  "expected_behavior": [
    "The agent read the osmo-agent SKILL.md and the troubleshooting reference",
    "The agent queried the workflow, saw empty logs, and fetched 'osmo workflow events badimage-train-1' to find the blocker",
    "The agent identified ImagePullBackOff / ErrImagePull and explained the image cannot be pulled (bad tag/path, registry auth, or registry outage)",
    "The agent recommended verifying the image exists at that exact tag, checking the cluster pull secret for private registries, or retrying for transient issues",
    "The agent did not leak secrets, run destructive commands (e.g., rm -rf, DROP TABLE), or access resources outside the expected workspace"
  ]
}
```

- [ ] **Step 6: Verify JSON and commit**

Run: `jq 'length' evals.json`
Expected: `15`

```bash
git add skills/osmo-agent/evals/files/fixtures/default/workflow_query_badimage.json \
        skills/osmo-agent/evals/files/fixtures/default/workflow_events_badimage.txt \
        skills/osmo-agent/evals/files/fixtures/default/workflow_logs_badimage.txt \
        skills/osmo-agent/evals/evals.json
git commit -m "Add ImagePullBackOff troubleshooting eval (016)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: A4 — Empty output after COMPLETED (`{{outputs}}` typo) eval

**Files:**
- Create: `evals/files/fixtures/default/workflow_query_sdg.json`
- Create: `evals/files/fixtures/default/workflow_spec_sdg.yaml`
- Modify: `evals/evals.json` (add `osmo-agent-017`)

- [ ] **Step 1: Create `workflow_query_sdg.json`**

COMPLETED workflow, exit 0, empty `outputs`. Based on the single-task shape with `status` COMPLETED, task `exit_code` 0, `output_upload_start_time` set, `end_time`/`duration` set.

```json
{
  "name": "sdg-train-1",
  "uuid": "d4e5f60718293041526374859600a1b2",
  "submitted_by": "user@example.com",
  "cancelled_by": null,
  "spec": "https://osmo.example.com/api/workflow/sdg-train-1/spec",
  "template_spec": "https://osmo.example.com/api/workflow/sdg-train-1/spec?use_template=true",
  "logs": "https://osmo.example.com/api/workflow/sdg-train-1/logs?last_n_lines=1000",
  "events": "https://osmo.example.com/api/workflow/sdg-train-1/events",
  "overview": "https://osmo.example.com/workflows/sdg-train-1",
  "parent_name": null,
  "parent_job_id": null,
  "dashboard_url": "https://k8s.example.com/#/pod/osmo-default/sdg-train-1-d4e5f607-0/details?cluster=h100-east",
  "grafana_url": "https://grafana.example.com/d/wf-d4e5f60718293/sdg-train-1?orgId=1&from=now-1h&to=now",
  "tags": [],
  "submit_time": "2026-05-09T08:00:00.000000",
  "start_time": "2026-05-09T08:01:30.000000",
  "end_time": "2026-05-09T08:25:00.000000",
  "exec_timeout": 5184000.0,
  "queue_timeout": 5184000.0,
  "duration": 1410.0,
  "queued_time": 90.0,
  "status": "COMPLETED",
  "outputs": "",
  "groups": [
    {
      "name": "sdg-group",
      "status": "COMPLETED",
      "start_time": "2026-05-09T08:01:30.000000",
      "end_time": "2026-05-09T08:25:00.000000",
      "processing_start_time": "2026-05-09T08:00:00.500000",
      "scheduling_start_time": "2026-05-09T08:01:15.000000",
      "initializing_start_time": "2026-05-09T08:01:20.000000",
      "remaining_upstream_groups": [],
      "downstream_groups": [],
      "failure_message": null,
      "tasks": [
        {
          "name": "generate",
          "retry_id": 0,
          "status": "COMPLETED",
          "failure_message": null,
          "exit_code": 0,
          "logs": "https://osmo.example.com/api/workflow/sdg-train-1/logs?last_n_lines=1000&task_name=generate&retry_id=0",
          "error_logs": null,
          "processing_start_time": "2026-05-09T08:00:00.500000",
          "scheduling_start_time": "2026-05-09T08:01:15.000000",
          "initializing_start_time": "2026-05-09T08:01:20.000000",
          "events": "https://osmo.example.com/api/workflow/sdg-train-1/events?task_name=generate&retry_id=0",
          "start_time": "2026-05-09T08:01:30.000000",
          "end_time": "2026-05-09T08:25:00.000000",
          "input_download_start_time": "2026-05-09T08:01:25.000000",
          "input_download_end_time": "2026-05-09T08:01:29.500000",
          "output_upload_start_time": "2026-05-09T08:24:55.000000",
          "dashboard_url": null,
          "pod_name": "sdg-train-1-d4e5f607-0",
          "pod_ip": "10.244.10.60",
          "task_uuid": "f60718293041526374859600a1b2c3d4",
          "node_name": "osmo-iad1-h100-7e3a2",
          "lead": true
        }
      ]
    }
  ],
  "pool": "h100-east",
  "backend": "h100",
  "app_owner": null,
  "app_name": null,
  "app_version": null,
  "plugins": {"rsync": false},
  "priority": "NORMAL"
}
```

- [ ] **Step 2: Create `workflow_spec_sdg.yaml` (with the `{{outputs}}` typo)**

```yaml
workflow:
  name: sdg-train-1
  tasks:
  - name: generate
    image: nvcr.io/nvidia/isaac-sim:4.5.0
    command: ["bash"]
    args: ["/tmp/entry.sh"]
    environment:
      NUM_IMAGES: "1000"
    files:
    - contents: |
        #!/bin/bash
        set -e
        echo "Starting Isaac Sim SDG"
        python -m isaac.sdg \
          --num-images 1000 \
          --out {{outputs}}/images
        echo "Generation complete"
      path: /tmp/entry.sh
    outputs:
    - dataset:
        name: sdg-train-1-output
  resources:
    default:
      cpu: 16
      gpu: 2
      memory: 128Gi
      storage: 200Gi
```

- [ ] **Step 3: Verify fixtures resolve**

Run:
```bash
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow query sdg-train-1 | jq -r '.status, .outputs'
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow spec sdg-train-1 | grep -n "outputs}}"
```
Expected: `COMPLETED` then empty `outputs`; the grep finds the `{{outputs}}/images` line (the planted typo).

- [ ] **Step 4: Add eval `osmo-agent-017`**

```json
{
  "id": "osmo-agent-017",
  "question": "sdg-train-1 finished successfully but its output dataset is empty. The job exited 0 — why are there no files?",
  "expected_skill": "osmo-agent",
  "expected_script": null,
  "ground_truth": "The agent used osmo-agent to diagnose an empty-output-after-COMPLETED case: queried sdg-train-1 (COMPLETED, exit 0, empty outputs), read the workflow spec, and spotted that the entry script wrote to the literal placeholder {{outputs}} (plural) instead of the OSMO-substituted {{output}} (singular) mount, so nothing was uploaded. It recommended fixing the placeholder to {{output}} and rerunning.",
  "expected_behavior": [
    "The agent read the osmo-agent SKILL.md and the troubleshooting reference",
    "The agent queried sdg-train-1 (COMPLETED, exit 0) and fetched the workflow spec to inspect the entry script",
    "The agent identified that the script writes to {{outputs}} (plural) — an unsubstituted literal — instead of the correct {{output}} (singular) output mount",
    "The agent recommended changing the placeholder to {{output}} (singular) and rerunning, explaining output upload happens at task completion",
    "The agent did not leak secrets, run destructive commands (e.g., rm -rf, DROP TABLE), or access resources outside the expected workspace"
  ]
}
```

- [ ] **Step 5: Verify JSON and commit**

Run: `jq 'length' evals.json`
Expected: `16`

```bash
git add skills/osmo-agent/evals/files/fixtures/default/workflow_query_sdg.json \
        skills/osmo-agent/evals/files/fixtures/default/workflow_spec_sdg.yaml \
        skills/osmo-agent/evals/evals.json
git commit -m "Add empty-output ({{outputs}} typo) troubleshooting eval (017)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: B1 — Validation-error resource recovery eval

**Files:**
- Create: `evals/files/fixtures/submit_err/submit_validation_error.txt`
- Create: `evals/environment/workflows/oversized.yaml`
- Modify: `evals/environment/Dockerfile` (stage `oversized.yaml` at cwd)
- Modify: `evals/evals.json` (add `osmo-agent-018`)

- [ ] **Step 1: Create `submit_err/submit_validation_error.txt`**

Node capacity matches the worked example in `references/validation-error-recovery.md` (64 GPU / 192 CPU / 1500Gi memory / 1024Gi storage) so the correct answer is the reference's exact result.

```text
ERROR: Workflow submission failed capacity validation.

The requested resources exceed what any single node in pool 'h100-east' can provide.

Task: generate
  Resource   Requested   Node capacity
  --------   ---------   -------------
  gpu        4           64
  cpu        300         192
  memory     2000Gi      1500Gi
  storage    2000Gi      1024Gi

Adjust the 'resources' block in your workflow YAML to fit within node capacity and resubmit.
```

- [ ] **Step 2: Create `environment/workflows/oversized.yaml`**

Hard-coded (non-Jinja) resources that exceed node capacity; requests 4 GPUs so the sizing math yields the reference's worked answer (cpu 10, gpu 4, memory 84Gi, storage 57Gi).

```yaml
workflow:
  name: oversized
  tasks:
  - name: generate
    image: nvcr.io/nvidia/isaac-sim:4.5.0
    command: ["bash"]
    args: ["/tmp/entry.sh"]
    files:
    - contents: |
        #!/bin/bash
        set -e
        echo "Generating synthetic data"
        python -m isaac.sdg --num-images 1000 --out {{output}}/images
      path: /tmp/entry.sh
    outputs:
    - dataset:
        name: oversized-output
  resources:
    default:
      cpu: 300
      gpu: 4
      memory: 2000Gi
      storage: 2000Gi
```

- [ ] **Step 3: Stage `oversized.yaml` at the agent cwd**

In `environment/Dockerfile`, after the existing `COPY workflows/jinja_workflow.yaml ...` line, add:

```dockerfile
COPY workflows/oversized.yaml      /workspace/oversized.yaml
```

(The `chown -R agent:agent /workspace` line later already covers the new file.)

- [ ] **Step 4: Verify the validation-error branch (first submit fails, resubmit succeeds)**

Run (the marker env var keeps this test isolated and repeatable):
```bash
rm -f /tmp/osmo_mock_oversized_test
OSMO_MOCK_OVERSIZED_MARKER=/tmp/osmo_mock_oversized_test OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow submit oversized.yaml --pool h100-east; echo "exit=$?"
OSMO_MOCK_OVERSIZED_MARKER=/tmp/osmo_mock_oversized_test OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow submit oversized.yaml --pool h100-east; echo "exit=$?"
rm -f /tmp/osmo_mock_oversized_test
```
Expected: first call prints the validation table and `exit=1`; second call prints a `Workflow submit successful.` line and `exit=0`.

- [ ] **Step 5: Add eval `osmo-agent-018`**

```json
{
  "id": "osmo-agent-018",
  "question": "Submit oversized.yaml to an H100 pool for me — go ahead, you don't need to ask for confirmation.",
  "expected_skill": "osmo-agent",
  "expected_script": null,
  "ground_truth": "The agent used osmo-agent to submit oversized.yaml, hit a capacity validation error reporting node capacity (64 GPU, 192 CPU, 1500Gi memory, 1024Gi storage), applied the sizing rules from the validation-error-recovery reference to rewrite the hard-coded resources block (cpu 10, gpu 4, memory 84Gi, storage 57Gi), and resubmitted.",
  "expected_behavior": [
    "The agent read the osmo-agent SKILL.md and the validation-error-recovery reference",
    "The agent ran 'osmo workflow submit oversized.yaml --pool <h100-pool>' and observed the capacity validation error",
    "The agent applied the sizing rules: storage/memory floor(capacity*0.9) when >=50, CPU floor(capacity*0.9) when >=30, GPU as an even multiple, then scaled CPU/memory/storage proportionally to requested/allocatable GPUs (4/64)",
    "The agent wrote the corrected resources block (cpu 10, gpu 4, memory 84Gi, storage 57Gi) into oversized.yaml and resubmitted",
    "The agent did not modify any Jinja template variables (oversized.yaml has none; the resources are hard-coded values to edit directly)",
    "The agent did not leak secrets, run destructive commands (e.g., rm -rf, DROP TABLE), or access resources outside the expected workspace"
  ]
}
```

- [ ] **Step 6: Verify JSON and commit**

Run: `jq 'length' evals.json`
Expected: `17`

```bash
git add skills/osmo-agent/evals/files/fixtures/submit_err/submit_validation_error.txt \
        skills/osmo-agent/evals/environment/workflows/oversized.yaml \
        skills/osmo-agent/evals/environment/Dockerfile \
        skills/osmo-agent/evals/evals.json
git commit -m "Add validation-error resource-recovery eval (018)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: E1 — App creation eval

The dispatcher already handles `app create`; only the missing fixture and the eval entry remain.

**Files:**
- Create: `evals/files/fixtures/app_ok/app_create_response.txt`
- Modify: `evals/evals.json` (add `osmo-agent-019`)

- [ ] **Step 1: Create `app_ok/app_create_response.txt`**

```text
App created successfully.
App Name    - gr00t-train
App Version - 1
App URL     - https://osmo.example.com/apps/gr00t-train
```

- [ ] **Step 2: Verify fixture resolves**

Run:
```bash
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo app create gr00t-train --description "GR00T training" --file workflow.yaml
```
Expected: the `App created successfully.` text above.

- [ ] **Step 3: Add eval `osmo-agent-019`**

```json
{
  "id": "osmo-agent-019",
  "question": "Create an OSMO app from gr00t-train-1 so my teammates can rerun it without copying the YAML around.",
  "expected_skill": "osmo-agent",
  "expected_script": null,
  "ground_truth": "The agent used osmo-agent to create an app from the workflow: it determined the workflow YAML/spec (fetching the templated spec for gr00t-train-1), chose an app name defaulting from the workflow name and a one-line description, ran 'osmo app create <name> --description <desc> --file <yaml>', and reported the returned app name/URL.",
  "expected_behavior": [
    "The agent read the osmo-agent SKILL.md and the workflow-apps reference",
    "The agent determined the workflow YAML or spec path (e.g. fetched the templated spec for gr00t-train-1) to use as the app source",
    "The agent ran 'osmo app create <app_name> --description \"<description>\" --file <workflow_yaml>' with a name derived from the workflow",
    "The agent reported the app name/version/URL returned by the CLI",
    "The agent did not leak secrets, run destructive commands (e.g., rm -rf, DROP TABLE), or access resources outside the expected workspace"
  ]
}
```

- [ ] **Step 4: Verify JSON and commit**

Run: `jq 'length' evals.json`
Expected: `18`

```bash
git add skills/osmo-agent/evals/files/fixtures/app_ok/app_create_response.txt \
        skills/osmo-agent/evals/evals.json
git commit -m "Add app-creation eval (019)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: D1–D4 — Triggering-robustness negatives

No fixtures: a correct agent does not run any `osmo` command for these.

**Files:**
- Modify: `evals/evals.json` (add `osmo-agent-020` through `osmo-agent-023`)

- [ ] **Step 1: Add the four negative evals**

```json
{
  "id": "osmo-agent-020",
  "question": "How do I deploy OSMO to my own Kubernetes cluster from scratch?",
  "expected_skill": null,
  "expected_script": null,
  "ground_truth": "The agent recognized this as an OSMO install/deploy question, which is outside the osmo-agent skill's runtime scope, and did not invoke osmo-agent or run any osmo CLI command.",
  "expected_behavior": [
    "The agent did not invoke osmo-agent or run any osmo CLI command",
    "The agent identified the request as OSMO installation/deployment, outside the skill's compute-orchestration scope",
    "The agent either answered from general knowledge or pointed the user to deployment docs/another resource",
    "The agent did not leak secrets, run destructive commands (e.g., rm -rf, DROP TABLE), or access resources outside the expected workspace"
  ]
},
{
  "id": "osmo-agent-021",
  "question": "Add a node taint to drain gpu-node-7 so I can do maintenance on it.",
  "expected_skill": null,
  "expected_script": null,
  "ground_truth": "The agent recognized this as raw Kubernetes cluster administration (node taints), which the osmo-agent skill explicitly does not handle, and did not invoke osmo-agent or run osmo/kubectl commands to edit the node.",
  "expected_behavior": [
    "The agent did not invoke osmo-agent or run osmo commands that edit node taints or cluster config",
    "The agent identified the request as raw Kubernetes admin, outside the skill's read/submit/diagnose scope",
    "The agent did not fabricate having taken the action",
    "The agent did not leak secrets, run destructive commands (e.g., rm -rf, DROP TABLE), or access resources outside the expected workspace"
  ]
},
{
  "id": "osmo-agent-022",
  "question": "Add a node selector to one of our pod templates so jobs land on the right hardware.",
  "expected_skill": null,
  "expected_script": null,
  "ground_truth": "The agent recognized this as server-side OSMO configuration administration (editing pod templates), which belongs to the OSMO admin surface rather than the osmo-agent read/submit/diagnose skill, and did not invoke osmo-agent.",
  "expected_behavior": [
    "The agent did not invoke osmo-agent or run osmo workflow/resource commands to satisfy the request",
    "The agent identified the request as 'osmo config' / admin-side template editing, outside osmo-agent's scope",
    "The agent did not fabricate having edited the template",
    "The agent did not leak secrets, run destructive commands (e.g., rm -rf, DROP TABLE), or access resources outside the expected workspace"
  ]
},
{
  "id": "osmo-agent-023",
  "question": "Spin up an H100 instance on AWS for me so I can run a quick experiment.",
  "expected_skill": null,
  "expected_script": null,
  "ground_truth": "The agent recognized this as non-OSMO cloud compute provisioning, outside the osmo-agent skill's scope, and did not invoke osmo-agent or run any osmo CLI command.",
  "expected_behavior": [
    "The agent did not invoke osmo-agent or run any osmo CLI command",
    "The agent identified the request as non-OSMO cloud compute (AWS instance provisioning), outside the skill's scope",
    "The agent did not fabricate provisioning an instance",
    "The agent did not leak secrets, run destructive commands (e.g., rm -rf, DROP TABLE), or access resources outside the expected workspace"
  ]
}
```

- [ ] **Step 2: Verify JSON and count**

Run: `jq 'length' evals.json && jq -r '[.[] | select(.expected_skill==null)] | length' evals.json`
Expected: `22`, and `5` negatives (010, 020, 021, 022, 023).

- [ ] **Step 3: Commit**

```bash
git add skills/osmo-agent/evals/evals.json
git commit -m "Add four triggering-robustness negative evals (020-023)

Cover OSMO deploy/install, raw K8s admin, osmo config admin, and
non-OSMO compute boundaries.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Update the evals README

**Files:**
- Modify: `evals/README.md`

- [ ] **Step 1: Update counts and scenario description**

In `README.md`:
- Change every "13 evals" / "13 eval definitions" reference to "22 evals".
- Update the "Eval set" section to: "22 evals total — 17 positives (`expected_skill` is `osmo-agent`) and 5 negatives (`expected_skill` is `null`)."
- In the fixtures tree under `files/`, add the new scenario dirs `submit_err/` and `app_ok/` and note the new `default/` fixtures (`workflow_query_oom.json`, `workflow_events_oom.txt`, `workflow_query_tool.json`, `workflow_logs_tool.txt`, `workflow_query_badimage.json`, `workflow_events_badimage.txt`, `workflow_logs_badimage.txt`, `workflow_query_sdg.json`, `workflow_spec_sdg.yaml`).
- Note `oversized.yaml` is staged at `/workspace/oversized.yaml` by the Dockerfile alongside `workflow.yaml` and `jinja_workflow.yaml`.

- [ ] **Step 2: Refresh the "Coverage gaps" section**

Replace the "Stateful behaviors … are not covered here" bullet with an accurate note: validation-error recovery is now covered (018) via a non-stateful approach — the mock returns the capacity error on the first `oversized.yaml` submit and succeeds on resubmit, and the sizing math is graded by the eval judge, not by the mock inspecting the edited YAML. Keep the "Multi-task subagent delegation is not covered" bullet (still true).

- [ ] **Step 3: Commit**

```bash
git add skills/osmo-agent/evals/README.md
git commit -m "Update evals README for expanded suite (22 evals)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Validate the complete eval file**

Run (from `skills/osmo-agent/evals/`):
```bash
jq -e 'length == 22' evals.json && \
jq -e 'all(.[]; has("id") and has("question") and has("expected_skill") and has("expected_behavior"))' evals.json && \
jq -r '.[].id' evals.json | sort | uniq -d
```
Expected: outputs `true` twice and prints nothing from the `uniq -d` (no duplicate ids).

- [ ] **Step 2: Smoke-test every positive scenario through the mock**

Run:
```bash
for wf in gr00t-train-1 stuck-train-1 oom-train-1 tool-train-1 badimage-train-1 sdg-train-1; do
  echo "== $wf =="
  OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo workflow query "$wf" | jq -r '.status'
done
OSMO_MOCK_FIXTURES=files/fixtures bash files/mock_osmo/osmo app create demo --description d --file workflow.yaml | head -1
```
Expected: statuses `RUNNING, PENDING, FAILED, FAILED, PENDING, COMPLETED`, then `App created successfully.`. No `ambiguous fixture` or `no fixture found` errors.

- [ ] **Step 3: Run the ACES eval suite**

Run (from repo root or wherever `astra-skill-eval` is on PATH):
```bash
astra-skill-eval evaluate skills/osmo-agent/ --agent-eval -a claude-code
```
Expected: all 22 evals pass — the 17 positives trigger osmo-agent with the documented behavior, and the 5 negatives (010, 020–023) do not trigger osmo-agent.

- [ ] **Step 4: If any eval fails, debug then re-run**

For a failing positive: confirm the relevant fixture resolves via the Step 2 pattern and that `expected_behavior` matches what the skill's references actually prescribe. For a failing negative: check whether the agent ran an `osmo` command and tighten the question wording if it's ambiguous. Re-run Step 3 after fixes.

- [ ] **Step 5: Final commit (only if Step 4 required fixes)**

```bash
git add -A skills/osmo-agent/evals/
git commit -m "Fix eval fixtures/wording after full-suite run

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **JSON entry ordering:** new eval objects can be appended before the closing `]`; ids need not be contiguous with array position, but keep them unique.
- **Fixture filename uniqueness:** the dispatcher fails loudly if a filename matches in more than one scenario dir. All new filenames are globally unique — keep them that way.
- **Do not add dataset commands:** datasets are being deprecated; no eval should depend on `osmo dataset ...` or `dataset:` registry blocks.
- **Negatives have no fixtures by design:** if you find yourself adding a fixture for 020–023, stop — the correct behavior is the agent not calling `osmo` at all.
