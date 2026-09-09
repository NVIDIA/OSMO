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

## Database migration

OSMO 6.4 reads and writes the nullable `workflows.labels` JSONB column and uses
ConfigMap-backed configuration instead of the legacy database fields listed
below. Every upgrade from 6.3 must run the unified chart's ordered migrations
before the API, worker, or agent starts.

### Legacy-writer quiescence fence

Migrations 007 and 009 change or remove database state that a running 6.3
process can recreate after the migration transaction releases its locks.
Therefore, `databaseMigration.enabled: true` is safe only inside this cutover
fence:

1. Before enabling `databaseMigration`, stop every 6.3 OSMO workload, Job, and
   external process that can write PostgreSQL or initialize database
   configuration. Inventory all legacy control-plane workloads with PostgreSQL
   credentials; stopping only the API is not sufficient. Keep PostgreSQL itself
   running for the migration.
2. Disable or suspend every mechanism that could recreate or scale those
   writers, including HPAs, GitOps automated sync or self-heal, operators, and
   environment-owned automation. Either pause the reconciler or first commit
   and apply a desired state with the legacy writers at zero and their
   autoscaling disabled.
3. Verify the fence before proceeding: there must be no running 6.3 writer Pod,
   migration/config-initializer Job, or external writer process, and no active
   autoscaler or reconciler capable of bringing one back. Check both the legacy
   release namespace and environment-owned processes; do not infer quiescence
   from a single Deployment's replica count.
4. While the verified fence remains in place, enable `databaseMigration` and
   apply the 6.4 release through either a raw Helm upgrade or the installation's
   existing Argo CD workflow. Argo CD is optional. When Argo CD is used, make
   quiescence a completed, separately verified sync before syncing the
   migration and 6.4 manifests.
5. Keep every 6.3 writer and its autoscaling/reconciliation stopped throughout
   the pre-upgrade or PreSync hook and until all upgraded manifests have been
   applied. If the migration or manifest application fails, keep the fence in
   place and repair or retry the 6.4 cutover; do not restart 6.3 workloads
   against the migrated database.
6. Resume reconciliation and autoscaling only after the migration succeeds and
   every workload being started is verified to use the 6.4 image and
   configuration. No 6.3 database writer may resume.

Before enabling `databaseMigration`, configure and validate every applicable
destination value in the 6.4 values. SQL cannot determine whether an
environment-specific replacement is correct. Rows marked retired have no 6.4
runtime destination, but operators must confirm that the deployment no longer
depends on them.

| Legacy row | Disposition before cleanup |
| --- | --- |
| `SERVICE.service_cluster` | Retired; Helm release/resource identity replaces it |
| `SERVICE.service_cluster_namespace` | Retired; release namespace and `POD_NAMESPACE` replace it |
| `SERVICE.service_url` | `externalUrl` / `service.service_base_url` |
| `SERVICE.user_data_path` | `configuration.workflow.workflow_data.base_url` |
| `SERVICE.user_dataset_path` | Retired; no 6.4 runtime equivalent |
| `SERVICE.workflow_backends` | `configuration.backends` plus pool backend selection |
| `SERVICE.workflow_start_timeout` | `configuration.service.max_pod_restart_limit` |
| `WORKFLOW.credential_validation_enabled` | `credential_config.disable_registry_validation` and `disable_data_validation` |
| `WORKFLOW.default_workflow_backend` | Retired after pool backend selection is configured |
| `WORKFLOW.exec_port_config` | Retired; no current port-range equivalent |
| `WORKFLOW.workflow_alert` | `configuration.workflow.workflow_alerts`, or explicitly retired when unused |
| Every `DATASET` row | Retired; dataset configuration is not part of the 6.4 ConfigMap schema |

The cleanup migration removes all eleven enumerated legacy keys and every row
whose type is `DATASET`. It does not remove `SERVICE.service_auth` or any
current configuration field.

After the destination-value preflight, enable the idempotent pgroll hook in the
unified `osmo` chart values. It requires external PostgreSQL:

```yaml
databaseMigration:
  enabled: true
  targetSchema: public
```

The chart includes both raw Helm `pre-install,pre-upgrade` hook annotations and
Argo CD `PreSync` annotations. Use either raw Helm or Argo CD according to the
existing release workflow; neither is a prerequisite for the other. If Argo CD
must order these hooks relative to environment-owned resources, set an
environment-specific sync wave:

```yaml
databaseMigration:
  annotations:
    argocd.argoproj.io/sync-wave: "<environment-sync-wave>"
```

### Existing database-backed service auth

Service-auth migration is opt-in and applies only when the 6.3 installation's
stable signing identity is stored in `SERVICE.service_auth`. Establish and
verify the complete legacy-writer quiescence fence above, then follow the
unified chart README's
[service-auth migration procedure](../charts/osmo/README.md#service-auth-identity)
to pre-provision and authorize the empty destination Secret. Then enable the
copy in the same upgrade:

```yaml
secrets:
  serviceAuth:
    managementMode: external
    existingSecret:
      name: osmo-service-auth
      key: authentication-config.json
    bootstrap:
      enabled: false
    migration:
      enabled: true
      attempt: "1"
```

The hook decrypts and validates the existing database identity and copies that
same stable identity to the authorized Secret. It does not create or rotate an
identity. Leave the migration disabled when no database-backed identity needs
to be copied.

After the hook succeeds and the Secret-backed API is ready, set
`secrets.serviceAuth.migration.enabled: false` and retain the destination
Secret. Keep `migration.attempt` unchanged after success. Increment it only
when retrying a failed or interrupted service-auth migration hook, then rerun
the upgrade. Raw Helm pre-upgrade and Argo CD PreSync execution are both
supported for this one-time hook.

### Verify the workflow-label schema

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
