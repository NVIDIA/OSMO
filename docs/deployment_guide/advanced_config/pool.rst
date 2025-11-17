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


.. _pool:

=======================================================
Resource Pools
=======================================================

After successfully :ref:`configuring the default pool <configure_pool>`, you can create additional pools to organize and control how users access your compute resources.


Why Create Multiple Pools?
===========================

Pools divide your compute backend into logical resource groupings that enable:

✓ **Simplified User Experience**
  Apply :ref:`Pod Templates <pod_template>` to pools so users don't repeat Kubernetes specifications in every workflow. Templates automatically handle node selectors, tolerations, and other scheduling requirements.

✓ **Resource Guardrails**
  Use :ref:`Resource Validation <resource_validation>` rules to reject workflows that request more resources than available on your nodes, preventing scheduling failures.

✓ **Hardware Differentiation**
  For heterogeneous clusters with multiple GPU types, create platforms within pools to route workflows to specific hardware (A100, H100, L40S, etc.).

✓ **User Access Control**
  Integrate pools with user groups and roles to manage permissions. See :ref:`authentication_authorization` for authentication and authorization details. For example, control which user groups can access specific compute resources based on workload type (training, simulation, inference) or project teams.

Pool Architecture
=================

Pools organize compute resources in a hierarchical structure:

.. code-block:: text

  Backend (Kubernetes Cluster)
  ├── Pool: training-pool
  │   ├── Platform: a100
  │   └── Platform: h100
  ├── Pool: simulation-pool
  │   ├── Platform: l40s
  │   └── Platform: l40
  └── Pool: inference-pool
      └── Platform: jetson-agx-orin

**Workflow Submission Flow:**

.. grid:: 5
    :gutter: 2

    .. grid-item-card::
        :class-header: sd-bg-info sd-text-white

        **1. Access Control** 🔐
        ^^^

        Check user permissions

        +++

        Verify pool access rights

    .. grid-item-card::
        :class-header: sd-bg-warning sd-text-white

        **2. Resource Check** ⚖️
        ^^^

        Validate requests

        +++

        Ensure node capacity

    .. grid-item-card::
        :class-header: sd-bg-primary sd-text-white

        **3. Apply Templates** 📋
        ^^^

        Build K8s specs

        +++

        Merge pod templates

    .. grid-item-card::
        :class-header: sd-bg-primary sd-text-white

        **4. Select Platform** 🎯
        ^^^

        Route to hardware

        +++

        A100, H100, L40S, etc.

    .. grid-item-card::
        :class-header: sd-bg-success sd-text-white

        **5. Schedule & Run** ▶️
        ^^^

        Identify a node in cluster

        +++

        Pod is running on the node

.. note::

   For detailed pool and platform configuration fields, see :ref:`pool_config` in the API reference documentation.


.. _advanced_pool_configuration:

Practical Guide
===============

Heterogeneous Pools
---------------------

For clusters with multiple GPU types (L40S, A100, H100, etc.), use platforms to route workflows to specific hardware.

**Step 1: Identify Node Labels**

Discover node labels and tolerations for your hardware:

.. code-block:: bash

  $ kubectl get nodes -o jsonpath='{.items[*].metadata.labels}' | jq -r 'to_entries[] | select(.key | startswith("nvidia.com/gpu.product")) | .value'
  $ kubectl get nodes -o jsonpath='{.items[*].metadata.tolerations}'

**Step 2: Create Pod Templates for Each GPU Type**

Create pod templates that target specific hardware using node selectors and tolerations:

.. code-block:: bash

  # L40S pod template
  $ cat << EOF > l40s_pod_template.json
  {
    "l40s": {
      "spec": {
        "nodeSelector": {
          "nvidia.com/gpu.product": "NVIDIA-L40S"
        }
      }
    }
  }
  EOF

.. code-block:: bash

  # A100 pod template with tolerations
  $ cat << EOF > a100_pod_template.json
  {
    "a100": {
      "spec": {
        "nodeSelector": {
          "nvidia.com/gpu.product": "NVIDIA-A100"
        },
        "tolerations": [
          {
            "key": "nvidia.com/gpu.product",
            "operator": "Equal",
            "value": "NVIDIA-A100",
            "effect": "NoSchedule"
          }
        }
      }
    }
  }
  EOF

.. code-block:: bash

  $ osmo config update POD_TEMPLATE l40s --file l40s_pod_template.json

  $ osmo config update POD_TEMPLATE a100 --file a100_pod_template.json

**Step 3: Create Pool with Platforms**

Configure the pool that references both pod templates via ``platforms``:

.. code-block:: bash

  $ cat << EOF > platform_config.json
  {
    "name": "heterogeneous_pool",
    "backend": "default",
    "default_platform": "l40s_platform",
    "description": "Simulation and training pool",
    "common_default_variables": {
        "USER_CPU": 1,
        "USER_GPU": 0,
        "USER_MEMORY": "1Gi",
        "USER_STORAGE": "1Gi"
    },
    "common_resource_validations": [
        "default_cpu",
        "default_memory",
        "default_storage"
    ],
    "common_pod_template": [
        "default_user",
        "default_ctrl"
    ],
    "platforms": {
        "l40s_platform": {
            "description": "L40S platform",
            "host_network_allowed": false,
            "privileged_allowed": false,
            "default_variables": {},
            "resource_validations": [],
            "override_pod_template": ["l40s"],
            "allowed_mounts": []
        },
        "a100_platform": {
            "description": "A100 platform",
            "host_network_allowed": false,
            "privileged_allowed": false,
            "default_variables": {},
            "resource_validations": [],
            "override_pod_template": ["a100"],
            "allowed_mounts": []
        }
    }
  }
  EOF

Apply the pool configuration:

.. code-block:: bash

  $ osmo config update POOL heterogeneous_pool --file platform_config.json

Validate the pool configuration:

.. code-block:: bash

  $ osmo resource list --pool heterogeneous_pool


**Step 4: Create a Role for the Pool**

Create a role to allow submitting to the pool using the ``osmo config set`` CLI:

.. code-block:: bash

  $ osmo config set ROLE osmo-heterogeneous_pool pool

Users that have this role will now be able to submit workflows to the newly created pool.

.. note::

  For more info, see :ref:`auto_generating_pool_roles`.

**Step 5: Assign the Role to Users in Keycloak**

To assign users to the role, the following steps must be completed:

1. Create the role ``osmo-heterogeneous_pool`` in keycloak (see :ref:`keycloak_create_roles`). Even though we created the role in OSMO, we also must
   create a matching role in Keycloak.
2. Create the group in keycloak (see :ref:`keycloak_create_groups`). You can pick any name for this group, for example ``OSMO Heterogeneous Pool``.
3. Assign the role ``osmo-heterogeneous_pool`` to the group ``OSMO Heterogeneous Pool`` (see :ref:`keycloak_assign_roles_to_groups`). Any users who are
   in this group will now have access to the pool.
4. Add users to the group ``OSMO Heterogeneous Pool`` (see :ref:`keycloak_assign_users_to_groups`). These users will now have access to the pool.


Additional Examples
------------------------

.. dropdown:: **Training Pool** - High-Performance GPU Pool
    :color: info
    :icon: stack

    Configure a pool for training workloads with GB200 platform:

    .. code-block:: json

      {
        "robotics-training": {
          "description": "High-performance GPU pool for robotics model training",
          "backend": "gpu-cluster-01",
          "default_platform": "h100-platform",
          "common_default_variables": {
            "USER_CPU": 16,
            "USER_GPU": 1,
            "USER_MEMORY": "64Gi",
            "USER_STORAGE": "500Gi"
          },
          "common_resource_validations": [
            "default_cpu",
            "default_memory",
            "default_storage",
            "gpu_training_validation"
          ],
          "common_pod_template": [
            "default_amd64",
            "training_optimized",
            "high_memory"
          ],
          "platforms": {
            "gb200-platform": {
              "description": "GB200 GPUs for high performance training",
              "override_pod_template": [
                "training_gb200_template"
              ],
              "default_variables": {
                "USER_MEMORY": "80Gi"
              }
            }
          }
          }
        }
      }

.. dropdown:: **Simulation Pool** - Graphics-Optimized Pool
    :color: info
    :icon: image

    Configure a pool for simulation workloads with L40/L40S platforms:

    .. code-block:: json

      {
        "robotics-simulation": {
          "description": "Graphics-optimized pool for robotics simulation",
          "backend": "graphics-cluster-01",
          "default_platform": "l40-platform",
          "common_default_variables": {
            "USER_CPU": 8,
            "USER_GPU": 1,
            "USER_MEMORY": "32Gi",
            "USER_STORAGE": "200Gi"
          },
          "common_resource_validations": [
            "default_cpu",
            "default_memory",
            "default_storage",
            "simulation_gpu_validation"
          ],
          "common_pod_template": [
            "default_amd64",
            "simulation_optimized",
            "graphics_drivers"
          ],
          "platforms": {
            "l40-platform": {
              "description": "L40 GPUs for standard simulation",
              "override_pod_template": [
                "simulation_l40_template"
              ]
            },
            "l40s-platform": {
              "description": "L40S GPUs for high-fidelity simulation",
              "override_pod_template": [
                "simulation_l40s_template"
              ],
              "default_variables": {
                "USER_MEMORY": "48Gi"
              }
            }
          }
          }
        }
      }

.. dropdown:: **Inference Pool** - NVIDIA Jetsons Pool
    :color: info
    :icon: dependabot

    Configure a pool for inference workloads with NVIDIA Jetsons:

    .. code-block:: json

      {
        "robotics-inference": {
          "description": "NVIDIA Jetsons pool for model inference",
          "backend": "inference-cluster-01",
          "default_platform": "jetson-thor-platform",
          "common_default_variables": {
            "USER_CPU": 4,
            "USER_GPU": 0,
            "USER_MEMORY": "16Gi",
            "USER_STORAGE": "50Gi"
          },
          "common_resource_validations": [
            "default_cpu",
            "default_memory",
            "default_storage",
            "inference_validation"
          ],
          "common_pod_template": [
            "default_amd64",
            "inference_optimized",
            "low_latency"
          ],
          "platforms": {
            "jetson-thor-platform": {
              "description": "Jetson Thor platform for edge AI inference",
              "override_pod_template": [
                "inference_jetson_thor_template"
              ],
              "default_variables": {
                "USER_GPU": 1,
                "USER_MEMORY": "8Gi"
              }
            }
          }
        }
      }


Troubleshooting
----------------


**Pool Access Denied**
  - Verify user's group membership matches pool naming convention
  - Check role configuration includes correct pool path

**Resource Validation Failures**
  - Ensure validation rules match node capacity
  - Verify resource requests don't exceed platform limits

**Template Conflicts**
  - Review template merge order (later templates override earlier ones)
  - Check for conflicting fields in merged templates

**Platform Not Available**
  - Verify platform name is correctly specified in pool configuration
  - Ensure referenced pod templates exist

**Debugging Tips**
  - Start with simple configurations and add complexity gradually
  - Test access with different user accounts
  - Examine OSMO service logs for detailed error messages

.. warning::

   Deleting or modifying pools used by running workflows may cause scheduling issues. Always verify pools are not in use before making changes.
