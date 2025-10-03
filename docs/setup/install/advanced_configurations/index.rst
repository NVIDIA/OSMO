.. _advanced_configurations:


================================================
Advanced Configurations
================================================

This section covers advanced configurations for OSMO.


Additional Backend Configuration
--------------------------------

Create OSMO backend role
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

By default, OSMO has a preassigned role for backend access called ``osmo-backend``.
This role allows full access to the backend API as any backend name.

If you want to create a role so that the agent only has access to the backend API as a specific
backend name, you can create a new role using the OSMO CLI. Follow the steps in :ref:`config_set`
to create a new backend role.

Grafana and Kubernetes Dashboard Configuration
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash
  :substitutions:

  echo '{
    "description": "...",
    "dashboard_url": "...",
    "grafana_url": "..."
  }' > /tmp/backend_config.json

..  list-table::
    :header-rows: 1
    :widths: auto

    * - **Field**
      - **Description**
    * - description
      - Default empty. Quick explanation of the resources available to this cluster.
    * - dashboard_url
      - Default empty. Link to a browser page to view the running pods.
    * - grafana_url
      - Default empty. Link to a browser page to view the pods resources and cluster status.

Then update the backend configuration using the CLI.

.. code-block:: bash
  :substitutions:

  BACKEND_NAME=...
  osmo config update BACKEND $BACKEND_NAME --file /tmp/backend_config.json


Node conditions
~~~~~~~~~~~~~~~~

``node_conditions`` lets you customize how OSMO evaluates `Kubernetes Node conditions <https://kubernetes.io/docs/reference/node/node-status/#condition>`_ when deciding whether a node is available for scheduling, and which conditions to ignore.
It also controls the label prefix used for the automatic verification label.

- ``additional_node_conditions``: List of condition type names that must be ``True`` (in addition to the default ``Ready``). Supports wildcard suffix ``*`` for prefix matches (e.g. ``nvidia.com/*``).
- ``ignore_node_conditions``: List of condition type names to exclude from evaluation. Supports wildcard suffix ``*`` for prefix matches.
- ``prefix``: String prefix used when OSMO sets the verification label on nodes. The label key will be ``<prefix>verified`` with values ``True``/``False``. Default is ``osmo.nvidia.com/`` and if changed needs to end with ``osmo.nvidia.com/``. This value is configured via the Helm chart (``global.nodeConditionPrefix``) and is read by the backend agent at startup; to change it, update the Helm values and redeploy the agent (it cannot be changed via backend configuration at runtime).

How availability is computed:

- OSMO reads all conditions on a node. For any condition whose type matches an entry in ``ignore_node_conditions`` (exact match or prefix match when the list entry ends with ``*``), that condition is skipped.
- For the remaining conditions:
  - If the condition type matches the default set ``["Ready"]`` or any entry in ``additional_node_conditions`` (exact match or prefix match when the list entry ends with ``*``), the condition must have status ``True``.
  - All other non-ignored conditions must have status ``False``.
- Additionally, nodes marked unschedulable (cordoned) are considered unavailable regardless of conditions.

OSMO will also update a node label ``<prefix>verified`` to reflect availability (``True`` or ``False``). By default, this is disabled. To enable it, set ``services.backendListener.enable_node_label_update`` to ``true`` in the backend configuration.

Example configuration

.. code-block:: bash

  echo '{
    "node_conditions": {
      "additional_node_conditions": ["GpuHealthy"],
      "ignore_node_conditions": ["NetworkUnavailable", "SomeTransient*"],
      "prefix": "osmo.nvidia.com/"
    }
  }' > /tmp/node_conditions.json

  BACKEND_NAME=...
  osmo config update BACKEND $BACKEND_NAME --file /tmp/node_conditions.json

.. note::

  - Wildcards only match as a prefix. For example, ``OSMO*`` matches ``OSMOCheck`` and ``OSMO-Verified``, but not ``MyOSMOCond``.
  - You don't need to include ``Ready`` in ``additional_node_conditions``; it is always required to be ``True`` by default.
  - If you want to ignore an entire family of custom conditions, prefer using a prefix wildcard in ``ignore_node_conditions``.



.. TODO:
  Add a section of how to configure the custom pool with heterogeneous nodes.


Configure Pool Platform
---------------------------------------

A platform is a set of resources within a pool defined by the labels and tolerations set in the pool and platform pod template.

OSMO is configured to handle resources which are referenced by multiple platforms within the same pool, but it is recommended that each resource matches a single platform within a pool.

Refer to :ref:`pool_config` for more information on the platform configuration.

.. note::

  Pod templates override the field prior to it unless it is a list. If the field is a list, the
  latter pod template will append to the list. If the field is a list of dictionaries, the
  dictionary is merged if the ``name`` field is the same. Otherwise, it is appended.

  The starting pod template is the one defined in the pool config.

.. note::

  Fields like ``tolerations``, ``labels``, and ``priority`` in the the platform/pool configs
  are derived from the pod template and therefore do not need to be set. If specified in the
  platform configs, they will be ignored in favor for the ones defined in the pod template.


Create the platform configuration using the OSMO CLI. A default platform config is shown below:

.. code-block:: bash

  echo '{
    "default_platform": "<default_platform>",
    "platforms": {
      "<default_platform>": {
        "description": "my nodes",
        "host_network_allowed": false,
        "privileged_allowed": false,
        "default_variables": {},
        "resource_validations": [],
        "override_pod_template": [],
        "allowed_mounts": []
      }
    }
  }' > /tmp/pool_platform_config.json

Then, update the platform configuration using the OSMO CLI.

.. code-block:: bash

  POOL_NAME=...
  osmo config update POOL $POOL_NAME --file /tmp/pool_platform_config.json
