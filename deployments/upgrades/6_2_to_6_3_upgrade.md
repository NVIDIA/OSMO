<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
-->

# Upgrading OSMO from 6.2 to 6.3

## What's new in 6.3

- **ConfigMap-based configuration** — all service configs (pools, backends, templates, roles, etc.) can be managed as Helm values via a Kubernetes ConfigMap instead of the database. Follows the standard K8s pattern.
- **GitOps workflow** — configs live in Git, deploy via ArgoCD/Helm. CLI/API config writes are blocked with HTTP 409 when ConfigMap mode is active.
- **File-backed authz sidecar** — the Go authorization sidecar reads roles from the ConfigMap file directly, eliminating its dependency on PostgreSQL for role resolution.

## Before you start

| Deployment type | Sections to follow |
|----------------|-------------------|
| Migrating to ConfigMap config | [Export existing configs](#export-existing-configs) → [Enable ConfigMap mode](#enable-configmap-mode) → [Create K8s Secrets](#create-kubernetes-secrets) |
| Staying with DB config | No action required — DB mode is the default and works unchanged |
| New deployment | [Enable ConfigMap mode](#enable-configmap-mode) (chart defaults provide sensible starting configs) |

## Export existing configs

Use the export script to dump your current configs from the running OSMO instance into Helm values format:

```bash
export OSMO_URL=https://osmo.example.com
export OSMO_TOKEN=$(osmo token set export-token --expires-at 2026-12-31 -t json | jq -r '.token')

python3 deployments/upgrades/export_configs_to_helm.py \
    --url $OSMO_URL \
    --token $OSMO_TOKEN \
    > my-configs.yaml
```

The script:
- Exports all config sections (service, workflow, dataset, backends, pools, templates, validations, roles)
- Strips runtime/computed fields (`parsed_pod_template`, `parsed_resource_validations`, etc.) — the service resolves these at load time from template name references
- Replaces masked credentials with `secretName` placeholders
- Outputs YAML ready to paste into your Helm values under `services.configs`

Review the output and check the `secretRefs` list printed to stderr — you'll need to create matching K8s Secrets.

### Dependencies

The export script requires PyYAML:

```bash
pip install pyyaml
```

## Enable ConfigMap mode

Add a `services.configs` section to your Helm values. The chart defaults provide a complete starting configuration with 5 roles, 2 pod templates, 2 resource validations, and a default backend/pool.

### Minimal example (chart defaults only)

```yaml
services:
  configs:
    enabled: true
```

This activates ConfigMap mode with the chart's built-in defaults. All config writes via CLI/API return HTTP 409.

### With exported configs

Paste your exported configs under `services.configs`:

```yaml
services:
  configs:
    enabled: true
    secretRefs:
      - secretName: osmo-workflow-data-cred
      - secretName: osmo-workflow-log-cred
    service:
      cli_config:
        latest_version: 6.3.0
        min_supported_version: 1.0.0
      max_pod_restart_limit: 15m
    workflow:
      workflow_data:
        credential:
          secretName: osmo-workflow-data-cred
        base_url: s3://my-bucket/workflows
      workflow_log:
        credential:
          secretName: osmo-workflow-log-cred
    backends:
      my-backend:
        scheduler_settings:
          scheduler_type: kai
          scheduler_name: kai-scheduler
    pools:
      default:
        backend: my-backend
        common_pod_template:
          - default_user
          - default_ctrl
        common_resource_validations:
          - default_cpu
          - default_gpu
          - default_memory
          - default_storage
        platforms:
          gpu-a100:
            override_pod_template:
              - a100_override
            resource_validations: []
```

## Create Kubernetes Secrets

Credentials referenced by `secretName` in the config must exist as K8s Secrets in the same namespace. The chart automatically mounts them when listed in `secretRefs`.

For each `secretName` in your config, create a Secret containing a `cred.yaml` file:

```bash
# S3 credentials
kubectl create secret generic osmo-workflow-data-cred \
    --from-file=cred.yaml=<(cat <<EOF
endpoint: s3://my-bucket
region: us-west-2
access_key_id: <your-access-key-id>
access_key: <your-secret-access-key>
EOF
)

# Log storage credentials
kubectl create secret generic osmo-workflow-log-cred \
    --from-file=cred.yaml=<(cat <<EOF
endpoint: s3://my-log-bucket
region: us-west-2
access_key_id: <your-access-key-id>
access_key: <your-secret-access-key>
EOF
)
```

The `secretKey` field in the config defaults to `cred.yaml`. Override it if your Secret uses a different key name:

```yaml
credential:
  secretName: my-cred
  secretKey: credentials.yaml
```

## Reverting to DB mode

Set `enabled: false` (or remove `services.configs` entirely):

```yaml
services:
  configs:
    enabled: false
```

The service reverts to reading all configs from the database. No data migration is needed — the database retains whatever was last written to it.
