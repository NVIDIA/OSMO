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

.. _installing_required_dependencies:

================================
Dependencies
================================

Required Dependencies
=====================

Before the execution cluster can be registered to OSMO, its dependencies must be installed through Helm charts.
In addition, secrets must be installed to allow OSMO to download the necessary Docker images, to connect to
your organization's OIDC provider, and to allow OSMO to connect to the database.

Prerequisites
-------------

- A running Kubernetes cluster
- `Helm <https://helm.sh/docs/intro/install>`_ CLI installed


Install the KAI Scheduler
--------------------------

OSMO uses `KAI scheduler <https://github.com/NVIDIA/kai-scheduler>`_ for gang scheduling, which allows OSMO to efficiently
schedule groups.

For more information on the scheduler, see :ref:`scheduler`.

Create a file called ``kai-selectors.yaml`` with node selectors / tolerations to specify which
nodes the KAI scheduler should run on.

.. code-block:: yaml

  global:
    # Modify the node selectors and tolerations to match your cluster
    nodeSelector: {}
    tolerations: []

  scheduler:
    additionalArgs:
    - --default-staleness-grace-period=-1s  # Disable stalegangeviction

Next, install KAI using ``helm``

.. code-block:: bash

  helm fetch oci://ghcr.io/nvidia/kai-scheduler/kai-scheduler --version <insert-chart-version>
  helm upgrade --install kai-scheduler kai-scheduler-<insert-chart-version>.tgz \
    --create-namespace -n kai-scheduler \
    --values kai-selectors.yaml

.. note::
   Replace ``<insert-chart-version>`` with the actual chart version.
   OSMO supports up to date chart versions.
   For more information on the chart version, refer to the `official KAI scheduler documentation <https://github.com/NVIDIA/kai-scheduler/releases>`__.

Install the GPU Operator
-------------------------

The `NVIDIA GPU-Operator <https://github.com/NVIDIA/gpu-operator>`_ is required for GPU workloads to be discovered and scheduled on the Kubernetes cluster.

.. code-block:: bash

  helm repo add nvidia https://nvidia.github.io/gpu-operator
  helm repo update
  helm install gpu-operator nvidia/gpu-operator --namespace gpu-operator



Optional Dependencies
================================

Optional dependencies are not required for the backend operator to be used, but they can be installed to provide additional functionality. This includes monitoring and observability features.

Workflow Dashboard and Metrics
------------------------------

OSMO can be integrated with Grafana and Kubernetes dashboard for monitoring backend clusters for users and admins. They can provide improved observability, easier management, and a better user experience.

The following components are optional and can be installed to provide additional functionality. For detailed installation instructions, refer to:

- `Ingress controller <https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/>`__
- `Prometheus <https://prometheus.io/docs/prometheus/latest/installation/>`__
- `Grafana <https://grafana.com/docs/grafana/latest/setup-grafana/installation/>`__
- `Kubernetes Dashboard <https://kubernetes.io/docs/tasks/access-application-cluster/web-ui-dashboard/>`__


Grafana Dashboard
--------------------------

Grafana is a powerful tool for monitoring and visualizing metrics from your Kubernetes cluster. It provides a rich set of features for creating dashboards, alerts, and visualizations.

A sample OSMO workflow resource dashboard is provided, this dashboard provides CPU, memory, GPU usage information for users' running workflows. Download and import the dashboard json with the following:

:download:`workflow_resources_usage.json <../../dashboards/workflow_resources_usage.json>`

To install the Backend Operator Observability dashboard, you will need to download the following dashboard:

:download:`backend_operator_observability.json <../../dashboards/backend_operator_observability.json>`

Once you have downloaded the dashboards, refer to the `official Grafana's Import Dashboard documentation <https://grafana.com/docs/grafana/latest/dashboards/export-import/#import-a-dashboard>`__ on how to import dashboards.

You will now be able to view a dashboard.

Grafana provides various ways to get alerts by setting up contact points and notification policies.
To setup, refer the documentation `Alert setup <https://grafana.com/docs/grafana/latest/alerting/alerting-rules/>`__.

It is recommended to setup access to grafana for customers submitting workflows to OSMO.
Refer to the `official documentation <https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/>`__ on how to securely setup access to Grafana Dashboard.

Grafana and Kubernetes Dashboard Configuration
-----------------------------------------------

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
------------------------

Additional metrics can be collected for ephemeral storage usage. This is optional and only required if you want your ephemeral storage usage graphs in Grafana to be populated. If you do not need these metrics, you can skip this step.

.. note::

   For more detailed step-by-step instructions on installing k8s-ephemeral-storage-metrics, refer to the `official documentation <https://github.com/jmcgrath207/k8s-ephemeral-storage-metrics#installation>`__.

