# OSMO-6592 Split-Plane Control Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a local dependency chart and a control-only OSMO umbrella deployment on kind.

**Architecture:** Keep the umbrella thin by depending on the existing `service` chart under the `controlPlane` alias. Add only backward-compatible Kubernetes Secret wiring to that child chart, and keep local PostgreSQL, Valkey, and RustFS in a separate testing-only `osmo-deps` chart.

**Tech Stack:** Helm 3, Kubernetes 1.30+, kind, Bazel `sh_test`, Bash, public NGC OSMO 6.3.1 images.

## Global Constraints

- Work only in `/home/ecolter/workspace/osmo/.herdr-worktrees/external/osmo-6592` on `agent/osmo-6592`.
- Never interact with a Kubernetes cluster unless its explicit context is a local kind context.
- The umbrella installs control-plane components only; compute-plane resources are out of scope.
- No rendered control-plane pod may require Vault injection.
- Preserve existing service-chart MEK ConfigMap behavior when no Secret name is configured.
- Use Bazel for the automated chart test and public `nvcr.io/nvidia/osmo` images tagged `6.3.1`.
- Keep `osmo-deps` explicitly non-production and reproducible enough for local verification.

---

### Task 1: Add Failing Helm Behavior Tests

**Files:**
- Create: `deployments/charts/tests/test_osmo_charts.sh`
- Modify: `deployments/charts/BUILD`

**Interfaces:**
- Consumes: system `helm` and the repository charts.
- Produces: Bazel target `//deployments/charts:test_osmo_charts`.

- [ ] **Step 1: Write rendering tests for the required behavior**

  The test renders the service chart with custom Secret names, the new dependency
  chart, and the umbrella profiles. It asserts actual Deployment/Service/Secret/
  Job output, absence of compute and embedded dependency resources, absence of
  Vault annotations, and failure when `planes.compute.enabled=true`.

- [ ] **Step 2: Run the test to verify RED**

  Run: `bash deployments/charts/tests/test_osmo_charts.sh`

  Expected: FAIL because `deployments/charts/osmo` and
  `deployments/charts/osmo-deps` do not exist and the service chart does not
  honor custom MEK/Valkey Secret values.

### Task 2: Make Service Credentials Kubernetes-Secret Configurable

**Files:**
- Modify: `deployments/charts/service/values.yaml`
- Modify: `deployments/charts/service/templates/_helpers.tpl`
- Modify: `deployments/charts/service/templates/api-service.yaml`
- Modify: `deployments/charts/service/templates/worker.yaml`
- Modify: `deployments/charts/service/templates/logger-service.yaml`
- Modify: `deployments/charts/service/templates/agent-service.yaml`
- Modify: `deployments/charts/service/templates/router-service.yaml`
- Modify: `deployments/charts/service/templates/delayed-job-monitor.yaml`
- Modify: `deployments/charts/service/templates/gateway.yaml`
- Modify: `deployments/charts/service/README.md`

**Interfaces:**
- Consumes: `services.postgres.passwordSecretName/passwordSecretKey`.
- Produces: `services.redis.passwordSecretName/passwordSecretKey` and
  `services.configFile.secretName/secretKey`; helper `osmo.mek-volume`.

- [ ] **Step 1: Replace hardcoded database and Valkey Secret references**

  Every workload must render `secretKeyRef` from the corresponding values. Add
  Valkey defaults `redis-secret` and `redis-password` to preserve behavior.

- [ ] **Step 2: Add the MEK volume resolver**

  `osmo.mek-volume` emits a Secret volume when `configFile.secretName` is set and
  the legacy `mek-config` ConfigMap volume otherwise. All MEK-consuming workloads
  call the helper.

- [ ] **Step 3: Run the service portion of the chart test**

  Run: `bash deployments/charts/tests/test_osmo_charts.sh service`

  Expected: PASS with custom Secret references in rendered pod specs.

### Task 3: Add the Local Dependency Chart

**Files:**
- Create: `deployments/charts/osmo-deps/Chart.yaml`
- Create: `deployments/charts/osmo-deps/values.yaml`
- Create: `deployments/charts/osmo-deps/templates/_helpers.tpl`
- Create: `deployments/charts/osmo-deps/templates/secret.yaml`
- Create: `deployments/charts/osmo-deps/templates/postgresql.yaml`
- Create: `deployments/charts/osmo-deps/templates/valkey.yaml`
- Create: `deployments/charts/osmo-deps/templates/rustfs.yaml`
- Create: `deployments/charts/osmo-deps/templates/buckets-job.yaml`
- Create: `deployments/charts/osmo-deps/README.md`

**Interfaces:**
- Produces: Services `osmo-deps-postgresql`, `osmo-deps-valkey`, and
  `osmo-deps-rustfs`; Secret `osmo-deps-credentials` with keys `db-password`,
  `redis-password`, `access_key_id`, `access_key`, `mek.yaml`, and
  `admin-password`.

- [ ] **Step 1: Implement chart metadata, values, naming, and credentials**

  Use PostgreSQL 15, Valkey 8, pinned RustFS `1.0.0-beta.11`, an AWS CLI bucket
  initializer, ephemeral `emptyDir` volumes, readiness probes, and low local
  resource requests.

- [ ] **Step 2: Render dependency workloads and bucket initialization**

  The bucket Job waits for the S3 endpoint and idempotently creates `osmo-workflows`,
  `osmo-logs`, and `osmo-apps`.

- [ ] **Step 3: Run the dependency portion of the chart test**

  Run: `bash deployments/charts/tests/test_osmo_charts.sh deps`

  Expected: PASS with all dependency resources and credential references.

### Task 4: Add the Control-Only Umbrella Chart

**Files:**
- Create: `deployments/charts/osmo/Chart.yaml`
- Create: `deployments/charts/osmo/values.yaml`
- Create: `deployments/charts/osmo/templates/validate-values.yaml`
- Create: `deployments/charts/osmo/profiles/split-plane-control.yaml`
- Create: `deployments/charts/osmo/profiles/kind.yaml`
- Create: `deployments/charts/osmo/README.md`
- Generate: `deployments/charts/osmo/Chart.lock`
- Generate and ignore from Git: `deployments/charts/osmo/charts/service-1.3.0.tgz`

**Interfaces:**
- Consumes: local `service` chart 1.3.0 and `osmo-deps` DNS/Secret contract.
- Produces: `planes.control.enabled`, `planes.compute.enabled`, the
  `controlPlane` child namespace, and two composable profile files.

- [ ] **Step 1: Declare the conditional control-plane dependency**

  Set umbrella `appVersion: "6.3.1"`, propagate the public image registry/tag
  through `global`, and reject compute enablement until its dependency exists.

- [ ] **Step 2: Configure the split-control and kind profiles**

  The split profile disables child-owned PostgreSQL, Redis, and LocalStack and
  selects existing Secrets. The kind profile connects to `osmo-deps`, mounts
  the shared credential Secret, configures path-style RustFS storage, uses one
  replica per component, disables PodMonitor and production auth components,
  and injects a local admin identity at Envoy.

- [ ] **Step 3: Build the dependency archive and run the umbrella tests**

  Run: `helm dependency build deployments/charts/osmo`

  Run: `bash deployments/charts/tests/test_osmo_charts.sh osmo`

  Expected: PASS; rendered resources contain control-plane deployments only and
  the unsupported compute value fails validation.

### Task 5: Document and Register the Charts

**Files:**
- Modify: `deployments/charts/BUILD`
- Modify: `deployments/charts/README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: public Bazel filegroups for both charts, an automated chart test,
  and exact local install/verification instructions.

- [ ] **Step 1: Add Bazel targets**

  Add `osmo`, `osmo-deps`, and `test_osmo_charts` targets with public chart data.

- [ ] **Step 2: Update chart and codebase documentation**

  Describe the umbrella, the test-only dependency chart, profile layering,
  Kubernetes Secret contract, public image version, kind safety guard, Helm
  commands, port-forward, and REST calls. Add a deployment-chart section to
  `AGENTS.md` because these are new major deployment components.

- [ ] **Step 3: Run the complete automated chart test**

  Run: `bazel --output_user_root=/tmp/osmo-6592-bazel test //deployments/charts:test_osmo_charts --test_output=errors`

  Expected: PASS, one test and zero failures.

### Task 6: Static Helm Verification

**Files:** none.

**Interfaces:**
- Consumes: completed chart tree.
- Produces: fresh lint, rendering, and client dry-run evidence.

- [ ] **Step 1: Build dependencies and lint both charts**

  Run: `helm dependency build deployments/charts/osmo`

  Run: `helm lint deployments/charts/osmo-deps`

  Run: `helm lint deployments/charts/osmo -f deployments/charts/osmo/profiles/split-plane-control.yaml -f deployments/charts/osmo/profiles/kind.yaml`

- [ ] **Step 2: Render and client-dry-run both installations**

  Run `helm template` and `helm install --dry-run=client` for release
  `osmo-deps` and then `osmo`, using namespace `osmo` and both umbrella profiles.

  Expected: every command exits zero.

### Task 7: Deploy and Exercise the Local kind Cluster

**Files:** none.

**Interfaces:**
- Consumes: a kube context whose exact name begins `kind-` and matches a cluster
  returned by `kind get clusters`.
- Produces: running local dependency/control releases and REST response evidence.

- [ ] **Step 1: Establish a guarded context variable**

  Read the current context without contacting a cluster. Stop unless its name is
  `kind-<cluster>` and `<cluster>` is listed by kind. Pass `--context` explicitly
  to every `kubectl` and `--kube-context` explicitly to every Helm command.

- [ ] **Step 2: Install and wait for dependencies**

  Install `osmo-deps` in namespace `osmo`, wait for all three deployments and
  the bucket Job, and inspect failure events/logs if readiness fails.

- [ ] **Step 3: Install and wait for the umbrella**

  Install `osmo` with both profiles and a 25-minute timeout. Verify all expected
  control Deployments become available and no backend Deployment exists.

- [ ] **Step 4: Port-forward and call REST APIs**

  Port-forward `service/osmo-gateway-envoy` to a free local port, call
  `/api/version`, and query `/api/workflow?limit=10&all_pools=true` with the
  documented development identity headers. Capture HTTP status and JSON bodies,
  then stop the port-forward.

### Task 8: Simplify, Review, Verify, and Deliver

**Files:** all changed files.

**Interfaces:**
- Produces: reviewed commit, remote topic branch, and pull request against main.

- [ ] **Step 1: Review scope and simplify**

  Inspect `git diff --check`, `git diff --stat`, and the complete patch. Remove
  duplication, unused values, generated archives, unrelated changes, and any
  accidental dependency on the original checkout.

- [ ] **Step 2: Run fresh final verification**

  Re-run the Bazel chart test, Helm lint/templates/dry-runs, guarded cluster
  readiness checks, and both live REST requests against the final tree.

- [ ] **Step 3: Commit and push**

  Stage only task files and commit with `feat(helm): add split control umbrella profile`.
  Push `agent/osmo-6592` without force.

- [ ] **Step 4: Create the pull request**

  Use the repository PR template if present, target `main`, summarize design and
  verification evidence, and report the commit SHA and PR URL.
