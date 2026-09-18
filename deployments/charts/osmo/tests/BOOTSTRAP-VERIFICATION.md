# Single bootstrap Job verification

## Separate legacy-token migration

The current revision keeps one ordinary OSMO bootstrap Job and adds a separate
`pre-install,pre-upgrade` token migration hook. Dex, database migrations, and
explicit rotations retain their independent lifecycles. The hook is controlled by
`authentication.bootstrap.tokenMigration.enabled` and selects only managed tokens
of enabled identities. Its RBAC allows only named-Secret `get,patch` operations.

ARM64 runtime built and executed for this revision:
`osmo.local/service@sha256:e09fe0784c8437e5915663cf29536ee50eecfac2dcb318e0707786816f5220b6`.
Tests ran on disposable context `kind-osmo-bootstrap`; each case owned a separate
namespace. The baseline chart/image references below remain unchanged.

### Validation

- Full chart shell suite and all 32 enable combinations passed. Assertions cover
  migration hooks/RBAC, compute-only exclusion, Dex independence, and stable
  ordinary Job identity when migration is disabled.
- All 27 focused `bazel coverage --config=ci` targets passed with Helm 3.16.2,
  including affected runtime, coordinator, identity, TLS, MEK, deployment, OETF,
  semantic chart, and Pylint targets.
- Unit tests verify metadata/data preservation, inventory prevalidation, UID and
  resourceVersion preconditions, conflict retries and bounds, replacement rejection,
  partial retry, strict coordinator adoption, and migration-only CLI dispatch.
- Three fail-on-bad checks reproduced the intended regressions: a no-op migrator
  fails strict legacy adoption; removing the migration-only argument fails the
  chart contract; restoring the old gate names collides for long consumer names.
- Fresh installation, both legacy-owner upgrades with current/previous-token
  authentication, independent Dex refresh, migration failure/partial retry,
  repeat/disabled migration, Flux migration/storage recovery, unavailable-storage
  retry, and crash-after-token-creation retry passed on the pinned runtime.
  Credential bytes and Secret UIDs were preserved. Hook failures kept the prior
  ordinary Job unchanged; recovery produced the expected replacement.

The new retry fixture initially reached successful recovery but failed while
setting a missing values mapping for its final disabled-migration assertion. The
fixture now creates that mapping explicitly; the entire case passed on rerun.
No production runtime change was required for that fixture correction.

The independent reviewer checked the entire PR and approved after reviewing the
final source and test evidence. Their long-consumer-name collision finding was
fixed by hashing the full consumer name with its bootstrap generation. Their
hooks-disabled migration prerequisite is documented in the chart README.

Local receipts:

- `/private/tmp/osmo-token-migration-coverage.log`
- `/private/tmp/osmo-token-migration-chart-shell.log`
- `/private/tmp/osmo-token-migration-mutations.log`
- `/private/tmp/osmo-token-migration-kind.log`
- `/private/tmp/osmo-token-migration-kind-retry-flux.log`
- `/private/tmp/osmo-bootstrap-evidence/migration-first-batch/`
- `/private/tmp/osmo-bootstrap-evidence/migration-final/`

## OSMO-only scope before legacy-token migration

Dex uses the original upstream chart 0.24.1 and retains its existing credential
and configuration-refresh Helm hooks. Only managed OSMO access tokens move out of
those hooks into the ordinary OSMO bootstrap Job. The local Dex fork and the
Dex/OAuth2Proxy startup gates are removed.

The restored Dex Deployment, Service, config Secret, ServiceAccount, and
OAuth2Proxy Deployment render identically to baseline `02c1fab45` under the same
values. A semantic regression check verifies separate Dex hooks with every OSMO
step enabled and with all OSMO steps disabled; removing the post-hook config
refresh argument in a temporary chart copy makes that check fail.

ARM64 runtime before legacy-token migration:
`osmo.local/service@sha256:58c37383131db47a704cf6f78344e1c4c6c89d9f431187bdfbaecc2f9b6402f4`.

The full chart shell suite and four focused Bazel targets for coordinator,
identity reconciliation, chart semantics (including all 32 OSMO enable
combinations), and deployment adapters passed.

All five selected lifecycle cases passed on the current runtime:

- Fresh installation with real Dex login and verified OSMO credential files.
- Upgrade from baseline chart/image with retained credentials and token overlap.
- Independent Dex config and user-email refresh: Dex Pods replaced, OSMO Job UID
  unchanged, credentials preserved, and login succeeds with the updated email.
- Unavailable object storage followed by deliberate retry.
- Crash after token creation before the step receipt, followed by deliberate retry.

Both retries preserve credentials already issued. Independent source review
approved the final OSMO-only scope with no blockers. Local receipts are
`/private/tmp/osmo-dex-restore-fast.log`,
`/private/tmp/osmo-dex-restore-chart-final.log`,
`/private/tmp/osmo-dex-restore-cluster.log`, and
`/private/tmp/osmo-bootstrap-evidence/dex-restored/`.

Earlier V6–V8 results below describe historical candidates before restoring the
Dex boundary; they are not final-scope reruns.

### Merge with main `7e4af2f7c`

The chart-test conflict preserves upstream's portable file edit and the fixed
release name needed to compare OSMO Job identity across a Dex-only change. The
full chart shell suite, bootstrap semantic matrix, and all four installer Bazel
targets passed after merging. The installer test required explicit local
`TFENV_CONFIG_DIR` and `TFENV_TERRAFORM_VERSION=1.9.8` because Bazel's test
environment did not locate the installed Terraform version. No installer source
changes were needed. Cluster scenarios were not rerun for this test-only conflict.

### CI follow-up for run `35148931910`

The coverage job failed 18 targets: the semantic chart test assumed locally
downloaded dependencies, and 17 Pylint targets reported style or test-fixture
findings. Chart tests now copy the chart into a temporary directory, exclude
existing dependency archives, configure private Helm repository paths, download
the locked dependencies, and verify the upstream Dex archive before rendering.
Pylint findings are corrected; narrow suppressions document intentional private
helper tests and resources already managed by explicit fixture cleanup.

All 18 failed targets passed locally. A subsequent `bazel coverage --config=ci`
run with CI's Helm 3.16.2 passed all 25 selected targets: the 18 failed targets plus
seven affected unit-test targets. The chart test uses an empty repository cache
on every run. Logs: `/private/tmp/osmo-ci-fixes-targets-rerun.log` and
`/private/tmp/osmo-ci-fixes-coverage.log`. This local run used macOS ARM64; the
GitHub Linux coverage job remains the integration check.

## Historical candidates and environment

Implementation starts at NVIDIA/OSMO `02c1fab45` on branch
`single-bootstrap-job`. The image digests below pin the executed runtime
independently of subsequent test/documentation edits.

- Disposable KIND `osmo-bootstrap`, context `kind-osmo-bootstrap`, one ARM64 node.
- KIND 0.31.0; Kubernetes 1.35.0; Helm CLI 3.19.0; Bazel 8.5.1.
- CloudNativePG operator chart 0.29.0, default local StorageClass.
- Flux 2.9.5, helm-controller 1.6.4; KAI scheduler 0.12.10.
- Baseline image: `osmo.local/service@sha256:2753cb9d1a2f54a9262c24630443d63b09b40f685bc11d4cd28d7f1f1ac17855`.
- Candidate v6: `osmo.local/service@sha256:0cf04b539c74897cf49a8888b9bbe285b382166e1a80528c6eea75319e1fdc94`.
- Candidate v7: `osmo.local/service@sha256:a82577121450013233703a947affeff68c8a895dddf74e4bcce47e32f08abc83`.
- Candidate v8: `osmo.local/service@sha256:6536c2a81f60336c830b38b080e361f87cfb22ccf80796409bf7c1a218a39362`.

V8 fixes PostgreSQL recovery across a RollingUpdate: an old Pod can participate
in the quiescence proof only when its exact owner is verified, no application
started, and its recognized bootstrap gate still requires the same missing MEK.
Waiting for that Pod to disappear would deadlock behind its unready replacement.
V8 also rejects takeover of every stranded foreign-held coordinator Lease;
normal supervised retries release ownership after verified process cleanup.

## Historical fast checks completed

V8 service image builds passed for ARM64 (executed on KIND) and AMD64
(build qualification only). AMD64 OCI manifest: `sha256:b161860231b938f9cf00361f7ab84ccb5d943237449d688cfaa2895fe51dcad9`.

All eight focused Bazel targets passed on September 16, 2026:

```sh
bazel test //src/utils/tests:test_bootstrap \
  //src/utils/tests:test_internal_tls_bootstrap \
  //src/utils/tests:test_identity_bootstrap \
  //src/service/core/tests:test_service_auth_bootstrap \
  //src/utils/secret_manager/tests:test_mek_lifecycle \
  //deployments/charts:osmo_single_bootstrap_test \
  //test/oetf/tests:test_deploy //test/oetf/tests:test_main
```

The final V8 coordinator and MEK Bazel targets also passed (27 and 24 unit
tests respectively), including the stronger gate and stranded-lease checks.

The complete existing chart shell suite and object-storage shell suite passed.
The semantic chart suite passes all 32 enable combinations and nine additional
checks for names, retries, scheduling, resource overrides, and actual application
volumes. Eight Linux supervisor tests passed, including timeout, process-tree
cleanup, escaped sessions, cancellation, before/after sequencing, and lease CAS.

Six independent mutations in a temporary chart copy were rejected by semantic
assertions (not merely rendering errors): ignored retry token, removed consumer
gate, dropped previous-token, omitted rotation inputs, colliding retained-record
names, and a required self-generated service-auth Secret mount. A separately
compiled Linux supervisor with its watchdog disabled failed the timeout test
under an independent four-second test-runner deadline.

Before opening the PR, upstream `38cc53d2f` was merged. Its service-auth
node-selector inheritance is preserved when comparing the shared Pod's effective
scheduling policy; the independent reviewer approved that conflict resolution.
The full chart shell suite, semantic matrix, and expanded 110-test MEK suite passed
after integration. New upstream MEK test fakes were adapted to the nonblocking
advisory lock and updated ownership error. Cluster receipts below remain tied to
their recorded images; the complete cluster matrix was not rerun after this merge.

## Historical cluster results

The checked-in OETF suite is `//test/smoke:bootstrap_lifecycle_kind`; see
[`test/oetf/README.md`](../../../../test/oetf/README.md) for image variables and
runner commands. Each case uses a separate namespace, freezes its chart copy,
checks actual image IDs, and records redacted Job/Pod/Deployment evidence.
Credential comparisons remain in memory.

Completed on v6:

- Fresh installation: five sequential optional steps, one ordinary Job, real Dex
  PKCE login and authenticated API access.
- Baseline chart/image upgrade: retained credential UIDs and bytes preserved;
  current and overlapping previous admin tokens both authenticate.
- Credential generation upgrade and missing retained Secret rejection.
- Storage unavailability and crash-after-credential-create retries preserve
  previously issued credentials.
- TLS-disabled installation and all-bootstrap-disabled rendering/upgrade.
- CA prepare, activate, retire, stable phases, with real login after each phase.

V7 has also passed:

- Held PostgreSQL advisory-lock failure/retry.
- CA predecessor rejection/retry through prepare, activate, retire, stable.
- Flux unchanged reconciliation, recorded upgrade failure, deliberate retry,
  retained credential comparison, and explicit terminal-failure cleanup.
- MEK prepare/activate/rewrap coexistence with ordinary bootstrap disabled for MEK.
- Baseline in-progress CA rotation adoption at the same phase, then advancement.
- Fresh-install application file hashes compared with expected Secret contents.

V8 has passed:

- PostgreSQL outage/recovery across old and replacement gated Pods.
- Fresh-install application-file verification and real Dex/API authentication.
- CPU workflow with two dependent tasks: the first writes proof text to object
  storage, and the second reads and verifies it. Workflow
  `bootstrap-storage-proof-1` reached `COMPLETED`; the test passed in 133 seconds.
  The final run needed zero transient status-read retries. Submission occurs once;
  status reads tolerate bounded HTTP 502/503/504 responses.

Failed preliminary runs are not counted as passes: they exposed the MEK rollout
race and the Helm failed-inventory cleanup behavior below. Preliminary fixture
failures (unsupported fractional workflow CPU, baseline rotation requiring
disabled consumers, incomplete cluster-RBAC teardown, and a transient status-read
503) were corrected and are tracked separately from runtime failures.

Independent source review completed, including the final gate validation and
stranded-lease recovery policy, with no remaining correctness blocker reported.

## Historical PR review follow-up

The initial Local KIND Deployment CI run installed OSMO successfully and passed
its five normal test targets. It failed because OETF matched `kind` as a substring
of `bootstrap-kind`, selecting the isolated lifecycle suite with the wrong
environment. Tag inclusion and exclusion now match complete Bazel list elements.
Real Bazel queries prove the old matcher selects that suite and the fixed matcher
excludes exactly that suite while preserving explicit `bootstrap-kind` selection.

Review fixes passed the full chart suite, the expanded 13-method semantic suite,
coordinator and OETF unit tests, Python 3.12 compilation, and both Linux supervisor
package builds. Coverage includes typed node selectors, Dex existing-Secret names,
zero-valued disruption budgets, shared readiness deadlines, and retry-Pod selection
that refuses live Pods or mismatched Job ownership. Namespace-wide Secret creation
is documented as a bootstrap permission boundary; pre-created empty protected
Secrets would violate atomic issuance and retained-state validation.

The replacement [Local KIND Deployment run](https://github.com/NVIDIA/OSMO/actions/runs/35132562879)
passed on `99743d0f5`. CodeRabbit's follow-up check succeeded with no unresolved
threads; its remaining three test return-annotation nits were applied afterward.

## Recovery contract discovered during testing

The chart declares **one desired ordinary bootstrap Job**. Helm can leave a
historical failed Job after a later successful upgrade because it may calculate
pruning from the last deployed revision, whose inventory excludes resources
created only by the failed revision. Flux uses this Helm behavior too. See
[the pinned Helm inventory selection](https://github.com/helm/helm/blob/v4.2.4/pkg/action/upgrade.go).

Capture evidence, prove the failed Job and its Pod are terminal, correct the cause,
and change `bootstrap.attempt`. After the replacement succeeds, delete the
specific retained failed Job. The bootstrap workload has no Job deletion rights.
This replaces the plan's assumption that Helm always prunes failed attempts.

Helm can continue waiting on gated Deployments after a Job fails. The fixture
independently proves terminal Job/Pod state before canceling Helm. A client timeout
alone never authorizes lease takeover or deletion of a live attempt.

## Evidence locations for this run

Local run artifacts (not committed):

- `/private/tmp/osmo-bootstrap-evidence/`: retained OETF results and redacted cluster snapshots.
- `/private/tmp/osmo-bootstrap-fast-v7.log`: eight-target regression run.
- `/private/tmp/osmo-single-bootstrap-chart-tests.log`: full chart shell suite.
- `/private/tmp/osmo-single-bootstrap-matrix-final.log`: semantic matrix suite.
- `/private/tmp/osmo-bootstrap-mutations.log`: six fail-on-bad checks.
- `/private/tmp/osmo-bootstrap-oetf-v7.log`: first V7 cluster batch.
- `/private/tmp/osmo-bootstrap-oetf-v7-rerun.log`: corrected fixture rerun.
- `/private/tmp/osmo-bootstrap-oetf-v8.log`: final runtime recovery/fresh-install batch.
- `/private/tmp/osmo-bootstrap-cpu-v8-rerun.log`: passing final CPU workflow run.
- `/private/tmp/osmo-bootstrap-evidence/cpu-v8-final`: final CPU Allure result and cluster evidence.
- `/private/tmp/osmo-bootstrap-fast-v8.log`: final coordinator/MEK targets.
- `/private/tmp/osmo-bootstrap-pr-chart.log`: full chart suite after upstream integration.
- `/private/tmp/osmo-bootstrap-pr-bazel.log`: passing merged semantic matrix and initial MEK fixture failures.
- `/private/tmp/osmo-bootstrap-pr-mek-rerun.log`: passing expanded MEK suite after fixture updates.

No production cluster was modified. The disposable cluster and locally loaded
images are retained for inspection. The final CPU release was uninstalled and its
namespace deleted; no test-owned cluster RBAC or PriorityClasses remained.

## Workflow images

Supporting service images were built from the candidate tree. The runtime init
and client images are published 6.3.1 ARM64 images. The local init-image build
packages a host-built CLI on macOS, so this run does not qualify that packaging
path. The legacy CA rotation test uses the pinned supporting router, agent, and
logger images below alongside its baseline API/bootstrap image and chart.

| Component | Executed reference |
| --- | --- |
| worker | `osmo.local/worker@sha256:8d3bfa3f5903fa724fab2d8ab1fc66f44bff7ed19c76700a46f6b1b2fe6f16d5` |
| router | `osmo.local/router@sha256:08b4a7ec8f5247ce7a1cd109fa36b6970afe758764a687440a6250ec483f7426` |
| agent | `osmo.local/agent@sha256:bd9325c3d2f4b227afc9fe4134ad83945fec256df164c64df2a165e1feb1873e` |
| logger | `osmo.local/logger@sha256:20137a476acebb80006b09dd6c75ccd5bb389b956652ce08072efbdc2a97d4ef` |
| delayedJobMonitor | `osmo.local/delayed-job-monitor@sha256:2abd42dff49b01b61a937ca14c62b11722705c9acf2daf9946db7a0543147364` |
| backendListener | `osmo.local/backend-listener@sha256:40b0cf642dfb31ffaf9622a3dac6a23e6d054b1f10cb6f841fc19122d6706935` |
| backendWorker | `osmo.local/backend-worker@sha256:1a711e86db2b2933e0fc27257fea9a6832ac5e92addb2baa2441377fbc3a8af8` |
| init | `nvcr.io/nvidia/osmo/init-container@sha256:0278a28a2bcab7c1c7f3d4b821569c04f04d1817cb770a6d2a74d61e1a346704` |
| client | `nvcr.io/nvidia/osmo/client@sha256:912b30bffb90531688dacd349d79fae3013a5d3ed6ad091158ba885625d8b48a` |
