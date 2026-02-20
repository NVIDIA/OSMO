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
     - The Kubernetes API version for the resource (for example, ``v1``, ``scheduling.run.ai/v2``).
   * - ``kind``
     - String
     - The Kubernetes resource kind (for example, ``ConfigMap``, ``Queue``).
   * - ``metadata.name``
     - String
     - The resource name. Supports variable substitution (for example, ``{{WF_ID}}-queue``).

.. note::

   ``metadata.namespace`` must **not** be set. OSMO assigns the namespace at runtime based on the backend configuration.

Example
=======

The following example defines two group templates: a KAI scheduler topology CRD and a RunAI queue:

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
        },
        "run-ai-queue": {
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

The key (for example, ``kai-topology``) is the template name referenced in the pool's ``common_group_templates`` list. The value is the full Kubernetes manifest for the resource.

A pool applies group templates by listing their names in the ``common_group_templates`` array:

.. code-block:: json

    {
        "my-pool": {
            "backend": "default",
            "common_group_templates": ["kai-topology", "run-ai-queue"]
        }
    }

To learn more about group templates, see :ref:`Group Template Concepts <group_template>`.
