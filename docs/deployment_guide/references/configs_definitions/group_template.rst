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

.. _group_template_config:

===========================
/api/configs/group_template
===========================

Each group template is defined by a name and a Kubernetes manifest dictionary (``Dict[String, Any]``). Group templates are applied to workflow task groups and create supporting Kubernetes resources before group pods are scheduled.

**Default Value:** Empty dictionary ``{}`` (no group templates configured by default)

Required Fields
===============

Each group template manifest must include the following fields:

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``apiVersion``
     - String
     - The Kubernetes API version for the resource (for example, ``v1``, ``resource.nvidia.com/v1beta1``).
   * - ``kind``
     - String
     - The Kubernetes resource kind (for example, ``ConfigMap``, ``ComputeDomain``).
   * - ``metadata.name``
     - String
     - The resource name. Supports variable substitution (for example, ``compute-domain-{{WF_GROUP_UUID}}``).

.. note::

   ``metadata.namespace`` must **not** be set. OSMO assigns the namespace at runtime based on the backend configuration.

Example
=======

The following example defines two group templates: a ``ComputeDomain`` for NvLINK connectivity and a ``ConfigMap`` for shared workflow configuration:

.. code-block:: json

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
        },
        "workflow-config": {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {
                "name": "workflow-config-{{WF_GROUP_UUID}}"
            },
            "data": {
                "workflow_id": "{{WF_ID}}",
                "pool": "{{WF_POOL}}"
            }
        }
    }

The key (for example, ``compute-domain``) is the template name referenced in the pool's ``common_group_templates`` list. The value is the full Kubernetes manifest for the resource.

A pool applies group templates by listing their names in the ``common_group_templates`` array:

.. code-block:: json

    {
        "my-pool": {
            "backend": "default",
            "common_group_templates": ["compute-domain", "workflow-config"]
        }
    }

To learn more about group templates, see :ref:`Group Template Concepts <group_template>`.
