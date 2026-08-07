# OSMO Umbrella Chart

The `osmo` chart is the unified entry point for OSMO deployment profiles. This
initial version implements the split-plane control profile by composing the
existing `service` chart. Compute-plane installation is intentionally rejected
until the backend chart is integrated.

The control profile consumes external PostgreSQL, Valkey, and S3-compatible
storage plus an existing Kubernetes Secret. It does not render the service
chart's embedded PostgreSQL, Redis, or LocalStack resources and does not use
Vault-agent annotations.

## Control-plane installation

The control profile requires operator-managed PostgreSQL, Redis or Valkey, and
S3-compatible object storage. Supply environment-specific endpoints and Secret
references in a separate values file, then layer it after the profile:

```bash
helm dependency build deployments/charts/osmo

helm upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  -f deployments/charts/osmo/profiles/split-plane-control.yaml \
  -f <environment-values.yaml> \
  --wait \
  --timeout 25m
```

At minimum, the environment values configure
`controlPlane.services.postgres.serviceName`,
`controlPlane.services.redis.serviceName`, and the workflow data, log, and app
storage entries beneath `controlPlane.services.configs.workflow`. Override the
Secret name consistently if the installation does not use
`osmo-control-secrets`.

## Existing Secret contract

The split-control profile expects an operator-owned Secret named
`osmo-control-secrets`. It supplies:

| Key | Consumer |
| --- | --- |
| `db-password` | PostgreSQL clients |
| `redis-password` | Valkey clients |
| `mek.yaml` | OSMO encryption-key configuration |
| Environment-defined key | Object-storage credentials loaded by the config watcher |

External installations override the host names and Secret references beneath
`controlPlane.services`. The referenced Secret remains operator-owned; the
umbrella does not overwrite or regenerate it.
