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
**Status**: v2 — redesigned (in-memory serving, watchdog events, global mode)

## Overview

Enable OSMO's dynamic configuration to be defined declaratively in Kubernetes ConfigMaps via Helm values, served from in-memory cache, and automatically reloaded on file changes. This follows the standard K8s pattern used by CoreDNS, Prometheus, NGINX Ingress, and Grafana: ConfigMap mounted as file, parsed into memory, served from memory, file watcher detects changes.

### Motivation

Today, after every OSMO deployment, an administrator must manually run `osmo config update` CLI commands to configure the instance. This is error-prone, not version-controlled, and doesn't fit a GitOps deployment model.

### Problem

- Config changes are imperative (CLI commands) rather than declarative (checked into Git)
- No way to reproduce a config state from source control
- Config drift between environments is invisible until something breaks
- New deployments require manual post-deploy setup steps

## Architecture

### Two Global Modes

A single toggle `dynamicConfig.enabled` controls the entire system:

| | **ConfigMap Mode** (`enabled: true`) | **DB Mode** (`enabled: false` / absent) |
|---|---|---|
| Source of truth | ConfigMap (Helm values / GitOps) | Database (CLI/API) |
| Config writes | ALL write endpoints return 409 | Normal CLI/API behavior |
| Config reads | In-memory dict (parsed from file) | Database |
| How configs change | Edit Helm values, deploy via ArgoCD/Flux, kubelet updates mount, watchdog detects, reload | `osmo config update` / API calls |
| File watcher | Active (watchdog/inotify) | Not running |
| DB role | Runtime state only (heartbeats, k8s_uid) + roles (authz_sidecar) | Persistent store for everything |

There are no per-config management modes. Either all configs come from ConfigMap or all configs come from the database. This simplifies the system and eliminates drift reconciliation (since CLI writes are fully blocked in ConfigMap mode, drift is impossible).

### Config vs Runtime Data Separation

Not everything in the system is configuration. Some data is generated at runtime by services or agents:

| Data | Source | ConfigMap Mode | DB Mode |
|---|---|---|---|
| Singleton configs (service, workflow, dataset) | Admin | In-memory dict | DB |
| Backend config (scheduler_settings, node_conditions) | Admin | In-memory dict | DB |
| Backend runtime (k8s_uid, last_heartbeat, version) | Agent | DB (backends table) | DB |
| Pools, templates, validations, backend_tests | Admin | In-memory dict | DB |
| Roles | Admin | In-memory dict + DB (authz_sidecar needs DB) | DB |
| service_auth (RSA keys, login_info) | Service startup | DB (auto-generated) | DB |

### Data Flow

```
ConfigMap Mode:

  Helm Values --> K8s ConfigMap --> Mounted File --> ConfigMapWatcher
                                   (/etc/osmo/      |
                                    config.yaml)     |
                                                     v
                                          +-------------------+
                                          | Watchdog (inotify) |
                                          | File changed?      |
                                          | -> Parse YAML      |
                                          | -> Resolve secrets  |
                                          | -> Validate (all-  |
                                          |    or-nothing)     |
                                          | -> Atomic swap     |
                                          +--------+----------+
                                                   |
                                                   v
                                          _parsed_configs dict
                                          (module-level, in-memory)
                                                   |
                          +------------------------+------------------------+
                          |                        |                        |
                     get_configs()          Backend.fetch_from_db()   PodTemplate.fetch_from_db()
                     (singleton)           (config from dict,         (pure in-memory)
                                           runtime from DB)

  CLI / API --> config_service --> 409 Guard --> X  (all writes blocked)

  K8s Secret --> Mounted File --> Loader reads on parse --> Stored in dict
  (credentials)  (/etc/osmo/secrets/)
```

### Key Components

| Component | File | Purpose |
|---|---|---|
| `configmap_state` | `src/utils/configmap_state.py` | Dependency-free module holding mode boolean + parsed config snapshot. Importable from both utils and service layers without circular deps. |
| `configmap_guard` | `src/service/core/config/configmap_guard.py` | 409 write protection. Single `reject_if_configmap_mode(username)` function. |
| `configmap_loader` | `src/service/core/config/configmap_loader.py` | ConfigMapWatcher class, file event handler, validation, secret resolution. |
| Postgres model methods | `src/utils/connectors/postgres.py` | 13 interception points that check `configmap_state.get_snapshot()` and serve from memory. |

### How File Changes Are Detected

Using the `watchdog` library (v6.0.0, already a project dependency for rsync) with inotify backend on Linux.

**K8s ConfigMap symlink handling**: When kubelet updates a ConfigMap volume mount, it atomically swaps a `..data` symlink to a new timestamped directory. Watchdog's inotify watches the **parent directory** and detects the symlink swap as directory events.

**Debounce**: 2-second delay to batch rapid events during the symlink swap (kubelet creates temp dir + swaps symlink = multiple inotify events).

### Validation

All-or-nothing validation before applying — same pattern as `nginx -t`:

1. Parse ConfigMap YAML
2. Resolve all secret file references
3. Validate each section by constructing Pydantic models (ServiceConfig, WorkflowConfig, etc.)
4. If ANY section fails validation: log error, keep previous config, service continues
5. If ALL pass: atomic swap of module-level dict reference

On first deployment with bad config: service starts with DB defaults (from `configure_app()`), ConfigMap mode is NOT activated, ERROR log shows what's wrong.

### 409 Write Protection

In ConfigMap mode, ALL config write endpoints return HTTP 409 Conflict:

```
Configs are managed by ConfigMap and cannot be modified via CLI/API.
Update the Helm values and redeploy instead.
```

29 guard call sites across `config_service.py` (27) and `helpers.py` (2). The `configmap-sync` username bypasses the guard for internal operations (writing roles to DB for the authz_sidecar).

### Secret Handling

Credentials are **never stored in ConfigMap or Helm values**. Instead:

1. K8s Secret created out-of-band (Vault, ExternalSecrets, or `kubectl create secret`)
2. Secret mounted into pod via Helm-generated volume/volumeMount
3. ConfigMap references the secret via `secretName` or `credentialSecretName`
4. Helm template transforms `secretName` to `secret_file` path
5. Loader reads the file during parse and injects resolved credentials into the in-memory dict

Supports three secret formats:
- Simple string: `{value: "token-value"}` (e.g., Slack tokens)
- Docker registry: `.dockerconfigjson` format (auto-detected)
- YAML dict: arbitrary key-value pairs (e.g., storage credentials)

### Backend Config + Runtime Merge

Backend reads merge config from the in-memory dict with runtime data from DB:

| ConfigMap | Agent Connected | Behavior |
|---|---|---|
| Declared | Yes | Config fields from dict, runtime (heartbeat, k8s_uid) from DB |
| Declared | No | Config fields from dict, runtime defaults to empty (offline) |
| Not declared | Yes | Excluded from config list (agent row exists but not managed) |

Agent code (`service/agent/helpers.py`) is unchanged — it continues writing heartbeats and k8s_uid to the `backends` table.

### Roles (DB Exception)

The Go authz_sidecar reads roles directly from the `roles` DB table via its own PostgreSQL connection. The ConfigMap loader writes roles to DB as a controlled exception so authz_sidecar can function. Python service reads for roles also come from DB.

### Runtime Field Injection

`service_auth` (RSA keys) and `service_base_url` are auto-generated by `configure_app()` on startup — they are NOT in the ConfigMap. The loader injects them:

- First load: reads from DB (configure_app has already written them)
- Subsequent reloads: carries forward from previous snapshot

This ensures `get_service_configs()` returns both admin-configured fields (from ConfigMap) and runtime-generated fields (from DB).

## Helm Values Format

```yaml
services:
  dynamicConfig:
    enabled: true   # single global toggle

    workflow:
      config:
        max_num_tasks: 100
        max_exec_timeout: "60d"
        workflow_data:
          credential:
            secretName: osmo-workflow-data-cred

    service:
      config:
        cli_config:
          latest_version: "6.2.12"
          min_supported_version: "6.0.0"

    dataset:
      config:
        default_bucket: primary
        buckets:
          primary:
            dataset_path: "s3://my-bucket"
            region: "us-west-2"
            default_credential:
              credentialSecretName: osmo-bucket-cred

    podTemplates:
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
      items:
        default:
          scheduler_settings:
            scheduler_type: kai
          router_address: "wss://osmo.example.com"

    pools:
      items:
        gpu-large:
          backend: default
          platforms: { ... }

    roles:
      items:
        osmo-admin:
          description: "Admin role"
          policies: [...]

    resourceValidations:
      items:
        default_cpu:
        - resource: cpu
          operator: LE
          threshold: node_cpu
```

## Testing

### Unit Tests (23 tests)
- ConfigMap guard: 409 when active, allow when inactive, bypass for configmap-sync
- Config state: snapshot set/get, atomic swap preserves old references
- Secret resolution: success, missing file, simple string, Docker registry, secretName conversion
- Validation: valid sections, invalid items type, unknown keys, empty configs
- ConfigMapWatcher: file not found, no managed_configs, populates snapshot, injects runtime fields, validation failure preserves previous config
- Event handler: ignores unrelated events, reacts to config file events, reacts to ..data symlink events

### Integration Tests (testcontainers PostgreSQL)
- Singleton configs served from snapshot
- Named configs (PodTemplate, ResourceValidation) served from snapshot
- 409 rejection on patch/put endpoints
- 409 bypass for configmap-sync username
- ConfigMapWatcher loads configs into snapshot

## Backwards Compatibility

- Fully backwards compatible: `dynamicConfig.enabled: false` (default) preserves current behavior
- No DB schema changes required
- Agent code unchanged
- CLI works normally in DB mode

## Open Questions

- [x] Per-config or global mode? -> Global mode (team feedback)
- [x] Polling or event watching? -> Watchdog/inotify events with 2s debounce (team feedback)
- [x] Write to DB or serve from memory? -> In-memory, standard K8s pattern (team feedback)
- [x] How to handle runtime data (heartbeats)? -> Separate: config from memory, runtime from DB
- [x] How to handle roles (authz_sidecar)? -> Write to DB as controlled exception
- [x] What about service_auth? -> Inject from DB on first load, carry forward on reloads
- [ ] Should the CLI display warnings when in ConfigMap mode?
- [ ] Health check endpoint for ConfigMap mode status?
