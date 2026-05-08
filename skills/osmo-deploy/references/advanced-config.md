# Advanced Configuration

Post-deployment configuration for pools, pod templates, resource validation, and more.
All configs are applied with `osmo config update <TYPE> --file <file.json>`.

---

## Resource Pools

Pools organize compute resources into logical groups. Users submit workflows to a pool,
which routes them to the right hardware on the right backend.

**Pool architecture:**
```
Backend (K8s cluster)
├── Pool: training-pool
│   ├── Platform: a100
│   └── Platform: h100
└── Pool: simulation-pool
    └── Platform: l40s
```

**Basic pool config:**
```json
{
  "pools": {
    "<pool-name>": {
      "backend": "<backend-name>",
      "description": "<description>"
    }
  }
}
```

**Pool with platforms (hardware differentiation):**
```json
{
  "pools": {
    "gpu-pool": {
      "backend": "default",
      "description": "GPU training pool",
      "platforms": {
        "a100": {
          "pod_template": "a100-template",
          "resource_validation": "gpu-validation"
        },
        "h100": {
          "pod_template": "h100-template",
          "resource_validation": "gpu-validation"
        }
      }
    }
  }
}
```

```bash
osmo config update POOL --file /tmp/pool_config.json
osmo pool list
```

For topology-aware scheduling, role-based pool access, and full pool reference:
fetch `advanced_config/pool.md` from `references/url-index.md`.

---

## Pod Templates

Pod templates define Kubernetes scheduling constraints applied to workflow task pods.

**Minimal template structure:**
```json
{
  "<template-name>": {
    "spec": {
      "nodeSelector": {
        "<node-label-key>": "<value>"
      },
      "tolerations": [
        {
          "key": "<taint-key>",
          "effect": "NoSchedule"
        }
      ],
      "containers": [
        {
          "name": "user-container",
          "resources": {
            "requests": {
              "cpu": "{{USER_CPU}}",
              "memory": "{{USER_MEMORY}}",
              "nvidia.com/gpu": "{{USER_GPU}}"
            },
            "limits": {
              "memory": "{{USER_MEMORY}}",
              "nvidia.com/gpu": "{{USER_GPU}}"
            }
          }
        }
      ]
    }
  }
}
```

**Available template variables:**

| Variable | Description |
|----------|-------------|
| `{{USER_CPU}}` | CPU requested by user's workflow task |
| `{{USER_MEMORY}}` | Memory requested |
| `{{USER_GPU}}` | GPU count requested |
| `{{USER_STORAGE}}` | Storage requested |
| `{{WF_ID}}` | Workflow ID |
| `{{TASK_ID}}` | Task ID |

```bash
osmo config update POD_TEMPLATE --file /tmp/pod_template.json
```

For Jinja2 conditionals, template merging, security contexts, and `/dev/shm` shared memory:
fetch `advanced_config/pod_template.md` from `references/url-index.md`.

---

## Resource Validation

Pre-flight rules that reject workflows requesting invalid resources before they reach the scheduler.

**Rule structure:**
```json
{
  "rules": [
    {
      "operator": "LE",
      "left_operand": "{{USER_GPU}}",
      "right_operand": "8",
      "assert_message": "Cannot request more than 8 GPUs per task"
    }
  ]
}
```

**Operators:** `LE` (≤), `LT` (<), `GE` (≥), `GT` (>), `EQ` (=), `NE` (≠)

**Available variables:** `{{USER_CPU}}`, `{{USER_GPU}}`, `{{USER_MEMORY}}`, `{{USER_STORAGE}}`
(also `{{K8_CPU}}`, `{{K8_GPU}}`, `{{K8_MEMORY}}` for K8s-format values)

**Example — GPU and memory guardrails:**
```json
{
  "rules": [
    {
      "operator": "LE",
      "left_operand": "{{USER_GPU}}",
      "right_operand": "8",
      "assert_message": "Max 8 GPUs per task on this pool"
    },
    {
      "operator": "GE",
      "left_operand": "{{USER_GPU}}",
      "right_operand": "1",
      "assert_message": "GPU pool requires at least 1 GPU"
    },
    {
      "operator": "LE",
      "left_operand": "{{USER_MEMORY}}",
      "right_operand": "400",
      "assert_message": "Memory limit is 400 GB per task"
    }
  ]
}
```

```bash
osmo config update RESOURCE_VALIDATION --file /tmp/resource_validation.json
```

Reference a validation config in a pool's platform:
```json
"platforms": { "a100": { "resource_validation": "<validation-config-name>" } }
```

For full validation reference and troubleshooting: fetch `advanced_config/resource_validation.md`.

---

## Group Templates

Group templates create Kubernetes resources (ConfigMaps, CRDs) alongside workflow task groups —
useful for NVLink ComputeDomain, custom schedulers, or shared cluster state.

The backend operator needs RBAC permissions for any resource kinds used in group templates.
Add to `backend_operator_values.yaml`:
```yaml
services:
  backendWorker:
    extraRBACRules:
      - apiGroups: ["<api-group>"]
        resources: ["<resource-kind>"]
        verbs: ["create", "delete", "get", "list", "patch", "update", "watch"]
```

For full group template structure and the NVLink ComputeDomain example:
fetch `advanced_config/group_template.md` from `references/url-index.md`.

---

## KAI Scheduler

KAI provides co-scheduling, preemption, and fair GPU sharing. Installed on the backend cluster.

**Install:**
```bash
helm upgrade --install kai-scheduler \
  oci://ghcr.io/nvidia/kai-scheduler/kai-scheduler \
  --version <version> \
  --create-namespace -n kai-scheduler \
  --set global.nodeSelector.node_group=kai-scheduler \
  --set "scheduler.additionalArgs[0]=--default-staleness-grace-period=-1s" \
  --set "scheduler.additionalArgs[1]=--update-pod-eviction-condition=true" \
  --wait
```

For GPU allocation model (Guarantee/Weight/Maximum), preemption policies, and fair sharing:
fetch `advanced_config/scheduler.md` from `references/url-index.md`.

---

## Dataset Buckets

Register external cloud storage buckets so OSMO can reference datasets by name.

```bash
cat << EOF > /tmp/dataset_config.json
{
  "buckets": {
    "<bucket-alias>": {
      "uri": "s3://<bucket-name>",
      "credentials": "<credential-name>"
    }
  }
}
EOF
osmo config update DATASET --file /tmp/dataset_config.json
osmo bucket list   # verify registration
```

For multi-cloud buckets, team-based organization, and naming conventions:
fetch `advanced_config/dataset_buckets.md` from `references/url-index.md`.

---

## Common `osmo config` Commands

```bash
# Show current config for a type
osmo config show POOL
osmo config show BACKEND <name>
osmo config show POD_TEMPLATE <name>

# List all configs of a type
osmo config list POOL

# Update from file
osmo config update <TYPE> --file <file.json>

# Diff current vs. previous version
osmo config diff <TYPE> <name>

# View config history
osmo config history <TYPE> <name>

# Roll back to a previous version
osmo config rollback <TYPE> <name> --version <N>
```
