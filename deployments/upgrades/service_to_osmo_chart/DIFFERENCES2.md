# Independent staging render comparison

This is an independent comparison of the Kubernetes resources rendered for the
legacy staging `service` chart and the proposed staging `osmo` chart. It
summarizes material runtime and migration differences; YAML ordering, source
comments, generated checksums, explicit `namespace: default`, and ordinary
Helm ownership labels are treated as presentation noise.

No cluster or Argo CD operations were used. No Secret values were read. The
comparison is render-only and cannot establish that referenced Secrets exist or
that hook Jobs will succeed against staging.

## Inputs and reproduction

The supplied legacy artifact, `/tmp/staging-osmo-old.yaml`, was reproduced
byte-for-byte by rendering:

- Public chart commit
  `3159ff927ac40d96f67cd2214ec544a1e175f386`,
  `deployments/charts/service`.
- Internal values commit
  `404fac6b8b1ae56505361133e0fc4e1942c2f915`.
- Values, in order: `staging_values.yaml`, `staging_configs.yaml`,
  `staging_templates.yaml`, and `staging_pools.yaml`.
- Release `staging-osmo`, namespace `default`, Kubernetes version `1.30.0`.

The legacy output SHA-256 is
`039cedd9e5f2183799a65a6ba331a9c12ccf3e0519b6ad21f8994926aced6481`.

The proposed render used:

- Public chart commit
  `8b11894fd0254e1808dfd28917987db059469761`,
  `deployments/charts/osmo`.
- Internal worktree commit
  `6305ee7cc3673e18f54b47c50b9c8b7d18cfd559`.
- `charts_value/osmo/stg/staging_osmo_values.yaml`, whose last modifying commit
  and Argo-pinned values revision is
  `9531a23d587a6a880c118266a6941c99002b6a60`. The worktree file is byte-identical
  to that pinned revision.
- Release `staging-osmo`, namespace `default`, Kubernetes version `1.30.0`.

Both fresh `helm template` commands completed successfully.
The proposed output SHA-256 is
`dbbe6df7f2cb893e98b31a4558fde66a48895a897af5f32bace6953cdc323fc0`.

## Executive summary

The proposed render is not object-for-object identical to the legacy render,
but most differences are deliberate consequences of the chart migration. The
public endpoint, Ingress behavior, application images, resource requests and
limits, probes, HPA bounds and targets, Service ports, and all non-empty OSMO
configuration values are preserved.

| Area | Major rendered difference | Effect and assessment |
| --- | --- | --- |
| Workload identity | Ten same-named Deployments receive new immutable selectors; `osmo-service` becomes `osmo-api`. Services, HPAs, policies, RBAC, and gateway configuration follow the new identity. | **Intentional, operationally significant.** The controlled cutover must delete/recreate all legacy Deployments as documented; a normal patch cannot change selectors. |
| Credentials | Vault Agent annotations, projected Vault tokens, and seven Vault ConfigMaps disappear. Workloads instead reference typed Kubernetes Secrets and the existing per-location storage Secrets. | **Intentional, prerequisite-sensitive.** ESO-provided Secrets must be Ready before cutover. Existing storage and image-pull Secret mount paths are preserved exactly. |
| Internal TLS | Process-local `--ssl_self_signed` is replaced by mounted leaf certificates. Seven retained placeholder Secrets and a bootstrap hook are added; Envoy begins validating the internal CA and expected DNS identities. | **Intentional, must be verified.** First-sync hook ordering and generated certificate contents are critical. |
| Service authentication | Components gain `/etc/osmo/service-auth/authentication-config.json`; a scoped ServiceAccount, Role, RoleBinding, and database-to-Secret migration Job are added. | **Intentional, must be verified.** The migration Job must finish before workloads start. |
| Database migration | The pgroll ConfigMap and Job are renamed and ordered ahead of service-auth. The legacy render bundles nine migrations; the proposed chart bundles only the five OSMO 6.4 migrations needed on the guaranteed 6.3 baseline. Password delivery changes from Vault to a typed Secret. | **Resolved.** New download logic adds failure handling, retries, and arm64 support; migration success remains a cutover gate. |
| Scheduling and capacity | Legacy soft spreading is preserved with new selectors, and worker spreading now correctly selects worker pods. All HPA min/max values and metric targets are preserved. | **Resolved.** Router omits an explicit `replicas: 3`, but its unchanged HPA has `minReplicas: 3`; it may briefly begin at one replica before HPA reconciliation. |
| Networking | The ALB Ingress is semantically identical. Ten retained Services have identical types and ports; API is renamed, router remains headless, and the redundant logger headless Service is removed. | **Intentional/resolved.** Envoy uses equivalent namespace-local short DNS names and adds upstream certificate verification. |
| Resources and health | Every main container's resources and startup/readiness/liveness probes match the legacy render exactly. | **Resolved.** This includes the legacy authenticated API readiness probe and logger/agent probe timings. |
| Pod security | Pods gain RuntimeDefault seccomp, mostly disable automatic service-account tokens, and most application containers use read-only root filesystems with explicit writable `emptyDir` mounts. | **Intentional hardening.** API keeps its service-account token because it uses the Kubernetes API. |
| Configuration | The only `config.yaml` data differences are omission of 16 empty `default_exit_actions` maps and 68 empty `default_variables` maps. | **Resolved/allowed.** No fallback storage endpoints render, and `pools.default.platforms.default: {}` is present in both renders. |
| Monitoring and policies | Four policies and three PodMonitors select the new release-scoped labels; three policies and all monitors are renamed. Scrape cadence remains 15 seconds. | **Intentional.** Extra monitor fields merely make HTTP, 10-second timeout, and `honorLabels: false` explicit. |
| Image pull policy | Nine OSMO application workloads change from `Always` to `IfNotPresent`; Envoy and oauth2-proxy were already `IfNotPresent`. | **Needs an explicit decision.** The pinned OSMO tag is build-specific, so the immediate risk is low. If tags can be overwritten, existing nodes can retain stale images. |

## Detailed findings

### 1. Identity and lifecycle replacement

The render still contains 11 Deployments and eight HPAs. The API-related
objects change consistently:

| Legacy | Proposed |
| --- | --- |
| Deployment/Service/HPA `osmo-service` | Deployment/Service/HPA `osmo-api` |
| ConfigMap `osmo-service-configs` | ConfigMap `osmo-api-config` |
| Role/RoleBinding `osmo-service-configmap-events` | Role/RoleBinding `osmo-api-configmap-events` |
| Envoy clusters `osmo-service` and `osmo-service-jwks` | `osmo-api` and `osmo-api-jwks` |

All ten other Deployments keep their names but replace their legacy selectors
with `app.kubernetes.io/name: osmo`, the release instance, and a component
label. The matching Service, HPA, NetworkPolicy, PodMonitor, and topology-spread
selectors change with them. These associations are internally consistent, but
Deployment selectors are immutable.

### 2. Workload behavior retained

For every primary Deployment container:

- The proposed application image repository and tag equal the legacy image.
  Envoy's `envoyproxy/envoy:v1.35.10` is only made explicit as
  `docker.io/envoyproxy/envoy:v1.35.10`.
- CPU/memory requests and limits match exactly.
- Startup, readiness, and liveness probes match exactly.
- Node selectors and tolerations match exactly.
- HPA minima, maxima, utilization targets, and container metrics match. The API
  HPA changes only its target and container name from `osmo-service` to
  `osmo-api`.
- Application arguments match except for the intended credential,
  service-auth, TLS, and API component-name changes.

The new explicit `terminationGracePeriodSeconds: 30` is equal to Kubernetes'
legacy default. The main remaining policy question in this area is
`imagePullPolicy: Always` becoming `IfNotPresent` for API, agent,
delayed-job-monitor, gateway-authz, logger, MCP, router, UI, and worker.

### 3. Secret delivery and mount paths

The legacy Vault integration is removed from the chart render: Vault webhook
annotations, Vault audience tokens, and these ConfigMaps are gone:

`osmo-vault-agent-configmap`, `osmo-mcp-vault-agent-configmap`,
`osmo-gateway-oauth2-vault-configmap`,
`osmo-gateway-authz-vault-configmap`,
`osmo-gateway-envoy-vault-configmap`,
`osmo-router-vault-agent-configmap`, and
`osmo-ui-vault-agent-configmap`.

The proposed workloads reference purpose-specific Secret names for PostgreSQL,
Valkey, OAuth, the MEK, Envoy's external credential, and service authentication.
Those credential Secrets are dependencies; except for internal TLS placeholders
and the service-auth migration output, this chart does not create them.

The existing storage and image credential projections remain mounted on API,
agent, logger, and worker at exactly the legacy locations:

- `/etc/osmo/secrets/imagepullsecret`
- `/etc/osmo/secrets/osmo-workflow-app-cred`
- `/etc/osmo/secrets/osmo-workflow-data-cred`
- `/etc/osmo/secrets/osmo-workflow-log-cred`

The MEK remains at `/opt/osmo/mek`, although its Secret name changes from
`osmo-mek` to the ESO-provided `osmo-master-encryption-key`.

### 4. TLS, pgroll, and service-auth hooks

The proposed chart adds seven empty, retained internal-TLS Secret placeholders
at hook weight `-30`, followed by the TLS bootstrap at `-29`. Application,
router, agent, logger, and MCP processes switch from runtime self-signed
certificates to the generated leaf Secrets. Envoy receives a trust bundle and
validates the internal endpoints; the UI remains plain HTTP behind Envoy.

Pgroll changes from `pgroll-migration-files`/`pgroll-migrate-1` to
`osmo-pgroll-migrations`/`osmo-pgroll-migration`. The five retained OSMO 6.4
JSON migrations (`005` through `008`) are byte-identical to their legacy-chart
counterparts. The four pre-6.3 migrations (`001` through `004`) are
intentionally omitted because the source database is guaranteed to already be
on 6.3. The unused Bazel `BUILD` entry is no longer placed in the ConfigMap.
The runner's effective staging SSL mode remains `require`, while the new
implementation supports an explicit CA, detects amd64/arm64, retries the
download, and fails on HTTP errors.

The ordering rendered for the migration is:

1. TLS Secret placeholders: `-30`.
2. TLS bootstrap: `-29`.
3. Pgroll ConfigMap: `-26`.
4. Pgroll Job: `-25`.
5. Service-auth RBAC: `-20`.
6. Service-auth migration Job: `-10`.
7. Normal workloads.

This is a safer and more explicit lifecycle, but it introduces additional
cutover failure points. Successful hooks and the expected retained Secrets must
be checked before declaring the sync healthy.

### 5. Gateway, Services, policies, and monitoring

The `osmo-gateway` Ingress spec and every ALB annotation are identical. The
gateway Service continues to expose ports 80 and 443. For the ten retained or
renamed Services, type, port, target port, and headless/regular behavior match;
only selectors change. `osmo-router-headless` remains because Envoy ring-hash
routing consumes its pod endpoints. `osmo-logger-headless` is removed and the
regular `osmo-logger` Service is retained with the same port contract.

Envoy's route behavior is preserved, while internal clusters change from fully
qualified names such as `osmo-agent.default.svc.cluster.local` to equivalent
namespace-local names such as `osmo-agent`. The important behavioral addition
is validation of the generated internal CA and DNS identity.

All four NetworkPolicies still allow only the gateway Envoy selector to reach
API, router, UI, or MCP on port 8000. Names and selectors are updated to match
the new labels. The three PodMonitors similarly use the new labels and names,
but continue scraping every 15 seconds at the same ports and paths.

### 6. Service configuration

Both rendered `config.yaml` documents contain the same top-level sections and
the same shared non-empty leaves. There are exactly 84 differences:

- 16 omitted `default_exit_actions: {}` fields.
- 68 omitted platform `default_variables: {}` fields.

These are empty-map normalization differences. The previously missing,
addressable `pools.default.platforms.default: {}` entry is restored. The new
render does not contain explicit workflow data, log, or app storage endpoints;
the endpoint remains sourced only from the mounted per-location Secrets.

## Resource inventory

The proposed manifest contains 56 top-level YAML documents. Its TLS bootstrap
is a hook-annotated Kubernetes `List` containing four resources. Expanding that
List yields 59 concrete resources, compared with 52 legacy resources.

| Kind | Legacy | Proposed | Notes |
| --- | ---: | ---: | --- |
| ConfigMap | 10 | 3 | Seven Vault ConfigMaps removed; config and pgroll ConfigMaps renamed. |
| Deployment | 11 | 11 | Ten retained names plus `osmo-service` replaced by `osmo-api`. |
| HorizontalPodAutoscaler | 8 | 8 | API HPA renamed; bounds and metrics retained. |
| Ingress | 1 | 1 | Same name and behavior. |
| Job | 1 | 3 | Pgroll renamed; service-auth and TLS bootstrap added. TLS Job is inside the List. |
| NetworkPolicy | 4 | 4 | Three renamed, MCP name retained; selectors updated. |
| PodMonitor | 3 | 3 | All renamed; scrape behavior retained. |
| Role | 1 | 3 | API config Role renamed; service-auth and TLS bootstrap Roles added. TLS Role is inside the List. |
| RoleBinding | 1 | 3 | API config binding renamed; service-auth and TLS bootstrap bindings added. TLS binding is inside the List. |
| Secret | 0 | 7 | Internal TLS retained placeholders. |
| Service | 11 | 10 | API renamed; redundant logger headless Service removed. |
| ServiceAccount | 1 | 3 | Shared `osmo2` retained; two scoped hook accounts added. TLS account is inside the List. |
| List wrapper | 0 | 1 | Delivery wrapper for four TLS bootstrap resources; not an additional persisted object when expanded. |

## Items still requiring cutover verification or a decision

1. Decide whether staging should explicitly retain `imagePullPolicy: Always`
   or accept `IfNotPresent` with immutable, build-specific tags.
2. Verify all ESO-provided and retained credential Secrets are present with the
   required keys, without reading their values.
3. Verify the TLS bootstrap, pgroll, and service-auth migration hooks complete
   in the intended order.
4. Verify all recreated Deployments reach their HPA minima and have Service
   endpoints; specifically confirm router returns to at least three replicas.
5. Run API/authentication, MCP/OAuth, router/WebSocket, storage upload/download,
   log retrieval, and app upload/download smoke tests.

Apart from the image pull policy decision and runtime verification inherent to
the new Secret/TLS/hook lifecycle, this independent render comparison did not
find another unexplained material discrepancy.
