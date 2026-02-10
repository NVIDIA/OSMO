<!-- SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0 -->

<a id="adding-observability"></a>

# Add Observability (Optional)

Integrate OSMO with [Grafana](https://grafana.com/) and [Kubernetes Dashboard](https://kubernetes.io/docs/tasks/access-application-cluster/web-ui-dashboard/) to monitor backend clusters, track resource usage, and improve operational visibility.

> **Prerequisites**
>
> # Prerequisites

> Install the following components in your compute cluster for full observability support:

> - [Ingress controller](https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/)
> - [Prometheus](https://prometheus.io/docs/prometheus/latest/installation/)
> - [Grafana](https://grafana.com/docs/grafana/latest/setup-grafana/installation/)
> - [Kubernetes Dashboard](https://kubernetes.io/docs/tasks/access-application-cluster/web-ui-dashboard/)

## Install Grafana Dashboards

OSMO provides pre-configured dashboards for monitoring workflows and backend operators.

### Download Dashboard Files

Download the following dashboard JSON files:

- [`osmo-workflow-resources.json`](../dashboards/workflow_resources_usage.json) - Monitor CPU, memory, and GPU usage for running workflows
- [`osmo-backend-operators.json`](../dashboards/backend_operator_observability.json) - Monitor backend operator health and performance

### Import to Grafana

Import the dashboards using [Grafana’s Import Dashboard](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/import-dashboards/) documentation.

### Configure Alerts

Set up alerts using Grafana’s [alert configuration](https://grafana.com/docs/grafana/latest/alerting/alerting-rules/).

## Install Storage Metrics

To enable usage metrics for ephemeral storage in Grafana, install the [k8s-ephemeral-storage-metrics](https://github.com/jmcgrath207/k8s-ephemeral-storage-metrics) plugin in your compute cluster.

## Update Backend Configs

Next, update your OSMO backend configuration to include the Grafana and Kubernetes Dashboard URLs:

```bash
$ cat << EOF > /tmp/backend_config.json
{
  "description": "<backend-description>",
  "dashboard_url": "<kubernetes-dashboard-url>",
  "grafana_url": "<grafana-url>"
}
EOF

$ export BACKEND_NAME=default  # Update to your backend name
$ osmo config update BACKEND $BACKEND_NAME --file /tmp/backend_config.json
```

Once configured, you can access dashboard and resource usage links for each workflow in the OSMO UI. See the [Workflow Resource Usage](../../user_guide/faq/index.md#faq-workflow-resource-usage) for details.

## Security Considerations

Configure secure access to monitoring tools:

- **Grafana**: Configure user authentication and access control using the [Grafana security documentation](https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/)
- **Kubernetes Dashboard**: Implement token-based login, user roles, and RBAC configuration. See [Kubernetes Dashboard access control](https://github.com/kubernetes/dashboard/blob/master/docs/user/access-control/README.md#login-view)
