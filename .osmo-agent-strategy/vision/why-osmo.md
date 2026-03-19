# What OSMO Uniquely Has

## Capabilities Only OSMO Provides

| Capability | Why No One Else Has It | Codebase Location |
|-----------|----------------------|-------------------|
| **GPU topology as queryable resource** | Standard K8s treats GPUs as opaque integers. OSMO has `TopologyKey`, `TopologyRequirement`, `TaskTopology`, `TopologyTreeNode` -- constraint trees for gang scheduling. An agent can reason: "64 GPUs needed, only 48 on same rack -- wait for colocation or accept cross-rack?" | `utils/job/topology.py` |
| **Physical AI pipeline semantics** | SDG -> train -> eval -> deploy as first-class concept. Each stage has radically different compute, data, and validation requirements. Argo can run DAGs but has zero domain knowledge. | `service/core/workflow/`, `utils/job/` |
| **Multi-cluster heterogeneous backends** | Training clusters, simulation clusters, edge devices -- each with different K8s configs, GPU types, network topologies. kagent operates within one cluster; OSMO orchestrates across many. | `service/agent/`, `operator/backend_listener.py` |
| **Multi-cloud storage with dataset versioning** | 6 backends (S3/Azure/GCS/Swift/TOS/local), parallel multiprocess+multithread transfer, checkpointing, content-addressable deduplication. | `lib/data/storage/`, `lib/data/dataset/` |
| **ctrl/user/rsync execution model** | Three-container architecture with WebSocket coordination, Unix socket IPC, checkpoint management, barrier sync. Deeply integrated workflow execution. | `runtime/cmd/ctrl/`, `runtime/cmd/user/`, `runtime/cmd/rsync/` |
| **Semantic RBAC** | Actions like `workflow:Create`, `dataset:Read`. LRU cache with TTL. Role sync from IDP. Pool access evaluation. | `utils/roles/`, `service/authz_sidecar/` |
| **Enterprise multi-tenancy** | Pool isolation, resource quotas, per-team visibility, JWE-based secret encryption (MEK/UEK). | `utils/secret_manager/`, `service/core/auth/` |

---

## Ecosystem Position (Not Data Moat)

### The K8s/Linux Model

OSMO's defensibility is ecosystem position, not proprietary data or lock-in.

| Aspect | K8s/Linux Model | OSMO Application |
|--------|----------------|------------------|
| **Code** | Fully open-source | Fully open-source (Apache 2.0) |
| **Data** | Community-contributed | Telemetry fully open, community-contributed |
| **Benefit to sponsor** | Deepest integration with own stack | Deepest integration with NVIDIA hardware/software |
| **Community benefit** | Shared infrastructure | Shared pipeline intelligence |
| **Lock-in** | Zero (by design) | Zero (by design) |
| **Adoption driver** | Ecosystem gravity | Ecosystem gravity |

The flywheel exists (every pipeline run makes tools smarter) but the data is fully open. Defensibility comes from ecosystem position: NVIDIA has the deepest integration with its own GPU hardware, CUDA stack, Isaac Sim, Omniverse, NIM, and Data Factory.

### NVIDIA Stack Positioning

OSMO is connective tissue underneath the domain-specific tools:

| NVIDIA Tool | What It Does | OSMO's Relationship |
|-------------|-------------|---------------------|
| **Isaac Sim** | Simulation | OSMO orchestrates sim jobs across clusters |
| **Omniverse** | Digital twins, collaboration | OSMO manages compute for Omniverse workloads |
| **NIM** | Model inference | OSMO schedules inference alongside training |
| **Data Factory** | SDG pipelines | OSMO orchestrates Data Factory pipeline execution |
| **Isaac ROS** | Robot middleware | OSMO manages edge deployment targets |
| **CUDA** | GPU programming | OSMO ensures correct GPU allocation for CUDA workloads |

**The key insight**: Each NVIDIA product creates GPU-hours on one cluster. OSMO creates GPU-hours ACROSS clusters. Multi-cluster heterogeneous orchestration is THE differentiator within the NVIDIA stack.

### Capability Unlock, Not Friction Reduction

Two framings of OSMO's value:

| | Version A (Friction Reduction) | Version B (Capability Unlock) |
|---|---|---|
| **Pitch** | "Run your pipelines faster and cheaper" | "Run pipelines that can't exist without multi-cluster orchestration" |
| **Example** | "Submit jobs in 2 clicks instead of 20" | "Run SDG on CPU cluster, training on H100 cluster, eval on edge devices -- as one pipeline" |
| **Defensibility** | Low -- any tool can reduce friction | High -- requires OSMO's multi-cluster architecture |
| **GPU demand** | Marginal increase | Enables entirely new workload types |

**Version B is the correct framing.** OSMO doesn't just make existing workflows faster -- it enables workflows that can't exist without multi-cluster heterogeneous orchestration.

---

## What OSMO Should NOT Build

| Capability | Leave To | Why |
|-----------|----------|-----|
| **Code editing / dev assistance** | Claude Code, Cursor, Codex | They are purpose-built. AGENTS.md provides OSMO context. |
| **K8s troubleshooting** | kagent (CNCF), Komodor (95% accuracy, 3X ARR), K8sGPT, Robusta/HolmesGPT | Production-hardened specialists with years of telemetry. |
| **Incident response** | PagerDuty AI (50% faster resolution), Rootly (70% MTTR reduction), incident.io | OSMO should be an event source, not an incident platform. |
| **Generic workflow DAGs** | Argo Workflows (CNCF graduated), n8n (180K stars), Temporal | Solved problem. OSMO's value is Physical AI semantics on top. |
| **CI/CD automation** | GitLab CI, GitHub Actions, ArgoCD | Already works fine. |
| **Monitoring/alerting** | Prometheus, Grafana, Datadog | Integration, not reinvention. |
| **Custom agent runtime** | OpenClaw, Manus, LangGraph, CrewAI | OSMO provides tools and domain knowledge; agent runtime provides reasoning. |
| **SaaS integrations** | n8n (400+ connectors), Zapier | OSMO is not a SaaS integration platform. |
| **General chatbot/agent UX** | n8n chat nodes, OpenManus | OSMO's users are engineers who write YAML and submit training jobs. |
| **Secret management platform** | Vault, K8s secrets | OSMO has JWE encryption but should not try to be a secrets platform. |

## The Integration Model

**OSMO as MCP server** -- so ANY agent (Claude Code, Codex, kagent, Manus) can call OSMO as a tool. Integration, not reinvention.

Domain-specific tools that encode OSMO's unique knowledge:
- `submit_physical_ai_pipeline` -- not generic DAG, but SDG -> train -> eval with domain defaults
- `recommend_topology` -- GPU topology reasoning no external tool can do
- `predict_resource_needs` -- based on historical pipeline data
- `optimize_dataset_placement` -- multi-cloud, colocation with compute
- `diagnose_training_failure` -- OSMO-specific failure taxonomy

**The agent runtime is someone else's problem. The Physical AI domain intelligence is ours.**

## Build vs. Buy vs. Integrate -- Per Capability

| Proposed Capability | Recommendation | Reasoning |
|---|---|---|
| Agent-assisted OSMO codebase development | **Dogfood** (5-layer framework) | The proof -- validate the framework on OSMO's own development |
| Agent-assisted K8s operations/troubleshooting | **Integrate** with kagent/Komodor | Production-hardened specialists |
| Agent-assisted incident response | **Integrate** with PagerDuty/Komodor | Let specialists handle triage |
| Agent-assisted CI/CD | **Do nothing** (already solved) | GitLab CI + Bazel + ArgoCD works |
| Agent-driven Physical AI pipeline orchestration | **BUILD THIS** | The unique opportunity |
| Agent-assisted dataset management | **BUILD THIS** (as part of pipeline agent) | OSMO's multi-cloud storage SDK is unique |
| Agent-assisted resource/pool optimization | **BUILD THIS** (narrow scope) | Data only OSMO has |
