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
- Drops `None`-valued keys and empty containers — Pydantic defaults don't need to be written out
- Strips pinned tags from `workflow.backend_images.{init,client}` so workflow pods track `global.osmoImageTag` after the upgrade instead of staying on the version that was running at export time
- Replaces masked secret values (`**********`) with `{secretName: TODO-REPLACE-ME, secretKey: <field>}` placeholders and lists each path on stderr so you know which K8s Secrets to create
- Diffs the output against the chart's `services.configs.*` defaults so only fields you've genuinely customized appear in the file (pass `--no-strip-defaults` for a full dump)
- Outputs YAML ready to paste into your Helm values under `services.configs`

Review the stderr output carefully — it lists the TODO placeholders you need to fill in plus any existing `secretRefs` that need matching K8s Secrets in the target namespace.

### Resolving the TODO placeholders

For each `{secretName: TODO-REPLACE-ME, secretKey: <field>}` block in the output, pick one of these patterns and replace `TODO-REPLACE-ME` with a real Secret name:

1. **Per-field Secret (matches the placeholder layout as-is).** Create a Secret with `--from-literal` keys that match each `secretKey` referenced in the placeholders. The loader reads files from `/etc/osmo/secrets/<secretName>/<secretKey>` so each masked field resolves independently.
   ```bash
   kubectl create secret generic osmo-workflow-creds \
       --from-literal=access_key=<S3 secret key> \
       --from-literal=auth=<base64 NGC token>
   ```

2. **Whole-credential Secret (collapses the entire credential dict).** Replace the parent dict (e.g. the whole `credential:` block under `workflow_data`) with a single `{secretName: <name>}` ref pointing at a Secret whose `cred.yaml` key contains the full YAML mapping. The loader detects `cred.yaml` and merges all its keys into the parent dict — useful when you want to keep `endpoint` / `region` / `access_key_id` / `access_key` together.
   ```yaml
   workflow_data:
     credential:
       secretName: osmo-workflow-data-cred   # provides cred.yaml
   ```

Either way, every `secretName` you settle on must also be listed under `services.configs.secretRefs` so the chart actually mounts it into the service pods.

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
        min_supported_version: 6.0.0
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
