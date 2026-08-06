# OSMO-6592 Split-Plane Control Profile Design

## Scope

Add a local-development dependency chart and the first OSMO umbrella chart. The
umbrella installs only the existing OSMO service/control-plane chart. It does
not install the backend operator or any compute-plane workload. The result must
render, install, and answer live REST requests on a local kind cluster with
public OSMO images.

The dependency chart is deliberately not production-ready. It exists to make
the OSMO-6592 installation test repeatable and installs one replica each of
PostgreSQL, Valkey, and RustFS with simple credentials and ephemeral storage.

## Architecture

`deployments/charts/osmo` is a thin Helm parent chart. It declares the existing
`service` chart as the `controlPlane` dependency and gates it with
`planes.control.enabled`. `planes.compute.enabled` is present for the future
unified chart but is rejected for now because the umbrella does not yet carry a
compute dependency.

The profile is split into two ordinary Helm values files:

- `profiles/split-plane-control.yaml` selects only the control plane, disables
  the service chart's embedded PostgreSQL, Redis, and LocalStack resources, and
  selects existing Kubernetes Secrets.
- `profiles/kind.yaml` supplies the local `osmo-deps` service names, configures
  RustFS-backed workflow storage, reduces replicas, and enables the unauthenticated
  development gateway identity needed for local REST verification.

`deployments/charts/osmo-deps` installs the three external services and one
credential Secret. PostgreSQL and Valkey consume the same Secret keys that the
OSMO profile references. RustFS exposes the S3 API and a hook Job creates the
workflow, log, and app buckets.

## Service Chart Compatibility

The current service chart already supports external hosts and Kubernetes
Secret-backed dependency credentials, but several templates hardcode
`db-secret`, `redis-secret`, and a `mek-config` ConfigMap. Add configurable
Valkey Secret name/key values, use the existing PostgreSQL Secret values in all
workloads, and allow `services.configFile.secretName` plus
`services.configFile.secretKey` to mount the MEK from a Secret. Leaving
`secretName` empty preserves the existing ConfigMap behavior.

No profile workload uses Vault annotations, Vault sidecars, or runtime package
downloads. The local credential Secret is testing convenience, not the future
generated-secret interface owned by OSMO-6594.

## Public Images

Use `nvcr.io/nvidia/osmo/<component>:6.3.1`. NVIDIA NGC lists 6.3.1 as the
current public OSMO container release and service chart 1.3.1 as the current
public chart release. The repository service chart is version 1.3.0, so the
umbrella depends on the local 1.3.0 chart while overriding its global image tag
to 6.3.1.

## Testing and Verification

A Bazel `sh_test` renders the real charts with Helm and checks observable
manifests:

- custom dependency and MEK Secret references reach every service workload;
- the dependency chart renders PostgreSQL, Valkey, RustFS, credentials, and the
  bucket initializer;
- the split control plus kind profiles render documented control components,
  omit embedded dependencies and compute components, use RustFS configuration,
  and contain no Vault annotations;
- enabling the unsupported compute plane fails with an actionable message.

Static verification runs the Bazel chart test, `helm lint`, `helm template`, and
`helm install --dry-run=client` for both charts.

Live verification first confirms the current kube context is a named local kind
context before every Kubernetes command. It then installs `osmo-deps`, waits for
its deployments and bucket Job, installs `osmo`, waits for control-plane
readiness, port-forwards the gateway, and calls `/api/version` and
`/api/workflow?limit=10&all_pools=true` with the development identity headers.

## Documentation and Delivery

Document the chart purpose, exact install commands, local credentials, supported
profile layering, REST verification, and non-production limitations. Add both
new deployment components to `AGENTS.md` and the chart index. After fresh final
verification, commit all scoped changes, push `agent/osmo-6592`, and create a
pull request against `main`.
