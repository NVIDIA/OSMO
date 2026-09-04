# Staging service-chart migration differences

This is the decision ledger for moving staging from the legacy `service` chart
to the umbrella `osmo` chart. It records material behavioral differences, not
formatting, Helm ordering, generated checksums, or equivalent image-reference
normalization.

The initial comparison uses the legacy staging render, the proposed umbrella
render, and a read-only inspection of the live staging cluster on 2026-09-03.
The old and new renders contain the same counts of Deployments, Services, and
HPAs, but those resources are not identical. In particular, selectors, pod
specs, security settings, secret delivery, and lifecycle jobs differ.

## Decision states

- **Pending**: we have not chosen an action.
- **Fix chart**: change the public umbrella chart.
- **Fix values**: change the internal staging values.
- **Migration procedure**: handle the difference during the cutover.
- **Allow**: accept and document the new behavior.
- **Verify**: the intended behavior is known but needs a targeted test.

## Summary

| ID | Area | Material difference | Risk | Decision |
| --- | --- | --- | --- | --- |
| D1 | Workload identity and replacement | Ten same-named Deployments change immutable selectors; `osmo-service` is replaced by `osmo-api`. Service selectors and HPA targets change with them. | A normal Argo apply cannot patch the ten immutable selectors. | **Migration procedure:** accept a traffic interruption and explicitly delete/recreate the Deployments. |
| D2 | Secret and authentication delivery | Every live OSMO pod currently receives Vault Agent init and sidecar containers. The proposed deployment removes Vault injection and consumes Kubernetes Secrets synchronized separately, including a one-time service-auth migration. | Incorrect ordering, stale synchronized Secrets, or lost token continuity can prevent startup or authentication. Secret rotation behavior changes from live file updates to Secret-triggered rollouts. | **Allow / fix chart:** retain ESO ownership and typed delivery; preserve the existing Kubernetes Secret mount paths, including adding the missing backend-image credential projection. |
| D3 | Internal TLS | Services stop generating process-local self-signed certificates and instead use generated CA/leaf Secrets with upstream certificate verification. A bootstrap hook and seven TLS Secrets are added. | First-sync ordering and retained Secret ownership must work; a bad CA/SAN configuration can break all internal calls. | **Allow / migration procedure:** use chart-generated TLS, permit initial generation once, verify it, and then restore fail-if-missing behavior. |
| D4 | MCP authentication boundary | Current main uses FastMCP's built-in OIDC proxy, but the converted values omit its required settings and the chart initially expects one combined OIDC/Valkey Secret while ESO provides separate typed Secrets. | The staging umbrella render fails without the values; accepting chart defaults would also change the Redis database and session-key prefix. | **Fix chart / values:** consume the effective Valkey Secret separately and preserve all 19 legacy MCP settings. |
| D5 | Scheduling and availability | Topology spread constraints disappear for API, agent, logger, router, worker, and UI. HPA min/max values and metric targets are otherwise preserved. | Reduced zone/host spreading can increase correlated disruption. Restoring worker behavior needs care because its legacy constraint selects API pods rather than worker pods. | **Fix values:** restore the legacy soft spread intent per component and correct worker to select worker pods. |
| D6 | Resources, probes, and pod hardening | Resource settings change for agent, logger, delayed-job-monitor, and Envoy. The API readiness endpoint changes. Pods gain seccomp, mostly disable service-account token automounting, use read-only root filesystems, and add writable runtime volumes where required. | Lower requests may alter scheduling/capacity; stricter filesystems may expose runtime assumptions; the new readiness endpoint has different coverage. | **Fix values / allow:** preserve legacy resources and probes; accept the umbrella pod hardening. |
| D7 | Gateway, policies, and monitoring | The Ingress and gateway ports are preserved, but gateway upstream names/addresses, Service selectors, NetworkPolicy names/selectors, and PodMonitor names/selectors change. Scrape interval changes from 15s to 30s. Upstream TLS validation is added. | Policies and monitors are recreated; dashboards or alerts may depend on scrape cadence or object names. | **Fix chart / allow / pending:** preserve the legacy 15-second scrape interval, accept release-scoped resource identity, and decide gateway routing separately. |
| D8 | Database and Argo lifecycle | The legacy pgroll migration Job and migration-files ConfigMap disappear. New TLS and service-auth hooks/RBAC appear, while Argo prunes the old Vault ConfigMaps and old API resources. | Schema migration must be completed before cutover, and hook/app synchronization must be explicitly ordered. | **Pending** |
| D9 | Configuration and storage representation | The generated service configuration retains the same major sections, but empty maps are pruned and storage credentials become explicit per-location Secret references and endpoints. | Empty maps are probably inert, but storage data/log/app operations require an end-to-end verification before allowing the difference. | **Pending** |
| D10 | Pinned revisions | The internal staging Application must pin the rebased chart-only commit and a reachable rebased internal values commit. | Later decisions would otherwise be tested against a stale candidate. | **Fix values:** refresh after each accepted chart or values change. |

## D1: Workload identity and replacement

### Evidence

- Both renders contain 11 Deployments. Ten keep their names, while the API
  changes from `osmo-service` to `osmo-api`.
- All ten same-named Deployments replace their legacy selector with the
  umbrella chart's release-scoped standard labels.
- A Kubernetes Deployment selector is immutable. The staging Argo Application
  does not currently request per-resource replacement, so a normal sync will
  fail when it reaches these objects.
- Services use matching new selectors. The gateway Ingress continues to point
  to the stable `osmo-gateway` Service, and the gateway Service continues to
  expose ports 80 and 443.
- The API rename is a deliberate replacement. Its Service, HPA, configuration
  ConfigMap, Role, and RoleBinding are renamed consistently.

### Options

1. **Add a chart migration compatibility mode.** Keep the legacy
   immutable Deployment selectors for same-named workloads while adding the
   umbrella standard labels to their pod templates. New Services, policies,
   and monitors can continue selecting the standard labels. The compatibility
   mode must stay enabled until a later planned Deployment replacement.
2. **Delete or replace the ten Deployments during the maintenance window
   (selected).**
   Keep the chart unchanged and document explicit Argo replacement or manual
   deletion/recreation. This is simpler code but creates a broad simultaneous
   control-plane disruption and needs careful sequencing.
3. **Use a parallel release identity.** Deploy all umbrella workloads under new
   names and cut traffic over after validation. This provides the cleanest
   rollback boundary but requires more value/chart changes and avoiding shared
   resource ownership conflicts.

### Decision

**Migration procedure.** A brief traffic interruption is acceptable. Do not
add selector compatibility to the umbrella chart. Explicitly delete and
recreate the ten same-named Deployments during a controlled manual sync.

### Actions

- Before changing the desired chart, pause automated synchronization for the
  staging Application. The exact pause/resume mechanism will be settled with
  the broader Argo sequencing in D8.
- After the new desired manifests and all prerequisite Secrets are available,
  delete these legacy Deployments:
  `osmo-agent`, `osmo-delayed-job-monitor`, `osmo-gateway-authz`,
  `osmo-gateway-envoy`, `osmo-gateway-oauth2-proxy`, `osmo-logger`, `osmo-mcp`,
  `osmo-router`, `osmo-ui`, and `osmo-worker`.
- Manually sync the staging Application and wait for all 11 umbrella
  Deployments, their Service endpoints, and all eight HPAs to become healthy.
- Resume automated synchronization only after the D2, D3, and D8 hook and
  Secret checks pass.
- Rollback must also delete the ten same-named umbrella Deployments before
  syncing the legacy chart, because the selector immutability applies in both
  directions. Remove `osmo-api` and restore `osmo-service` through the legacy
  sync.

## D2: Secret and authentication delivery

### Evidence

- Every live OSMO pod has a `vault-agent-init` init container and a
  `vault-agent` sidecar injected by the Vault webhook.
- The proposed umbrella workloads have no Vault annotations, projected Vault
  service-account token, init container, or sidecar. They consume typed
  Kubernetes Secrets instead.
- The proposed separate External Secrets application creates five typed target
  Secrets for PostgreSQL, Valkey, OAuth, the master encryption key, and an
  Envoy upstream credential. It refreshes them from the existing
  `ClusterSecretStore` every five minutes. The store exists and currently
  reports Ready.
- The three existing per-location object-storage Secrets are retained and are
  not copied or owned by the External Secrets application.
- No automatic Secret rollout controller is installed. ESO can update a
  Kubernetes Secret, but values sourced into environment variables remain old
  until the pod restarts. The umbrella chart provides explicit `rolloutNonce`
  values for controlled restarts.
- The ExternalSecret sync wave orders resources only inside its own Argo
  Application. It does not order that Application ahead of the OSMO
  Application.
- The proposed ExternalSecrets use `creationPolicy: Owner`. Removing an
  ExternalSecret can therefore garbage-collect its target Secret even though
  provider-side deletion uses `deletionPolicy: Retain`.
- The object-storage credential Secrets remain mounted on API, agent, logger,
  and worker at `/etc/osmo/secrets/<secret-name>`, the MEK remains mounted at
  `/opt/osmo/mek`, and configuration remains mounted at `/etc/osmo/configs`.
- The generated configuration still refers to the backend-image credential as
  `secretName: imagepullsecret` and `secretKey: .dockerconfigjson`. The legacy
  chart mounts that Secret at `/etc/osmo/secrets/imagepullsecret`, but the
  proposed umbrella render does not. The configuration loader resolves these
  references below `/etc/osmo/secrets`, so this is a functional chart gap.
- PostgreSQL and Valkey credentials become environment variables. OAuth and
  Envoy credentials become purpose-specific file mounts. These replace
  Vault-rendered files rather than moving an existing Kubernetes Secret
  projection; their typed interfaces are part of the accepted ESO transition.

### Options

1. **Complete the ESO transition with an explicit two-phase cutover
   (selected).** Sync and verify the External Secrets application first, then
   sync OSMO. Keep rotation deliberate by changing the relevant
   `rolloutNonce`; do not add another rollout controller. Keep the proposed
   ExternalSecrets and their target Secrets owned by ESO with
   `creationPolicy: Owner`.
2. **Use ESO plus an automatic rollout controller.** This reduces stale
   environment-variable risk after rotation but adds a new cluster dependency
   and can restart many control-plane components together.
3. **Retain Vault Agent injection in the umbrella workloads.** This preserves
   the current delivery mechanism but works against the umbrella chart's typed
   Secret contract and retains one init and sidecar container per pod.

### Decision

**Allow / fix chart.** Use the proposed ESO resources unchanged, including
`creationPolicy: Owner`. Do not add a rollout controller or retain Vault Agent
injection. Existing configuration-referenced Kubernetes Secrets must remain
mounted at the same paths used by the legacy workloads. The typed ESO
credentials use the umbrella chart's environment-variable and purpose-specific
file interfaces.

### Actions

- Sync the External Secrets application by itself and require all five
  ExternalSecrets to be Ready before starting D1's Deployment replacement.
- Validate the required key names without reading or logging Secret values.
- Confirm the three existing storage Secrets remain unmanaged and present.
- Fix the umbrella chart to project the configured backend-image credential
  key at `/etc/osmo/secrets/<secret-name>` on API, agent, logger, and worker,
  deduplicating the volume if it shares a Secret with a storage credential.
- Render the staging values and compare the configuration, storage, MEK, and
  backend-image Secret mount paths against the legacy render.
- Document a rotation matrix mapping each typed Secret to its
  `rolloutNonce` and affected Deployments.
- Keep the service-auth placeholder and database extraction as a separate
  one-time step coordinated under D8.

## D3: Internal TLS

### Evidence

- The legacy services use process-local `--ssl_self_signed` certificates. The
  umbrella chart instead mounts stable leaf Secrets and makes Envoy validate
  each upstream certificate against a generated trust Secret and an exact DNS
  subject alternative name.
- With MCP enabled, the bootstrap hook manages seven retained Secrets:
  `osmo-internal-tls-ca`, `osmo-internal-tls-trust`,
  `osmo-internal-tls-api`, `osmo-internal-tls-router`,
  `osmo-internal-tls-agent`, `osmo-internal-tls-logger`, and
  `osmo-internal-tls-mcp`.
- The hook's RBAC can update only those named Secrets. The bootstrap Job runs
  before install or upgrade workloads and checks each TLS consumer Deployment.
- Staging already sets `gateway.tls.enabled=true`, generated TLS enabled, and
  `gateway.tls.generated.bootstrap.allowInitialGeneration=true`. The last
  value prevents the first upgrade from failing merely because the stable
  Secrets do not exist yet.
- The generated Secrets use the keep resource policy, so rollback to the
  legacy chart does not remove them. The legacy workloads ignore them.

### Options

1. **Use chart-generated stable internal TLS (selected).** Allow the bootstrap
   to create the initial CA, trust bundle, and leaves once, then restore strict
   missing-Secret failure for subsequent syncs.
2. **Provision certificates externally.** Disable generated TLS and configure
   a trust Secret plus one correctly signed leaf Secret per enabled upstream.
   This is viable but adds a certificate operator and SAN provisioning task to
   the staging migration.
3. **Disable internal TLS.** This removes certificate bootstrap risk but is a
   transport-security regression and does not preserve the legacy
   process-local TLS behavior.

### Decision

**Allow / migration procedure.** Keep the proposed chart-generated TLS model.
Use `allowInitialGeneration=true` only for the first umbrella sync. After all
seven Secrets and consumers are healthy, set it to `false`; later missing
Secrets must stop the sync rather than silently create a new trust identity.

### Actions

- Keep `gateway.tls.generated.bootstrap.allowInitialGeneration=true` through
  the initial controlled sync.
- Require the bootstrap hook to succeed before replacing the legacy
  Deployments. Confirm all seven retained Secrets exist and expose the expected
  key names without reading or logging their values.
- Verify the rendered leaf identities match `osmo-api`,
  `osmo-router-headless`, `osmo-agent`, `osmo-logger-headless`, and `osmo-mcp`.
- Wait for the API, router, agent, logger, MCP, and Envoy Deployments to become
  available. Exercise API and MCP requests through Envoy and check that Envoy
  reports no upstream certificate or SAN validation failures.
- Change `allowInitialGeneration` to `false` after the successful first sync
  and sync again. Confirm the bootstrap runs in fail-if-missing mode and reuses
  the retained Secrets.
- Do not remove these Secrets during rollback. Use the chart's documented leaf
  nonce and phased CA rotation procedure for future rotations.

## D4: MCP authentication boundary

### Evidence

- The legacy MCP Deployment already uses FastMCP's built-in OIDC proxy. Its 19
  managed `OSMO_MCP_*` and gateway environment settings define the resource
  URL, allowed browser origins, OIDC client and issuer, token lifetimes, Redis
  session store, and timeouts.
- Current main makes those settings first-class chart values. The converted
  staging file predates that contract: its `authorizationServers` and `scopes`
  fields are obsolete, while required OIDC values are absent, so the chart
  does not render.
- The legacy Redis session database is `14` and its key prefix is
  `staging:mcp-fastmcp`. The new chart defaults are database `1` and prefix
  `osmo:mcp-fastmcp`; accepting them could strand existing sessions and mix
  staging's keys with another consumer.
- ESO already owns `osmo-oauth-credentials/client_secret` and
  `osmo-valkey-credentials/redis-password`. They contain the same Vault
  properties used by the old MCP Vault Agent files. The chart initially allows
  only one combined Secret for both files.
- The existing Envoy JWT provider for the legacy access-token issuer already
  covers the MCP resource audience. The chart can append that audience without
  introducing another authentication boundary.

### Options

1. **Consume the existing OAuth and Valkey Secrets separately (selected).**
   Keep the MCP-specific OIDC Secret reference and source its Redis password
   from the chart's effective Valkey Secret. Preserve compatibility for users
   that already keep both keys in one Secret.
2. **Add another ESO target Secret combining both values.** This fits the
   original chart input but duplicates credentials and changes the ESO
   resources that were explicitly accepted in D2.
3. **Use the chart defaults or omit Redis authentication.** This changes the
   session namespace and cannot connect reliably to the protected staging
   Valkey service.

### Decision

**Fix chart / values.** Keep MCP's existing FastMCP OIDC authentication model.
Leave ESO unchanged. Mount the OIDC client key from `osmo-oauth-credentials`
and the Redis password key from `osmo-valkey-credentials`, while retaining the
chart's combined-Secret compatibility path. Preserve all legacy non-secret MCP
settings exactly.

### Actions

- Make the chart source the MCP Redis password from the effective Valkey
  Secret when `services.mcp.oidcProxy.existingSecret.redisPasswordKey` is
  empty. Retain the combined-Secret behavior when that key is configured.
- Add the OAuth-client and Valkey rollout nonces to the MCP Pod template so a
  deliberate Secret rotation restarts MCP.
- Configure staging's OIDC discovery URL, client ID, v1 access-token issuer,
  required scope, token lifetimes, timeouts, allowed origins, Redis database
  `14`, and `staging:mcp-fastmcp` prefix from the legacy Deployment.
- Point the OIDC client reference at
  `osmo-oauth-credentials/client_secret`; use the already configured effective
  Valkey reference `osmo-valkey-credentials/redis-password`.
- Render the full staging release and compare all 19 managed MCP environment
  settings with the legacy Deployment, normalizing only the accepted typed
  Secret file paths.
- During cutover, verify protected-resource and authorization-server metadata,
  browser-origin rejection, access-token and refresh-token flows, and Redis
  session continuity across an MCP restart.

## D5: Scheduling and availability

### Evidence

- The legacy API, agent, logger, router, and worker Deployments have a soft
  zone topology spread constraint. The legacy UI has both soft hostname and
  zone constraints. All use `maxSkew: 1` and
  `whenUnsatisfiable: ScheduleAnyway`.
- The initial staging umbrella render omits all six workloads' constraints
  because the combined staging values do not inherit the split-plane control
  profile's pod defaults.
- The legacy worker constraint selects `app: osmo-service`, so it measures API
  pods rather than the worker pods being scheduled. Preserving that selector
  would not preserve useful worker-spreading behavior.
- The eight HPA specs otherwise match after normalizing the deliberate API
  rename from `osmo-service` to `osmo-api`, including replica bounds,
  container targets, resource metrics, and 80-percent utilization targets.
- The umbrella chart's topology helper accepts per-component constraints and
  replaces their selectors with the same standard labels used by each
  Deployment selector.

### Options

1. **Restore the legacy spread intent per component (selected).** Configure
   the old topology keys and soft policy in staging values, allowing the chart
   helper to generate component-correct selectors. This also repairs worker's
   ineffective legacy selector.
2. **Leave the constraints absent.** This simplifies the generated pod specs
   but gives the scheduler no preference to distribute replicated control
   services across zones or UI pods across hosts.
3. **Use hard spreading.** Changing to `DoNotSchedule` would provide stronger
   failure-domain guarantees, but it is a new availability policy that can
   prevent scheduling when capacity or topology labels are constrained.

### Decision

**Fix values.** Restore soft zone spreading for API, agent, logger, router,
and worker, and restore both soft hostname and zone spreading for UI. Keep
`maxSkew: 1` and `ScheduleAnyway`. Use the umbrella chart's generated
per-component selectors, intentionally correcting worker to count worker pods
instead of API pods. Do not change the public chart.

### Actions

- Add per-component `pod.topologySpreadConstraints` to the internal staging
  values for the six affected workloads.
- Render the complete staging release and verify that each generated
  constraint selector exactly matches its Deployment selector.
- Compare all topology keys, skew values, and unsatisfiable policies with the
  legacy render, treating worker's component-correct selector as the intended
  fix.
- Compare the eight old and new HPA specs after normalizing only the deliberate
  API resource and container rename.

## D6: Resources, probes, and pod hardening

This area is split into separate decisions so resource sizing, health
semantics, and security hardening can be evaluated independently.

### Resource sizing

#### Evidence

- The initial umbrella render lowers agent requests from `500m` CPU and
  `500Mi` memory to `100m` and `256Mi`, while retaining its `1Gi` memory
  limit.
- Logger requests fall from `1` CPU and `1Gi` memory to `100m` and `256Mi`,
  while retaining its `1Gi` memory limit.
- Delayed-job-monitor requests fall from `1` CPU and `1Gi` memory to `100m`
  and `512Mi`, and its memory limit falls from `1Gi` to `512Mi`.
- Envoy requests fall from `200m` CPU and `128Mi` memory to `50m` and `64Mi`,
  while its memory limit rises from `256Mi` to `512Mi`.
- Agent, logger, and Envoy HPAs retain 80-percent utilization targets. Lower
  requests would therefore make them scale at lower absolute CPU and memory
  usage even though the HPA specs themselves are unchanged.

#### Decision

**Fix values.** Preserve the legacy resource requests and limits for all four
components. Resource tuning and autoscaling behavior should not change as part
of the chart migration.

#### Actions

- Set explicit legacy resources for agent, logger, delayed-job-monitor, and
  Envoy in the internal staging values.
- Render the complete staging release and compare every application-container
  resource block with the legacy render after normalizing the API rename.
- Reconfirm all eight HPA specs remain unchanged after the values update.

### API readiness probe

#### Evidence

- The legacy API readiness probe queries
  `/api/workflow?limit=0&all_pools=true` over HTTPS and supplies
  `x-osmo-roles: osmo-admin`. This exercises the authenticated workflow-list
  path and its PostgreSQL dependency before the pod receives traffic.
- The umbrella chart defaults readiness to the authorization-neutral
  `/health` endpoint, which only confirms that the API process can respond.
  Its liveness and startup probes continue to use `/api/version`.
- The base umbrella chart already exposes the complete readiness probe spec,
  including HTTP headers, so staging can retain the legacy behavior without a
  public chart change.

#### Decision

**Fix values.** Keep the legacy authenticated workflow-list readiness probe in
staging. Preserve its path, header, failure threshold, period, and timeout
exactly. Leave the base chart's general-purpose `/health` default unchanged.

#### Actions

- Override `services.api.readinessProbe` in the internal staging values with
  the complete legacy probe.
- Render the complete staging release and compare every application-container
  liveness, readiness, and startup probe after normalizing the API rename.

### Pod hardening

#### Evidence

- All 11 umbrella Deployments set the pod seccomp profile to
  `RuntimeDefault`; none of the legacy Deployments sets a pod seccomp profile.
- The umbrella API retains its service-account token because it uses the
  Kubernetes API. All ten non-API Deployments explicitly disable token
  automounting. MCP already disabled it in the legacy render, so this removes
  the implicit token from nine additional workloads.
- API, agent, delayed-job-monitor, Envoy, logger, router, UI, and worker add
  `readOnlyRootFilesystem: true`. Authz, OAuth proxy, and MCP retain their
  previous setting.
- The chart supplies writable `emptyDir` mounts at `/tmp` and/or
  `/var/run/osmo` for the hardened services with known runtime writes. Envoy
  and UI do not receive writable mounts because they are not expected to write
  to their root filesystems.

#### Decision

**Allow.** Accept the umbrella chart's seccomp, service-account-token, and
read-only-root-filesystem hardening unchanged. Do not add staging overrides or
weaken the base chart security defaults.

#### Actions

- Keep API token automounting enabled and require it to retain its expected
  Kubernetes access after cutover.
- Require all 11 Deployments to become Ready and inspect startup/runtime logs
  for permission-denied or read-only-filesystem errors before declaring the
  migration healthy.
- Exercise API, agent, logger, router, worker, UI, and Envoy paths that can
  write temporary or progress data, confirming the provided writable mounts
  cover their runtime behavior.

## D7: Gateway, policies, and monitoring

This area is split into separate decisions for monitoring cadence, resource
identity, and gateway routing.

### Monitoring cadence

#### Evidence

- The legacy `service` chart hardcodes a `15s` interval for its control-plane,
  Envoy, and OAuth-proxy PodMonitors. This is chart-wide behavior rather than a
  staging override.
- The umbrella `osmo` chart initially defaults all three PodMonitors to `30s`,
  halving metric resolution and ingestion frequency during the migration.
- The umbrella chart already centralizes the interval under
  `monitoring.podMonitor.interval`, so one base default controls the control
  and gateway monitors consistently.

#### Decision

**Fix chart.** Change the umbrella chart's default PodMonitor interval to
`15s`, matching the legacy chart for all environments. Do not add a
staging-only override.

#### Actions

- Set the base `monitoring.podMonitor.interval` default to `15s`.
- Run the complete umbrella chart test suite and Helm lint.
- Render staging and require all three PodMonitor endpoints to use `15s`.

### Resource names and selectors

#### Evidence

- All 11 Services replace legacy `app` or gateway-specific selectors with the
  umbrella chart's release-scoped standard labels. Each selector matches its
  intended Deployment pod labels, including the two headless Services.
- The API, router, and UI ingress NetworkPolicies are renamed to use umbrella
  component names. MCP's policy keeps its name. All four policies select the
  matching destination and allow TCP port 8000 only from the new gateway
  Envoy selector.
- The three PodMonitors gain the `osmo-` release-name prefix and replace
  legacy selectors with standard labels. Together they select exactly agent,
  API, worker, logger, delayed-job-monitor, Envoy, and OAuth proxy.
- No repository configuration, dashboard, or alert directly references the
  old NetworkPolicy or PodMonitor object names.
- With `PruneLast=true`, renamed policies and monitors can coexist during the
  Deployment replacement. Their old and new selectors target their respective
  old and new pod identities rather than double-selecting the same pods.

#### Decision

**Allow.** Accept the release-scoped names and standard-label selectors. Do
not add legacy-name or legacy-selector compatibility to the chart; these
changes are consistent with the D1 Deployment replacement.

#### Actions

- During cutover, verify all 11 Services have endpoints after the new
  Deployments become available.
- Exercise gateway traffic to API, router, UI, and MCP to confirm all four
  NetworkPolicies allow the intended path.
- Confirm Prometheus discovers all seven intended workload targets through the
  three new PodMonitors before pruning the legacy monitors.
- Confirm Argo prunes the three renamed legacy NetworkPolicies and all three
  legacy PodMonitors after the replacement is healthy.

### Remaining decisions

- Confirm the renamed gateway upstreams and accepted D3 TLS behavior preserve
  all intended routes and ports.

## Decisions log

| Date | ID | Decision | Required changes | Verification |
| --- | --- | --- | --- | --- |
| 2026-09-03 | D1 | Use explicit Deployment replacement; a brief traffic interruption is accepted. No chart compatibility mode. | Add the maintenance-window delete/sync/rollback sequence. | Confirm all 11 Deployments are available, every Service has endpoints, and all eight HPAs target the expected Deployment/container. |
| 2026-09-04 | D2 | Use ESO unchanged with target Secrets owned by ESO. Preserve existing Kubernetes Secret mount paths; accept typed env/file delivery in place of Vault-rendered files. | Add the missing backend-image credential Secret projection to the umbrella chart. Keep `creationPolicy: Owner` and use a two-phase ESO-then-OSMO cutover. | Confirm all five ExternalSecrets are Ready without reading values; compare old/new configuration, storage, MEK, and backend-image mount paths; exercise controlled `rolloutNonce` rotation. |
| 2026-09-04 | D3 | Use chart-generated internal TLS and allow initial generation once. | Keep the first-sync gate enabled, verify all seven retained Secrets and TLS consumers, then disable the gate and resync in fail-if-missing mode. | Check Secret key names, exact upstream DNS SANs, Deployment health, and API/MCP traffic through Envoy without certificate-validation errors. |
| 2026-09-04 | D4 | Preserve the legacy FastMCP authentication and session behavior using separate existing OAuth and Valkey Secrets. | Fix the chart's default Redis Secret source and configure the complete staging OIDC/Redis contract. Do not change ESO. | The full staging release renders; all 19 managed settings match after normalizing typed Secret file paths. Cutover still requires live metadata, token, origin, and session tests. |
| 2026-09-04 | D5 | Restore the legacy soft spread intent and correct worker to count worker pods rather than API pods. | Add per-component zone constraints for API, agent, logger, router, and worker, plus hostname and zone constraints for UI. No chart change. | The full staging release renders; all six workloads use matching Deployment selectors, and all eight normalized HPA specs match the legacy render. |
| 2026-09-04 | D6 resources | Preserve the legacy requests, limits, and resulting HPA utilization baseline during migration. | Set explicit legacy resources for agent, logger, delayed-job-monitor, and Envoy in staging values. | The full staging release renders; all application-container resource blocks and all eight normalized HPA specs match the legacy render. |
| 2026-09-04 | D6 readiness | Keep the legacy authenticated workflow-list readiness check in staging. | Override the API readiness probe in staging values; leave the base chart default unchanged. | The full staging release renders; all normalized application-container probe specs match the legacy render. |
| 2026-09-04 | D6 hardening | Accept the umbrella chart's seccomp, service-account-token, read-only-root-filesystem, and writable-volume defaults. | No chart or values change. Add cutover health and runtime-write checks. | The render has 11 `RuntimeDefault` seccomp profiles, ten non-API token opt-outs, eight read-only application roots, and the expected writable paths. Live behavior remains a cutover check. |
| 2026-09-04 | D7 cadence | Preserve the legacy chart-wide 15-second metrics cadence. | Change the base umbrella PodMonitor interval default; do not add a staging override. | The complete chart test suite and Helm lint pass; all three staging PodMonitors render with `interval: 15s`. |
| 2026-09-04 | D7 identity | Accept release-scoped Service, NetworkPolicy, and PodMonitor names and selectors. | No chart or values change. Add endpoint, policy-path, monitoring-target, and prune checks to cutover. | All 11 Services, four policies, and seven monitored workloads resolve to exactly the intended Deployment labels and ports. |
| 2026-09-04 | D10 | Refresh both repositories after rebasing onto current main. | Pin staging to chart commit `629c676d5a3e270499b5ca61e096742364ccd9bb` and values commit `5cd89de190b5f255c2221afe4087a893c2cf80e9`; retain the unchanged ESO source pin. | Chart tests, typed ESO tests, and the complete staging render pass. |
