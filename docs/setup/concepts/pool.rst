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
Pool
=======================================================

Pools in OSMO serve as an abstraction layer over compute backends that enables fine-grained access control and resource management.
Pools allow administrators to define which users can access which compute resources, while providing a simplified interface for users to select appropriate hardware for their workflows.


Understanding OSMO Pools
------------------------

A pool represents a logical grouping of compute resources within a backend that can be configured with:

- **Access Control**: Define which user groups can access the pool
- **Resource Templates**: Specify pod templates and resource validation rules
- **Default Settings**: Set default resource allocations and timeouts
- **Platforms**: Create sub-divisions within pools for different hardware types
- **Variables**: Define common variables used across templates

Pool Architecture
~~~~~~~~~~~~~~~~~

OSMO pools follow a hierarchical structure:

.. code-block:: text

  Backend
  └── Pool (e.g., "training-pool")
      ├── Platform 1 (e.g., "a100")
      ├── Platform 2 (e.g., "h100")
      └── Platform 3 (e.g., "gb200")

**Backend**: The underlying Kubernetes cluster or compute infrastructure

**Pool**: A logical grouping with access control and common configuration

**Platform**: Specific hardware configurations within a pool (optional)

This structure enables users to:

1. Select a pool based on their workflow type (training, simulation, inference)

2. Optionally select a platform for specific hardware requirements in their workflow spec

3. Have their workflows automatically scheduled on appropriate nodes

Pool Access Control
~~~~~~~~~~~~~~~~~~~

OSMO implements a naming-based access control system for pools:

**Access Rule**: A Pool ``<pool_name>`` can be accessed via role ``osmo-<team_name>`` if ``<pool_name>`` begins with ``<team_name>``.

**Examples if <team_name> is ``team``**:

- ✅ Can access pools: ``teamcluster01``, ``team-cluster-02``, ``team-gpu-pool``

- ❌ Cannot access pools: ``myteam-cluster-01``, ``other-team-pool``

How OSMO Uses Pools
-------------------

Workflow Submission Process
~~~~~~~~~~~~~~~~~~~~~~~~~~~

When users submit workflows to OSMO pools, the following process occurs:

1. **Pool Selection**: User specifies a pool name in their workflow submission
2. **Access Validation**: OSMO verifies the user's group membership allows access to the pool
3. **Resource Validation**: User's resource requests are validated against pool's validation rules
4. **Template Building**: Pool's pod templates are applied to create Kubernetes pod specifications
5. **Scheduling**: Kubernetes scheduler places the pod on appropriate nodes based on selectors and tolerations

Integration with Pod Templates and Resource Validation
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Pools serve as the integration point between pod templates and resource validation:

**Pod Template Integration**
  Pools reference pod templates through the ``common_pod_template`` field. These templates define the Kubernetes pod specifications that will be used for workflows. For detailed information, see :ref:`Pod Template <pod_template>`.

**Resource Validation Integration**
  Pools reference validation rules through the ``common_resource_validations`` field. These rules ensure users don't request more resources than available on nodes. For comprehensive details, see :ref:`Resource Validation <resource_validation>`.

**Template Inheritance**
  Pools can specify multiple pod templates that are merged in order, with later templates overriding earlier ones. This enables composition patterns like:

.. code-block:: json

  {
    "common_pod_template": [
      "default_amd64",      // Architecture requirement
      "training_a100",      // GPU-specific configuration
      "security_template"   // Security policies
    ]
  }

Pod templates are explained in more detail in :ref:`Pod Template <pod_template>`.

Resource validation rules are explained in more detail in :ref:`Resource Validation <resource_validation>`.

Pool Configuration
------------------

Core Pool Fields
~~~~~~~~~~~~~~~~

.. list-table:: Pool Configuration Fields
   :header-rows: 1
   :widths: 25 75

   * - **Field**
     - **Description**
   * - ``name`` (Required)
     - Name of the pool
   * - ``description``
     - Human-readable description of the pool's purpose and resources
   * - ``backend`` (Required)
     - Name of the compute backend this pool targets
   * - ``default_platform``
     - Default platform to use if user doesn't specify one
   * - ``default_exit_actions``
     - Default exit actions to use if not set by user
   * - ``action_permissions``
     - Action permissions to use if not set by user
   * - ``resources``
     - Resources to use if not set by user
   * - ``enable_maintenance``
     - Whether to enable maintenance mode
   * - ``common_default_variables``
     - Variables used in pod templates and resource validation
   * - ``common_resource_validations``
     - List of resource validation template names (merged in order)
   * - ``common_pod_template``
     - List of pod template names (merged in order)
   * - ``platforms``
     - Dictionary of platform configurations within this pool

Timeout Configuration (Optional)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Timeout configurations are optional fields which overrides fields that can be set in the workflow configs.

.. list-table:: Timeout Configuration Fields
   :header-rows: 1
   :widths: 25 75

   * - **Field**
     - **Description**
   * - ``default_exec_timeout``
     - Default execution timeout if not set by user
   * - ``default_queue_timeout``
     - Default queue timeout if not set by user
   * - ``max_exec_timeout``
     - Maximum execution timeout users can set
   * - ``max_queue_timeout``
     - Maximum queue timeout users can set



Platform Configuration
-----------------------

Understanding Platforms
~~~~~~~~~~~~~~~~~~~~~~~~

If your cluster contain nodes with different hardware specs (e.g. different kinds of GPUs),
platforms can provide fine-grained resource differentiation within pools.
They enable:

- **Hardware Specialization**: Different platforms for different GPU types
- **Resource Isolation**: Different resource limits per platform

Platform Fields
~~~~~~~~~~~~~~~

.. list-table:: Platform Configuration Fields
   :header-rows: 1
   :widths: 25 75

   * - **Field**
     - **Description**
   * - ``description``
     - Description of the platform's specific resources
   * - ``host_network_allowed``
     - Whether host networking is allowed (default: false)
   * - ``privileged_allowed``
     - Whether privileged containers are allowed (default: false)
   * - ``default_variables``
     - Platform-specific variables (inherit from pool)
   * - ``resource_validations``
     - Additional validation rules (merged with pool rules)
   * - ``override_pod_template``
     - Additional pod templates (merged with pool templates)
   * - ``allowed_mounts``
     - List of volume mounts available to users



Pool Examples
------------------------

Robotics Training Pools
~~~~~~~~~~~~~~~~~~~~~~~~

**High-Performance Training Pool**
  Pool targeting latest GPU hardware for large model training:

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
        "a100-platform": {
          "description": "A100 GPUs for standard training workloads",
          "override_pod_template": ["training_a100_template"],
          "default_variables": {
            "USER_MEMORY": "80Gi"
          }
        },
        "h100-platform": {
          "description": "H100 GPUs for large-scale training",
          "override_pod_template": ["training_h100_template"],
          "default_variables": {
            "USER_MEMORY": "128Gi"
          }
        },
        "gb200-platform": {
          "description": "GB200 GPUs for ultra-large models",
          "override_pod_template": ["training_gb200_template"],
          "default_variables": {
            "USER_MEMORY": "256Gi"
          }
        }
      }
    }
  }

Robotics Simulation Pool
~~~~~~~~~~~~~~~~~~~~~~~~~

**Graphics-Optimized Simulation Pool**
  Pool targeting graphics GPUs for robotics simulation:

.. code-block:: json

  {
    "robotics-simulation": {
      "description": "Graphics-optimized pool for robotics simulation workloads",
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
          "override_pod_template": ["simulation_l40_template"]
        },
        "l40s-platform": {
          "description": "L40S GPUs for high-fidelity simulation",
          "override_pod_template": ["simulation_l40s_template"],
          "default_variables": {
            "USER_MEMORY": "48Gi"
          }
        }
      }
    }
  }

Inference Pool
~~~~~~~~~~~~~~

**Cost-Optimized Inference Pool**
  Pool targeting efficient hardware for model inference:

.. code-block:: json

  {
    "robotics-inference": {
      "description": "Cost-optimized pool for model inference workloads",
      "backend": "inference-cluster-01",
      "default_platform": "cpu-platform",
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
        "cpu-platform": {
          "description": "CPU-only inference for lightweight models",
          "override_pod_template": ["inference_cpu_template"]
        },
        "t4-platform": {
          "description": "T4 GPUs for accelerated inference",
          "override_pod_template": ["inference_t4_template"],
          "default_variables": {
            "USER_GPU": 1,
            "USER_MEMORY": "24Gi"
          }
        }
      }
    }
  }

Development Pool
~~~~~~~~~~~~~~~~

**Multi-Purpose Development Pool**
  Pool for development and testing with various hardware options:

.. code-block:: json

  {
    "team-development": {
      "description": "Development pool for prototyping and testing",
      "backend": "dev-cluster-01",
      "default_platform": "small-gpu",
      "common_default_variables": {
        "USER_CPU": 2,
        "USER_GPU": 0,
        "USER_MEMORY": "8Gi",
        "USER_STORAGE": "50Gi"
      },
      "common_resource_validations": [
        "development_cpu_validation",
        "development_memory_validation",
        "development_storage_validation"
      ],
      "common_pod_template": [
        "default_amd64",
        "development_template"
      ],
      "default_exec_timeout": "2h",
      "max_exec_timeout": "8h",
      "platforms": {
        "cpu-only": {
          "description": "CPU-only development environment",
          "override_pod_template": ["dev_cpu_template"]
        },
        "small-gpu": {
          "description": "Single GPU for ML development",
          "override_pod_template": ["dev_gpu_template"],
          "default_variables": {
            "USER_GPU": 1,
            "USER_MEMORY": "16Gi"
          }
        }
      }
    }
  }


Troubleshooting
---------------

Common Issues
~~~~~~~~~~~~~

**Pool Access Denied**
Verify that the user's group name matches the pool naming convention and that they're a member of the correct group.

**Resource Validation Failures**
Check that pool's resource validation rules are appropriate for the intended workloads and node capacity.

**Template Conflicts**
Review template merge order and ensure later templates properly override earlier ones without conflicts.

**Platform Not Available**
Verify that platform names are correctly specified and that the platform exists in the pool configuration.

Debugging Tips
~~~~~~~~~~~~~~

1. **Check Pool Status**: Use ``osmo pool list`` to verify pool availability and status

2. **Validate Templates**: Ensure referenced pod templates and validation rules exist in the system

3. **Test Access**: Test pool access with different user accounts to verify access control

4. **Review Logs**: Examine OSMO service logs for detailed error messages during pool operations

5. **Incremental Configuration**: Start with simple pool configurations and add complexity gradually

Pool Management Operations
~~~~~~~~~~~~~~~~~~~~~~~~~~

**List Pools**
View available pools and their status:

.. code-block:: bash

  osmo pool list

**Pool Details**
Get detailed resource information about a specific pool:

.. code-block:: bash

  osmo resource list -p <pool_name>

**Update Pool Configuration**
Modify existing pool configuration:

.. code-block:: bash

  osmo config update POOL --file updated_pool_config.json

**Delete Pool**
Remove a pool configuration:

.. code-block:: bash

  osmo config delete POOL <pool_name>

.. note::

   Pool configurations integrate closely with pod templates and resource validation rules.
   Changes to referenced templates or validation rules will affect all pools that use them.

.. warning::

   Deleting or modifying pools that are actively used by running workflows may cause
   scheduling issues. Always verify that pools are not in use before making changes.
