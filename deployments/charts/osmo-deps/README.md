# OSMO Local Dependencies

`osmo-deps` is a non-production Helm chart for local OSMO installation tests.
It deploys single-replica PostgreSQL, authenticated Valkey, and RustFS with
ephemeral storage, then creates the three buckets used by the OSMO kind profile.

Install it with the fixed release name expected by the kind profile:

```bash
helm upgrade --install osmo-deps deployments/charts/osmo-deps \
  --namespace osmo \
  --create-namespace \
  --wait \
  --wait-for-jobs
```

The chart creates `osmo-deps-credentials`. Its intentionally simple local
credentials are `osmo` for PostgreSQL, `osmo` for Valkey, and
`osmo`/`osmo-local-secret` for S3. Data is lost when the pods are recreated.
Do not use this chart for production, shared, or security-sensitive clusters.
