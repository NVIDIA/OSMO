..
  SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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


.. _group_template:

=======================================================
Group Templates
=======================================================

Group templates define arbitrary Kubernetes resources that OSMO creates alongside each workflow task group. Unlike :ref:`pod templates <pod_template>`, which configure the pod spec for individual tasks, group templates deploy namespace-scoped resources—such as ComputeDomains or ConfigMaps—that the group's pods depend on. Resources are scoped to the namespace in which the workflow runs.


Why Use Group Templates?
========================

Group templates extend OSMO's scheduling capabilities by allowing you to provision supporting Kubernetes resources alongside workflow task groups:

✓ **Provision Shared Group Resources**
  Create ConfigMaps, Secrets, or other namespace-scoped resources that all tasks in a group share.

✓ **Support Custom CRDs**
  Deploy any Kubernetes custom resource your backend requires without modifying OSMO's core scheduling logic.

✓ **Maintain Consistent Cleanup**
  OSMO records which resource types were created and cleans them up when the group finishes, regardless of pool config changes.


How It Works
============

Resource Creation Flow
----------------------

.. grid:: 4
    :gutter: 2

    .. grid-item-card::
        :class-header: sd-bg-info sd-text-white

        **1. Define Templates** 📋
        ^^^

        Create named Kubernetes manifests

        +++

        ComputeDomains, ConfigMaps, and more

    .. grid-item-card::
        :class-header: sd-bg-primary sd-text-white

        **2. Reference in Pools** 🔗
        ^^^

        Attach to pools

        +++

        Multiple templates per pool

    .. grid-item-card::
        :class-header: sd-bg-warning sd-text-white

        **3. Merge Templates** 🔄
        ^^^

        Combine specifications

        +++

        Same apiVersion/kind/name = merge

    .. grid-item-card::
        :class-header: sd-bg-success sd-text-white

        **4. Create Resources** ✅
        ^^^

        Resources created before pods

        +++

        Cleaned up when group finishes

Template Structure
------------------

Group templates are full Kubernetes manifests. They must include ``apiVersion``, ``kind``, and ``metadata.name``. The ``metadata.namespace`` field must be omitted—OSMO assigns the namespace at runtime.

.. code-block:: json

  {
    "template_name": {
      "apiVersion": "resource.nvidia.com/v1beta1",
      "kind": "ComputeDomain",
      "metadata": {
        "name": "compute-domain-{{WF_GROUP_UUID}}"
      },
      "spec": {
        "numNodes": 0,
        "channel": {
          "resourceClaimTemplate": {
            "name": "compute-domain-{{WF_GROUP_UUID}}-rct"
          }
        }
      }
    }
  }

.. note::

   **Resource Name Uniqueness**

   Because multiple workflows may run in the same pool and namespace at the same time, resource names must be unique per group. Include ``{{WF_GROUP_UUID}}`` in ``metadata.name`` to ensure each group gets its own resource instance, as shown in the example above.

Key Features
------------

- **Variable Substitution**: The same variables available in pod templates are resolved at runtime, except task-specific variables (such as task name and task UUID) which are not available at the group level.
- **Label Injection**: OSMO automatically adds its standard labels (``osmo.workflow_id``, ``osmo.submitted_by``, etc.) to each resource's ``metadata.labels`` for tracking and cleanup.
- **Template Merging**: Multiple templates that define the same resource (same ``apiVersion``, ``kind``, and ``metadata.name``) are merged, with later templates overriding earlier ones.
- **Creation Order**: Group template resources are created before the group's pods, ensuring dependencies are satisfied.

.. note::

   For detailed configuration fields and all available variables, see :ref:`group_template_config` in the API reference.


Practical Guide
===============

Configuring Group Templates to Enable NvLINK
--------------------------------------------

This example shows how to configure a ``ComputeDomain`` group template alongside a matching pod template to enable NvLINK communication across nodes for multi-node workloads.

**Step 1: Create the Group Template**

Create a JSON file defining the ``ComputeDomain`` resource. The ``resourceClaimTemplate.name`` is used in the pod template in the next step:

.. code-block:: bash

  $ cat << EOF > group_templates.json
  {
    "compute-domain": {
      "apiVersion": "resource.nvidia.com/v1beta1",
      "kind": "ComputeDomain",
      "metadata": {
        "name": "compute-domain-{{WF_GROUP_UUID}}"
      },
      "spec": {
        "numNodes": 0,
        "channel": {
          "resourceClaimTemplate": {
            "name": "compute-domain-{{WF_GROUP_UUID}}-rct"
          }
        }
      }
    }
  }
  EOF

  $ osmo config update GROUP_TEMPLATE --file group_templates.json

**Step 2: Create the Pod Template**

Create a pod template that claims the compute domain channel so that each task pod is connected to the NvLINK fabric:

.. code-block:: bash

  $ cat << EOF > pod_templates.json
  {
    "use-compute-domain": {
      "spec": {
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
        ],
        "resourceClaims": [
          {
            "name": "compute-domain-channel",
            "resourceClaimTemplateName": "compute-domain-{{WF_GROUP_UUID}}-rct"
          }
        ]
      }
    }
  }
  EOF

  $ osmo config update POD_TEMPLATE --file pod_templates.json

**Step 3: Reference Both Templates in the Pool**

Add both templates to your pool configuration:

.. code-block:: json
  :emphasize-lines: 4,5-7

  {
    "my-pool": {
      "backend": "default",
      "common_pod_template": ["default_amd64", "default_user", "use-compute-domain"],
      "common_group_templates": [
        "compute-domain"
      ]
    }
  }

**Step 4: Verify the Configuration**

.. code-block:: bash

  # List all group templates
  $ osmo config get GROUP_TEMPLATE

  # Show a specific group template
  $ osmo config get GROUP_TEMPLATE compute-domain

