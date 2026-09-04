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
| D4 | MCP authentication boundary | Current main now uses FastMCP's built-in OIDC proxy and a four-value configuration contract. The converted staging values predate that merge and omit required OIDC settings. | The staging umbrella render now fails before producing manifests; after values are supplied, clients may still see different token, refresh, origin, and failure behavior. | **Pending; render blocker** |
| D5 | Scheduling and availability | Topology spread constraints disappear for API, agent, logger, router, worker, and UI. HPA min/max values and metric targets are otherwise preserved. | Reduced zone/host spreading can increase correlated disruption. Restoring worker behavior needs care because its legacy constraint selects API pods rather than worker pods. | **Pending** |
| D6 | Resources, probes, and pod hardening | Resource settings change for agent, logger, delayed-job-monitor, and Envoy. The API readiness endpoint changes. Pods gain seccomp, mostly disable service-account token automounting, use read-only root filesystems, and add writable runtime volumes where required. | Lower requests may alter scheduling/capacity; stricter filesystems may expose runtime assumptions; the new readiness endpoint has different coverage. | **Pending** |
| D7 | Gateway, policies, and monitoring | The Ingress and gateway ports are preserved, but gateway upstream names/addresses, Service selectors, NetworkPolicy names/selectors, and PodMonitor names/selectors change. Scrape interval changes from 15s to 30s. Upstream TLS validation is added. | Policies and monitors are recreated; dashboards or alerts may depend on scrape cadence or object names. | **Pending** |
| D8 | Database and Argo lifecycle | The legacy pgroll migration Job and migration-files ConfigMap disappear. New TLS and service-auth hooks/RBAC appear, while Argo prunes the old Vault ConfigMaps and old API resources. | Schema migration must be completed before cutover, and hook/app synchronization must be explicitly ordered. | **Pending** |
| D9 | Configuration and storage representation | The generated service configuration retains the same major sections, but empty maps are pruned and storage credentials become explicit per-location Secret references and endpoints. | Empty maps are probably inert, but storage data/log/app operations require an end-to-end verification before allowing the difference. | **Pending** |
| D10 | Pinned revisions | The internal staging Application must pin the rebased chart-only commit and a reachable rebased internal values commit. | Later decisions would otherwise be tested against a stale candidate. | **Fix values:** refreshed after the D2 chart change. |

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

## Decisions log

| Date | ID | Decision | Required changes | Verification |
| --- | --- | --- | --- | --- |
| 2026-09-03 | D1 | Use explicit Deployment replacement; a brief traffic interruption is accepted. No chart compatibility mode. | Add the maintenance-window delete/sync/rollback sequence. | Confirm all 11 Deployments are available, every Service has endpoints, and all eight HPAs target the expected Deployment/container. |
| 2026-09-04 | D2 | Use ESO unchanged with target Secrets owned by ESO. Preserve existing Kubernetes Secret mount paths; accept typed env/file delivery in place of Vault-rendered files. | Add the missing backend-image credential Secret projection to the umbrella chart. Keep `creationPolicy: Owner` and use a two-phase ESO-then-OSMO cutover. | Confirm all five ExternalSecrets are Ready without reading values; compare old/new configuration, storage, MEK, and backend-image mount paths; exercise controlled `rolloutNonce` rotation. |
| 2026-09-04 | D3 | Use chart-generated internal TLS and allow initial generation once. | Keep the first-sync gate enabled, verify all seven retained Secrets and TLS consumers, then disable the gate and resync in fail-if-missing mode. | Check Secret key names, exact upstream DNS SANs, Deployment health, and API/MCP traffic through Envoy without certificate-validation errors. |
| 2026-09-04 | D10 | Refresh both repositories after rebasing onto current main. | Pin the staging chart to `d16c1980b48e1ae825b5c679964fa78b34971b9e` and its values/ESO sources to rebased commit `985e55045420a9334e33ad182109f06306351b2c`. | Chart tests and the typed ESO render test pass; full staging rendering remains blocked on pending D4. |
