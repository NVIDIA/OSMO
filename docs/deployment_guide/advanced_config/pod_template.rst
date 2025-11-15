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
Pod Template
=======================================================

Pod templates in OSMO are directly based on Kubernetes Pod specifications and serve as reusable templates for defining how workflow tasks will be executed as Kubernetes pods. They provide a flexible way to standardize pod configurations across different compute environments while allowing for dynamic customization based on workflow requirements.

Understanding Pod Templates
-----------------------------

In Kubernetes, a Pod is the smallest deployable unit that can contain one or more containers. OSMO leverages this concept by allowing administrators to define pod templates that specify:

- **Container specifications** (commands, environment variables, sidecar containers)
- **Scheduling constraints** (node selectors, affinity, tolerations)
- **Security contexts** (user IDs, capabilities, security policies)
- **Volume mounts** (persistent storage, config maps, secrets)
- **Other configuration** (host aliases, service account)

When a workflow is submitted to OSMO, the system uses these pod templates as blueprints to create actual Kubernetes pods that execute the workflow tasks.

OSMO Pod Template Structure
~~~~~~~~~~~~~~~~~~~~~~~~~~~

OSMO pod templates follow the standard Kubernetes Pod specification structure but are enhanced with:

1. **Variable substitution**: Dynamic values that are resolved at runtime based on workflow specifications
2. **Template inheritance**: Ability to combine multiple templates for complex configurations
3. **Conditional logic**: Jinja2-style expressions for dynamic configuration
4. **OSMO-specific extensions**: Additional metadata and configuration options specific to OSMO workflows

The basic structure mirrors a Kubernetes PodSpec:

.. code-block:: bash

  {
    "template_name": {
      "spec": {
        "containers": [...],
        "volumes": [...],
        "nodeSelector": {...},
        "tolerations": [...],
        "affinity": {...},
        "securityContext": {...},
        "hostAliases": [...]
      }
    }
  }

This essentially gets converted into YAML form:

.. code-block:: bash

  spec:
    containers: [...]
    volumes: [...],
    nodeSelector: {...},
    tolerations: [...],
    affinity: {...},
    securityContext: {...},
    hostAliases: [...]

.. note::

  The name for the pod template (e.g. ``template_name``) is used to reference the pod template
  in the pool configuration, and not used when building the pod spec.

When the service starts building the pod specs for each workflow task, it will start with:

.. code-block:: yaml

  apiVersion: v1
  kind: Pod
  metadata:
    name: <generated pod name>
    labels:
      osmo.workflow_id: <workflow name>
      osmo.submitted_by: <user name>
      osmo.task_name: <task name>
      …
    finalizers:
      - osmo.nvidia.com/cleanup
  spec:
    restartPolicy: Never
    imagePullSecrets:
      - name: …
      - name: …
    hostNetwork: false
    containers:
      - name: {{USER_CONTAINER_NAME}}
        image: <task image>
        imagePullPolicy: Always
        command: ["/osmo/bin/osmo_exec"]
        args: […]
        securityContext:
          privileged: false
        env:
          <osmo internal env>
          - name: NVIDIA_VISIBLE_DEVICES
            value: ""
        volumeMounts:
          <osmo internal mounts>
      - name: osmo-ctrl
        image: <osmo image>
        imagePullPolicy: Always
        command: ["/osmo/bin/osmo_ctrl"]
        args: …
        securityContext:
          privileged: false
        env: <osmo internal env>
        volumeMounts:
          <osmo internal mounts>
    initContainers:
      - name: osmo-init
        image: <osmo image>
        imagePullPolicy: Always
        command: ["osmo_init"]
        args: […]
        resources:
          requests:
            cpu: 250m
            ephemeral-storage: 1Gi
          limits:
            cpu: 500m
            ephemeral-storage: 1Gi
        volumeMounts:
        <osmo internal mounts>
    volumes:
    <osmo internal volumes>

Each pod template is then recursively merged on top of this base pod spec in the order they are defined.

For lists, the items are merged based on the name field:

- If the name field is not present or different from the rest of the list, the item is added to the list
- If the name field is present and is the same as an item in the list, the item is recursively merged

Pod templates must be configured before pools and platforms can be properly set up,
as they define the underlying Kubernetes pod specifications that will be used to execute workflows.

Pod Templates in Pool Configuration
-----------------------------------

Pod templates play a crucial role in pool configuration by enabling administrators to create pools that
target specific node types, and handle node taints. The primary benefit of pools with specific pod templates
is that **OSMO users can easily select which type of machine they want to run their workflows on** by simply
choosing the appropriate pool.

For example, in robotics and AI/ML workflows where different tasks require different hardware capabilities:

- **Training pools** use high-end GPUs (A100, H100, GB200) for model training
- **Simulation pools** use graphics-optimized GPUs (L40, L40s) for robotics simulation
- **Inference pools** use cost-effective GPUs for model inference
- **General purpose pools** use CPU-only instances for prototyping and testing

Each pool can reference one or more pod templates that define how workflows submitted to that pool will be executed,
automatically targeting the appropriate hardware without requiring users to understand complex Kubernetes scheduling details.

Pool specific template examples
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

For pool-specific pod templates, we can leverage the ``nodeSelector`` field to target specific node types and the ``tolerations`` field to handle node taints.
Each node in kubernetes has a set of labels that can be used to target specific node types.
For example, the ``node.kubernetes.io/instance-type`` label is used to target specific instance types.

The following examples demonstrate how pod templates are used to create pools with specific characteristics:

**CPU-Optimized Pool Template**

This template targets specific CPU-optimized instance types for compute-intensive workflows:

.. code-block:: json

  {
    "default_eks_cpu": {
      "spec": {
        "nodeSelector": {
          "node.kubernetes.io/instance-type": "m5a.xlarge"
        }
      }
    }
  }

**GPU-Enabled Pool Template**

This template targets L4 GPU instances for training or simulation workflows:

.. code-block:: json

  {
    "default_eks_l4": {
      "spec": {
        "nodeSelector": {
          "nvidia.com/gpu.product": "L4"
        }
      }
    }
  }

**Tainted Node Pool Template**

This template handles dedicated nodes with taints, allowing workflows to run on reserved hardware:

.. code-block:: json

  {
    "tainted_eks_l4": {
      "spec": {
        "tolerations": [
          {
            "key": "dedicated",
            "value": "l4",
            "effect": "NoSchedule"
          }
        ],
        "nodeSelector": {
          "nvidia.com/gpu.product": "L4"
        }
      }
    }
  }


Pool Template Composition
~~~~~~~~~~~~~~~~~~~~~~~~~~

Pools can reference multiple pod templates that are merged together. For example, a pool might combine:

.. code-block:: json

  {
    "sample_pool": {
      "common_pod_template": ["default_amd64", "tainted_eks_l4", "security_template"]
    }
  }

In this configuration:

* ``default_amd64`` ensures AMD64 architecture

* ``tainted_eks_l4`` handles the tainted nodes and targets specific GPU instances

* ``security_template`` applies security policies

The templates are merged in order, with later templates overriding conflicting settings from earlier ones.

.. note::

  Pod templates override the field prior to it unless it is a list. If the field is a list, the
  latter pod template will append to the list. If the field is a list of dictionaries, the
  dictionary is merged if the ``name`` field is the same. Otherwise, it is appended.


Robotics and AI/ML Pool Scenarios
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The following examples demonstrate how pod templates enable users to select appropriate hardware for different robotics and AI/ML workflows:

**Training Pool (H100 GPUs)**

GPU pool for large-scale model training workflows:

.. code-block:: json

  {
    "training_h100_template": {
      "spec": {
        "nodeSelector": {
          "nvidia.com/gpu.product": "NVIDIA-H100"
        },
        "tolerations": [
          {
            "key": "training-dedicated",
            "value": "h100",
            "effect": "NoSchedule"
          }
        ]
      }
    }
  }

**Simulation Pool (L40 GPUs)**

Graphics-optimized GPUs for robotics simulation workflows:

.. code-block:: json

  {
    "simulation_l40_template": {
      "spec": {
        "nodeSelector": {
          "nvidia.com/gpu.product": "NVIDIA-L40"
        },
        "tolerations": [
          {
            "key": "simulation-dedicated",
            "value": "l40",
            "effect": "NoSchedule"
          }
        ]
      }
    }
  }

**General Purpose Pool (CPU)**

Cost-effective CPU instances for model general purpose workflows:

.. code-block:: json

  {
    "general_purpose_cpu_template": {
      "spec": {
        "nodeSelector": {
          "node.kubernetes.io/instance-type": "c5.4xlarge"
        }
      }
    }
  }

**Inference Pool (T4 GPUs)**

Efficient GPU instances for accelerated inference workflows:

.. code-block:: json

  {
    "inference_t4_template": {
      "spec": {
        "nodeSelector": {
          "nvidia.com/gpu.product": "NVIDIA-T4",
          "workload-type": "inference"
        },
        "tolerations": [
          {
            "key": "inference-dedicated",
            "value": "t4",
            "effect": "NoSchedule"
          }
        ]
      }
    }
  }


Each pod template can be used in a pool configuration to create a pool with specific characteristics. Users can simply select the appropriate pool for their workflow by choosing the appropriate pool. This aims to simplify the user experience and make it easier to use OSMO.

How OSMO Uses Kubernetes Pod Templates
---------------------------------------

Workflow Execution Lifecycle
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

When a workflow is submitted to OSMO, the following process occurs:

1. **Template Selection**: OSMO selects the appropriate pod template(s) based on the pool/platform configuration
2. **Variable Resolution**: All template variables (``{{USER_CPU}}``, ``{{WF_ID}}``, etc.) are resolved using workflow specifications and system context
3. **Template Merging**: If multiple templates are specified, they are merged according to precedence rules
4. **Pod Creation**: The final pod specification is submitted to the Kubernetes API to create the actual pod
5. **Task Execution**: The Kubernetes scheduler places the pod on an appropriate node and starts the containers

Template Inheritance and Merging
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

OSMO supports applying multiple pod templates to a single workflow task. Templates are merged in the order they are specified, with later templates overriding earlier ones. This allows for composition patterns such as:

.. code-block:: json

  {
    "pool_config": {
      "pod_templates": ["base_template", "gpu_template", "security_template"]
    }
  }

In this example:

* ``base_template`` provides common configuration (node selectors, basic resources)

* ``gpu_template`` adds GPU-specific configuration (GPU resources, tolerations)

* ``security_template`` applies security policies (security contexts, service accounts)


Container-Level Configuration
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Within the containers section, OSMO templates support all standard Kubernetes container fields:

.. code-block:: json

  {
    "spec": {
      "containers": [
        {
          "name": "{{USER_CONTAINER_NAME}}",
          "env": [
            {
              "name": "ENV_VAR_NAME",
              "value": "ENV_VAR_VALUE"
            }
          ],
          "resources": {
            "limits": {
              "cpu": "{{USER_CPU}}",
              "memory": "{{USER_MEMORY}}",
              "ephemeral-storage": "{{USER_STORAGE}}",
              "nvidia.com/gpu": "{{USER_GPU}}"
            },
            "requests": {
              "cpu": "{{USER_CPU}}",
              "memory": "{{USER_MEMORY}}",
              "ephemeral-storage": "{{USER_STORAGE}}",
              "nvidia.com/gpu": "{{USER_GPU}}"
            }
          }
        }
      ]
    }
  }

.. warning::

  Do not override the `image`, `command` and `args` fields in the container spec.
  They are already configured by OSMO, and will use the user's workflow spec
  to determine the command and args.

Configuration Process
---------------------

Pod templates are configured using the OSMO CLI with the ``POD_TEMPLATE`` configuration key:

.. code-block:: bash

  osmo config update POD_TEMPLATE --file /path/to/pod_template_config.json

The configuration file should contain a JSON object where each key represents a template name and the value contains the pod specification.

Recommended Templates
---------------------

The following are recommended pod templates that cover common use cases:

**default_amd64**
  Ensures pods are scheduled on AMD64 architecture nodes.

**default_ctrl**
  Defines resource specifications for OSMO control containers with optimized resource requests and limits.
  This is an internal container that is used to manage the workflow.

**default_user**
  Defines resource specifications for user containers with full resource allocation based on workflow requirements.

Here's the complete recommended configuration:

.. code-block:: json

  {
    "default_amd64": {
      "spec": {
        "nodeSelector": {
          "kubernetes.io/arch": "amd64"
        }
      }
    },
    "default_ctrl": {
      "spec": {
        "containers": [
          {
            "name": "osmo-ctrl",
            "resources": {
              "limits": {
                "cpu": "{{USER_CPU}}",
                "memory": "{{USER_MEMORY}}",
                "ephemeral-storage": "{{USER_STORAGE}}"
              },
              "requests": {
                "cpu": "{% if USER_CPU > 2 %}2{% else %}{{USER_CPU}}{% endif %}",
                "memory": "1Gi",
                "ephemeral-storage": "4Gi"
              }
            }
          }
        ]
      }
    },
    "default_user": {
      "spec": {
        "containers": [
          {
            "name": "{{USER_CONTAINER_NAME}}",
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
          }
        ]
      }
    }
  }

Template Variables
------------------

Pod templates support dynamic variable substitution using special tokens enclosed in double curly braces (``{{TOKEN_NAME}}``). These variables are resolved at runtime based on workflow specifications and system context.

Resource-Related Variables
~~~~~~~~~~~~~~~~~~~~~~~~~~

.. list-table:: Resource Variables
   :header-rows: 1
   :widths: 25 75

   * - **Token**
     - **Description**
   * - ``USER_CPU``
     - CPU count value defined in resource spec
   * - ``USER_MEMORY``
     - Memory value defined in resource spec (e.g., "8Gi")
   * - ``USER_MEMORY_VAL``
     - Numeric value in memory value defined in resource spec
   * - ``USER_MEMORY_UNIT``
     - Unit in memory value defined in resource spec (e.g., "Gi")
   * - ``USER_MEMORY_<UNIT>``
     - Numeric value in memory converted to specified unit. UNIT can be B, Ki, Mi, Gi, Ti (e.g., ``USER_MEMORY_Gi``)
   * - ``USER_STORAGE``
     - Storage value defined in resource spec (e.g., "100Gi")
   * - ``USER_STORAGE_VAL``
     - Numeric value in storage value defined in resource spec
   * - ``USER_STORAGE_UNIT``
     - Unit in storage value defined in resource spec (e.g., "Gi")
   * - ``USER_STORAGE_<UNIT>``
     - Numeric value in storage converted to specified unit. UNIT can be B, Ki, Mi, Gi, Ti (e.g., ``USER_STORAGE_Gi``)
   * - ``USER_GPU``
     - GPU count value defined in resource spec
   * - ``USER_CACHE``
     - Cache size for user mounted inputs (amount like "10GiB" or percent like "50%")

Node and Container Variables
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. list-table:: Node and Container Variables
   :header-rows: 1
   :widths: 25 75

   * - **Token**
     - **Description**
   * - ``USER_CONTAINER_NAME``
     - Name of the user container
   * - ``USER_EXCLUDED_NODES``
     - List of nodes specified by users using the ``nodesExcluded`` field. Interpreted as a list.

Workflow-Related Variables
~~~~~~~~~~~~~~~~~~~~~~~~~~

.. list-table:: Workflow Variables
   :header-rows: 1
   :widths: 25 75

   * - **Token**
     - **Description**
   * - ``WF_ID``
     - The name/ID associated with the workflow
   * - ``WF_UUID``
     - The unique ID associated with the workflow
   * - ``WF_GROUP_NAME``
     - The group name of the task
   * - ``WF_TASK_NAME``
     - The task name
   * - ``WF_SUBMITTED_BY``
     - The username of the user who submitted the workflow
   * - ``WF_LEAD_CONTAINER``
     - Boolean value indicating if the task is the lead task
   * - ``WF_POOL``
     - The name of the pool that the workflow is submitted to
   * - ``WF_PLATFORM``
     - The name of the platform that the workflow is submitted to

Variable Usage Examples
-----------------------

Basic Variable Substitution
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

To use variables in your pod template, include them in double curly braces:

.. code-block:: json

  {
    "volumeAttributes": {
      "size": "{{USER_STORAGE}}"
    },
    "metadata": {
      "labels": {
        "workflow-id": "{{WF_ID}}",
        "submitted-by": "{{WF_SUBMITTED_BY}}"
      }
    }
  }

Conditional Logic
~~~~~~~~~~~~~~~~~

Pod templates support Jinja2-style conditional expressions:

.. code-block:: json

  {
    "resources": {
      "requests": {
        "cpu": "{% if USER_CPU > 2 %}2{% else %}{{USER_CPU}}{% endif %}"
      }
    }
  }

Array Variables
~~~~~~~~~~~~~~~

Variables that follow the format ``ARRAY:[<item1>,<item2>,...]`` are automatically unrolled into JSON arrays:

.. code-block:: json

  {
    "affinity": {
      "nodeAffinity": {
        "requiredDuringSchedulingIgnoredDuringExecution": {
          "nodeSelectorTerms": [
            {
              "matchExpressions": [
                {
                  "key": "kubernetes.io/hostname",
                  "operator": "NotIn",
                  "values": "{{USER_EXCLUDED_NODES}}"
                }
              ]
            }
          ]
        }
      }
    }
  }

This will be unrolled into:

.. code-block:: json

  {
    "values": ["node1", "node2", "node3"]
  }

Advanced Configuration Examples
-------------------------------

These examples demonstrate how OSMO pod templates translate to real-world Kubernetes configurations.

Complete Kubernetes Pod Template
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

This example shows a comprehensive pod template that demonstrates the full range of Kubernetes features:

.. code-block:: json

  {
    "comprehensive_template": {
      "spec": {
        "securityContext": {
          "capabilities": {
            "add": [
              "SYS_PTRACE",
              "IPC_LOCK"
            ]
          }
        },
        "containers": [
          {
            "name": "{{USER_CONTAINER_NAME}}",
            "imagePullPolicy": "Always",
            "env": [
              {
                "name": "OSMO_WORKFLOW_ID",
                "value": "{{WF_ID}}"
              },
              {
                "name": "OSMO_TASK_NAME",
                "value": "{{WF_TASK_NAME}}"
              },
              {
                "name": "NVIDIA_VISIBLE_DEVICES",
                "value": "all"
              }
            ],
            "volumeMounts": [
              {
                "name": "shared-memory",
                "mountPath": "/dev/shm"
              }
            ]
          }
        ],
        "volumes": [
          {
            "name": "shared-memory",
            "emptyDir": {
              "medium": "Memory",
              "sizeLimit": "1Gi"
            }
          },
        ],
        "nodeSelector": {
          "kubernetes.io/arch": "amd64",
          "node.kubernetes.io/instance-type": "gpu-node"
        },
        "tolerations": [
          {
            "key": "nvidia.com/gpu",
            "operator": "Exists",
            "effect": "NoSchedule"
          },
          {
            "key": "osmo.nvidia.com/dedicated",
            "operator": "Equal",
            "value": "workflow",
            "effect": "NoSchedule"
          }
        ],
        "affinity": {
          "nodeAffinity": {
            "requiredDuringSchedulingIgnoredDuringExecution": {
              "nodeSelectorTerms": [
                {
                  "matchExpressions": [
                    {
                      "key": "kubernetes.io/hostname",
                      "operator": "NotIn",
                      "values": "{{USER_EXCLUDED_NODES}}"
                    }
                  ]
                }
              ]
            },
            "preferredDuringSchedulingIgnoredDuringExecution": [
              {
                "weight": 100,
                "preference": {
                  "matchExpressions": [
                    {
                      "key": "nvidia.com/gpu.product",
                      "operator": "In",
                      "values": ["NVIDIA-L40", "NVIDIA-H100"]
                    }
                  ]
                }
              }
            ]
          }
        }
      }
    }
  }

GPU-Enabled Template
~~~~~~~~~~~~~~~~~~~~~

.. code-block:: json

  {
    "gpu_workload": {
      "spec": {
        "containers": [
          {
            "name": "{{USER_CONTAINER_NAME}}",
            "resources": {
              "limits": {
                "nvidia.com/gpu": "{{USER_GPU}}",
                "memory": "{{USER_MEMORY}}",
                "cpu": "{{USER_CPU}}"
              },
              "requests": {
                "nvidia.com/gpu": "{{USER_GPU}}",
                "memory": "{{USER_MEMORY}}",
                "cpu": "{{USER_CPU}}"
              }
            }
          }
        ],
        "nodeSelector": {
          "nvidia.com/gpu.product": "NVIDIA-H100"
        },
        "tolerations": [
          {
            "key": "nvidia.com/gpu",
            "operator": "Exists",
            "effect": "NoSchedule"
          }
        ]
      }
    }
  }


Security-Enhanced Template
~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: json

  {
    "secure_workload": {
      "spec": {
        "securityContext": {
          "runAsNonRoot": true,
          "runAsUser": 1000,
          "fsGroup": 1000
        },
        "containers": [
          {
            "name": "{{USER_CONTAINER_NAME}}",
            "securityContext": {
              "allowPrivilegeEscalation": false,
              "readOnlyRootFilesystem": true,
              "capabilities": {
                "drop": ["ALL"]
              }
            },
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

Best Practices
--------------

Template Design
~~~~~~~~~~~~~~~~

1. **Use descriptive names**: Choose clear, descriptive names for your templates that indicate their purpose (e.g., ``gpu_training``, ``cpu_inference``, ``high_memory``).

2. **Modular approach**: Create focused templates for specific use cases rather than trying to create one template that handles all scenarios.

3. **Resource optimization**: Use conditional logic to optimize resource requests, especially for CPU where you might want to request less than the limit for better scheduling.

4. **Include metadata**: Add relevant labels and annotations to help with monitoring and debugging.

Variable Usage
~~~~~~~~~~~~~~

1. **Validate variables**: Ensure that the variables you use in templates are appropriate for your use case and will be populated correctly.

2. **Provide defaults**: Use conditional expressions to provide sensible defaults when variables might not be set.

3. **Test thoroughly**: Test your templates with different workflow configurations to ensure they work correctly across all scenarios.


Troubleshooting
---------------

Common Issues
~~~~~~~~~~~~~

**Template not found**
  Ensure the template name in your pool/platform configuration exactly matches the name defined in your pod template configuration.
  You can verify the template name by running ``/api/configs/pod_template/<template_name>``.

**Variable substitution errors**
  Check that all variables used in your template are valid and will be populated by the system. Invalid variables will cause pod creation to fail.

**Resource constraints**
  Verify that the resource requirements defined in your templates are compatible with the available nodes in your cluster.

**Syntax errors**
  Validate your JSON syntax and ensure that Jinja2 expressions are properly formatted.

Debugging Tips
~~~~~~~~~~~~~~

1. **Check logs**: Review OSMO service logs for template parsing errors.

2. **Validate JSON**: Use a JSON validator to ensure your template configuration is syntactically correct.

3. **Test incrementally**: Start with simple templates and gradually add complexity.

4. **Use workflow inspection**: Use OSMO CLI commands to inspect the final pod specifications generated from your templates.

.. note::

   Pod specs are constructed per workflow task, allowing administrators to use task-specific variables such as ``WF_GROUP_NAME`` or ``WF_TASK_NAME`` for fine-grained control over pod specifications.

.. warning::

   Changes to pod templates will only apply to new workflow tasks that were created after the configuration update.
   Running tasks will continue to use the template configuration that was active when they were created.
