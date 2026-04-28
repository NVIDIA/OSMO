<!--
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
-->

# Release Notes Template

This file documents the format for release notes in `releases/X.Y.Z.md`. Two
variants of the actual template follow: the pre-release variant (committed via
the `draft-release-notes` workflow when generating notes for an upcoming RC)
and the stable variant (the form left when the release ships and the RC notice
block is removed).

---

## Pre-release variant

Use this when creating `X.Y.Z.md` for a new pre-release. Paste below the
horizontal rule into the release file, then fill in the content.

---

```markdown
> **This is a pre-release** (`X.Y.Z-prerelease-rcN`). It has been validated in
> staging and is undergoing SQA testing. Production deployments should await
> the stable release.

## Highlights

- **Feature name** — One-sentence summary of the change and why it matters.
- **Feature name** — One-sentence summary of the change and why it matters.

## Breaking Changes

- **Change name**: What breaks, and what operators or users need to do.

## Authentication and Authorization

- **Feature or fix name**: Description of the change. (#NNN)

## Workflow Engine

- **Feature or fix name**: Description of the change. (#NNN)

## Data and Storage

- **Feature or fix name**: Description of the change. (#NNN)

## Scheduling and Compute

- **Feature or fix name**: Description of the change. (#NNN)

## Web UI

- **Feature or fix name**: Description of the change. (#NNN)

## CLI

- **Feature or fix name**: Description of the change. (#NNN)

## Bug Fixes

- **Fix name**: Description of the fix. (#NNN)

## Getting OSMO

### Helm Charts and Containers

Helm charts and container images are available on
[NGC](https://catalog.ngc.nvidia.com/orgs/nvidia/teams/osmo/containers/osmo).

### CLI Client

Installers for the CLI client for macOS (Apple Silicon), x86-64 Linux, and
ARM64 Linux are attached as assets to this release.
```

---

## Stable variant

When the release ships, remove the RC notice block at the top of the file. All
other sections remain identical. The resulting file looks like this:

---

```markdown
## Highlights

- **Feature name** — One-sentence summary of the change and why it matters.
- **Feature name** — One-sentence summary of the change and why it matters.

## Breaking Changes

- **Change name**: What breaks, and what operators or users need to do.

## Authentication and Authorization

- **Feature or fix name**: Description of the change. (#NNN)

## Workflow Engine

- **Feature or fix name**: Description of the change. (#NNN)

## Data and Storage

- **Feature or fix name**: Description of the change. (#NNN)

## Scheduling and Compute

- **Feature or fix name**: Description of the change. (#NNN)

## Web UI

- **Feature or fix name**: Description of the change. (#NNN)

## CLI

- **Feature or fix name**: Description of the change. (#NNN)

## Bug Fixes

- **Fix name**: Description of the fix. (#NNN)

## Getting OSMO

### Helm Charts and Containers

Helm charts and container images are available on
[NGC](https://catalog.ngc.nvidia.com/orgs/nvidia/teams/osmo/containers/osmo).

### CLI Client

Installers for the CLI client for macOS (Apple Silicon), x86-64 Linux, and
ARM64 Linux are attached as assets to this release.
```

---

## Section reference

| Section | When to include | Content |
|---|---|---|
| RC notice block | Pre-release only | Removed at stable promotion |
| Highlights | Always | 3-6 bullets; one per major change across all sections |
| Breaking Changes | Only if applicable | API removals, config format changes, behavior requiring action |
| Authentication and Authorization | If changes exist | RBAC, OAuth2/OIDC, JWT, authz sidecar, access tokens, credentials |
| Workflow Engine | If changes exist | Submission, execution, scheduling, task lifecycle, backend integration, quotas, pools, priority |
| Data and Storage | If changes exist | Datasets, collections, versioning, multi-backend storage, upload/download |
| Scheduling and Compute | If changes exist | KAI Scheduler, NVLink/topology placement, GPU resources, node pools |
| Web UI | If changes exist | User-visible UI changes, accessibility, new views, log viewer |
| CLI | If changes exist | CLI commands, output formatting, tab completion, packaging |
| Bug Fixes | If changes exist | Cross-cutting fixes not belonging to a functional section above |
| Getting OSMO | Always | Standard boilerplate; do not modify |

Empty sections must be removed. Do not leave sections with no bullets or a
"(none)" placeholder.

## Bullet format

Each bullet follows this pattern:

```
- **Short noun phrase**: One-sentence description of the user-visible change. (#NNN)
```

Multiple PRs for one change: `(#NNN, #NNN)`. No PR available: omit the reference
entirely. Do not fabricate PR numbers.

Highlights bullets use an em-dash instead of a colon:

```
- **Short noun phrase** — One-sentence summary of why it matters.
```

## AI generation guidance

When generating content for a release file from `git log`:

1. Run: `git log --oneline <prior-stable-tag>..<nominated-sha> -- .`
   (from the repo root). Exclude merge commits (`--no-merges`).

2. Exclude from release notes:
   - CI, test infrastructure, and build system changes
   - Dependency version bumps with no user-visible effect
   - Internal refactors with no behavioral change
   - Documentation-only commits
   - Formatting or linting fixes

3. Map each remaining commit to a section using the commit message prefix or
   the changed file paths as a signal. Commits touching `src/ui/` map to
   Web UI. Commits touching `src/cli/` map to CLI. Commits touching
   `src/service/core/auth/` or `src/utils/roles/` map to Authentication and
   Authorization. And so on.

4. Write in user-facing language. "Users can now submit to a default pool
   without specifying one." Not "Refactored pool resolution to fall back to
   default."

5. Write the Highlights section last, pulling the 3-6 most significant items
   from the body sections you have already written.

6. Target length: 300-600 words for a patch release (primarily bug fixes),
   600-1000 words for a feature-heavy minor release.

7. For pre-releases: fill in the RC number (`rcN`) in the notice block using
   the RC number from the nomination (the count of existing
   `X.Y.*-prerelease-rc*` tags + 1).
