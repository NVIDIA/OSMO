<!--
Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
-->

# ConfigMap-Sourced Dynamic Configuration

**Author**: @vvnpn-nv<br>
**PIC**: @vvnpn-nv<br>
**Status**: MVP validated on dev instance

## Overview

Enable OSMO's dynamic configuration (service settings, workflow limits, pools, pod templates, resource validations, backends, dataset buckets) to be defined declaratively in Kubernetes ConfigMaps via Helm values, applied automatically on service startup, and continuously reconciled against the database. This enables GitOps workflows where config changes are version-controlled and applied automatically by any CD tool (e.g., ArgoCD, Flux, Helm CLI), while preserving the existing CLI for ad-hoc changes.

### Motivation

Today, after every OSMO deployment, an administrator must manually run `osmo config update` CLI commands to configure the instance — setting up pools, pod templates, resource validations, workflow limits, dataset buckets, etc. This is error-prone, not version-controlled, and doesn't fit a GitOps deployment model.

### Problem

- Config changes are imperative (CLI commands) rather than declarative (checked into Git)
- No way to reproduce a config state from source control
- Config drift between environments is invisible until something breaks
- New deployments require manual post-deploy setup steps
- No mechanism to enforce configuration — CLI changes can silently override intended values

## Use Cases

| Use Case | Description |
|---|---|
| GitOps config management | An operator defines all OSMO configs in Helm values files, commits to Git, and the CD tool (e.g., ArgoCD, Flux) applies them automatically |
| Fresh deployment setup | A new OSMO instance starts with all configs pre-populated from ConfigMap — no manual CLI commands needed |
| Config enforcement | Critical configs (workflow limits, pod templates) are enforced from ConfigMap — CLI writes are rejected with 409 Conflict |
| Config seeding | Default configs (resource validations) are seeded on first deploy but can be customized via CLI afterward |
| Credential management | Dataset bucket credentials are injected via K8s Secrets (not in ConfigMap or Git) and encrypted before DB storage |
| Write protection | CLI/API writes to configmap-managed configs are rejected with 409 Conflict; direct DB manipulation is corrected by the watcher as a safety net |

## Requirements

| Title | Description | Type |
|---|---|---|
| Declarative config | Configs shall be definable in Helm values and applied via K8s ConfigMap | Functional |
| Two management modes | Each config type shall support `seed` (apply once) and `configmap` (continuously enforce) modes | Functional |
| CLI compatibility | The existing `osmo config update` CLI shall continue to work alongside ConfigMap configs | Functional |
| Write protection | CLI/API writes to configmap-managed configs shall be rejected with 409 Conflict before any DB mutation | Functional |
| Secret handling | Dataset bucket credentials shall be injected via K8s Secrets, not stored in ConfigMap or Helm values | Security |
| Error isolation | A validation error in one config type shall not prevent other config types from being applied | Reliability |
| Multi-replica safety | Only one replica shall apply configs at a time via advisory lock | Reliability |
| Audit trail | All ConfigMap-applied changes shall be recorded in config_history with `username=configmap-sync` and `tags=['configmap']` | Observability |
| No history pollution | Drift reconciliation shall not create config_history entries when values haven't actually changed | Observability |

## Architectural Details

### How It Works

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        ConfigMap Config Flow                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Helm Values ──► K8s ConfigMap ──► Mounted File ──► ConfigMapWatcher     │
│                                    (/etc/osmo/       │                   │
│                                     dynamic-config/  │                   │
│                                     config.yaml)     │                   │
│                                                      ▼                   │
│                                            ┌──────────────────┐          │
│                                            │ Watcher (30s)    │          │
│                                            │                  │          │
│                                            │ File changed?    │          │
│                                            │ YES → re-apply   │          │
│                                            │       all configs│          │
│                                            │                  │          │
│                                            │ NO → check DB    │          │
│                                            │      drift for   │          │
│                                            │      configs     │          │
│                                            └────────┬─────────┘          │
│                                                     │                    │
│                                                     ▼                    │
│                                            ┌──────────────────┐          │
│                                            │ PostgreSQL       │          │
│                                            │ (configs,        │          │
│                                            │  config_history) │          │
│                                            └──────────────────┘          │
│                                                     ▲                    │
│                                                     │                    │
│  CLI / API ──► config_service ──► 409 Guard ──X     │                    │
│                (configmap_guard.py)                 │                    │
│                                                     │                    │
│  CLI / API ──► config_service ──► (seed/unmanaged) ─┘                    │
│                                   Write allowed                          │
│                                                                          │
│  K8s Secret ──► Mounted File ──► Loader reads & encrypts ──► DB          │
│  (credentials)  (/etc/osmo/       via SecretManager                      │
│                  secrets/)                                               │
└──────────────────────────────────────────────────────────────────────────┘
```

### Key Components

1. **ConfigMapWatcher** (`configmap_loader.py`): File watching, hash-based change detection, DB drift checks, and config application
2. **409 Guard** (`configmap_guard.py`): Standalone module holding managed config state and write rejection logic — blocks CLI/API writes to configmap-managed configs
3. **Helm ConfigMap template** (`dynamic-config.yaml`): Renders Helm values into a ConfigMap with a `config.yaml` data key
4. **Helm Secret template** (`dynamic-config-secrets.yaml`): Renders credential values into K8s Secrets (for local dev; production uses Vault/ExternalSecrets)
5. **Checksum annotation** on the pod spec: Triggers pod restart when ConfigMap content changes via Helm upgrade

### Management Modes

| Mode | Behavior | Source of Truth | CLI Changes |
|---|---|---|---|
| `seed` | Apply from ConfigMap only if config doesn't exist in DB (checked via config_history) | DB after first apply | Persist across restarts |
| `configmap` | Always apply from ConfigMap on startup; CLI/API writes rejected with 409 | ConfigMap | Blocked — API returns 409 Conflict |

### Config Types Supported

| Type | Storage | Enforced on file change | CLI write enforcement |
|---|---|---|---|
| SERVICE | `configs` table (global — one per instance) | Yes | Rejected with 409 Conflict |
| WORKFLOW | `configs` table (global — one per instance) | Yes | Rejected with 409 Conflict |
| DATASET | `configs` table (global — one per instance) | Yes | Rejected with 409 Conflict |
| BACKEND | `backends` table (named) | Yes | Rejected with 409 Conflict |
| POOL | `pools` table (named) | Yes | Rejected with 409 Conflict |
| POD_TEMPLATE | `pod_templates` table (named) | Yes | Rejected with 409 Conflict |
| GROUP_TEMPLATE | `group_templates` table (named) | Yes | Rejected with 409 Conflict |
| RESOURCE_VALIDATION | `resource_validations` table (named) | Yes | Rejected with 409 Conflict |
| BACKEND_TEST | `backend_tests` table (named) | Yes | Rejected with 409 Conflict |
| ROLE | `roles` table (named) | Yes | Rejected with 409 Conflict |

## Detailed Design

### ConfigMap YAML Format

```yaml
services:
  dynamicConfig:
    enabled: true

    workflow:
      managed_by: configmap          # or "seed"
      config:
        max_num_tasks: 100
        max_exec_timeout: "60d"

    service:
      managed_by: seed
      config:
        service_base_url: "https://osmo.example.com"

    podTemplates:
      managed_by: configmap
      items:
        default_ctrl:
          spec:
            containers:
            - name: osmo-ctrl
              resources:
                requests:
                  cpu: "1"
                  memory: "1Gi"

    backends:
      managed_by: configmap
      items:
        my-backend:
          description: "Production cluster"

    dataset:
      managed_by: configmap
      config:
        default_bucket: primary
        buckets:
          primary:
            dataset_path: "s3://my-bucket"
            region: "us-west-2"
            mode: "read-write"
            default_credential:
              secret_file: "/etc/osmo/secrets/bucket-cred/cred.yaml"

    resourceValidations:
      managed_by: seed
      items:
        default_cpu:
        - resource: cpu
          operator: LE
          threshold: node_cpu
```

### Secret Handling

Dataset bucket credentials are **never stored in ConfigMap or Helm values**. Instead:

1. A K8s Secret is created out-of-band (Vault agent, ExternalSecrets, or `kubectl create secret`)
2. The Secret is mounted into the pod via `extraVolumes`/`extraVolumeMounts`
3. The ConfigMap's `secret_file` field points to the mounted path
4. The loader reads the file, encrypts credentials via SecretManager (JWE with MEK), and stores encrypted values in PostgreSQL

### Dependency Ordering

Configs are applied in 5 phases to respect referential integrity:

1. Resource validations, pod templates, group templates (no dependencies)
2. Backends, backend tests (depend on templates)
3. Pools (depend on backends and templates)
4. Roles
5. Global configs: service, workflow, dataset

### Advisory Lock

- Session-level `pg_try_advisory_lock` prevents multiple replicas from applying configs simultaneously
- Lock released in `finally` block to prevent leaks

### How Config Changes Are Detected and Applied

The system handles three scenarios:

**1. ConfigMap file changed** (Helm upgrade, ArgoCD sync, or direct ConfigMap edit):
- K8s propagates the change to the mounted file (~60s kubelet sync)
- Watcher detects the file hash change on its next 30s poll
- **All config types are re-applied** — global configs (service, workflow, dataset) and named configs, both seed and configmap modes
- Seed-mode items that already exist are skipped; new items are created
- Configmap-mode items are applied unconditionally, overwriting DB values
- No pod restart needed

**2. CLI/API write to a configmap-managed config**:
- The API returns **409 Conflict** immediately — the write never reaches the DB
- Applies to all config types: global configs (service, workflow, dataset), named configs, bulk endpoints, and rollback
- The loader's own writes bypass the guard via the `configmap-sync` username
- Seed-mode configs are not blocked — CLI writes are allowed and persist

**3. Direct DB manipulation** (safety net — bypasses the API entirely):
- For global configs (service, workflow, dataset) in configmap mode, the watcher compares cached ConfigMap values against current DB state on each poll cycle where the file hasn't changed
- If values differ, the watcher corrects the DB automatically
- Named configs are not checked in this scenario, but the 409 guard prevents the normal API paths from modifying them

### Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|---|---|---|---|
| K8s watch loop | Real-time detection | Requires K8s client in core service (breaks architectural boundary) | Core service talks to K8s only via agent service |
| Sidecar controller | Decoupled, K8s-native | New deployment component, more operational overhead | Polling is simpler and proven in codebase |
| Webhook on ConfigMap change | Instant notification | Requires webhook infra, harder to debug | Polling is more reliable |
| Bootstrap only (no watcher) | Simplest | Requires pod restart for config changes | Doesn't meet drift reconciliation requirement |

### Backwards Compatibility

- Fully backwards compatible — no changes to existing APIs, CLI, or config behavior
- `dynamicConfig.enabled: false` (default) preserves current behavior entirely
- In seed mode, existing CLI workflows continue to work normally
- In configmap mode, CLI writes to managed configs are rejected with 409 — users are directed to update Helm values instead

### Performance

- File hash check: 1 SHA-256 computation per 30s poll (negligible)
- Drift reconciliation: up to 3 DB reads per 30s poll (one per global config type in configmap mode)
- Advisory lock: 2 DB calls per apply cycle (acquire + release)
- Named config filtering in seed mode: 1 DB query per item (N+1 pattern — acceptable for typical config counts of 5-20)

### Operations

- **Logs**: All ConfigMap operations logged at INFO level with `configmap_loader` source
- **Audit trail**: Config history entries with `username=configmap-sync` and `tags=['configmap']`
- **Monitoring**: Errors logged at ERROR level with full tracebacks; service always starts even on config failures
- **Helm upgrade**: Checksum annotation triggers pod restart when ConfigMap content changes

### Security

- Credentials never stored in ConfigMap or Helm values (Git)
- Credentials injected via K8s Secrets (encrypted at rest, RBAC-controlled)
- Credentials encrypted via JWE (SecretManager) before DB storage
- Secret file paths not logged (only bucket names)

### Testing

#### Unit Tests (20 tests)
- File handling: missing file, invalid YAML, empty file, no managed_configs
- Managed mode parsing: seed, configmap, default, invalid
- Secret file resolution: success, missing file, invalid YAML, missing keys
- Safe apply: missing key, exception handling
- Advisory lock: acquire, release on success, release on failure, not acquired
- Unknown keys warning
- None managed_configs handling

#### Integration Tests (21 tests, testcontainers PostgreSQL)
- Global configs: seed new, seed existing (skip), configmap overwrite
- Named configs: pod templates (seed, configmap), backends (create, update, seed skip, error isolation), pools with dependencies, roles, resource validations
- Dataset with secret file credentials
- Full end-to-end: all config types in one YAML
- Partial failure: one type fails, others applied
- Config history: configmap-sync username and tags verified
- Backend conflict: no history on INSERT conflict
- **409 rejection**: CLI write to configmap-managed config rejected with 409, value unchanged
- **Drift reconciliation**: Global config drift detected and corrected, seed-mode configs preserved, no history when no drift

#### E2E Tests (validated on live dev instance)

| Test | What Was Validated | Result |
|---|---|---|
| Fresh deployment | All config types applied from ConfigMap on startup | PASS |
| Helm upgrade (file change) | Changed `max_num_tasks` 100→200, watcher detected and applied | PASS |
| CLI override (seed mode) | Changed service config via API, persisted across watcher polls | PASS |
| Dataset with K8s Secret credentials | Bucket credentials loaded from mounted Secret, encrypted in DB | PASS |
| New named config | Added `e2e-test-backend` in Helm values, created in DB after deploy | PASS |
| Error resilience | Invalid `bad-validation` format — service started, other configs applied, error logged | PASS |
| Multi-replica (2 replicas) | Advisory lock prevented duplicate config_history entries | PASS |
| Mode switch (seed→configmap) | Changed service from seed to configmap mode, ConfigMap values now enforced | PASS |
| Config history audit trail | `configmap-sync` entries clearly distinguishable from CLI entries | PASS |
| 409 — global config PATCH | PATCH workflow/service/dataset all return 409 | PASS |
| 409 — named PUT/DELETE | PUT pod_template, DELETE backend all return 409 | PASS |
| 409 — bulk PUT with managed item | PUT /api/configs/pod_template with default_ctrl returns 409 | PASS |
| 409 — bulk PUT non-managed only | PUT /api/configs/pod_template with non-managed item returns 200 | PASS |
| 409 — rollback global config | Rollback WORKFLOW and SERVICE return 409 | PASS |
| 409 — rollback named config | Rollback POD_TEMPLATE returns 409 | PASS |
| Non-managed write allowed | PATCH pool/default returns 200 | PASS |
| `_managed_by` in GET | workflow, service, dataset all include `_managed_by: configmap` | PASS |
| Values unchanged after 409 | `max_num_tasks=200`, `default_ctrl=osmo-ctrl` — no writes occurred | PASS |
| Performance — 409 latency | 409 rejection ~200ms vs normal write ~250-600ms (faster — no DB work) | PASS |

### Dependencies

- **PostgreSQL**: config_history table for seed mode existence checks
- **Helm charts**: New templates (dynamic-config.yaml, dynamic-config-secrets.yaml), updated api-service.yaml
- **K8s Secrets**: For credential injection (Vault, ExternalSecrets, or manual)
- **GitOps CD tool** (e.g., ArgoCD, Flux): Checksum annotation on pod spec triggers restart when ConfigMap content changes via `helm upgrade`

## UX Improvements (Post-MVP)

### Management Mode Visibility
- Config GET endpoints (`/api/configs/service`, `/api/configs/workflow`, `/api/configs/dataset`) include `_managed_by` field in responses (`"configmap"`, `"seed"`, or absent)
- Managed modes persisted to `configmap_state` DB table on startup
- Guard logic extracted to `configmap_guard.py` — a standalone module with no circular imports

### 409 Rejection for ConfigMap-Managed Configs
- All write/delete API endpoints reject modifications to configmap-managed configs with HTTP 409 Conflict
- Error message: `"<name> is managed by ConfigMap (managed_by=configmap) and cannot be modified via API. Update the Helm values instead."`
- Applies consistently to all 10 config types — global configs (service, workflow, dataset) and named configs
- Zero performance impact (in-memory dict lookup), zero race conditions, zero duplicate history entries

**Write path coverage:**
- **Global configs**: guarded in `helpers.put_configs()` and `helpers.patch_configs()` — covers all PUT/PATCH endpoints and rollback
- **Named configs**: guarded in each single-item endpoint (19 total) + all bulk endpoints (6 total) + rollback endpoint
- **Configmap-sync bypass**: the loader's own writes pass `username='configmap-sync'` which skips the guard via `reject_if_managed()` in `configmap_guard.py`

### Simplified Secret Wiring (`credentialSecretName`)
- Dataset buckets can use `credentialSecretName: my-secret` instead of manual `secret_file` + `extraVolumes`/`extraVolumeMounts`
- Helm template auto-generates volume + volumeMount for each referenced secret name
- Loader resolves `credentialSecretName` to `/etc/osmo/secrets/<name>/cred.yaml` as a fallback

```yaml
# Before (manual wiring)
dataset:
  config:
    buckets:
      sandbox:
        default_credential:
          secret_file: "/etc/osmo/secrets/sandbox-cred/cred.yaml"
# Plus manual extraVolumes/extraVolumeMounts in the service section

# After (simplified)
dataset:
  config:
    buckets:
      sandbox:
        credentialSecretName: osmo-bucket-sandbox-cred
# Volume mount auto-generated — no extraVolumes needed
```

## Future Improvements

- CLI warning when editing a configmap-managed config (`osmo config show` / `osmo config update`) — display `_managed_by` info before opening editor
- No-op checks in `put_*` service functions to avoid history entries when values are identical on file-change re-applies
- Dry-run mode (`--dynamic_config_dry_run`) to preview what would be applied

## Open Questions

- [x] Source of truth: ConfigMap or DB? → Depends on `managed_by` mode per config type
- [x] How to handle secrets? → K8s Secrets mounted as files, never in ConfigMap. Simplified via `credentialSecretName`.
- [x] When does the service pick up changes? → Polls every 30s, or on pod restart
- [x] What happens to config history? → `configmap-sync` entries with `['configmap']` tag
- [x] What if CLI changes a configmap-managed config? → Rejected with 409 Conflict for all write paths (endpoints, bulk, rollback)
- [x] Can users see which configs are managed? → `_managed_by` field in GET responses
- [x] Should named configs also be protected from CLI writes? → Yes, all single-item + bulk endpoints + rollback guarded
- [x] Can bulk endpoints bypass the guard? → No, bulk endpoints check each item and reject if any are managed (loader's writes use `configmap-sync` username to bypass)
- [x] Can rollback bypass the guard? → No, rollback endpoint checks config type against managed state
- [ ] Should the CLI display warnings when editing a configmap-managed config?
- [ ] Should `put_*` functions skip history entries when values are unchanged?
