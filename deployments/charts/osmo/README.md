# OSMO Umbrella Chart

The `osmo` chart is the unified entry point for OSMO deployment profiles. This
initial version implements the split-plane control profile by composing the
existing `service` chart. Compute-plane installation is intentionally rejected
until the backend chart is integrated.

The control profile consumes external PostgreSQL, Valkey, and S3-compatible
storage plus an existing Kubernetes Secret. It does not render the service
chart's embedded PostgreSQL, Redis, or LocalStack resources and does not use
Vault-agent annotations.

## Local kind installation

Install the test-only dependencies first, then layer the control and kind
profiles in normal Helm precedence order:

```bash
helm dependency build deployments/charts/osmo

helm upgrade --install osmo-deps deployments/charts/osmo-deps \
  --namespace osmo \
  --create-namespace \
  --wait \
  --wait-for-jobs

helm upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  -f deployments/charts/osmo/profiles/split-plane-control.yaml \
  -f deployments/charts/osmo/profiles/kind.yaml \
  --wait \
  --timeout 25m
```

The kind profile uses the public
`nvcr.io/nvidia/osmo/<component>:6.3.1` images. It disables OAuth2 Proxy and
authorization and asks Envoy to inject a development administrator identity.
Use it only on an isolated local cluster.

Verify the gateway through a port-forward:

```bash
kubectl --context kind-<cluster> -n osmo port-forward \
  service/osmo-gateway 9000:80

curl -fsS http://127.0.0.1:9000/api/version
curl -fsS \
  -H 'x-osmo-user: admin' \
  -H 'x-osmo-roles: osmo-admin' \
  -H 'x-osmo-allowed-pools: default' \
  'http://127.0.0.1:9000/api/workflow?limit=10&all_pools=true'
```

Replace `<cluster>` with the local kind cluster name only after confirming it
with `kind get clusters`. Never use these commands against a non-kind context.

## Existing Secret contract

The generic split-control profile expects `osmo-control-secrets`; the kind
overlay changes this to `osmo-deps-credentials`. The Secret supplies:

| Key | Consumer |
| --- | --- |
| `db-password` | PostgreSQL clients |
| `redis-password` | Valkey clients |
| `mek.yaml` | OSMO encryption-key configuration |
| `admin-password` | Local development administrator |
| `object-storage.yaml` | S3 access key fields loaded by the config watcher |

External installations override the host names and Secret references beneath
`controlPlane.services`. The referenced Secret remains operator-owned; the
umbrella does not overwrite or regenerate it.
