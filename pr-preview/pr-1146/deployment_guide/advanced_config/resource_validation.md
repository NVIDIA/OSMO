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

<a id="resource-validation"></a>

# Resource Validation

After configuring [pools](pool.md#pool), add resource validation rules to prevent workflows from requesting more resources than available on your nodes. Validation acts as a pre-flight check that rejects invalid requests before they reach the scheduler.

## Why Use Resource Validation?

Resource validation provides guardrails that protect your cluster and improve user experience:

✓ **Prevent Scheduling Failures**
: Reject workflows that request more CPU, memory, or GPU than any node can provide, avoiding pods getting stuck in pending state.

✓ **Catch Configuration Errors**
: Detect invalid resource specifications (negative values, zero allocations, incorrect units) before submission.

✓ **Provide Clear Feedback**
: Give users immediate, actionable error messages explaining what’s wrong and how to fix it.

✓ **Optimize Resource Utilization**
: Enforce safety margins and best practices for resource allocation across your cluster.

## How It Works

### Validation Flow

**1. Submit Workflow** 📝

User requests resources

CPU, memory, GPU, storage resources

**2. Validate Rules** ⚖️

Check against capacity

Compare with rule structure set by admin

**3. Proceed or Reject** ✓✗

Accept or deny

Submit for scheduling or show error message

### Rule Structure

Each validation rule has four components:

```json
{
  "operator": "LE",
  "left_operand": "{{USER_CPU}}",
  "right_operand": "{{K8_CPU}}",
  "assert_message": "CPU {{USER_CPU}} exceeds node capacity {{K8_CPU}}"
}
```

- **operator**: Comparison type (EQ, LT, LE, GT, GE)
- **left_operand**: User-requested value (e.g., `{{USER_CPU}}`)
- **right_operand**: Limit or node capacity (e.g., `{{K8_CPU}}`)
- **assert_message**: Error shown when validation fails

> **Note**
>
> For detailed configuration fields and all available variables, see [/api/configs/resource_validation](../references/configs_definitions/resource_validation.md#resource-validation-config) in the API reference documentation.

## Practical Guide

### Standard Validation Rules

Create validation templates for common resources: CPU, GPU, memory, and storage.

**Step 1: Create Validation Configuration**

Define validation rules using variables for user requests (`{{USER_*}}`) and node capacity (`{{K8_*}}`):

### **Available Variables**

**User Request Variables:**
: - `{{USER_CPU}}` - CPU count requested
  - `{{USER_GPU}}` - GPU count requested
  - `{{USER_MEMORY}}` - Memory requested (e.g., “8Gi”)
  - `{{USER_STORAGE}}` - Storage requested (e.g., “100Gi”)

> **Note**
>
> The values from the user request variables are the same values that are provided in the resource
> spec of a workflow.

**Node Capacity Variables:**
: - `{{K8_CPU}}` - Available CPU on nodes
  - `{{K8_GPU}}` - Available GPU on nodes
  - `{{K8_MEMORY}}` - Available memory on nodes
  - `{{K8_STORAGE}}` - Available storage on nodes

> **Note**
>
> The values from the node capacity variables are the same values that are reported by the Kubernetes
> API in the allocatable fields. `{{K8_MEMORY}}` and `{{K8_STORAGE}}` support units `B`, `Ki`,
> `Mi`, `Gi` and `Ti`.

> **Note**
>
> If the CPU allocatable provided by Kubernetes is in the format of `m`,
> `{{K8_CPU}}` will be an integer value after rounding down the CPU allocatable value.

**Operators:**
: - EQ (equal)
  - LT (less than)
  - LE (less/equal)
  - GT (greater than)
  - GE (greater/equal)
  - NE (not equal)

For all available variables and detailed configuration fields, see [/api/configs/resource_validation](../references/configs_definitions/resource_validation.md#resource-validation-config).

**Step 2: Apply Standard Validation Rules**

Create a file with recommended validation templates:

```bash
$ cat << EOF > validation_config.json
{
  "default_cpu": [
    {
      "operator": "LE",
      "left_operand": "{{USER_CPU}}",
      "right_operand": "{{K8_CPU}}",
      "assert_message": "CPU {{USER_CPU}} exceeds node capacity {{K8_CPU}}"
    },
    {
      "operator": "GT",
      "left_operand": "{{USER_CPU}}",
      "right_operand": "0",
      "assert_message": "CPU {{USER_CPU}} must be greater than 0"
    }
  ],
  "default_gpu": [
    {
      "operator": "LE",
      "left_operand": "{{USER_GPU}}",
      "right_operand": "{{K8_GPU}}",
      "assert_message": "GPU {{USER_GPU}} exceeds node capacity {{K8_GPU}}"
    },
    {
      "operator": "GE",
      "left_operand": "{{USER_GPU}}",
      "right_operand": "0",
      "assert_message": "GPU {{USER_GPU}} cannot be negative"
    }
  ],
  "default_memory": [
    {
      "operator": "LT",
      "left_operand": "{{USER_MEMORY}}",
      "right_operand": "{{K8_MEMORY}}",
      "assert_message": "Memory {{USER_MEMORY}} exceeds node capacity {{K8_MEMORY}}"
    },
    {
      "operator": "GT",
      "left_operand": "{{USER_MEMORY}}",
      "right_operand": "0",
      "assert_message": "Memory {{USER_MEMORY}} must be greater than 0"
    }
  ],
  "default_storage": [
    {
      "operator": "LT",
      "left_operand": "{{USER_STORAGE}}",
      "right_operand": "{{K8_STORAGE}}",
      "assert_message": "Storage {{USER_STORAGE}} exceeds node capacity {{K8_STORAGE}}"
    },
    {
      "operator": "GT",
      "left_operand": "{{USER_STORAGE}}",
      "right_operand": "0",
      "assert_message": "Storage {{USER_STORAGE}} must be greater than 0"
    }
  ]
}
EOF

$ osmo config update RESOURCE_VALIDATION --file validation_config.json
```

**Step 3: Reference in Pool Configuration**

Add validation templates to your pool’s `common_resource_validations` field:

```json
{
  "name": "my-pool",
  "backend": "default",
  "common_resource_validations": [
    "default_cpu",
    "default_memory",
    "default_storage",
    "default_gpu"
  ]
}
```

### Additional Examples

### **Custom GPU Validation** - Enforce Minimum GPU Requirements

Create validation for workloads requiring at least 2 GPUs:

```json
{
  "min_2_gpu": [
    {
      "operator": "GE",
      "left_operand": "{{USER_GPU}}",
      "right_operand": "2",
      "assert_message": "This pool requires minimum 2 GPUs, you requested {{USER_GPU}}"
    },
    {
      "operator": "LE",
      "left_operand": "{{USER_GPU}}",
      "right_operand": "{{K8_GPU}}",
      "assert_message": "GPU {{USER_GPU}} exceeds node capacity {{K8_GPU}}"
    }
  ]
}
```

### **Memory Safety Margins** - Prevent 100% Utilization

Enforce 80% maximum memory usage to leave headroom:

```json
{
  "memory_80_percent": [
    {
      "operator": "LT",
      "left_operand": "{{USER_MEMORY}}",
      "right_operand": "{{K8_MEMORY}} * 0.8",
      "assert_message": "Memory {{USER_MEMORY}} exceeds 80% of node capacity"
    }
  ]
}
```

### **Platform-Specific Rules** - Different Limits Per Platform

Create different validation rules for different hardware platforms:

```json
{
  "a100_validation": [
    {
      "operator": "LE",
      "left_operand": "{{USER_GPU}}",
      "right_operand": "8",
      "assert_message": "A100 platform supports max 8 GPUs"
    }
  ],
  "h100_validation": [
    {
      "operator": "LE",
      "left_operand": "{{USER_GPU}}",
      "right_operand": "8",
      "assert_message": "H100 platform supports max 8 GPUs"
    }
  ]
}
```

### Troubleshooting

**Validation Always Fails**
: - Check Kubernetes nodes are properly labeled and available
  - Verify node variables are populated: `kubectl describe nodes`

**Inconsistent Results**
: - Ensure all nodes report resources consistently
  - Check no nodes are in unschedulable state

**Unit Conversion Errors**
: - Use consistent units between requests and validation (For example, use `Gi` vs `GB`)
  - Review variable substitution in error messages

**Debugging Tips**
: - Start with simple rules and add complexity gradually
  - Test validation with different resource values
  - Examine OSMO service logs for detailed rule evaluation

> **Tip**
>
> **Best Practices**

> - Don’t allow 100% resource utilization - leave margins for system overhead and unexpected spikes
> - Use `LT` (less than) instead of `LE` (less/equal) for memory and storage to ensure safety margins
> - Write clear error messages that include variable values to help users fix issues quickly
> - Test rules with edge cases (minimum values, maximum values, invalid inputs)
