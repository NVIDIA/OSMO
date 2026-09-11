# Azure nightly deployment test

`Deployment Test (Azure)` builds the checkout's images and CLI, invokes
`deployments/scripts/deploy-osmo-single-plane.sh`, runs the existing OETF selection,
and cleans up Azure in a separate job. The installer owns Terraform provisioning,
KAI, bootstrap Secrets, the unified `osmo` Helm release, and hello/object-storage
verification. The nightly does not invoke the legacy minimal deployment wrapper.

The schedule, manual `full-deployment` mode, and `ci:azure-deployment` PR-label event
share this path. Normal deployment-related PR updates retain `init-only` validation;
manual `auth-check` plans the same single-plane Terraform inputs without provisioning.
Full runs remain serialized because they share a dedicated, preexisting resource
group. Re-adding the PR label is necessary to request another full run after a push.

## CI prerequisites

The existing `internal-ci` environment supplies `AZURE_CLIENT_ID`,
`AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, and optional
`AZURE_REGION` / `AZURE_CLUSTER_NAME`. The resource group must be dedicated to this
workflow: both pre-clean and failed-deployment recovery delete resources in it.
The group itself is preserved.

The OIDC principal needs the existing provisioning permissions plus permission to
create/delete the Azure workload-identity role assignments used by the single-plane
profile. RG-scoped Contributor alone cannot create those assignments. Grant the
required assignment-management permissions at the dedicated RG scope, not
subscription-wide Owner. Cleanup also needs read access to the AKS-managed node
resource group to verify that its dependent resources are gone. Lack of inventory
read access is reported as a cleanup failure, never an empty inventory.

`NGC_API_KEY` retains its existing registry push/pull purpose. Add a separate,
random `OSMO_AZURE_TFSTATE_KEY` environment secret for state encryption. The key must
be available to both deployment and cleanup; retain it until all encrypted artifacts
using it have expired (seven days) or been recovered. A missing key fails the local
encrypt/decrypt preflight before any Azure resource mutation. There is no plaintext
fallback. No Azure credentials or encryption key belong in committed files.

`azure-inputs.sh` centralizes CI sizing and the existing primary Redis settings:
three `Standard_D8s_v3` nodes, Redis HA disabled, `MemoryOptimized_M10` in `westus3`.
The single-plane profile owns generated database passwords and workload-identity
object storage. The old capacity retry/fallback has been removed: do not retry the
entire installer on a Helm or verification failure. If a canary encounters a Redis
allocation failure, review the primary SKU/region or an apply-only driver fix before
nightly cutover.

## Handoffs and failure reporting

The deployment job must upload `cloud-attempt-RUN_ID-PRODUCER_ATTEMPT` before
pre-clean or provisioning. It records source SHA, subscription, group and cluster.
The always-preserve step encrypts state/backup, provider lock, the single-plane
profile and effective CI overrides with GnuPG AES256 and integrity protection.
Only `terraform-state.gpg` enters `tf-state-RUN_ID-PRODUCER_ATTEMPT`.

Downstream jobs use the producer's explicit artifact names, including on reruns.
Images and the HEAD CLI artifact are also unique per producer attempt, so rerunning
failed jobs cannot overwrite an earlier build's inputs. Do not use a downstream
job's attempt number to guess the deployment artifact name.

OETF creates fresh AKS credentials and its own gateway port-forward in namespace
`osmo`. It authenticates with the bootstrap admin access token, sets pool `default`, and
creates a run-specific PAT with 24–48 hours of validity, revoked on normal exit. The existing OETF overlay hook
loads `oetf-single-plane.yaml`; no user configuration or framework auth strategy is
changed. The tags remain `api,websocket,logger,task-env,negative`, with the previous
`auth,mcp` exclusions preserved. Missing, empty or entirely skipped results fail.

Deployment, OETF and cleanup have separate status, summaries and diagnostic
artifacts. Cleanup captures fresh pod status, events and selected service logs after
OETF, then destroys with the restored state and the exact saved inputs. A bounded
resource sweep handles partial resources even when restore/destroy fails. Cleanup
still reports the restore/destroy failure after a successful fallback; it cannot
hide the original deployment or OETF failure.

Artifacts exclude Kubernetes Secrets, credential files, raw Helm values, Docker
configuration and OETF's raw `.oetf-bep.json` (which contains token-valued Bazel
arguments). Do not broaden diagnostic upload globs to the workspace or runner temp
directory. State archive extraction accepts only the expected flat file allowlist.

Initial budgets reserve finalization time: deployment has a 180-minute job budget
(setup 20, pre-clean 30, installer 105, finalization 20, headroom 5); OETF has 45
minutes (setup at most 10, suite 30, summary/artifacts 5); cleanup has 50 minutes
(setup/restore 10, diagnostics 3, destroy 22, sweep 10, summary/artifacts 5).
Tune using observed canary timings without consuming the artifact/fallback reserve.

## Interrupted-run recovery

A normally failed/skipped cloud gate proves no mutations began, so cleanup does
nothing. A successful gate plus a validated marker authorizes cleanup of that
specific dedicated group even when the state archive is missing. If a runner dies
and its outputs/marker cannot be established, cleanup fails as **unknown** and does
not infer permission to delete resources from an unavailable artifact.

`always()` and EXIT traps cannot survive every force cancellation or runner loss.
Before rerunning, confirm the previous runner and Azure operations have stopped.
Recover the producer marker and encrypted state from the exact run/attempt. With
the same source checkout, environment, and configured secret, the local helper
interfaces are:

```bash
bash ci/deployment-test/azure-state.sh restore terraform-state.gpg restored-state
# Set PRODUCER_ATTEMPT to the deployment attempt, GITHUB_RUN_ID/GITHUB_SHA to the
# recorded run/source, and RUN_DIR to a diagnostic directory before recovery.
bash ci/deployment-test/azure-cleanup.sh destroy cloud-attempt.json restored-state
bash ci/deployment-test/azure-cleanup.sh sweep cloud-attempt.json
```

The helpers compare the marker to the configured subscription/RG/cluster and
source identity. If producer evidence is unavailable, inspect the dedicated RG and
resolve the interrupted run before starting another full deployment. The next-run
pre-clean is a recovery backstop, not permission to overlap cloud operations.

## Validation and rollout

```bash
bazel test //ci/deployment-test:all \
  //deployments/scripts/tests:test_deploy_osmo_single_plane \
  //deployments/scripts/tests:test_azure_terraform_driver \
  //deployments/scripts/tests:test_verify --test_output=errors
bash deployments/charts/osmo/tests/test_osmo_charts.sh
bash ci/deployment-test/check-head-chart-contract.sh
shellcheck --source-path=SCRIPTDIR ci/deployment-test/*.sh ci/deployment-test/tests/*.sh
actionlint .github/workflows/deployment-test.yaml
```

The workflow retains `concurrency.queue: max` from the existing nightly; actionlint
versions that predate that GitHub field report a schema error. For those versions,
ignore only `unexpected key "queue"` and retain all other checks.

Unit tests exercise encryption/integrity, partial state, deletion scope, downstream
reruns, token login, gateway failure, exit propagation and empty/all-skipped test
results. The HEAD chart check renders actual unified values and verifies matching
CI service/compute/workflow-runtime images; disabled authz/test-runner components
are not required to appear in this profile's manifests.

After code review and prerequisite setup, validate an authorized manual full run:
check the `osmo` release and images, built-in hello/object-storage verification,
nonempty passing OETF results, useful per-stage diagnostics and a confirmed empty
Azure inventory including AKS dependencies. Verify PR-label routing and retain a
successful scheduled run before declaring nightly migration complete. Local mocks
do not establish Azure permissions, capacity, real gateway behavior or live cleanup.
Roll back by cleaning the single-plane deployment first and reverting the workflow
migration; never give single-plane state to the old minimal teardown path.
