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

.. _adding_observability:

================================================
Adding Observability (Optional)
================================================

OSMO can be integrated with Grafana and Kubernetes dashboard for monitoring backend clusters for users and admins. They can provide improved observability, easier management, and a better user experience.

For detailed instructions on setting up observability tools, see the optional dependencies section in :ref:`installing_required_dependencies`.

Key Observability Components
=============================

Workflow Dashboard and Metrics
-------------------------------

OSMO can be integrated with Grafana for monitoring backend clusters. For detailed installation instructions, refer to the Dependencies section which covers:

- Ingress controller configuration
- Prometheus setup
- Grafana installation
- Kubernetes Dashboard setup

Grafana Dashboards
------------------

OSMO provides sample dashboards for monitoring:

- **Workflow Resources Usage**: CPU, memory, GPU usage information for users' running workflows
- **Backend Operator Observability**: Monitoring for the backend operator

See :ref:`installing_required_dependencies` for detailed setup instructions.

Storage Metrics
---------------

Additional metrics can be collected for ephemeral storage usage. This is optional and only required if you want your ephemeral storage usage graphs in Grafana to be populated.

For more information, see the "Install Storage Metrics" section in :ref:`installing_required_dependencies`.


