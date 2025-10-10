.. _pool_configuration:

=======================
Pool Configuration
=======================

Heterogeneous Node Pools
------------------------

Pools can be configured to handle heterogeneous nodes (e.g., different host machine types such as AGX Jetson Orin, L40s, A100, H100, GB200) by creating and assigning a platform for each machine type.

1. Create a pod template for each kind of host machine.
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

To assign a platform to a pool, you need to create a pod template for each kind of host machine. A pod template is a used to define the Kubernetes pod specification for node selectors and tolerations. You can find the labels and tolerations for each kind of node using the following command:

.. code-block:: bash

  $ kubectl get nodes -o jsonpath='{.items[*].metadata.labels}' | jq -r 'to_entries[] | select(.key | startswith("nvidia.com/gpu.product")) | .value'
  $ kubectl get nodes -o jsonpath='{.items[*].metadata.tolerations}'


For example, if we have nodes with the label ``nvidia.com/gpu.product`` set to ``NVIDIA-L40S``, we can set the pod template for it to be:

.. code-block:: bash

  $ echo '{
    "l40s": {
      "spec": {
        "nodeSelector": {
          "nvidia.com/gpu.product": "NVIDIA-L40S"
        }
      }
    }
  }' > l40s_pod_template.json

Then, update the pod template using the OSMO CLI.

.. code-block:: bash

  $ osmo config update POD_TEMPLATE l40s --file l40s_pod_template.json


If you have another node with the label "nvidia.com/gpu.product" set to "NVIDIA-A100" and a toleration with the key "nvidia.com/gpu.product" and value "NVIDIA-A100", you can create another pod template for it.

.. code-block:: bash

  $ echo '{
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
  }' > a100_pod_template.json

Then, update the pod template using the OSMO CLI.

.. code-block:: bash

  $ osmo config update POD_TEMPLATE a100 --file a100_pod_template.json

2. Create a platform for each kind of node.
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

With the pod templates created, we can create a pool or modify an existing pool with platforms and their associated pod templates.

.. code-block:: bash

  $ echo '{
    "name": "shared_simulation_training_pool",
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
  }' > platform_config.json

**Key configuration fields:**

- ``default_platform``: The default platform to use if a user does not specify a platform
- ``common_pod_template``: The common pod templates to use for all platforms
- ``override_pod_template``: The pod templates to use for the platform, in addition to the common pod templates

Then, add the pool configuration using the OSMO CLI.

.. code-block:: bash

  $ osmo config update POOL shared_simulation_training_pool --file platform_config.json


You can validate the pool configuration and see the available nodes in the pool using the OSMO CLI.

.. code-block:: bash

  $ osmo resource list --pool shared_simulation_training_pool


Refer to :ref:`pool_config` for more information on the pool and platform configurations.



Pool Access Control
~~~~~~~~~~~~~~~~~~~

When a new pool is created, a new role should be created with the name ``osmo-<pool_name_prefix>``. This role is used to give access to the pool to a user with roles.

For example, if the pool name is ``shared_simulation_training_pool``, the role name should be ``osmo-shared`` with the following policies:

.. code-block:: bash

  $ echo '{
    "name": "osmo-shared",
    "description": "Role for shared simulation training pool",
    "actions": [
      {
        "base": "http",
        "path": "/api/pool/shared_simulation_training_pool*",
        "method": "post"
      },
      {
        "base": "http",
        "path": "http:/api/profile/*",
        "method": "*"
      }
    ]
  }' > role_config.json

Then, the role can be created using the OSMO CLI.

.. code-block:: bash

  $ osmo config set ROLE osmo-shared -f role_config.json

Each action in the list specifies a path and method that the user can access. The first action allows the user to create a workflow in the pool. The second action allows the user to access the pool in their profile.
If you have a multiple pools with the same name prefix, you can use the glob pattern to allow the user to access all the pools. example: ``api/pool/shared*`` will allow the user to access all the pools with the name prefix "shared".

Refer to :ref:`roles_config` for more information on the role configurations.
