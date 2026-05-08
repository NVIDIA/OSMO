# Minimal Deployment

Single-cluster deployment: service and backend operator in the same Kubernetes cluster.
No identity provider — uses defaultAdmin for authentication. Suitable for testing, evaluation,
and small teams. Not recommended for production (no SSO, limited auth).

For full production deployment (separate clusters, IdP): see the inline production steps in `SKILL.md`.
For requirements (K8s, PostgreSQL, Redis): fetch `requirements/prereqs.md` from `references/url-index.md`.

---

## Step 1: Create Namespace and Add Helm Repo

```bash
kubectl create namespace osmo-minimal

helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo
helm repo update
```

## Step 2: Create Secrets

```bash
# Database and Redis passwords
kubectl create secret generic db-secret \
  --from-literal=db-password=<your-db-password> --namespace osmo-minimal
kubectl create secret generic redis-secret \
  --from-literal=redis-password=<your-redis-password> --namespace osmo-minimal

# Default admin password (must be exactly 43 characters)
kubectl create secret generic default-admin-secret \
  --namespace osmo-minimal \
  --from-literal=password='<your-43-char-password>'
```

**Generate MEK (Master Encryption Key):**
```bash
export RANDOM_KEY=$(openssl rand -base64 32 | tr -d '\n')
export JWK_JSON="{\"k\":\"$RANDOM_KEY\",\"kid\":\"key1\",\"kty\":\"oct\"}"
export ENCODED_JWK=$(echo -n "$JWK_JSON" | base64 | tr -d '\n')

kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: mek-config
  namespace: osmo-minimal
data:
  mek.yaml: |
    currentMek: key1
    meks:
      key1: $ENCODED_JWK
EOF
```

## Step 3: Create PostgreSQL Database

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
        - "PGPASSWORD=$OSMO_PGPASSWORD psql -U postgres -h $OSMO_DB_HOST -p 5432 -d postgres -c 'CREATE DATABASE osmo_db;'"
  restartPolicy: Never
EOF

kubectl get pod osmo-db-ops   # wait for Completed
kubectl delete pod osmo-db-ops
```

## Step 4: Prepare Helm Values

**`osmo_values.yaml`:**
```yaml
global:
  osmoImageLocation: <osmo-image-registry>   # REQUIRED
  osmoImageTag: <version>                     # REQUIRED

services:
  configFile:
    enabled: true
  postgres:
    enabled: false
    serviceName: <your-postgres-host>
    db: osmo_db
  redis:
    enabled: false
    serviceName: <your-redis-host>
    port: 6379
    tlsEnabled: true   # set false if Redis has no TLS
  defaultAdmin:
    enabled: true
    username: "admin"
    passwordSecretName: default-admin-secret
    passwordSecretKey: password

gateway:
  oauth2Proxy:
    enabled: false
  authz:
    enabled: false
```

**`ui_values.yaml`:**
```yaml
global:
  osmoImageLocation: <osmo-image-registry>
  osmoImageTag: <version>

services:
  ui:
    apiHostname: osmo-gateway.osmo-minimal.svc.cluster.local:80
```

**`router_values.yaml`:**
```yaml
global:
  osmoImageLocation: <osmo-image-registry>
  osmoImageTag: <version>

services:
  configFile:
    enabled: true
  postgres:
    serviceName: <your-postgres-host>
    db: osmo_db
```

## Step 5: Deploy

```bash
helm upgrade --install osmo-minimal osmo/service \
  -f ./osmo_values.yaml --namespace osmo-minimal

helm upgrade --install ui-minimal osmo/web-ui \
  -f ./ui_values.yaml --namespace osmo-minimal

helm upgrade --install router-minimal osmo/router \
  -f ./router_values.yaml --namespace osmo-minimal
```

## Step 6: Verify and Access

```bash
kubectl get pods -n osmo-minimal
# Expected: osmo-agent, osmo-delayed-job-monitor, osmo-logger,
#           osmo-router, osmo-service, osmo-ui, osmo-worker all Running

# Access OSMO via port-forward
kubectl port-forward service/osmo-gateway 9000:80 -n osmo-minimal
```

OSMO UI: http://localhost:9000
OSMO API: http://localhost:9000/api

## Step 7: Deploy Backend Operator (same cluster)

```bash
# Port-forward first, then log in
kubectl port-forward service/osmo-gateway 9000:80 -n osmo-minimal &
osmo login http://localhost:9000 --method=dev --username=testuser

# Create service account and token
osmo user create backend-operator --roles osmo-backend
export BACKEND_TOKEN=$(osmo token set backend-token \
  --user backend-operator \
  --expires-at <YYYY-MM-DD> \
  --roles osmo-backend \
  -t json | jq -r '.token')

# Create namespaces and secret in same cluster
kubectl create namespace osmo-operator
kubectl create namespace osmo-workflows
kubectl create secret generic osmo-operator-token -n osmo-operator \
  --from-literal=token=$BACKEND_TOKEN
```

**`backend_operator_values.yaml`:**
```yaml
global:
  osmoImageLocation: <osmo-image-registry>
  osmoImageTag: <version>
  serviceUrl: http://osmo-gateway.osmo-minimal.svc.cluster.local
  agentNamespace: osmo-operator
  backendNamespace: osmo-workflows
  backendName: default
  accountTokenSecret: osmo-operator-token
  loginMethod: token
```

```bash
helm upgrade --install osmo-operator osmo/backend-operator \
  -f ./backend_operator_values.yaml \
  --namespace osmo-operator

# Validate
osmo config show BACKEND default   # check "online": true
```

## Step 8: Basic Configuration

```bash
# Configure default pool
cat << EOF > /tmp/pool_config.json
{"pools": {"default": {"backend": "default", "description": "Default pool"}}}
EOF
osmo config update POOL --file /tmp/pool_config.json

# Set service base URL (for CLI access outside port-forward)
cat << EOF > /tmp/service_config.json
{"service": {"service_base_url": "http://localhost:9000"}}
EOF
osmo config update SERVICE --file /tmp/service_config.json
```

## Upgrading to Production

When ready to move to production (separate clusters, IdP, cloud LB):
- See the production deploy steps in `SKILL.md`
- For IdP setup: read `references/auth-guide.md`
- For cloud infrastructure: fetch from `references/url-index.md`
