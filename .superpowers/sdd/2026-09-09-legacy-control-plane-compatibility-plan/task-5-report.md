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
