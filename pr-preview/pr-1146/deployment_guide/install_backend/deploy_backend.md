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

<a id="deploy-backend"></a>

# Deploy Backend Operator

Deploying the backend operator will register your compute backend with OSMO, making its resources available for running workflows. Follow these steps to deploy and connect your backend to OSMO.

> **Prerequisites**
>
> # Prerequisites

> - Install [OSMO CLI](../../user_guide/getting_started/install/index.md#cli-install) before you begin
> - Replace `osmo.example.com` with your domain name in the commands below

<a id="create-osmo-token"></a>

## Step 1: Create OSMO Service Token

Create a service access token using OSMO CLI for backend operator authentication:

```bash
$ osmo login https://osmo.example.com

$ export OSMO_SERVICE_TOKEN=$(osmo token set backend-token --expires-at <insert-date> --description "Backend Operator Token" --service --roles osmo-backend -t json | jq -r '.token')
```

> **Note**
>
> Replace `<insert-date>` with an expiration date in UTC format (YYYY-MM-DD). Save the token securely as it will not be shown again.

## Step 2: Create K8s Namespaces and Secrets

Create Kubernetes namespaces and secrets necessary for the backend deployment.

```bash
  # Create namespaces for osmo operator and osmo workflows
  $ kubectl create namespace osmo-operator
  $ kubectl create namespace osmo-workflows

  # Create the secret used to authenticate with osmo
  $ kubectl create secret generic osmo-operator-token -n osmo-operator \
      --from-literal=token=$OSMO_SERVICE_TOKEN
```

## Step 3: Deploy Backend Operator

Deploy the backend operator to the backend kubernetes cluster.

Prepare the `backend_operator_values.yaml` file:

### `backend_operator_values.yaml`

```yaml
global:
  osmoImageTag: <insert-osmo-image-tag>  # REQUIRED: Update with OSMO image tag
  serviceUrl: https://osmo.example.com
  agentNamespace: osmo-operator
  backendNamespace: osmo-workflows
  backendName: default  # REQUIRED: Update with your backend name
  accountTokenSecret: osmo-operator-token
  loginMethod: token

  services:
    backendListener:
      resources:
        requests:
            cpu: "1"
            memory: "1Gi"
        limits:
            memory: "1Gi"
    backendWorker:
      resources:
        requests:
            cpu: "1"
            memory: "1Gi"
        limits:
            memory: "1Gi"
```

Deploy the backend operator:

```bash
$ helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo

$ helm repo update

$ helm upgrade --install osmo-operator osmo/backend-operator \
  -f ./backend_operator_values.yaml \
  --version <insert-chart-version> \
  --namespace osmo-operator
```

## Step 4: Validate Deployment

Use the OSMO CLI to validate the backend configuration

```bash
$ export BACKEND_NAME=default  # Update with your backend name

$ osmo config show BACKEND $BACKEND_NAME
```

Alternatively, visit [http://osmo.example.com/api/configs/backend](http://osmo.example.com/api/configs/backend) in your browser.

Ensure the backend is online (see the highlighted line in the JSON output):

```json
{
  "backends": [
      {
          "name": "default",
          "description": "Default backend",
          "version": "6.0.0",
          "k8s_uid": "6bae3562-6d32-4ff1-9317-09dd973c17a2",
          "k8s_namespace": "osmo-workflows",
          "dashboard_url": "",
          "grafana_url": "",
          "tests": [],
          "scheduler_settings": {
              "scheduler_type": "kai",
              "scheduler_name": "kai-scheduler",
              "scheduler_timeout": 30
          },
          "node_conditions": {
              "rules": null,
              "prefix": "osmo.example.com/"
          },
          "last_heartbeat": "2025-11-15T02:35:17.957569",
          "created_date": "2025-09-03T19:48:21.969688",
          "router_address": "wss://osmo.example.com",
          "online": true
      }
  ]
}
```

#### SEE ALSO
See [/api/configs/backend](../references/configs_definitions/backend.md#backend-config) for more information

## Troubleshooting

### Token Expiration Error

```bash
Connection failed with error: {OSMOUserError: Token is expired, but no refresh token is present}
```

Check the `osmo token list --service` command to see if the token is expired. Follow [Step 1: Create OSMO Service Token](#create-osmo-token) to create a new token.
