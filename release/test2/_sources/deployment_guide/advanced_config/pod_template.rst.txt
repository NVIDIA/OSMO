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


.. _pod_template:

=======================================================
Pod Templates
=======================================================

Pod templates define how workflow tasks execute as Kubernetes pods. After configuring :ref:`pools <pool>` and :ref:`resource validation <resource_validation>`, create pod templates to specify scheduling constraints, security policies, and resource allocations that apply across your pools.


Why Use Pod Templates?
======================

Pod templates provide standardized configurations that simplify cluster management:

✓ **Target Specific Hardware**
  Use node selectors and tolerations to route workflows to the right GPU types, CPU architectures, or instance types.

✓ **Enforce Security Policies**
  Apply consistent security contexts, capabilities, and access controls across all workflow tasks.

✓ **Optimize Resource Allocation**
  Set appropriate resource requests and limits with conditional logic based on workflow requirements.

✓ **Simplify User Experience**
  Users select pools without needing to understand complex Kubernetes scheduling—templates handle all the details.


How It Works
============

Template Application Flow
-------------------------

.. grid:: 4
    :gutter: 2

    .. grid-item-card::
        :class-header: sd-bg-info sd-text-white

        **1. Define Templates** 📋
        ^^^

        Create reusable specs

        +++

        Node selectors, tolerations, resrcs

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

        Later templates override earlier

    .. grid-item-card::
        :class-header: sd-bg-success sd-text-white

        **4. Create K8s Pods** ✅
        ^^^

        Build Kubernetes pods

        +++

        Apply to workflow tasks

Template Structure
------------------

Pod templates use the standard `Kubernetes PodSpec <https://kubernetes.io/docs/concepts/workloads/pods/#pod-templates>`_ format with OSMO enhancements:

.. code-block:: json

  {
    "template_name": {
      "spec": {
        "nodeSelector": {
          "node-label": "value"
        },
        "tolerations": [
          {
            "key": "taint-key",
            "effect": "NoSchedule"
          }
        ],
        "containers": [
          {
            "name": "{{USER_CONTAINER_NAME}}",
            "resources": {
              "limits": {
                "cpu": "{{USER_CPU}}",
                "memory": "{{USER_MEMORY}}"
              }
            }
          }
        ]
      }
    }
  }

Key Features
------------

- **Variable Substitution**: Use ``{{USER_CPU}}``, ``{{WF_ID}}``, etc. are resolved at runtime
- **Template Merging**: Combine multiple templates; later ones override earlier ones
- **Conditional Logic**: Use Jinja2 expressions for dynamic values (For example, to accept all user requests of CPU > 2 else override to 2, use ``{% if USER_CPU > 2 %}2{% else %}{{USER_CPU}}{% endif %}``)

.. warning::

   **Merge Behavior**

   - Fields are overridden by your templates
   - Lists are merged by ``name`` field (same name = recursive merge, different name = append)
   - Templates are applied in order (later overrides earlier)

.. note::

   For detailed configuration fields and all available variables, see :ref:`pod_template_config` in the API reference.

.. dropdown:: **Base Pod Specification Details**
    :color: info
    :icon: info

    OSMO creates a base pod spec with three containers (osmo-init, osmo-ctrl, user container). Your templates are merged on top of it.

    .. code-block:: yaml

      apiVersion: v1
      kind: Pod
      metadata:
        labels:
          osmo.workflow_id: <workflow name>
          osmo.submitted_by: <user name>
      spec:
        containers:
          - name: {{USER_CONTAINER_NAME}}  # Your code runs here
            command: ["/osmo/bin/osmo_exec"]
          - name: osmo-ctrl  # Manages data transfer
        initContainers:
          - name: osmo-init  # Sets up environment


Practical Guide
===============

Standard Pod Templates
--------------------------------

Create templates that target specific hardware and handle Kubernetes scheduling constraints.

**Step 1: Understanding Template Variables**

.. dropdown:: **Special Variables**
    :color: info
    :icon: code

    **Resource Variables:**
      - ``{{USER_CPU}}`` - CPU count
      - ``{{USER_GPU}}`` - GPU count
      - ``{{USER_MEMORY}}`` - Memory (e.g., "8Gi")
      - ``{{USER_STORAGE}}`` - Storage (e.g., "100Gi")
      - ``{{USER_CONTAINER_NAME}}`` - Name of user container

    **Workflow Variables:**
      - ``{{WF_ID}}`` - Workflow name/ID
      - ``{{WF_UUID}}`` - Unique workflow ID
      - ``{{WF_TASK_NAME}}`` - Task name
      - ``{{WF_SUBMITTED_BY}}`` - Username
      - ``{{WF_POOL}}`` - Pool name
      - ``{{WF_PLATFORM}}`` - Platform name

    **Conditional Logic:**
      - Use Jinja2: ``{% if USER_CPU > 2 %}2{% else %}{{USER_CPU}}{% endif %}``


**Step 2: Template Configuration File**

Create a configuration file with base templates for architecture, control container, and user container:

.. code-block:: bash

  $ cat << EOF > pod_templates.json
  {
    # Target specific architecture
    "default_amd64": {
      "spec": {
        "nodeSelector": {"kubernetes.io/arch": "amd64"}
      }
    },
    "default_ctrl": {
      "spec": {
        # Control container
        "containers": [{
          "name": "osmo-ctrl",
          "resources": {
            # Use user specified resources as limits
            "limits": {
              "cpu": "{{USER_CPU}}",
              "memory": "{{USER_MEMORY}}",
              "ephemeral-storage": "{{USER_STORAGE}}"
            },
            # Use a default value of 2 if user requests are less than 2
            "requests": {
              "cpu": "{% if USER_CPU > 2 %}2{% else %}{{USER_CPU}}{% endif %}",
              "memory": "1Gi",
              "ephemeral-storage": "4Gi"
            }
          }
        }]
      }
    },
    "default_user": {
      "spec": {
        # User container
        "containers": [{
          "name": "{{USER_CONTAINER_NAME}}",
          # Use user specified resources for requests and limits
          "resources": {
            "limits": {
              "cpu": "{{USER_CPU}}",
              "memory": "{{USER_MEMORY}}",
              "nvidia.com/gpu": "{{USER_GPU}}",
              "ephemeral-storage": "{{USER_STORAGE}}"
            },
            "requests": {
              "cpu": "{{USER_CPU}}",
              "memory": "{{USER_MEMORY}}",
              "nvidia.com/gpu": "{{USER_GPU}}",
              "ephemeral-storage": "{{USER_STORAGE}}"
            }
          }
        }]
      }
    }
  }
  EOF

  $ osmo config update POD_TEMPLATE --file pod_templates.json

**Step 3: Reference Templates in Pools**

Add templates to your pool's ``common_pod_template`` field:

.. code-block:: json
  :emphasize-lines: 5-7

  {
    "my-pool": {
      "backend": "default",
      "common_pod_template": [
        "default_amd64",
        "default_ctrl",
        "default_user"
      ]
    }
  }


Additional Examples
-------------------

.. dropdown:: **GPU-Specific Templates** - Target Specific GPU Types
    :color: info
    :icon: cpu

    Create templates for different GPU hardware (H100, L40, T4):

    .. code-block:: json

      {
        "training_h100": {
          "spec": {
            "nodeSelector": {"nvidia.com/gpu.product": "NVIDIA-H100"},
            "tolerations": [{
              "key": "training-dedicated",
              "value": "h100",
              "effect": "NoSchedule"
            }]
          }
        },
        "simulation_l40": {
          "spec": {
            "nodeSelector": {"nvidia.com/gpu.product": "NVIDIA-L40"},
            "tolerations": [{
              "key": "simulation-dedicated",
              "value": "l40",
              "effect": "NoSchedule"
            }]
          }
        }
      }

.. dropdown:: **CPU Instance Types** - Target Specific Instance Classes
    :color: info
    :icon: server

    Target CPU-optimized instances:

    .. code-block:: json

      {
        "cpu_compute": {
          "spec": {
            "nodeSelector": {
              "node.kubernetes.io/instance-type": "c5.4xlarge"
            }
          }
        }
      }

.. dropdown:: **Security Templates** - Apply Security Contexts
    :color: info
    :icon: shield

    Enforce security policies:

    .. code-block:: json

      {
        "secure_workload": {
          "spec": {
            "securityContext": {
              "runAsNonRoot": true,
              "runAsUser": 1000,
              "fsGroup": 1000
            },
            "containers": [{
              "name": "{{USER_CONTAINER_NAME}}",
              "securityContext": {
                "allowPrivilegeEscalation": false,
                "readOnlyRootFilesystem": true,
                "capabilities": {"drop": ["ALL"]}
              }
            }]
          }
        }
      }

.. dropdown:: **Node Exclusion** - Exclude Specific Nodes
    :color: info
    :icon: x-circle

    Use node affinity to exclude nodes from user requests. This rule can be used to avoid gpu fragmentation with in the cluster by satisfying user requests on the same node, before the scheduler chooses other nodes to schedule tasks.

    .. code-block:: json

      {
        "node_exclusion": {
          "spec": {
            "affinity": {
              "nodeAffinity": {
                "requiredDuringSchedulingIgnoredDuringExecution": {
                  "nodeSelectorTerms": [{
                    "matchExpressions": [{
                      "key": "kubernetes.io/hostname",
                      "operator": "NotIn",
                      "values": "{{USER_EXCLUDED_NODES}}"
                    }]
                  }]
                }
              }
            }
          }
        }
      }

.. dropdown:: **Shared Memory** - Add /dev/shm Volume
    :color: info
    :icon: database

    Add shared memory for workflows requiring IPC (Example: TensorRT, PyTorch, etc.)

    .. code-block:: json

      {
        "shared_memory": {
          "spec": {
            "containers": [{
              "name": "{{USER_CONTAINER_NAME}}",
              "volumeMounts": [{
                "name": "shm",
                "mountPath": "/dev/shm"
              }]
            }],
            "volumes": [{
              "name": "shm",
              "emptyDir": {
                "medium": "Memory",
                "sizeLimit": "1Gi"
              }
            }]
          }
        }
      }


Troubleshooting
---------------

**Template Not Found**
  - Verify template name matches exactly in pool configuration
  - Check template exists: ``osmo config get POD_TEMPLATE <template_name>``

**Variable Substitution Errors**
  - Ensure all variables used are valid OSMO variables
  - Check for typos in variable names (case-sensitive)
  - Review logs for specific variable resolution errors

**Resource Constraints**
  - Verify resource requests match available node capacity
  - Check nodeSelector labels exist on cluster nodes
  - Ensure tolerations match node taints

**Debugging Tips**
  - Start with simple templates and add complexity gradually
  - Validate JSON syntax before applying
  - Test with different workflow configurations
  - Review OSMO service logs for detailed errors

.. tip::

   **Best Practices**

   - Use descriptive template names (e.g., ``gpu_h100_training``, ``cpu_inference``)
   - Create modular templates for reusability across different pools (Example: architecture, security, resources)
   - Use conditional logic to optimize resource requests
   - Add labels and annotations for monitoring
   - Test templates thoroughly before production use

.. warning::

   - Do not override ``image``, ``command``, or ``args`` fields in containers — OSMO manages these internally.
   - Template changes only apply to new workflows and NOT running workflow tasks
