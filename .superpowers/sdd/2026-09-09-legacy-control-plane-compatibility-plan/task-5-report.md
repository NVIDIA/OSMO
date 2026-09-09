# Task 5 Report: Collision-free service-auth migration retries

## Status

Implemented and verified collision-free, attempt-scoped service-auth migration
hook identities for the unified OSMO chart. The change retains raw Helm
pre-upgrade hooks and Argo CD PreSync metadata, adds failed-hook cleanup to the
Job, and does not broaden Secret RBAC.

## Implementation

- Added `secrets.serviceAuth.migration.attempt` with the string default `"1"`.
- Required `migration.attempt` in the values schema as a string with
  `minLength: 1`.
- Replaced the fixed migration resource name with one shared DNS-safe name for
  the ServiceAccount, Role, RoleBinding, Job, RoleBinding references, and Job
  `serviceAccountName`.
- Built the name hash from exactly these identity inputs:
  - Helm release name
  - Helm release namespace
  - target Secret name
  - target Secret key
  - migration attempt
  - resolved API service image
- Used a bounded base name and the required name expression so the complete
  ten-character hash remains inside Kubernetes' 63-character name limit:

  ```gotemplate
  {{- $name := printf "%s-%s" $baseName ($identity | toJson | sha256sum | trunc 10) | trunc 63 | trimSuffix "-" -}}
  ```

- Added `hook-failed` to the Job's Helm delete policy and `HookFailed` to its
  Argo CD hook delete policy. Existing hook type, weights, sync waves, and the
  ServiceAccount/Role/RoleBinding cleanup policies remain intact.
- Kept Role access target-scoped to the configured Secret with only
  `get,update`; no `create` or other Secret verb was added.
- Updated the Task 1 PostgreSQL `sslMode=require` render test to locate the new
  hashed migration Job while retaining all of its existing SSL-mode and CA
  absence assertions.
- Added no Argo CD `Force`/`Replace`, Deployment adoption, Secret creation or
  rotation, or global cleanup behavior.

## Files changed

- `deployments/charts/osmo/values.yaml`
- `deployments/charts/osmo/values.schema.json`
- `deployments/charts/osmo/templates/service-auth-db-migration.yaml`
- `deployments/charts/osmo/tests/test_osmo_charts.sh`
- `.superpowers/sdd/2026-09-09-legacy-control-plane-compatibility-plan/task-5-report.md`

No environment files, internal-TLS templates, Vault configuration, live
systems, or Deployment manifests were changed.

## TDD evidence

### RED

The render assertions were added before production changes. They render
attempts `1` and `2` and check:

- a single shared hashed identity across ServiceAccount, Role, RoleBinding,
  and Job;
- a different identity after changing the attempt;
- DNS-safe format and maximum length;
- target-scoped `get,update` Secret RBAC with no `create`;
- Helm pre-upgrade and complete failed-hook cleanup metadata on all four
  resources;
- Argo CD PreSync and complete failed-hook cleanup metadata on all four
  resources;
- absence of Argo CD `Force=true` and `Replace=true`;
- schema rejection of an empty migration attempt.

Command:

```bash
bash deployments/charts/osmo/tests/test_osmo_charts.sh
```

The first sandboxed invocation could not download the pinned Valkey OCI chart
because network access was denied, so it did not qualify as feature RED. The
approved rerun reached the new assertion setup and failed with exit code `1`
for the expected missing feature:

```text
PASS: OSMO database migration runner tests
Error: values don't meet the specifications of the schema(s) in the following chart(s):
osmo:
- at '/secrets/serviceAuth/migration': additional properties 'attempt' not allowed
```

### GREEN

The first post-implementation suite run found a stale Task 1 fixture lookup:

```text
resource not found: Job/pg-require-osmo-service-auth-db-migration
```

The cause was the Task 1 PostgreSQL SSL-mode test selecting the migration Job
by its former fixed name. It was updated to resolve the hashed name through the
existing render-test helper. Its assertions for `sslMode=require`, no
`PGSSLROOTCERT`, no PostgreSQL CA, and no `sslrootcert=` remain unchanged.

Final fresh command after all assertion refinements:

```bash
bash deployments/charts/osmo/tests/test_osmo_charts.sh
```

Result: exit code `0`.

```text
PASS: OSMO database migration runner tests
PASS: OSMO Helm chart tests (all)
```

Static verification also passed:

```bash
bash -n deployments/charts/osmo/tests/test_osmo_charts.sh
git diff --check
```

## Raw Helm compatibility and retry inspection

I copied the chart to a temporary directory, built its pinned dependencies,
and rendered only `templates/service-auth-db-migration.yaml` through raw
`helm template` for attempts `1` and `2` using the split control-plane and
external dependency values.

Attempt `1` produced one common name across all four kinds:

```text
ServiceAccount/task5-inspect-osmo-service-auth-db-migration-0a57564b96
Role/task5-inspect-osmo-service-auth-db-migration-0a57564b96
RoleBinding/task5-inspect-osmo-service-auth-db-migration-0a57564b96
Job/task5-inspect-osmo-service-auth-db-migration-0a57564b96
```

Attempt `2` produced a different common name:

```text
ServiceAccount/task5-inspect-osmo-service-auth-db-migration-50b9399dea
Role/task5-inspect-osmo-service-auth-db-migration-50b9399dea
RoleBinding/task5-inspect-osmo-service-auth-db-migration-50b9399dea
Job/task5-inspect-osmo-service-auth-db-migration-50b9399dea
```

Each render contained:

```text
Helm pre-upgrade hooks: 4
Helm complete delete policies: 4
Argo PreSync hooks: 4
Argo complete delete policies: 4
resourceNames: ["osmo-service-auth"]
verbs: ["get", "update"]
Argo force/replace options: absent
```

This confirms raw Helm still sees all four resources as `pre-upgrade` hooks,
with `before-hook-creation,hook-succeeded,hook-failed` cleanup, while the Argo
CD metadata remains PreSync with matching failed-hook cleanup.

## Self-review

- Confirmed attempt is a required, non-empty schema string and defaults to
  `"1"`.
- Confirmed identity contains the six required inputs and no global revision,
  force, or replacement mechanism.
- Confirmed every metadata/reference occurrence uses the same `$name`.
- Confirmed the ten-character hash is retained and the rendered name is DNS
  safe and no longer than 63 characters.
- Confirmed all existing Helm and Argo CD hook weights/types/sync waves remain
  unchanged.
- Confirmed all four resources have both Helm and Argo CD failed-hook cleanup.
- Confirmed the Role still has one verbs entry, exactly `get,update`, scoped by
  `resourceNames` to the configured target Secret.
- Confirmed no Secret resource is rendered, no Secret `create` verb appears,
  and service identity creation/rotation behavior was not introduced.
- Confirmed Task 1 PostgreSQL SSL-mode assertions remain present and pass.
- Confirmed the diff contains only Task 5 chart, render-test, and report files.

## Concerns

No Task 5 blocker or behavioral concern remains. The passing chart suite emits
an existing awk warning about `\\\"` being an unknown regular-expression escape;
it is outside this task's changed assertions and did not affect the exit code.
The suite and standalone inspection also require network access when their
pinned OCI chart dependencies are not already present locally.

## Fix round 1: stable Helm retry support resources

This section supersedes the original report's common-name conclusion for the
ServiceAccount, Role, and RoleBinding. The original attempt-hashed common name
is safe under newer Helm cleanup behavior but is not a reliable retry cleanup
contract for older Helm 3 clients that this chart does not exclude.

### Helm lifecycle verification

The installed client is Helm `v4.0.4`. I inspected the matching upstream
`pkg/action/hooks.go`, then inspected Helm `v3.19.4`, `v3.18.6`, and `v3.14.4`
for the same failed-hook branch.

- Helm 4.0.4 and Helm 3.19.4 call `deleteHooksByPolicy` with
  `HookSucceeded` for prior successful hooks when a later hook fails. With
  these versions, the successful `-20` support hooks are deleted when the
  `-10` Job fails because they include `hook-succeeded`.
- Helm 3.18.6 and Helm 3.14.4 delete only the currently failed hook under
  `HookFailed` and return. They do not apply cleanup to earlier successful
  hooks in the failed event.
- The chart declares Kubernetes compatibility but no minimum Helm version, so
  raw Helm compatibility cannot depend on the newer cleanup branch.

With the original common attempt-hashed name, an older Helm client could leave
the successful ServiceAccount, Role, and RoleBinding behind after the Job
failed. Changing `migration.attempt` also changed those names, so the next
run's `before-hook-creation` policy addressed only the new names and could not
reconcile the earlier support objects.

### Corrected contract and tradeoff

The smallest cross-version correction separates the two identity lifecycles:

- ServiceAccount, Role, and RoleBinding use the stable release-scoped
  `osmo.component.fullname` ending in `service-auth-db-migration`.
- Job alone uses the full-input, attempt-scoped ten-character hash introduced
  in Task 5.
- RoleBinding subject and `roleRef`, plus the Job's `serviceAccountName`, all
  reference the stable support name.

On older Helm 3, support resources can still remain temporarily after a failed
Job because `hook-failed` does not apply to already-successful hooks. Their
stable names make cleanup deterministic on the next retry: each `-20` hook's
`before-hook-creation` deletes its prior object before recreating it, even when
the attempt, target Secret correction, or migration image changes. The Job
retains its attempt-hashed name to avoid retry collisions. Newer Helm versions
also delete the support hooks immediately through `hook-succeeded` when the Job
fails.

This intentionally replaces the original “one common attempt-hashed name for
all four kinds” requirement. Retaining that requirement is incompatible with
reliable retry reconciliation on older Helm 3 without adding broader cleanup
RBAC or a separate cleanup controller/Job. The split-name contract preserves
the existing raw Helm and Argo CD sequencing and cleanup annotations with no
new privileges or global force behavior.

### Test-first change

The render assertions were amended before the template:

- attempts `1` and `2` must produce different hashed Job names;
- both attempts must use the same stable ServiceAccount, Role, and RoleBinding
  name;
- the Job must reference the stable ServiceAccount;
- the RoleBinding must reference the stable ServiceAccount and Role;
- support hooks remain at Helm weight and Argo sync wave `-20`;
- the Job remains at Helm weight and Argo sync wave `-10`;
- every hook retains Helm/Argo failed-hook cleanup;
- Secret RBAC remains exactly one `get,update` verbs entry scoped to the
  configured Secret, with no `create`;
- Argo CD `Force=true` and `Replace=true` remain absent.

Fix-round RED command:

```bash
bash deployments/charts/osmo/tests/test_osmo_charts.sh
```

Expected result, exit code `1`:

```text
PASS: OSMO database migration runner tests
resource not found: ServiceAccount/service-auth-migration-osmo-service-auth-db-migration
```

After splitting the template names, the same covering command completed with
exit code `0`:

```text
PASS: OSMO database migration runner tests
PASS: OSMO Helm chart tests (all)
```

The successful run retained the pre-existing non-fatal awk escape warning
already noted above.

### Raw Helm render evidence

I rendered `templates/service-auth-db-migration.yaml` through raw
`helm template` for both attempts after building the pinned dependencies in a
temporary chart copy.

Attempt `1`:

```text
ServiceAccount/task5-inspect-osmo-service-auth-db-migration
Role/task5-inspect-osmo-service-auth-db-migration
RoleBinding/task5-inspect-osmo-service-auth-db-migration
Job/task5-inspect-osmo-service-auth-db-migration-0a57564b96
serviceAccountName: "task5-inspect-osmo-service-auth-db-migration"
```

Attempt `2`:

```text
ServiceAccount/task5-inspect-osmo-service-auth-db-migration
Role/task5-inspect-osmo-service-auth-db-migration
RoleBinding/task5-inspect-osmo-service-auth-db-migration
Job/task5-inspect-osmo-service-auth-db-migration-50b9399dea
serviceAccountName: "task5-inspect-osmo-service-auth-db-migration"
```

Each attempt also produced:

```text
weight -20: 3
weight -10: 1
Helm complete delete policies: 4
Argo complete delete policies: 4
verbs: ["get", "update"]
Argo force/replace options: absent
```

### Fix-round self-review

- Only the migration template, its unified render tests, and this report were
  changed in fix round 1.
- The attempt value/schema and full Job identity tuple are unchanged.
- The Job name remains deterministic, DNS safe, no longer than 63 characters,
  and changes with `migration.attempt`.
- Support names remain deterministic and stable for all retries of the same
  Helm release.
- Raw Helm `pre-upgrade` type, weights, and all delete policies are unchanged.
- Argo CD PreSync type, sync waves, and all delete policies are unchanged.
- The Role still grants only `get,update` on the configured Secret; no Secret
  `create`, cleanup privilege, identity rotation, Force/Replace, or Deployment
  adoption was added.
- PostgreSQL SSL-mode coverage remains unchanged and passes.

No fix-round blocker remains. On Helm versions before the prior-successful-hook
cleanup enhancement, successful support hooks may exist between a failed run
and its retry; the stable identity ensures the retry cleans and recreates them
deterministically.
