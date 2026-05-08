---
name: osmo-deploy
description: >
  Deployment, installation, and administration of the OSMO platform on Kubernetes.
  Use this skill whenever the user asks about deploying OSMO, setting up the OSMO
  service or backend operator, preparing Helm values files, creating Kubernetes
  secrets (database, Redis, MEK, OAuth2 proxy), configuring authentication with or
  without an identity provider, setting up resource pools, pod templates, or resource
  validation rules, understanding OSMO's control plane / compute plane architecture,
  troubleshooting a failed deployment, rotating backend operator tokens, or doing a
  local (KIND) or minimal single-cluster deployment. Also use for questions about
  OSMO requirements, cloud infrastructure setup, storage bucket configuration, or
  KAI scheduler setup. Do NOT use for users who already have OSMO deployed and want
  to submit workflows, monitor runs, or use the osmo CLI for day-to-day operations —
  use the osmo-agent skill for those.
---

# OSMO Deployment Guide

## Architecture Overview

OSMO separates compute from orchestration across two planes:

**Control plane** (runs in a single service cluster):
- **API Service** — workflow operations and API endpoints
- **Router** — routes HTTP/WebSocket to backend clusters
- **Web UI** — browser interface
- **Worker** — background job processing (Kombu/Redis queue)
- **Logger** — log collection and streaming
- **Agent** — receives node/pod/event streams from backends
- **Delayed Job Monitor** — promotes scheduled jobs to main queue

**Compute plane** (one per backend cluster, any number of backends):
- **Backend Operator** — registers the cluster with OSMO, runs workflows as K8s pods
- **KAI Scheduler** — co-scheduling, priority, preemption for GPU workloads

One control plane can serve many backend clusters simultaneously.

---

## Requirements

| Component | Minimum Version | Notes |
|-----------|----------------|-------|
| Kubernetes | 1.27+ | EKS, AKS, GKE, or on-prem |
| PostgreSQL | 15+ | External managed DB recommended |
| Redis | 7.0+ | External managed cache recommended |
| Helm | 3.x | |
| kubectl | 1.32+ | |
| OSMO CLI | latest | `curl -fsSL https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh \| bash` |

**Instance sizing (control plane cluster):**

| Service | CPU | RAM | Storage |
|---------|-----|-----|---------|
| OSMO services | 8 cores | 32 GB | 100 GB |
| PostgreSQL | 2 cores | 4 GB | 32 GB |
| Redis | 1 core | 4 GB | — |

**Networking:** FQDN + SSL/TLS certificate + DNS CNAME pointing to the `osmo-gateway` LoadBalancer. VPC required for cloud deployments.

---

## Deployment Path Selection

Match the user's context to the right path. No keyword matching needed — read the signals:

| Signals | Path |
|---------|------|
| Experimenting, "try it out", "quick start", no cloud infra, mentions Docker/KIND | **Local** |
| Simple setup, no IdP/SSO, single cluster, small team, mentions port-forwarding | **Minimal** |
| Mentions EKS/AKS/GKE, IdP/SSO, multi-user org, external PostgreSQL/Redis, separate backend cluster | **Production** |

When no signals are present, default to **Production** (the primary audience for this skill).

---

## Intent Routing

Before answering a specific question, check here first:

| Question topic | Action |
|----------------|--------|
| Helm values configuration | Read `references/helm-values-templates.md` |
| Authentication / IdP setup | Read `references/auth-guide.md`; for provider-specific steps, also fetch IdP URL from `references/url-index.md` |
| Pools, pod templates, resource validation, group templates, KAI scheduler | Read `references/advanced-config.md` |
| Minimal single-cluster deployment | Read `references/deploy-minimal.md` |
| Storage setup (S3, Azure Blob, GCP, TOS) | Fetch URL from `references/url-index.md` |
| Keycloak setup | Fetch URL from `references/url-index.md` |
| Full config schema (pool, workflow, backend, etc.) | Fetch URL from `references/url-index.md` |
| Local KIND deployment details beyond what's below | Fetch `appendix/deploy_local.md` URL from `references/url-index.md` |

---

## Local Deployment (KIND)

For evaluation and development. No cloud account required. Takes ~10 minutes.

**Prerequisites:** Docker ≥28.3.2, KIND ≥0.29.0 or nvkind (GPU), kubectl ≥1.32.2, helm ≥3.16.2

**Step 1: Create KIND cluster**

CPU workstation:
```bash
kind create cluster --config kind-osmo-cluster-config.yaml
```

GPU workstation (install [nvkind](https://github.com/NVIDIA/nvkind) first):
```bash
nvkind cluster create --config-template=kind-osmo-cluster-config.yaml
```

Fetch `appendix/deploy_local.md` from `references/url-index.md` for the full `kind-osmo-cluster-config.yaml` content — the cluster needs specific node labels (`node_group=service`, `kai-scheduler`, `data`, `compute`).

**Step 2: Install KAI Scheduler**
```bash
helm upgrade --install kai-scheduler \
  oci://ghcr.io/nvidia/kai-scheduler/kai-scheduler \
  --version v0.12.10 \
  --create-namespace -n kai-scheduler \
  --set global.nodeSelector.node_group=kai-scheduler \
  --set "scheduler.additionalArgs[0]=--default-staleness-grace-period=-1s" \
  --set "scheduler.additionalArgs[1]=--update-pod-eviction-condition=true" \
  --wait
```

**Step 3: Install OSMO (quick-start)**
```bash
helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo
helm repo update
helm upgrade --install osmo osmo/quick-start \
  --namespace osmo --create-namespace --wait
```

Monitor: `kubectl get pods --namespace osmo`

**Step 4: Configure access**
```bash
echo "127.0.0.1 quick-start.osmo" | sudo tee -a /etc/hosts
```

**Step 5: Install OSMO CLI**
```bash
curl -fsSL https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh | bash
```

**Step 6: Log in**
```bash
osmo login http://quick-start.osmo --method=dev --username=testuser
```

OSMO is now available at `http://quick-start.osmo`. To clean up: `kind delete cluster --name osmo`

---

## Production Deployment

### Deploy Service (Control Plane)

**Step 1: Create PostgreSQL database**
```bash
export OSMO_DB_HOST=<your-db-host>
export OSMO_PGPASSWORD=<your-postgres-password>
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: osmo-db-ops
spec:
  containers:
    - name: osmo-db-ops
      image: alpine/psql:17.5
      command: ["/bin/sh", "-c"]
      args:
        - "PGPASSWORD=$OSMO_PGPASSWORD psql -U postgres -h $OSMO_DB_HOST -p 5432 -d postgres -c 'CREATE DATABASE osmo;'"
  restartPolicy: Never
EOF
kubectl get pod osmo-db-ops   # wait for Completed
kubectl delete pod osmo-db-ops
```

**Step 2: Create namespace and secrets**
```bash
kubectl create namespace osmo

# Database and Redis credentials
kubectl create secret generic db-secret \
  --from-literal=db-password=<your-db-password> --namespace osmo
kubectl create secret generic redis-secret \
  --from-literal=redis-password=<your-redis-password> --namespace osmo

# OAuth2 Proxy secret (requires IdP client secret — see references/auth-guide.md)
kubectl create secret generic oauth2-proxy-secrets \
  --from-literal=client_secret=<your-idp-client-secret> \
  --from-literal=cookie_secret=$(openssl rand -base64 32) \
  --namespace osmo
```

For **no-IdP (defaultAdmin)** setup instead: read `references/auth-guide.md` — skip the oauth2-proxy secret and enable `services.defaultAdmin` in Helm values.

For **IdP registration** (getting client ID, secret, endpoints): read `references/auth-guide.md`, then fetch the provider-specific URL from `references/url-index.md`.

**Generate and create MEK (Master Encryption Key):**
```bash
# Generate 256-bit random key
export RANDOM_KEY=$(openssl rand -base64 32 | tr -d '\n')

# Format as JWK
export JWK_JSON="{\"k\":\"$RANDOM_KEY\",\"kid\":\"key1\",\"kty\":\"oct\"}"

# Base64-encode the JWK
export ENCODED_JWK=$(echo -n "$JWK_JSON" | base64 | tr -d '\n')

# Create ConfigMap
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: mek-config
  namespace: osmo
data:
  mek.yaml: |
    currentMek: key1
    meks:
      key1: $ENCODED_JWK
EOF
```

> Store the original JWK securely. Never commit it to version control.

**Step 3: Prepare Helm values**

Read `references/helm-values-templates.md` for minimal annotated skeletons of all three values files (`osmo_values.yaml`, `router_values.yaml`, `ui_values.yaml`). For full options, fetch `getting_started/deploy_service.md` from `references/url-index.md`.

**Step 4: Deploy components**
```bash
helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo
helm repo update

helm upgrade --install service osmo/service -f ./osmo_values.yaml -n osmo
helm upgrade --install router osmo/router -f ./router_values.yaml -n osmo
helm upgrade --install ui osmo/web-ui -f ./ui_values.yaml -n osmo
```

**Step 5: Verify**
```bash
kubectl get pods -n osmo
# Expected: osmo-agent, osmo-delayed-job-monitor, osmo-logger,
#           osmo-router, osmo-service, osmo-ui, osmo-worker all Running

kubectl get svc -n osmo | grep gateway
# osmo-gateway should show an EXTERNAL-IP
```

**Step 6: Post-deployment**
1. Create DNS CNAME record: `<your-domain>` → `osmo-gateway` external IP/hostname (`kubectl get svc osmo-gateway -n osmo`)
2. Test auth flow and IdP role mapping — see `references/auth-guide.md`
3. Configure storage: `osmo config update WORKFLOW --file /tmp/workflow_log_config.json` (fetch `getting_started/configure_data.md` for the config JSON)

---

### Deploy Backend (Compute Plane)

Run Steps 1–2 against the **control plane** (OSMO CLI pointed at your domain). Run Steps 2–4 against the **backend cluster** (kubectl context pointed at the compute cluster). For minimal deployments, both are the same cluster.

**Step 1: Create service account and token**
```bash
osmo login https://osmo.example.com   # replace with your domain

osmo user create backend-operator --roles osmo-backend

export OSMO_SERVICE_TOKEN=$(osmo token set backend-token \
  --user backend-operator \
  --expires-at <YYYY-MM-DD> \
  --description "Backend Operator Token" \
  --roles osmo-backend \
  -t json | jq -r '.token')
```

Save the token securely — it will not be shown again.

**Step 2: Create namespaces and secret**
```bash
kubectl create namespace osmo-operator
kubectl create namespace osmo-workflows

kubectl create secret generic osmo-operator-token -n osmo-operator \
  --from-literal=token=$OSMO_SERVICE_TOKEN
```

**Step 3: Install backend dependencies**

Install KAI Scheduler and GPU Operator on the backend cluster. Fetch `install_backend/dependencies/dependencies.md` from `references/url-index.md` for exact commands and chart versions.

**Step 4: Deploy backend operator**

Read `references/helm-values-templates.md` for the `backend_operator_values.yaml` skeleton, then:
```bash
helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo
helm repo update

helm upgrade --install osmo-operator osmo/backend-operator \
  -f ./backend_operator_values.yaml \
  --version <chart-version> \
  --namespace osmo-operator
```

**Step 5: Validate**
```bash
export BACKEND_NAME=default  # or your backend name
osmo config show BACKEND $BACKEND_NAME
# Check "online": true in the output
```

**Troubleshoot — token expired:**
```bash
osmo token list --user backend-operator   # check expiry

# Rotate token: generate new one (Step 1), then update the secret:
kubectl delete secret osmo-operator-token -n osmo-operator
kubectl create secret generic osmo-operator-token -n osmo-operator \
  --from-literal=token=$OSMO_SERVICE_TOKEN
```

---

### Configure Pool

After the backend is online, link it to the default pool:
```bash
cat << EOF > /tmp/pool_config.json
{
  "pools": {
    "default": {
      "backend": "<your-backend-name>",
      "description": "Default pool"
    }
  }
}
EOF

osmo config update POOL --file /tmp/pool_config.json
osmo pool list   # verify: default pool shows ONLINE
```

For multi-pool setups, hardware differentiation, or topology-aware scheduling: read `references/advanced-config.md`.

---

## Troubleshooting

| Symptom | Action |
|---------|--------|
| DB connection failure | Verify `db-secret` values; check `kubectl logs -f <osmo-service-pod> -n osmo` |
| `osmo-gateway` has no EXTERNAL-IP | Check cloud LoadBalancer provisioner; verify cloud LB quota |
| Auth failures / 401 errors | Verify IdP client ID, client secret, and issuer URL in `osmo_values.yaml`; check `oauth2-proxy-secrets` |
| Backend `"online": false` | Run `kubectl logs -f <osmo-operator-pod> -n osmo-operator`; check token expiry |
| Pods in CrashLoopBackOff | Run `kubectl logs -f <pod-name> -n osmo`; check for missing secrets or misconfigured values |
| "Too many open files" (local) | Raise inotify limits: `echo fs.inotify.max_user_watches=1048576 \| sudo tee -a /etc/sysctl.conf && sudo sysctl -p` |

---

## Reference Files

Read these when the user's question goes beyond the inline steps above:

| File | When to read |
|------|-------------|
| `references/helm-values-templates.md` | Configuring any Helm values file |
| `references/auth-guide.md` | Auth setup (with/without IdP), roles, service accounts, token rotation |
| `references/advanced-config.md` | Pools, pod templates, resource validation, group templates, KAI scheduler, dataset buckets |
| `references/deploy-minimal.md` | Minimal single-cluster deployment (no IdP, port-forward access) |
| `references/url-index.md` | Finding the fetch URL for any section of the deployment guide |

---

## Fetching Online Docs

Base URL: `https://nvidia.github.io/OSMO/main/deployment_guide/`

Rule: any `.html` URL → replace with `.md` to get fetchable Markdown.

Always fetch (don't guess) for: Keycloak setup, per-cloud storage bucket setup, IdP provider-specific registration, full config schema definitions, observability/Grafana setup, on-prem cluster creation.

Use `references/url-index.md` to find the exact path for any section before fetching.
