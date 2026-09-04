# Service chart to OSMO umbrella chart migration

This investigation is based on the repository state available on 2026-09-02.
It covers the three control-plane applications named `sqa`, `staging`, and
`prod` in the internal Argo CD configuration. The repository path in the
original request was slightly wrong: the public chart paths are
`deployments/charts/service` and `deployments/charts/osmo`.

The migration is **not currently a values-only, drop-in change**. The supplied
converter preserves settings that have a proven equivalent, but every current
environment still needs operator input before its output is deployable. In
particular, credentials must move from arbitrary Vault-injected files to typed
Kubernetes Secrets, and storage endpoints referenced only through Kubernetes
Secrets must be recovered from the live environment.

On 2026-09-03, read-only staging inspection established that all three staging
locations use Swift. This migration branch extends the umbrella chart to accept
Swift locations and reuse separate existing credential Secrets, resolving the
values-only storage gap without copying credential material.

Do not commit converted environment values or rendered manifests to this public
repository. They contain internal topology and may contain secret references.

## Exact source revisions

The parent Argo CD application at `argocd/argo/base/osmo-services.yaml` selects
`argocd/osmo` at `HEAD`. At the snapshot used here, the default branch and the
values branch both resolve to internal repository commit
`21e4b4d13004e4756938255460f290fd563c04ff`. The generated applications are
defined by `argocd/osmo/osmo.yaml` at that commit.

`targetRevision` values such as `main`, `release/6.3`, and `HEAD` are mutable.
The resolved commits below are the reproducibility boundary for this report.

| Environment | Legacy chart revision and resolved commit | Values revision and resolved commit | Values files, in Helm order |
| --- | --- | --- | --- |
| SQA | tag `6.4.0` → `08a56212565a93e8c95ece823692db191ad07899` | `main` → `21e4b4d13004e4756938255460f290fd563c04ff` | `charts_value/osmo/sqa/sqa_values.yaml`, `charts_value/osmo/sqa/sqa_configs.yaml` |
| Staging | `main` → `546b82179a50b0648fe8b7b6adb3784d685ced48` | `main` → `21e4b4d13004e4756938255460f290fd563c04ff` | `charts_value/osmo/stg/staging_values.yaml`, `staging_configs.yaml`, `staging_templates.yaml`, `staging_pools.yaml` |
| Prod | `release/6.3` → `b9a0497eff530572af0e1e7c59724221d43771b1` | `main` → `21e4b4d13004e4756938255460f290fd563c04ff` | `charts_value/osmo/prod/prod_6_3_values.yaml`, `prod_configs.yaml`, `prod_templates.yaml`, `prod_pools.yaml` |

The candidate umbrella chart used for comparison is
`deployments/charts/osmo` from public repository `main` at
`546b82179a50b0648fe8b7b6adb3784d685ced48`. This matters for production:
its old chart templates come from `release/6.3`, while the candidate templates
come from `main`. An explicit image tag in converted values does not make those
template revisions equivalent.

## Converter

`values_convert.py` accepts one or more legacy values files. Multiple files are
merged from left to right using Helm's map-merge/list-replace behavior:

```bash
python3 deployments/upgrades/service_to_osmo_chart/values_convert.py \
  legacy-values.yaml \
  --output umbrella-values.yaml
```

The default is fail-closed: if any value is ambiguous or unsupported, the
command exits 2 and emits no YAML. Diagnostics go to standard error, identify
paths rather than values, and are safe to retain in CI logs. To inspect the
proven partial conversion:

```bash
python3 deployments/upgrades/service_to_osmo_chart/values_convert.py \
  --allow-unmapped \
  legacy-values.yaml \
  --output umbrella-values.partial.yaml \
  2>conversion-report.txt
```

For Argo's split files, pass every environment file in the exact order shown in
the revision table. The converter processes explicit overrides, not the source
chart's implicit defaults. Always compare rendered manifests; chart-default
changes such as internal TLS, config defaults, and Service ports cannot be
derived from an override file alone.

### Values mapping

| Legacy service-chart value | Umbrella-chart value | Conversion behavior |
| --- | --- | --- |
| `global.osmoImageLocation` | `imageRegistry` + `imageRepository` | Registry and repository are split without changing the component suffixes. |
| `global.osmoImageTag` | `imageTag` | Direct. |
| `global.imagePullSecret` | `imagePullSecrets[]` | Converted to a named reference. |
| `global.hostname` | `externalUrl` + `ingress.hostname` | Adds `https://` when the legacy value is a hostname. |
| `global.logs` | `logging` | Direct. |
| `global.serviceAccountName` and `serviceAccount` | Per-component `serviceAccount` | One API-owned shared ServiceAccount is rendered so Argo prune does not delete it; other components reference it. |
| `services.postgres` | `embeddedDependencies.postgresql`, `externalDependencies.postgresql`, `secrets.postgresql` | Endpoint fields map. A compatible password Secret is mandatory for external PostgreSQL. |
| `services.migration` | `databaseMigration` | Map enablement, target schema, and scheduling explicitly. Replace legacy Vault credential delivery with the typed PostgreSQL Secret; the converter leaves a diagnostic for this review. |
| `services.redis` | `embeddedDependencies.valkey`, `externalDependencies.valkey`, `secrets.valkey` | Endpoint fields map. Legacy TLS defaults on; public-CA endpoints use the system trust store and private CAs use `caExistingSecret`. |
| `services.configs` | `configuration` | Supported configuration sections are copied. Storage subtrees are handled separately. |
| `extraConfigMaps` | `configuration.extraConfigMaps` | Direct. |
| `services.configs.workflow.workflow_{data,log,app}.credential` | `externalDependencies.objectStorage` + `secrets.objectStorage` | `s3://`, `azure://`, and `swift://` endpoints map. Existing per-location Secrets map to `credentialSecretRefs`; otherwise a shared credential document can be used. |
| `services.service` | `services.api` | Component rename plus field conversion. Snake-case auth keys become camel-case. |
| Component `scaling` | Component `autoscaling` | HPA bounds and metrics map; legacy always-on HPAs remain enabled. |
| Component `nodeSelector`, tolerations, labels, annotations, volumes, and sidecars | Component `pod.*` and `extraVolumeMounts` | Structural move. |
| Component image fields | Component `image.*` | Full third-party image references retain the Docker registry instead of inheriting the OSMO registry. |
| `gateway.envoy.ingress` | Root `ingress` | ALB convenience fields become their concrete annotations. |
| `gateway.envoy.service.httpsPort` | `gateway.envoy.service.extraPorts` | An explicit legacy alias maps to the same Envoy target port. The legacy default still requires render comparison because it is absent from override-only input. |
| `gateway.upstreams.service` | `gateway.upstreams.api` | The old default host is cleared so the chart derives the renamed `osmo-api` Service. |
| `gateway.networkPolicies` | `gateway.networkPolicies` | App-only selectors become release-scoped component selectors. |
| `gateway.*.scaling` | `gateway.*.autoscaling` | Envoy, OAuth2 Proxy, and Authz HPAs remain enabled. |
| `podMonitor.enabled` | `monitoring.podMonitor.control.enabled` | Direct for a control-only release. |
| `services.masterEncryptionKey`, `services.backendApiTokens`, `services.defaultAdmin` | Typed blocks under `secrets` | Compatible references map; legacy inline secret material is rejected. |

The following values intentionally produce findings instead of guesses:

- `services.configFile` and `services.configs.secretRefs`;
- `services.migration`, because credential delivery and scheduling must be
  reviewed before enabling `databaseMigration`;
- `services.configs.dataset`;
- LocalStack settings;
- storage schemes other than S3, Azure, and Swift;
- MCP's removed `services.mcp.oidcProxy`;
- OAuth and rate-limit Redis blocks, because those components share the one
  umbrella Valkey endpoint;
- OAuth `secretPaths` and any inline passwords;

## Reproduce the renders

The following commands avoid a checkout race by extracting exact commits. Set
the two repository paths for the local public and internal clones:

```bash
EXTERNAL_REPO=/path/to/NVIDIA-OSMO
CONFIG_REPO=/path/to/internal-osmo
RENDER_DIR="$(mktemp -d)"

mkdir -p \
  "${RENDER_DIR}/old-sqa" \
  "${RENDER_DIR}/old-staging" \
  "${RENDER_DIR}/old-prod" \
  "${RENDER_DIR}/new" \
  "${RENDER_DIR}/values"

git -C "${EXTERNAL_REPO}" archive \
  08a56212565a93e8c95ece823692db191ad07899 \
  deployments/charts/service | tar -x -C "${RENDER_DIR}/old-sqa"
git -C "${EXTERNAL_REPO}" archive \
  546b82179a50b0648fe8b7b6adb3784d685ced48 \
  deployments/charts/service | tar -x -C "${RENDER_DIR}/old-staging"
git -C "${EXTERNAL_REPO}" archive \
  b9a0497eff530572af0e1e7c59724221d43771b1 \
  deployments/charts/service | tar -x -C "${RENDER_DIR}/old-prod"
git -C "${EXTERNAL_REPO}" archive \
  546b82179a50b0648fe8b7b6adb3784d685ced48 \
  deployments/charts/osmo | tar -x -C "${RENDER_DIR}/new"
git -C "${CONFIG_REPO}" archive \
  21e4b4d13004e4756938255460f290fd563c04ff \
  charts_value/osmo | tar -x -C "${RENDER_DIR}/values"
```

Render the old state using Argo's application names as Helm release names and
the configured `default` namespace:

```bash
helm template sqa-osmo \
  "${RENDER_DIR}/old-sqa/deployments/charts/service" \
  --namespace default \
  -f "${RENDER_DIR}/values/charts_value/osmo/sqa/sqa_values.yaml" \
  -f "${RENDER_DIR}/values/charts_value/osmo/sqa/sqa_configs.yaml" \
  >"${RENDER_DIR}/sqa-old.yaml"

helm template staging-osmo \
  "${RENDER_DIR}/old-staging/deployments/charts/service" \
  --namespace default \
  -f "${RENDER_DIR}/values/charts_value/osmo/stg/staging_values.yaml" \
  -f "${RENDER_DIR}/values/charts_value/osmo/stg/staging_configs.yaml" \
  -f "${RENDER_DIR}/values/charts_value/osmo/stg/staging_templates.yaml" \
  -f "${RENDER_DIR}/values/charts_value/osmo/stg/staging_pools.yaml" \
  >"${RENDER_DIR}/staging-old.yaml"

helm template prod-osmo \
  "${RENDER_DIR}/old-prod/deployments/charts/service" \
  --namespace default \
  -f "${RENDER_DIR}/values/charts_value/osmo/prod/prod_6_3_values.yaml" \
  -f "${RENDER_DIR}/values/charts_value/osmo/prod/prod_configs.yaml" \
  -f "${RENDER_DIR}/values/charts_value/osmo/prod/prod_templates.yaml" \
  -f "${RENDER_DIR}/values/charts_value/osmo/prod/prod_pools.yaml" \
  >"${RENDER_DIR}/prod-old.yaml"
```

Run the converter with the same file sets. Add `--allow-unmapped` only to build
a comparison artifact; do not deploy partial output. Build the umbrella
dependencies using its checked-in `Chart.lock`:

```bash
helm dependency build "${RENDER_DIR}/new/deployments/charts/osmo"
```

Create a private `manual-values.yaml` containing the values the converter
reported. For a render-only comparison, placeholder names and locations can be
used as below. **This file is deliberately not deployable.** Replace every
placeholder with an existing, correctly formatted resource before any sync.

```yaml
externalDependencies:
  valkey:
    tls:
      caExistingSecret: migration-placeholder-valkey-ca
  objectStorage:
    locations:
      workflows: s3://migration-placeholder/workflows
      logs: s3://migration-placeholder/logs
      apps: s3://migration-placeholder/apps
    s3:
      region: us-east-1
      overrideUrl: ''
secrets:
  postgresql:
    existingSecret: migration-placeholder-postgresql
  valkey:
    existingSecret: migration-placeholder-valkey
  objectStorage:
    existingSecret: migration-placeholder-object-storage
  oauthClientSecret:
    existingSecret: migration-placeholder-oauth
  oauthCookieSecret:
    existingSecret: migration-placeholder-oauth
```

Render each candidate with the control profile, converted environment values,
and manual values, in that order:

```bash
helm template sqa-osmo "${RENDER_DIR}/new/deployments/charts/osmo" \
  --namespace default \
  -f "${RENDER_DIR}/new/deployments/charts/osmo/profiles/split-plane-control.yaml" \
  -f "${RENDER_DIR}/sqa-converted.yaml" \
  -f "${RENDER_DIR}/manual-values.yaml" \
  >"${RENDER_DIR}/sqa-new.yaml"
```

Repeat with `staging-osmo`/`staging-converted.yaml` and
`prod-osmo`/`prod-converted.yaml`. `helm template` proves rendering and schema
validation only. It cannot prove that referenced Secrets exist, that an ALB or
CNI implements the rendered objects, or that Argo hook ordering succeeds.

For a semantic comparison, first index each YAML stream by
`kind`, `metadata.namespace`, and `metadata.name`. Compare workload pod specs,
Services, HPAs, Ingresses, policies, and ConfigMap payloads separately. Treat
mapping order, generated checksums, chart labels, and document order as noise;
do not ignore names, selectors, Secret references, command arguments, ports,
or hook annotations. A useful first inventory is:

```bash
python3 - "${RENDER_DIR}/sqa-old.yaml" "${RENDER_DIR}/sqa-new.yaml" <<'PY'
import collections
import pathlib
import sys
import yaml

for manifest in sys.argv[1:]:
    documents = [document for document in yaml.safe_load_all(
        pathlib.Path(manifest).read_text(encoding='utf-8'))
                 if isinstance(document, dict)]
    counts = collections.Counter(document.get('kind') for document in documents)
    print(manifest, len(documents), dict(sorted(counts.items())))
PY
```

Keep the complete normalized diff in a private review artifact. ConfigMap data
and pod arguments reveal internal endpoints even when they contain no password.

## Render findings

The partial candidate renders used the exact revisions above and only the
render-only placeholders shown earlier. The converter explicitly disables the
five PDBs enabled by the control profile so that the comparison retains the old
availability behavior; enabling those PDBs later is recommended but is a
separate operational change.

| Environment | Old top-level documents | New top-level documents | Workloads and autoscaling |
| --- | ---: | ---: | --- |
| SQA | 47 | 52 | 10 Deployments and 8 HPAs in both; all HPA min/max bounds preserved. |
| Staging | 52 | 58 | 11 Deployments and 8 HPAs in both; all HPA min/max bounds preserved. |
| Prod | 51 | 57 | 11 Deployments and 9 HPAs in both; all HPA min/max bounds preserved. |

The umbrella chart emits its internal-TLS bootstrap resources as a `List`, so
the document counts understate the logical resource count by three. Ordering
and generated checksum differences were ignored. The following differences are
meaningful.

### Common to all environments

- `fullnameOverride: osmo` retains the old `osmo-*` prefix and the converter
  retains the shared `osmo2` ServiceAccount. The API resources still change
  from `osmo-service` to `osmo-api`; selectors and standard labels also become
  release-scoped. This is a replacement, not an in-place Deployment rollout.
- The gateway Ingress class, seven ALB annotation keys, hostname, and lack of a
  Kubernetes TLS section are preserved. The old ClusterIP Service exposes
  ports 80 and 443; the umbrella gateway exposes port 80 only. Confirm no
  in-cluster caller uses port 443, or add an intentional `extraPorts` mapping.
- The old process-local `--ssl_self_signed` mode is replaced by six stable
  internal-TLS Secrets, a bootstrap hook, and mounted leaf/CA material (seven
  Secrets when MCP is enabled). The first upgrade must set
  `gateway.tls.generated.bootstrap.allowInitialGeneration=true` once, verify
  the retained Secrets, then set it back to `false`.
- PostgreSQL and Valkey passwords become typed Secret environment variables.
  The current Vault file injection is not an equivalent input. A public-CA
  Valkey endpoint retains the system trust store; configure a CA Secret only
  for a private CA.
- The chart rewrites the three workflow credential subtrees while preserving
  sibling storage settings such as `base_url`, timeouts, and download mode. It
  can consume one
  shared object-storage credential document or three existing per-location
  Secrets.
- The stable service-auth JWT identity is now a required Secret mounted in all
  consumers. Use the umbrella chart's documented DB-to-Secret migration hook;
  generating a new identity would invalidate existing tokens.
- The MEK must be an existing typed Secret. Confirm whether the live legacy
  identity is `osmo-mek`, `osmo-master-encryption-key`, or a Vault-projected
  file before changing ownership. Never bootstrap a new MEK against the
  retained database.
- The umbrella chart provides `databaseMigration` for the legacy pgroll
  lifecycle. It packages the ordered migrations, reads the typed PostgreSQL
  Secret, and runs as a Helm pre-install/pre-upgrade or Argo PreSync hook before
  the service-auth migration. Enable it for SQA or staging when their legacy
  values enable `services.migration`; production currently leaves it disabled.
- Core images, HPA metric types, HPA bounds, and the numbers of Deployments,
  Services, HPAs, Ingresses, NetworkPolicies, and PodMonitors are otherwise
  preserved by the converted values. The new chart adds read-only-root and
  runtime-directory security conventions and changes the API readiness probe;
  validate any Vault sidecars against the hardened pod contexts.
- The control profile would add five PDBs. The candidate values disable them to
  keep the old rendered state. Adopt them only after checking disruption
  budgets against each environment's minimum replicas and maintenance process.

### SQA

- The source chart is the `6.4.0` tag, not `main`.
- All three storage endpoints exist only inside referenced Secrets, so the
  provider and URI scheme cannot be established from Git.
- The values contain an API-specific Ingress block as well as the gateway
  Ingress block. Only the gateway Ingress currently renders; the API-specific
  block is not carried forward.
- `services.configs.dataset` is stale at the selected source chart: it does not
  appear in the old rendered ConfigMap. Remove it after confirming no external
  process reads the values file directly.
- The source chart supplies an empty workflow label policy by default, while
  the umbrella control profile explicitly removes it. Add the required policy
  to the replacement values rather than relying on either default.

### Staging

- Enable `databaseMigration` with `targetSchema: public`. The pgroll Job uses
  `osmo-postgresql-credentials/db-password`, retains the service-node selector
  and toleration, and runs at Argo wave `-25` before service-auth at `-10`. It
  downloads pgroll `v0.16.1` at runtime, so verify outbound GitHub HTTPS before
  the maintenance window.
- The selected values use the existing service-auth migration path with
  `secrets.serviceAuth.managementMode=external`,
  `existingSecret.name=osmo-service-auth`,
  `existingSecret.key=authentication-config.json`, bootstrap disabled, and
  migration enabled. Before syncing `staging-osmo`, stop all legacy API
  writers, confirm the `osmo-master-encryption-key` and PostgreSQL credential
  Secrets are ready, and create the release-authorized empty placeholder:

  ```bash
  kubectl create secret generic osmo-service-auth -n default
  kubectl annotate secret osmo-service-auth -n default \
    osmo.nvidia.com/service-auth-db-migration-placeholder=staging-osmo
  ```

  The Argo CD `PreSync` hook then copies the stable DB-backed JWT identity into
  `authentication-config.json`, preserving existing tokens. After the new API
  is ready and token continuity is verified, set
  `secrets.serviceAuth.migration.enabled=false`. Retain the legacy DB row and
  MEK through the rollback window.
- MCP is enabled. Current main uses FastMCP's built-in OIDC proxy. Preserve the
  legacy OIDC discovery URL, client ID, v1 access-token issuer, scope, token
  lifetimes, Redis database `14`, `staging:mcp-fastmcp` key prefix, timeouts,
  and allowed origins. Use `osmo-oauth-credentials/client_secret` for the OIDC
  client and the chart's effective
  `osmo-valkey-credentials/redis-password` reference for Redis; do not combine
  or duplicate them in ESO.
- Read-only inspection on 2026-09-03 established that all three storage
  endpoints use `swift://` and that `osmo-workflow-data-cred`,
  `osmo-workflow-log-cred`, and `osmo-workflow-app-cred` contain the expected
  per-field credentials. The migration reuses those Secrets through
  `secrets.objectStorage.credentialSecretRefs`.
- The OAuth2 Proxy currently uses Valkey database 3 while the control services
  use database 0. Preserve this with `gateway.oauth2Proxy.redisDatabase: 3`;
  moving sessions to database 0 would log users out.
- Dataset values are stale at the selected source chart and the workflow label
  policy has the same default drift as SQA.

### Production

- The source chart is `release/6.3`, not `main`.
- Workflow data, logs, and apps use `swift://`. The migration branch adds Swift
  URI validation and per-location Secret references. Production still needs a
  live Secret inventory before those references can be configured; the S3
  placeholders used in the original comparison are not a proposed migration.
- The old rendered ConfigMap includes the dataset section. The umbrella chart
  does not render it, so this is a real production feature gap rather than a
  stale-values cleanup.
- The release/6.3 agent includes a `logrotate` sidecar and
  `osmo-agent-logrotate` ConfigMap. The umbrella candidate has neither. Confirm
  the newer agent image has an equivalent retention strategy or add one before
  rollout.
- Rate limiting remains enabled, but the new rate-limit pod always reads
  `REDIS_AUTH` from `secrets.valkey`. Confirm the production Valkey credential
  and TLS CA work for both the core services and the rate limiter.
- Production uses mainline umbrella templates with 6.3-tagged images. Run the
  complete regression suite; matching images does not remove template/config
  compatibility risk.

## Azure object-storage safety

If the recovered SQA or staging endpoints use Azure Blob Storage, verify both
layers before migration. A private container alone is insufficient:

1. The authoritative infrastructure must set account-level anonymous blob
   access off (`allowBlobPublicAccess: false`, or
   `allow_nested_items_to_be_public = false` in AzureRM Terraform).
2. Every referenced container must be private.
3. The live account check must return the literal value `false`:

```bash
az storage account show --ids "${STORAGE_ACCOUNT_ID}" \
  --query allowBlobPublicAccess -o tsv
```

Do not proceed on an empty, `null`, or `true` result. The converter does not
create or modify Azure resources and cannot perform this live verification.

## Migration sequence

1. Freeze the Argo application definition, chart revision, and values revision
   to reviewed commit hashes. Set staging's ApplicationSet `automatedSync` value
   to `false`; when the parent `argocd/` Application reconciles it, confirm the
   generated `staging-osmo` Application has no automated sync while SQA and
   production retain it. Do not migrate against moving `main`/`HEAD` refs.
2. Take a tested database, MEK, service-auth, and credential backup. For
   releases that used the legacy migration, enable `databaseMigration` and
   verify its PostgreSQL Secret key, scheduling, and GitHub egress.
3. Recover storage endpoints from the mounted Secrets. Reuse all three existing
   credential Secrets through `credentialSecretRefs`, or build one compatible
   object-storage Secret per namespace, and validate access with least
   privilege.
4. Create typed PostgreSQL, Valkey, object-storage, OAuth client, OAuth cookie,
   and MEK Secrets. Add a Valkey CA Secret only for a private CA. Confirm secret
   keys match the chart contract.
5. Convert the exact values set. Resolve every diagnostic; do not deploy with
   `--allow-unmapped` output alone.
6. Render again with no placeholders. Perform the semantic comparison and run
   `helm lint` plus the umbrella chart tests.
7. Follow the chart's database and service-auth migration procedures: create
   and authorize the service-auth placeholder Secret and enable both required
   hooks for the first upgrade. Verify all other prerequisites before deleting
   workloads.
8. Start the maintenance window. Delete the ten legacy Deployments whose
   selectors are replaced, plus `osmo-service` so no old API database writer
   remains. Manually sync `staging-osmo` once with pruning enabled. Pgroll must
   complete before the service-auth migration starts, and `PruneLast=true` must
   leave obsolete resources until replacements are healthy. Verify every
   rollout, HPA recreation, ALB health, login/token continuity, workflow
   submit/log/data paths, router WebSockets, Authz, rate limiting, and the final
   prune set.
9. Disable the service-auth migration and one-time TLS generation flags,
   manually sync, and verify again. Then restore staging `automatedSync: true`
   in a separate reviewed commit. Retain the old DB identity, MEK, and
   chart/value commits for the rollback window.
10. Migrate one non-production environment first. Production remains blocked
    until its credential inventory, dataset, and log-rotation behavior have
    explicit resolutions.

Rollback is not a Helm values rollback alone: the service name, stable TLS
Secrets, service-auth authority, and config credential layout cross the chart
boundary. Preserve both exact chart revisions and all old Secrets until the
rollback window closes.
