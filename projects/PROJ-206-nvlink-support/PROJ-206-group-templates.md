<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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

# Group Templates

**Author**: @ecolternv<br>
**PIC**: @ecolternv<br>
**Proposal Issue**: [#206](https://github.com/nvidia/osmo/issues/206)

## Overview

This project adds support for "Group Templates": A template for an arbitrary kubernetes resource (inspired by pod templates) that is created/destroyed
along with the lifecycle for all task groups in a given pool. Admins can create group templates and assign them to one ore more pools. If multiple group templates create the same resource, OSMO will merge them in a similar way to pod templates.


### Motivation

The current Blackwell generation of GPUs with GB200 and GB300, and future announced GPU generations feature Multi Node NvLink with NVL72 and even higher numbers like NVL144, etc.

To use Multi Node NvLink in kubernetes, a ComputeDomain kubernetes CRD must be created, and all pods in a group must join together into the same ComputeDomain. Because the ComputeDomain CRD is new and is changing overtime, a Group Template offers a way to create this ComputeDomain, and to adapt as the ComputeDOmain spec changes without needing a code change.


### Problem

To use MultiNode NvLink in kubernetes, you must create a ComputeDomain CRD and all pods that are part of a given training run must have a resourceClaim that points to the same ComputeDomain.

OSMO does not currently support creating/destroying ComputeDomains along with the lifecycle of the workflow. To use NvLink with OSMO currently, you must have another system for creating/destroying ComputeDomains along with workflows.

Furthermore, there may be other future  usecases that require OSMO to create kubernetes resources, some examples include:
- A Shared reverse proxy deployment
- A Secret that is mounted in each pod and contains CA certificates
- A PodGroup for a scheduler not supported by OSMO, such as Kueue.

Group templates give admins additional flexibility to extend OSMO without needing to make code changes.

## Use Cases

| Use Case | Description |
|---|---|
| Create ComputeDomain for NVLink workflow | When a user submits a workflow to a pool with NVLink enabled, OSMO automatically creates a ComputeDomain CRD and configures all task pods to reference it via resourceClaim. |
| Destroy ComputeDomain on workflow completion | When a workflow completes or is deleted, OSMO automatically cleans up the associated ComputeDomain CRD. |

For example, if a user wants to use NvLink in a task group for a workflow, Kubernetes must create a ComputeDomain object as follows

```yaml
apiVersion: resource.nvidia.com/v1beta1
kind: ComputeDomain
metadata:
  labels:
    osmo.group_name: <group-name>
    osmo.group_uuid: <workflow-uuid>
    osmo.submitted_by: <user>
    osmo.workflow_id: <workflow-id>
    osmo.workflow_uuid: <workflow-uuid>
  name: compute-domain-<group-uuid>
spec:
  channel:
    resourceClaimTemplate:
      name: osmo-<group-uuid>
```

Each Pod corresponding to a task in the workflow must have the following added into its pod spec
```yaml
{
    "resourceClaims": [
        {
            "name": "compute-domain-channel",
            "resourceClaimTemplateName": osmo-<group-uuid>
        }
    ],
    "containers": [
        {
            "name": "{{USER_CONTAINER_NAME}}",
            "resources": {
                "claims": [
                    {
                        "name": "compute-domain-channel"
                    }
                ]
            }
        }
    ]
}
```

The ComputeDomain will automatically take care of the pods being split across multiple gpu cliques. When the NCCL library
starts, it will use NvLink for pods that are part of the same clique, and a different transport between cliques. Therefore,
only one ComputeDomain should ever need to be created for a single task group.

## Requirements

| Title | Description | Type |
|---|---|---|
| Create and modify group templates | Admins shall be able to create and modify group templates with the OSMO config CLIs and REST APIs. | Functional |
| Add group templates to pools and platforms | Admins shall be able to add "common" group templates to pools and to add group templates to platforms. | Functional |
| Ignore namespaces in group templates | OSMO shall ignore namespaces set in group templates, and rather use the namespace for workflows submitted in a given backend. | Functional |
| Merge group templates | OSMO shall apply group templates in the order they appear in the config. If multiple group templates create the same resource (`Kind` and `metadata.name` match), then OSMO shall merge them using the JSON merge patch strategy. | Functional |
| Create resources with task group | When a task group is created with a `CreateGroup` job, OSMO shall create all kubernetes resources specified in the group templates. | Functional |
| Destroy resources with task group | When a task group is deleted with a `CleanupGroup` job, OSMO shall destroy all kubernetes resources specified in the group templates. | Functional |

## Detailed Design

### Group template specification

Group templates will be specified like pod templates, with a few differences:
- Group templates will specify the whole k8s object (`Kind`, `meteadata`, `spec`, etc.) instead of just the `spec` as pod templates do.
- Group templates will not directly have access to pod specific variables (Ie `WF_TASK_UUID`)
- Group templates will have access to `TASKS` which is a list with one entry per task in the group. Each entry will have the task specific variables, like `WF_TASK_UUID` or `USER_GPUS` in it.

Group and workflow level `osmo.*` labels will automatically be added to kubernetes resources created by group templates.

The below sample group template creates the `ComputeDomain` CRD shown aboves

```yaml

"compute-domain": {
    "apiVersion": "resource.nvidia.com/v1beta1",
    "kind": "ComputeDomain",
    "metadata": {
        "name": "compute-domain-{{WF_GROUP_UUID}}"
    },
    "spec": {
        "channel": {
            "resourceClaimTemplate": {
                "name": "compute-domain-{{WF_GROUP_UUID}}"
            }
        }
    }
}
```


### Pool configs

Pool configs will have a new section, `common_group_template` to parallel the `common_pod_template` section.
This is a list of group templates that will be applied to all workflow groups created in that pool. Note that there is **NOT**
an `override_group_template` section in platforms to mirror `override_pod_template` because this could create a situation where multiple
pods in the same group have different group templates applied to them, which doesn't make sense.

```yaml
"my-pool": {
    "name": "my-pool",
    "description": "A pool with nvlink enabled",
    "status": "ONLINE",
    "override_group_templates": [
        "compute-domain"
    ]

    ...
}
```

Viewing a pool with `verbose=true` will add a `parsed_group_template` similar to `parsed_pod_template` that shows all fully rendered objects
created by the group templates
```yaml
"my-pool": {
    "name": "my-pool",
    "description": "A pool with nvlink enabled",
    "status": "ONLINE",
    "override_group_templates": [
        "compute-domain"
    ],
    "parsed_group_templates": [
        {
            "apiVersion": "resource.nvidia.com/v1beta1",
            "kind": "ComputeDomain",
            "metadata": {
                "name": "compute-domain-{{WF_GROUP_UUID}}"
            },
            "spec": {
                "channel": {
                    "resourceClaimTemplate": {
                        "name": "compute-domain-{{WF_GROUP_UUID}}"
                    }
                }
            }
        }
    ]
    ...
}
```


### Alternatives Considered

Rather than introducing group templates, we could bake in the idea of ComputeDomain into OSMO, and add a boolean switch to pool configs like
`"enable_compute_domain": true`. This will be simpler to implement, but will be very narrow in functionality. Any future changes to the
ComputeDomain CRD spec will require code changes in OSMO.

By doing this with group templates, this feature can adapt to changes to the ComputeDomain CRD without changes to OSMO Code. This also adds more
flexibility to OSMO and unlocks many other usecases for OSMO.


### Backwards Compatibility

This will be backwards compatible. Older versions of OSMO upgrading to a new version that has group templates will just have
an empty set of group templates, and an empty list of `common_group_templates` for each pool.

### Performance

This should add a negligible amount of new work to the osmo worker as it need to substitute hte group templates to generate the new kubernetes
resource specs. There will also be additional latency in the workflow creation phase for all new kubernetes resources that are created as part of a
task group.

### Security

We must restrict the user from setting the `metadata.namespace` property group templates, or ignore them. All created objects should be in the
pre-configured workflow namespace.

### Testing

Unit testing can be done by creating a pool config that adds group templates, and
running a test workflow spec through the code under test to generate a list of kubernetes resources for OSMO to create. Those
resources can be compared against the expected output to confirm the code is working correctly.

## Open Questions

- [ ] How can we add task group level resource validation (Ie, validate that a task group has a certain number of tasks)?
- [ ] How can we verify NVLink is working properly and has the expected performance for workflows that use it?
