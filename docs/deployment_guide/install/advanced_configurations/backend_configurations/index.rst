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

.. _backend_configurations:

================================
Backend Configurations
================================


Create backend roles
---------------------

By default, OSMO has a preassigned role for backend access called ``osmo-backend``.
This role allows full access to the backend API as any backend name.

If you want to create a role such that the backend agents only has access to the backend API as a specific backend name, you can create a new role using the OSMO CLI. Follow the steps in :ref:`roles_config` to create a new backend role.


Node conditions
----------------

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



Workflow Dashboard and Metrics
--------------------------------

OSMO can be integrated with Grafana and Kubernetes dashboard for monitoring backend clusters for users and admins. They can provide improved observability, easier management, and a better user experience.

For detailed installation instructions, refer to:

- `Ingress controller <https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/>`__
- `Grafana <https://grafana.com/docs/grafana/latest/setup-grafana/installation/>`__
- `Kubernetes Dashboard <https://kubernetes.io/docs/tasks/access-application-cluster/web-ui-dashboard/>`__


Prerequisites
~~~~~~~~~~~~~

- A running Kubernetes cluster
- `Helm <https://helm.sh/docs/intro/install>`__ CLI installed
- `NVIDIA GPU-Operator <https://github.com/NVIDIA/gpu-operator>`__ installed in order to schedule workloads that request GPU resources


Install Grafana
~~~~~~~~~~~~~~~

Grafana is a powerful tool for monitoring and visualizing metrics from your Kubernetes cluster. It provides a rich set of features for creating dashboards, alerts, and visualizations.

A sample OSMO workflow resource dashboard is provided, this dashboard provides CPU, memory, GPU usage information for users' running workflows. Download and import the dashboard json with the following:

:download:`workflow_resources_usage.json <../../../dashboards/workflow_resources_usage.json>`

To install the Backend Operator Observability dashboard, you will need to download the following dashboard:

:download:`backend_operator_observability.json <../../../dashboards/backend_operator_observability.json>`

Once you have downloaded the dashboards, refer to the `official Grafana's Import Dashboard documentation <https://grafana.com/docs/grafana/latest/dashboards/export-import/#import-a-dashboard>`__ on how to import dashboards.

You will now be able to view a dashboard.

Grafana provides various ways to get alerts by setting up contact points and notification policies.
To setup, refer the documentation `Alert setup <https://grafana.com/docs/grafana/latest/alerting/alerting-rules/>`__.

It is recommended to setup access to grafana for customers submitting workflows to OSMO.
Refer to the `official documentation <https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/>`__ on how to securely setup access to Grafana Dashboard.

Grafana and Kubernetes Dashboard Configuration
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

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
      - Default empty. Link to a browser page to view the running pods in Kubernetes.
    * - grafana_url
      - Default empty. Link to a browser page to view the pods resources and cluster status.

Then update the backend configuration using the CLI.

.. code-block:: bash

  BACKEND_NAME=...
  osmo config update BACKEND $BACKEND_NAME --file /tmp/backend_config.json


Install Storage Metrics
~~~~~~~~~~~~~~~~~~~~~~~~

Additional metrics can be collected for ephemeral storage usage. This is optional and only required if you want your ephemeral storage usage graphs in Grafana to be populated. If you do not need these metrics, you can skip this step.

.. note::

   For more detailed step-by-step instructions on installing k8s-ephemeral-storage-metrics, refer to the `official documentation <https://github.com/jmcgrath207/k8s-ephemeral-storage-metrics#installation>`__.
