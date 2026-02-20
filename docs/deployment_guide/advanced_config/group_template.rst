..
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


.. _group_template:

=======================================================
Group Templates
=======================================================

Group templates define arbitrary Kubernetes resources that OSMO creates alongside each workflow task group. Unlike :ref:`pod templates <pod_template>`, which configure the pod spec for individual tasks, group templates deploy cluster-level or namespace-scoped resources—such as custom scheduler objects, topology CRDs, or ConfigMaps—that the group's pods depend on.


Why Use Group Templates?
========================

Group templates extend OSMO's scheduling capabilities by allowing you to provision supporting Kubernetes resources alongside workflow task groups:

✓ **Deploy Custom Scheduler Resources**
  Create scheduler-specific objects (for example, RunAI Queues, KAI Topology CRDs) that must exist before pods are scheduled.

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

        Full :code:`apiVersion`, :code:`kind`, and :code:`metadata`

    .. grid-item-card::
        :class-header: sd-bg-primary sd-text-white

        **2. Reference in Pools** 🔗
        ^^^

        Attach to pools

        +++

        Multiple templates per pool

    .. grid-item-card::
        :class-header: sd-bg-warning sd-text-white

        **3. Render Templates** 🔄
        ^^^

        Substitute variables and inject labels

        +++

        Templates with matching keys are merged

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
      "apiVersion": "example.io/v1",
      "kind": "MyResource",
      "metadata": {
        "name": "{{WF_ID}}-my-resource"
      },
      "spec": {
        "workflowId": "{{WF_ID}}",
        "pool": "{{WF_POOL}}"
      }
    }
  }

Key Features
------------

- **Variable Substitution**: The same variables available in pod templates (``{{WF_ID}}``, ``{{WF_POOL}}``, ``{{USER_GPU}}``, etc.) are resolved at runtime.
- **Label Injection**: OSMO automatically adds its standard labels (``osmo.workflow_id``, ``osmo.submitted_by``, etc.) to each resource's ``metadata.labels`` for tracking and cleanup.
- **Template Merging**: Multiple templates that define the same resource (same ``apiVersion``, ``kind``, and ``metadata.name``) are merged, with later templates overriding earlier ones.
- **Creation Order**: Group template resources are created before the group's pods, ensuring dependencies are satisfied.

.. warning::

   **Namespace Behavior**

   - Do not set ``metadata.namespace`` in group templates. OSMO assigns the namespace at runtime.
   - OSMO will reject any template that includes ``metadata.namespace``.

.. note::

   For detailed configuration fields and all available variables, see :ref:`group_template_config` in the API reference.


Practical Guide
===============

Configuring Group Templates
---------------------------

**Step 1: Create a Template File**

Create a JSON file with one or more group templates. Each key is the template name; each value is a Kubernetes manifest:

.. code-block:: bash

  $ cat << EOF > group_templates.json
  {
    "my-queue": {
      "apiVersion": "scheduling.run.ai/v2",
      "kind": "Queue",
      "metadata": {
        "name": "{{WF_ID}}-queue"
      },
      "spec": {
        "quota": {
          "gpu": "{{USER_GPU}}"
        }
      }
    }
  }
  EOF

  $ osmo config update GROUP_TEMPLATE --file group_templates.json

**Step 2: Reference Templates in Pools**

Add template names to your pool's ``common_group_templates`` field:

.. code-block:: json
  :emphasize-lines: 5-7

  {
    "my-pool": {
      "backend": "default",
      "common_pod_template": ["default_amd64", "default_user"],
      "common_group_templates": [
        "my-queue"
      ]
    }
  }

**Step 3: Verify the Configuration**

.. code-block:: bash

  # List all group templates
  $ osmo config get GROUP_TEMPLATE

  # Show a specific group template
  $ osmo config get GROUP_TEMPLATE my-queue


Additional Examples
-------------------

.. dropdown:: **Topology CRD** - KAI Scheduler Topology
    :color: info
    :icon: cpu

    Create a KAI scheduler topology resource for topology-aware scheduling:

    .. code-block:: json

      {
        "kai-topology": {
          "apiVersion": "kai.scheduler/v1alpha1",
          "kind": "Topology",
          "metadata": {
            "name": "{{WF_ID}}-topology"
          },
          "spec": {
            "levels": [
              {"leveltype": "node"}
            ]
          }
        }
      }

.. dropdown:: **ConfigMap** - Shared Workflow Configuration
    :color: info
    :icon: file

    Create a ConfigMap shared by all tasks in the group:

    .. code-block:: json

      {
        "workflow-config": {
          "apiVersion": "v1",
          "kind": "ConfigMap",
          "metadata": {
            "name": "{{WF_ID}}-config"
          },
          "data": {
            "workflow_id": "{{WF_ID}}",
            "pool": "{{WF_POOL}}",
            "submitted_by": "{{WF_SUBMITTED_BY}}"
          }
        }
      }

.. dropdown:: **Multiple Templates** - Combining Resources
    :color: info
    :icon: stack

    Define multiple resources in one configuration and reference them together in a pool:

    .. code-block:: json

      {
        "kai-topology": {
          "apiVersion": "kai.scheduler/v1alpha1",
          "kind": "Topology",
          "metadata": {
            "name": "{{WF_ID}}-topology"
          },
          "spec": {
            "levels": [{"leveltype": "node"}]
          }
        },
        "run-ai-queue": {
          "apiVersion": "scheduling.run.ai/v2",
          "kind": "Queue",
          "metadata": {
            "name": "{{WF_ID}}-queue"
          },
          "spec": {
            "quota": {"gpu": "{{USER_GPU}}"}
          }
        }
      }

    Reference both in the pool:

    .. code-block:: json

      {
        "my-pool": {
          "backend": "default",
          "common_group_templates": ["kai-topology", "run-ai-queue"]
        }
      }


Troubleshooting
---------------

**Template Rejected on Upload**
  - Ensure ``apiVersion`` is present and non-empty.
  - Ensure ``kind`` is present and non-empty.
  - Ensure ``metadata.name`` is present.
  - Remove ``metadata.namespace``—OSMO sets this at runtime.

**Template Not Found**
  - Verify the template name matches exactly in the pool's ``common_group_templates`` list.
  - Check the template exists: ``osmo config get GROUP_TEMPLATE <template_name>``

**Variable Substitution Errors**
  - Ensure all variables used are valid OSMO variables.
  - Check for typos in variable names (case-sensitive).
  - Review service logs for detailed variable resolution errors.

**Resource Not Created**
  - Confirm the pool's ``common_group_templates`` references the correct template name.
  - Verify the backend has sufficient permissions to create the resource type.
  - Check OSMO service logs for Kubernetes API errors.

.. tip::

   **Best Practices**

   - Use ``{{WF_ID}}`` or ``{{WF_UUID}}`` in ``metadata.name`` to ensure each group gets a unique resource instance.
   - Keep templates focused on a single resource type for easier reuse across pools.
   - Test templates with a non-production pool before rolling out to production.

.. warning::

   - Template changes only apply to new workflow groups, not groups that are already running.
   - A group template cannot be deleted while it is referenced by an active pool. Remove it from all pools first.
