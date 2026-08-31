<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Upgrading OSMO from 6.3 to 6.4

## What's new in 6.4

- **Workflow labels** — optional, immutable `key: value` metadata on the
  workflow spec, stored in PostgreSQL and stamped onto task pods. See the
  workflow specification and submission guides for usage, and the
  `labels_config` reference for the admin policy.
- **ConfigMap-only service configuration** — the unified `osmo` chart owns
  service, workflow, backend, pool, template, validation, test, and role
  configuration. PostgreSQL is no longer a configuration source.

## Required ConfigMap adoption gate

Complete this gate on every existing installation before starting the 6.4
maintenance window. Do not remove the database fallback until every supported
installation has an approved row in the [adoption inventory](#adoption-inventory).

The adoption sequence is:

1. Export all nine configuration sections while the existing API is running.
2. Map every masked API credential to a pre-provisioned Kubernetes Secret.
3. Render the exact unified-chart values intended for the installation.
4. Verify the rendered ConfigMap, mounted Secret data, and production config
   models against the live export.
5. Enable ConfigMap mode on the dual-mode release, then run the live read and
   workflow smoke checks below.

### Export configuration and map Secrets

The API deliberately returns `SecretStr` fields as `**********`. The export
tool never writes that placeholder into Helm values. Instead, provide an
operator-owned mapping from each masked config path to an existing Secret and
optional key:

```yaml
# secret-mappings.yaml
secretMappings:
  - path: workflow.workflow_data.credential
    secretName: osmo-object-storage
    secretKey: object-storage.yaml
  - path: workflow.workflow_log.credential
    secretName: osmo-object-storage
    secretKey: object-storage.yaml
  - path: workflow.workflow_app.credential
    secretName: osmo-object-storage
    secretKey: object-storage.yaml
  - path: workflow.backend_images.credential
    secretName: osmo-registry
    secretKey: .dockerconfigjson
  - path: workflow.workflow_alerts
    secretName: osmo-alerts
    secretKey: alerts.yaml
```

A mapping may name the masked leaf or an enclosing credential object. It must
not overlap another mapping. If a masked path is missing, unused, or repeated,
the export fails without producing an adoptable result.

```bash
export OSMO_URL=https://osmo.example.com
export OSMO_TOKEN=<short-lived-admin-token>

python3 deployments/upgrades/export_configs_to_helm.py \
  --secret-mappings secret-mappings.yaml \
  > exported-config-values.yaml
```

The unified chart mounts every Secret listed in
`configuration.secretRefs` read-only under
`/etc/osmo/secrets/<secretName>/`. Do not place plaintext credentials in the
exported values file or commit locally extracted Secret data.

The exporter writes the complete nine-section result under
`configuration.snapshot`. A non-null snapshot replaces the chart's
opinionated configuration defaults instead of merging with them, so an empty
section and a deleted default entry remain empty or deleted after Helm values
merging. Hand-written installations that do not use a snapshot retain the
normal chart defaults.

### Render and verify the installation

Render with the installation's complete values stack, including its external
URL, image settings, object-storage settings, and any overlays. Those values
can intentionally derive fields in `config.yaml`; the verifier catches any
derived value that differs from the live configuration.

```bash
helm template osmo deployments/charts/osmo \
  -f deployments/charts/osmo/profiles/split-plane-control.yaml \
  -f <installation-values.yaml> \
  -f exported-config-values.yaml \
  > rendered.yaml
```

Run verification in a hardened environment where the referenced Secrets are
mounted using the same directory layout as an OSMO pod. For a local one-time
check, create a mode-`0700` temporary root, write each Secret key below its
Secret name without printing it to the terminal, and securely remove the root
after the command completes. Verification reuses the production config loader,
so run it from the OSMO development environment or another environment with
the service's Python dependencies installed.

```bash
python3 deployments/upgrades/export_configs_to_helm.py \
  --secret-mappings secret-mappings.yaml \
  --verify-rendered rendered.yaml \
  --secrets-root <mounted-secret-root> \
  > /dev/null
```

Verification succeeds only when:

- all nine API sections were fetched;
- every masked credential has a Secret mapping and no masked value leaked;
- normalized non-secret values exactly match the rendered ConfigMap; and
- the mounted Secret contents resolve and pass the production config models.

Normalization removes only fields that are not configuration authority:
`service_auth`; backend `k8s_uid`, `version`, `last_heartbeat`, `created_date`,
and `online`; pool status/heartbeat and parsed template/validation fields;
platform parsed fields, tolerations, labels, and default mounts; and role
`sync_mode`. Values such as `service_base_url`, backend namespace/router
settings, storage endpoints, and credential references must match exactly.

### Dual-mode live check

Deploy the verified values on the dual-mode release with
`configuration.enabled: true`. Confirm all OSMO workloads become ready, read
each configuration section through the API, and submit a hello-world workflow
through the same gateway and backend used by users. The smoke must pull the
configured workload image, write and read workflow application/data storage,
and retrieve workflow logs. Record the immutable image tag, values revision,
rendered-verification result, workflow ID, successful registry pull, and
storage/log evidence in the inventory. A failed check blocks that
installation's 6.4 cutover.

Finish this export, verification, and live check while the old API is still
available. Only after its inventory row is approved should you begin the
[service-auth maintenance and migration](../charts/osmo/README.md#service-auth-identity),
which scales the old API to zero before copying its stable identity.

Secret volume updates do not trigger a config-file reload. When changing one
of these Secrets, restart the affected OSMO workloads and repeat verification.

### Adoption inventory

Release owners must maintain and approve one row per supported installation:

| Installation | Immutable image | Values revision | Render/Secret verification | Live config reads | Workflow/registry | Storage/log evidence | Owner approval |
|---|---|---|---|---|---|---|---|
| `<name>` | `<tag>` | `<commit>` | pass | pass | `<workflow-id>` / pass | `<evidence>` | `<owner/date>` |

The ConfigMap-only code change is blocked until every row passes. Keep the old
master-encryption keys while the database configuration data is retained for
rollback; remove them only in a later, separately reviewed cleanup.

### Release compatibility boundary

The legacy `deployments/charts/service` chart remains a 6.3 compatibility
path and is not supported with 6.4 images. Pin any mutable registry `latest`
used by that chart to the final compatible 6.3 build for the duration of its
support window. Publish and deploy 6.4 only with immutable/versioned image tags
through the unified `deployments/charts/osmo` chart. If that registry rule
cannot be enforced, the ConfigMap-only cutover is blocked.

## Database migration

OSMO 6.4 reads and writes the nullable `workflows.labels` JSONB column. Every
upgrade from 6.3 must apply migrations `005_v6_4_0_workflow_labels.json` and
`006_v6_4_0_workflow_labels_gin_index.json` before the API, worker, or agent
starts.

Enable the idempotent pgroll pre-upgrade Job in the service chart values:

```yaml
services:
  migration:
    enabled: true
```

For ArgoCD, run it as a PreSync hook:

```yaml
services:
  migration:
    enabled: true
    extraAnnotations:
      argocd.argoproj.io/hook: PreSync
      argocd.argoproj.io/hook-delete-policy: BeforeHookCreation
```

Before allowing the service rollout to continue, verify the column and generic
GIN index exist:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'workflows'
  AND column_name = 'labels';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'workflows'
  AND indexname = 'workflow_labels_gin_idx';
```

The expected results contain one `jsonb` column row and a `jsonb_ops` GIN
index on `labels`. New databases receive both from the in-code schema.

The generic GIN index accelerates key existence, exact-value, and alternation
filters. Deployments with curated keys should also provision per-key indexes
for prefix and missing-label queries. For example:

```sql
CREATE INDEX CONCURRENTLY workflow_labels_ppp_pattern_idx
    ON workflows ((labels ->> 'PPP') text_pattern_ops);

CREATE INDEX CONCURRENTLY workflow_labels_ppp_missing_idx
    ON workflows (submit_time DESC)
    WHERE labels IS NULL OR NOT (labels ? 'PPP');
```

Use deployment-specific index names and replace `PPP` with the configured key.
Create or drop these indexes outside a transaction because PostgreSQL does not
allow `CONCURRENTLY` inside a transaction block.
