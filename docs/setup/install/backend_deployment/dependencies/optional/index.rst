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

.. _installing_optional_dependencies:

================================
Install Optional Dependencies
================================

OSMO can be integrated with Grafana and Kubernetes dashboard for monitoring backend clusters for users and admins. They can provide improved observability, easier management, and a better user experience.

For detailed installation instructions, refer to:

- `Ingress controller <https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/>`__
- `Grafana <https://grafana.com/docs/grafana/latest/setup-grafana/installation/>`__
- `Kubernetes Dashboard <https://kubernetes.io/docs/tasks/access-application-cluster/web-ui-dashboard/>`__


Prerequisites
========================================
- A running Kubernetes cluster
- `Helm <https://helm.sh/docs/intro/install>`__ CLI installed
- `NVIDIA GPU-Operator <https://github.com/NVIDIA/gpu-operator>`__ installed in order to schedule workloads that request GPU resources


Install Grafana
=================

Grafana is a powerful tool for monitoring and visualizing metrics from your Kubernetes cluster. It provides a rich set of features for creating dashboards, alerts, and visualizations.

A sample OSMO workflow resource dashboard is provided, this dashboard provides CPU, memory, GPU usage information for users' running workflows. Download and import the dashboard json with the following:

:download:`workflow-resources-usage.json <../../../../dashboards/workflow-resources-usage.json>`

To install the Backend Operator Observability dashboard, you will need to download the following dashboard:

:download:`backend-operator-observability.json <../../../../dashboards/backend-operator-observability.json>`

Once you have downloaded the dashboards, refer to the `official Grafana's Import Dashboard documentation <https://grafana.com/docs/grafana/latest/dashboards/export-import/#import-a-dashboard>`__ on how to import dashboards.

You will now be able to view a dashboard.

Grafana provides various ways to get alerts by setting up contact points and notification policies.
To setup, refer the documentation `Alert setup <https://grafana.com/docs/grafana/latest/alerting/alerting-rules/>`__.

It is recommended to setup access to grafana for customers submitting workflows to OSMO.
Refer to the `official documentation <https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/>`__ on how to securely setup access to Grafana Dashboard.

Install Storage Metrics
========================

Additional metrics can be collected for ephemeral storage usage. This is optional and only required if you want your ephemeral storage usage graphs in Grafana to be populated. If you do not need these metrics, you can skip this step.

.. note::

   For more detailed step-by-step instructions on installing k8s-ephemeral-storage-metrics, refer to the `official documentation <https://github.com/jmcgrath207/k8s-ephemeral-storage-metrics#installation>`__.
