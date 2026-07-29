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
