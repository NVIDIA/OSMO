# bump_version

Bumps OSMO semver (`src/lib/utils/version.yaml`) and all Helm chart versions
(`deployments/charts/*/Chart.yaml`) in lockstep.

## Usage

```sh
bazel run //scripts/bump_version -- --major   # 6.3.0 → 7.0.0; charts 1.3.0 → 2.0.0
bazel run //scripts/bump_version -- --minor   # 6.3.0 → 6.4.0; charts 1.3.0 → 1.4.0
bazel run //scripts/bump_version -- --patch   # 6.3.0 → 6.3.1; charts 1.3.0 → 1.3.1
```

Exactly one of `--major` / `--minor` / `--patch` is required.

## What it mutates

- `src/lib/utils/version.yaml` — `major` / `minor` / `revision`
- `deployments/charts/{service,web-ui,router,backend-operator,quick-start}/Chart.yaml` — top-level `version:` and `appVersion:`
- `deployments/charts/quick-start/Chart.yaml` — the four `dependencies[*].version` entries

License headers and inline comments are preserved byte-for-byte; only the target lines are touched.

## Invariants (checked before any write)

- All five charts' `version:` values must be identical
- All five charts' `appVersion:` values must be identical
- `appVersion` must equal `version.yaml`'s `{major}.{minor}.{revision}` exactly
- `quick-start`'s four dep `version:` values must equal its chart `version:`

If any check fails the script exits non-zero without writing.

## Tests

```sh
bazel test //scripts/bump_version/tests:test_bump_version
```
