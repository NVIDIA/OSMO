<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
-->

# Node Validation Tests

This folder contains node validation utilities that run in Kubernetes and set node conditions under a common prefix (default: `osmo.nvidia.com/`). These are typically executed as DaemonSets and used by backend tests, but you can also run them directly.

## Validators

- Resource Validator: `resource_validator.py`
- Connection Validator: `connection_validator.py`
- LFS Validator: `lfs_validator.py`

## Shared Base and Config

- Base: `test_base.py` provides Kubernetes helpers and condition updates
- Shared config: `NodeTestConfig` supports standard flags and environment

## Common Environment and Flags

- Environment variables
  - `OSMO_NODE_NAME`: Node name when running in-cluster
  - `OSMO_NODE_CONDITION_PREFIX`: Must end with `osmo.nvidia.com/` (default set by the tools)

- Common command-line flags (in all validators)
  - `--node_name`: Target node name (defaults from `OSMO_NODE_NAME`)
  - `--node_condition_prefix`: Condition prefix (defaults from `OSMO_NODE_CONDITION_PREFIX`)
  - `--max_retries`: Retry attempts for transient failures (default: 3)
  - `--base_wait_seconds`: Base backoff seconds (default: 10)
  - `--exit_after_validation`: If set, the process exits after running once

Notes:
- Validators patch node status conditions. Ensure the running identity has RBAC permission: `patch node/status` on nodes.
- When `--exit_after_validation` is not set, validators sleep and continue to run.

---

## Resource Validator

File: `resource_validator.py`

Purpose: Validate node allocatable resources and GPU labels, and set conditions accordingly.

Checks performed:
- GPU count vs. `--gpu_count` using label `--gpu_type_label` (default `nvidia.com/gpu`)
- NIC count vs. `--nic_count` using label `--nic_type_label` (default `nvidia.com/mlnxnics`)
- Memory vs. `--min_memory` (e.g., `1850Gi`)
- Ephemeral storage vs. `--min_storage` (e.g., `10Gi`)
- GPU mode label `--gpu_mode_label` equals `--gpu_mode` (default `compute`)
- GPU product label `--gpu_product_label` equals `--gpu_product` (default `NVIDIA-H100-80GB-HBM3`)

Condition types (overridable):
- `GpuLessThanTotal`, `NicsLessThanTotal`, `MemoryLessThanTotal`, `StorageLessThanTotal`
- `GpuIncorrectMode`, `GpuIncorrectProduct`

Key flags:
- `--gpu_type_label`, `--nic_type_label`
- `--gpu_count`, `--nic_count`
- `--min_memory`, `--min_storage`
- `--gpu_mode_label`, `--gpu_mode`
- `--gpu_product_label`, `--gpu_product`
- Condition name overrides: `--gpu_less_than_total_condition`, `--nics_less_than_total_condition`, `--memory_less_than_total_condition`, `--storage_less_than_total_condition`, `--gpu_incorrect_mode_condition`, `--gpu_incorrect_product_condition`

Example (local/kubeconfig):

```bash
bazel run @osmo_workspace///src/operator/utils/node_validation_test:resource_validator -- \
  --node_name $NODE \
  --gpu_count 8 --nic_count 8 \
  --min_memory 1850Gi --min_storage 10Gi \
  --gpu_mode compute --gpu_product NVIDIA-H100-80GB-HBM3 \
  --exit_after_validation
```

---

## Connection Validator

File: `connection_validator.py`

Purpose: Perform HTTP checks against service endpoints and set a failure condition if any check fails.

Options:
- Single URL mode: `--test_url` (with `--test_timeout` and `--condition_name`)
- YAML mode: `--url_configs_filepath` (defaults to `connection_validator.yaml`) to load multiple endpoints

YAML format (see `connection_validator.yaml`):

```yaml
url_configs:
  - url: "https://us-west-2-aws.osmo.nvidia.com/api/version"
    timeout: 30
    condition_name: "ServiceConnectionTestFailure"
```

Key flags:
- `--condition_name` (default `ServiceConnectionTestFailure`)
- `--test_url` (single URL)
- `--test_timeout` (seconds)
- `--url_configs_filepath` (YAML with `url_configs` list)

Example (YAML mode):

```bash
bazel run @osmo_workspace///src/operator/utils/node_validation_test:connection_validator -- \
  --node_name $NODE \
  --url_configs_filepath /absolute/path/to/connection_validator.yaml \
  --exit_after_validation
```

---

## LFS Validator

File: `lfs_validator.py`

Purpose: Validate LFS mounts by creating a pod on the target node and checking mount paths.

Modes:
- PVC-based mounts: `--volume_type pvc` with lists `--volume_names`, `--mount_paths`, `--claim_names`, `--sub_paths`
- CSI/Lustre mounts: `--volume_type csi` with lists `--volume_names`, `--mount_paths`, `--lustre_drivers`, `--lustre_shares`, `--lustre_servers`, `--lustre_mount_options`

All list arguments per mode must have the same length.

Additional flags:
- `--pod_namespace` (required), `--pod_image` (default `nvcr.io/nvidian/osmo/alpine:latest`)
- `--image_pull_secret` (default `nvcr-secret`)
- `--pod_succeeded_timeout` (default `120` seconds)
- `--condition_name` (default `LFSMountFailure`)

Example (PVC mode):

```bash
bazel run @osmo_workspace///src/operator/utils/node_validation_test:lfs_validator -- \
  --node_name $NODE \
  --pod_namespace osmo \
  --volume_type pvc \
  --volume_names data --mount_paths /mnt/data --claim_names data-pvc --sub_paths "" \
  --exit_after_validation
```

---

## Running in Kubernetes (DaemonSet pattern)

Reference container images (as used in docs/backend tests):
- `nvcr.io/nvidian/osmo/resource-validator:latest`
- `nvcr.io/nvidian/osmo/connection-validator:latest`
- `nvcr.io/nvidian/osmo/lfs-validator:latest`

Typical container settings:
- `imagePullSecrets`: include your `nvcr.io` secret (e.g., `nvcr-secret`)
- Env:
  - `OSMO_NODE_NAME` via `fieldRef: spec.nodeName`
  - `OSMO_NODE_CONDITION_PREFIX` set to `osmo.nvidia.com/`
- Pass validator-specific flags via container `command`/`args`

Example args (resource validator):

```yaml
command: ["resource_validator"]
args: [
  "--gpu_count=8", "--nic_count=8",
  "--min_memory=1850Gi", "--min_storage=10Gi",
  "--gpu_mode=compute", "--gpu_product=NVIDIA-H100-80GB-HBM3"
]
env:
  - name: OSMO_NODE_NAME
    valueFrom: {fieldRef: {fieldPath: spec.nodeName}}
  - name: OSMO_NODE_CONDITION_PREFIX
    value: "osmo.nvidia.com/"
```
---

## Troubleshooting

- RBAC: Ensure the service account can `patch` node and `patch` node `status`.
- Prefix validation: `--node_condition_prefix` must end with `osmo.nvidia.com/`.
- Images: Make sure `imagePullSecrets` are configured to pull from `nvcr.io`.
