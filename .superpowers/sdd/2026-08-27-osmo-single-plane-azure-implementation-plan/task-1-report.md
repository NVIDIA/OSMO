# Task 1 Report: native external object-storage locations

## Implementation

Replaced the public external object-storage values contract with
`externalDependencies.objectStorage.locations.{workflows,logs,apps}` and the
optional `s3.{region,overrideUrl}` settings. Each external location accepts a
complete `s3://` or `azure://` SDK URI. The schema rejects the retired
`endpoint`, `region`, and `buckets` shape.

The chart now renders each workflow credential from its effective location.
S3-only fields are added only when non-empty, so Azure output carries no
`override_url`, `region`, or S3 URI. Embedded RustFS retains its endpoint and
bucket helpers; its effective locations remain `s3://<bucket>/<use>`.

Validation requires all external locations for a control-plane release,
requires a single URI scheme, rejects S3 settings for Azure, and requires all
external locations/S3 settings to be empty in embedded mode. The test suite
covers S3 and Azure rendering, missing/mixed/invalid locations, Azure S3
settings, and retired properties.

The controller-approved quickstart correction changes only its stale MEK
settings to `managementMode: osmo`, named `existingSecret`, and enabled
bootstrap. Its existing required `objectStorage.generate: true` value remains
once (there was no duplicate key in the checked-out profile); the quickstart
test now matches the current hashed MEK bootstrap Job name.

## Files

- `deployments/charts/osmo/{values.yaml,values.schema.json}`
- `deployments/charts/osmo/templates/{_helpers.tpl,configs.yaml,validate-values.yaml}`
- `deployments/charts/osmo/tests/{control-external-values.yaml,control-external-azure-values.yaml,control-embedded-values.yaml,object-storage-lifecycle-values.yaml,test_osmo_charts.sh}`
- `deployments/charts/osmo/{embedded-rustfs-ha-values.yaml,profiles/quickstart.yaml,README.md}`

## TDD Evidence

The tests and both external fixtures were changed before templates, values, or
schema production code.

RED command:

```bash
bash deployments/charts/osmo/tests/test_osmo_charts.sh osmo
```

RED output (exit 1):

```text
Error: execution error at (osmo/templates/validate-values.yaml:378:4): externalDependencies.objectStorage.endpoint is required for the control plane

Use --debug flag to render out invalid YAML
```

This is the expected old-contract failure: the migrated fixture has locations
but the old template still required `endpoint`.

GREEN command:

```bash
bash deployments/charts/osmo/tests/test_osmo_charts.sh osmo
```

GREEN result: exit 0. Helm printed only its pinned dependency fetch:

```text
Pulled: ghcr.io/valkey-io/valkey-helm/valkey:0.11.0
Digest: sha256:55b08229a874b687d4a4773683d19db1277db996c889c08f2fa6179d5316ec4c
```

Complete chart suite command:

```bash
bash deployments/charts/osmo/tests/test_osmo_charts.sh
```

Complete suite result: exit 0.

Additional verification:

```bash
helm lint deployments/charts/osmo --strict --kube-version 1.30.0 \
  -f deployments/charts/osmo/profiles/split-plane-control.yaml \
  -f deployments/charts/osmo/tests/control-external-values.yaml
```

```text
1 chart(s) linted, 0 chart(s) failed
```

```bash
helm template azure-storage deployments/charts/osmo --kube-version 1.30.0 \
  -f deployments/charts/osmo/profiles/split-plane-control.yaml \
  -f deployments/charts/osmo/tests/control-external-azure-values.yaml >/tmp/osmo-azure.yaml
```

The rendered API ConfigMap contains only:

```text
endpoint: azure://osmotest/osmo-workflows/apps
endpoint: azure://osmotest/osmo-workflows/workflows
endpoint: azure://osmotest/osmo-workflows/logs
```

and contains no `override_url`, `region:`, or `s3://` values.

## Self-review

- Schema has `additionalProperties: false` on the connection, locations, and
  S3 objects; values default all new external fields to empty.
- Config rendering carries only Secret references (`secretName` and
  `secretKey`), never credential data.
- Embedded RustFS template paths remain endpoint/bucket based and are covered
  by the complete chart suite.
- Search found no production use of retired external endpoint/region/buckets
  values. The two intentional legacy negative tests retain those names solely
  to prove schema rejection.
- `git diff --check` and `jq empty deployments/charts/osmo/values.schema.json`
  passed.

## Concerns

The installed Helm version reports JSON-schema diagnostics as `does not match
pattern` and `additional properties 'endpoint' not allowed`, rather than the
brief's requested `Must validate "pattern"` / `Additional property endpoint is
not allowed` capitalization and wording. The tests assert the actual Helm
diagnostics while exercising the required schema rejections; changing this
would require a Helm-version-specific assertion rather than a chart change.
