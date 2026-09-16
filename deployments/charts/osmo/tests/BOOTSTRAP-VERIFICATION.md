# Single bootstrap Job verification

## Candidate and environment

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

## Fast checks completed

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

## Cluster results

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
