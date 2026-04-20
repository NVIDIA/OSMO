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
