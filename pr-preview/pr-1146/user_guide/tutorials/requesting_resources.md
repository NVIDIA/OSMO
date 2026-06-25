<!-- SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0 -->

<a id="tutorials-requesting-resources"></a>

# Requesting Resources

In this tutorial, you will learn how to request and configure compute resources for your workflows.
Understanding resource management is essential for running efficient workflows at scale.

Every task in OSMO runs on compute nodes with specific resources. You can specify:

- **CPU** - Number of CPU cores
- **Memory** - Amount of RAM
- **Storage** - Disk space
- **GPU** - Number of GPUs
- **Platform** - Target specific compute platforms

## Understanding Resources

Resources in OSMO are specified using standard Kubernetes resource notation:

- CPU: Cores (e.g., `1`, `2`, `0.5`)
- Memory: Bytes with units (e.g., `1Gi`, `512Mi`, `2Gi`)
- Storage: Bytes with units (e.g., `10Gi`, `100Mi`)
- GPU: Count (e.g., `1`, `2`, `4`)

> **Note**
>
> OSMO only accepts resource units specified binary units like
> **Gi** (gibibytes) or **Mi** (mebibytes),
> *not* in decimal units like **GB** (gigabytes) or **MB**.

> - **1 Gi** = 1,073,741,824 bytes
> - **1 GB** = 1,000,000,000 bytes

## Basic Resource Specification

Resources are defined under the `workflow` in the `resources` field and assigned
using the `resource` field in the `tasks` section. If a task doesn’t specify a resource,
it automatically uses the `default` resource spec:

```yaml

workflow:
  name: resource-demo
  resources:
    default:
      cpu: 2
      memory: 4Gi
      storage: 10Gi
  tasks:
  - name: my-task
    image: ubuntu:24.04
    command: ["bash", "-c", "echo 'Using default resources'"]
```

This task will automatically use 2 CPU cores, 4Gi of memory, and 10Gi of storage because no explicit
`resource` field is specified.

## Multiple Resource Specifications

You can define multiple named resource specifications and assign them to different tasks:

```yaml

workflow:
  name: mixed-resources
  resources:
    default:
      cpu: 1
      memory: 2Gi
      storage: 5Gi
    gpu_resource:
      cpu: 8
      gpu: 1
      memory: 32Gi
      storage: 100Gi
  tasks:
  - name: light-task
    image: ubuntu:24.04
    command: ["bash", "-c", "echo 'Using default resources'"]
    # No resource field specified, so 'default' is used

  - name: gpu-task
    image: ubuntu:24.04
    command: ["bash", "-c", "nvidia-smi"]
    resource: gpu_resource  # Explicitly uses gpu_resource
```

In this example, `light-task` uses the `default` resource spec automatically, while
`gpu-task` explicitly requests the `gpu_resource` spec.

## Targeting Specific Platforms

Use the `platform` field to target specific compute platforms. If no platform is specified,
the default platform for the pool is used (if configured by administrators):

```yaml

workflow:
  name: platform-demo
  resources:
    default:
      cpu: 1
      memory: 16Gi
      storage: 1Gi
      platform: ovx-l40
    x86_gpu:
      cpu: 4
      gpu: 1
      memory: 16Gi
      storage: 1Gi
      platform: dgx-h100
  tasks:
  - name: cpu-task
    image: ubuntu:24.04
    command: ["bash", "-c", "echo 'Running on L40'"]
    # Uses default resource with ovx-l40 platform

  - name: gpu-task
    image: nvcr.io/nvidia/pytorch:24.01-py3
    command: ["bash", "-c", "echo 'Running on DGX H100 with GPU'"]
    resource: x86_gpu  # Uses x86_gpu resource with dgx-h100 platform
```

To see available platforms and pools, use:

```bash
$ osmo pool list
```

This shows all pools, along with their available platforms and resources.

## Checking Available Resources

Before building your resource specifications, check what’s available in your pools:

```bash
$ osmo resource list -p <pool_name>

Node             Pool      Platform       Storage [Gi]   CPU [#]   Memory [Gi]   GPU [#]
========================================================================================
hil-ovx-01       default   ovx-a40        0/2028         1/127     1/1006        0/8
hil-ovx-02       default   ovx-a40        14/2028        25/127    15/1006       0/8
hil-ovx-03       default   ovx-a40        2/2028         4/127     8/1006        0/8
orin-01          default   agx-orin-jp6   0/1646         1/11      1/28          0
orin-02          default   agx-orin-jp6   0/1646         1/11      1/28          0
x86-rtx4090-01   default   x86-4090       0/822          1/31      1/123         0/1
========================================================================================
                                          16/10198       33/434    27/3197       0/25
```

### How to read the resource list?

`resource list` command shows resources in `used/total` format by default.

For example, `40/100` means `40 Gi` of memory is used out of `100 Gi` total.

To see available resources more directly, use the `--mode free` flag

```bash
$ osmo resource list -p <pool_name> --mode free
```

This shows available resources as single numbers (e.g., `60` means 60 Gi of memory available).

When building your resource specs, ensure:

- Your requested resources fit within what’s available in the pool
- The resources can **fit on a single node**, you can check per-node resources via:
  ```bash
  $ osmo resource info <node_name>
  ```

> **Tip**
>
> If your workflow is not getting scheduled, check pool quotas with `osmo pool list` to see
> if you have reached quota limits. See [Why is my workflow not getting scheduled quickly?](../faq/index.md#faq-why-is-my-workflow-not-getting-scheduled-quickly)
> for detailed troubleshooting.

> **Note**
>
> Please contact your administrator to configure the **default** resource spec for your pool.

## Next Steps

Now that you understand resource management, learn about working with data
in the next tutorial: [Working with Data](data/index.md#tutorials-working-with-data).

#### SEE ALSO
- [Why is my workflow not getting scheduled quickly?](../faq/index.md#faq-why-is-my-workflow-not-getting-scheduled-quickly)
- [Workflow Specification - Resources](../workflows/specification/resources.md#workflow-spec-resources)
- [Pool List CLI](../appendix/cli/cli_pool.md#cli-reference-pool)
- [Resource List CLI](../appendix/cli/cli_resource.md#cli-reference-resource)
