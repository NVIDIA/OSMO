<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
-->

# Path-Scoped Registry Credentials

**Author**: [Trasha Dewan](https://github.com/tdewan-nvidia)<br>
**PIC**: TBD<br>
**Proposal Issue**: TBD<br>
**Slack Context**: [#osmo discussion](https://nvidia.slack.com/archives/C017S566MHD/p1778521163785859)

## Overview

Today every OSMO registry credential is keyed by hostname alone, so a user can have at most one credential per host (e.g. one for `nvcr.io`). Users with multiple service accounts on the same registry — e.g. one robot account for `nvcr.io/nvstaging/osmo` and a different one for `nvcr.io/nvstaging/isaac` — cannot model that in OSMO today. This project adds path-scoped credential resolution using the same longest-prefix semantics that Kubernetes itself uses for `~/.docker/config.json`.

### Motivation

- Real users have multiple robot accounts on `nvcr.io` scoped to different teams/orgs.
- Workarounds today (sharing one over-scoped credential, or rebuilding images into a single org) are operationally painful and weaken least-privilege.
- The desired behavior matches a well-known Kubernetes convention, so users already understand the mental model.

### Problem

`get_registry_cred(user, registry)` in `src/utils/connectors/postgres.py:1567` looks up credentials keyed by `(user_name, profile)` where `profile` is always `image_info.host`. Both resolution sites — `src/utils/job/workflow.py:636` (manifest pre-flight) and `src/utils/job/task.py:2654` (imagePullSecret construction) — pass only `image_info.host`, so the repository path portion (`image_info.name`, e.g. `nvstaging/osmo`) is ignored.

This makes it structurally impossible to register two credentials that share a host. The DB constraint `CONSTRAINT unique_cred UNIQUE (user_name, profile)` (postgres.py:1175) enforces this.

## Use Cases

| Use Case | Description |
|---|---|
| Path-scoped robot accounts | A user holds two NGC robot account tokens — one with read access to `nvcr.io/nvstaging/osmo`, another with read access to `nvcr.io/nvstaging/isaac`. They register both in OSMO and submit workflows that pull from either path; OSMO selects the correct credential per image. |
| Host-wide fallback | A user has one path-scoped credential for `nvcr.io/nvstaging/isaac` plus a broader host-level credential for `nvcr.io`. Images under `nvcr.io/nvstaging/isaac/*` use the scoped credential; everything else under `nvcr.io` falls back to the host credential. |
| Existing host-only credential keeps working | A user with a single legacy `nvcr.io` credential sees no change in behavior after upgrade. No re-registration required. |

## Requirements

| Title | Description | Type |
|---|---|---|
| Path-scoped credential registration | A user shall be able to register a registry credential whose profile includes a repository path prefix (e.g. `nvcr.io/nvstaging/osmo`). | Functional |
| Longest-prefix resolution | When pulling an image, OSMO shall select the credential whose profile is the longest path prefix of the image's `host/name`. | Functional |
| Host-only credentials remain valid | A pre-existing credential with `profile=<host>` shall continue to authenticate every image on that host that has no more-specific credential. | Compatibility |
| No re-registration on upgrade | Existing credentials shall keep working after deploy without user action and without a backfill job. | Compatibility |
| `valid_cred` works for path-scoped profiles | New profiles shall be validated by authenticating to the registry's `/v2/` endpoint, not by appending the path to the URL. | Functional |
| Resolution failure preserves current error | When no credential matches, OSMO shall raise the existing `OSMOCredentialError` and reference the most specific path tried. | Functional |
| K8s imagePullSecret remains kubelet-resolvable | The generated `.dockerconfigjson` shall key entries by the credential's full profile string so the kubelet's own longest-prefix matcher resolves them at pull time. | Functional |

## Architectural Details

The credential subsystem stores rows in a single `credential` table where `profile` is a free-form `TEXT` column. Today `profile` always holds a bare hostname for `REGISTRY` rows; we will allow it to hold `host[/path...]` instead. No schema migration is required: the column already accepts the longer string, and the existing `UNIQUE (user_name, profile)` constraint is exactly what we want — it now means "at most one credential per `(user, registry+path)`" rather than "at most one per `(user, host)`".

Resolution moves from an exact-match SELECT to a candidate-set SELECT plus client-side longest-prefix selection. The imagePullSecret produced for K8s pods continues to be a single `.dockerconfigjson` Secret; we just emit multiple entries (one per matching credential) and let kubelet pick — matching Kubernetes's documented behavior.

```
┌──────────────────────────────────────────────────────────────────────┐
│  User submits workflow with image nvcr.io/nvstaging/osmo/foo:v1     │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
            common.docker_parse(image)
            ├─ host = "nvcr.io"
            ├─ name = "nvstaging/osmo/foo"
            └─ full_repo = "nvcr.io/nvstaging/osmo/foo"
                              │
                              ▼
   resolve_registry_cred(user, full_repo)         ← NEW helper
   ┌──────────────────────────────────────────┐
   │ Candidate profiles for user (one query): │
   │   "nvcr.io"                              │
   │   "nvcr.io/nvstaging/osmo"               │  ← longest prefix wins
   │   "docker.io"                            │
   └──────────────────────────────────────────┘
                              │
                              ▼
       workflow.py: registry_auth(manifest_url, …)
       task.py:    docker_config[<winning_profile>] = {auth: …}
                   plus any other matching profiles
                   so kubelet can re-resolve on pull
```

## Detailed Design

### Image / repository representation

`common.docker_parse` already returns `host` and `name` separately (`src/lib/utils/common.py:452`). The "image repository path" used for credential matching is `f"{host}/{name}"`. We add one helper next to it:

```python
def image_repo_path(info: DockerImageInfo) -> str:
    """Full repository path used for registry credential matching.

    For "nvcr.io/nvstaging/osmo/foo:v1" returns "nvcr.io/nvstaging/osmo/foo".
    """
    return f"{info.host}/{info.name}"
```

`registry_parse` (common.py:445) is unchanged — it still normalizes `docker.io`/empty to the default registry. Path-bearing profiles pass through untouched.

### Data model

`RegistryCredential` (`src/lib/utils/credentials.py:32`) needs no field changes — the existing `registry: str` field accepts `host` or `host/path`. We update the field description and add a validator:

```python
class RegistryCredential(pydantic.BaseModel, extra='forbid', populate_by_name=True):
    registry: str = pydantic.Field(
        '',
        description=(
            'The Docker registry to authenticate to. May be a hostname '
            '(e.g. "nvcr.io") or a path prefix (e.g. "nvcr.io/nvstaging/osmo"). '
            'When pulling, the longest matching prefix wins, mirroring '
            'Kubernetes ~/.docker/config.json behavior.'
        ),
    )
    # username / auth unchanged
```

Validator rules (enforced in `UserRegistryCredential.valid_cred`, `src/service/core/workflow/objects.py:614`):

- Must be a valid host (or host:port), optionally followed by `/segment[/segment...]`.
- No scheme, no trailing slash, no query string.
- Normalize: strip trailing slash, collapse duplicate `/`, run `common.registry_parse` on the host portion only.
- Authentication probe targets `https://{host_only}/v2/` — the registry doesn't expose per-path auth endpoints.

### Database

**No schema change.** `profile TEXT` already accepts arbitrary length strings. `UNIQUE (user_name, profile)` (postgres.py:1175) becomes "one credential per `(user, registry-or-path)`", which is the desired semantics.

A user can therefore register:

| `cred_name` | `cred_type` | `profile` |
|---|---|---|
| `nvcr-osmo` | REGISTRY | `nvcr.io/nvstaging/osmo` |
| `nvcr-isaac` | REGISTRY | `nvcr.io/nvstaging/isaac` |
| `nvcr-fallback` | REGISTRY | `nvcr.io` |
| `dockerhub` | REGISTRY | `docker.io` |

### Resolver

New method on `PostgresConnector`:

```python
def get_registry_creds_for_user(self, user: str) -> List[Tuple[str, Dict[str, str]]]:
    """Return all REGISTRY credentials for user as [(profile, payload), ...]."""
```

New pure helper in `src/utils/job/task.py` (or `src/lib/utils/common.py`, see Open Questions):

```python
def select_registry_cred(
    image_repo: str,
    candidates: Iterable[Tuple[str, Dict[str, str]]],
) -> Optional[Tuple[str, Dict[str, str]]]:
    """Pick the credential whose profile is the longest prefix of image_repo.

    A profile P matches image_repo R when R == P or R startswith P + "/".
    Returns (profile, payload) or None.
    """
```

This guards against `nvcr.io/nvstaging/osmo` matching `nvcr.io/nvstaging/osmo-private` (substring vs path prefix).

### Resolution site 1: workflow validation

`src/utils/job/workflow.py:615` `validate_registry`:

```python
# before
registry_cred = connectors.PostgresConnector.get_instance()\
    .get_registry_cred(user, image_info.host)
if registry_cred:
    response = common.registry_auth(image_info.manifest_url,
                                    registry_cred['username'],
                                    registry_cred['auth'])

# after
db = connectors.PostgresConnector.get_instance()
candidates = db.get_registry_creds_for_user(user)
match = select_registry_cred(common.image_repo_path(image_info), candidates)
if match is not None:

    _, registry_cred = match
    response = common.registry_auth(image_info.manifest_url,
                                    registry_cred['username'],
                                    registry_cred['auth'])
```

Error message updated to include the image repo path: `Please create a credential for nvcr.io/nvstaging/osmo (or a broader prefix).`

### Resolution site 2: imagePullSecret construction

`src/utils/job/task.py:2654` `_get_registry_creds`:

```python
def _get_registry_creds(self, user: str, workflow_config: connectors.WorkflowConfig):
    registry_creds_user: Dict[str, Dict[str, str]] = {}
    candidates = self.database.get_registry_creds_for_user(user)

    for t in self.spec.tasks:
        info = common.docker_parse(t.image)
        repo = common.image_repo_path(info)
        # Emit every credential whose profile is a prefix of this image's repo path.
        # kubelet will perform longest-prefix selection at pull time.
        for profile, payload in candidates:
            if _profile_matches_repo(profile, repo) and profile not in registry_creds_user:
                auth_string = f"{payload['username']}:{payload['auth']}"
                registry_creds_user[profile] = {
                    'auth': base64.b64encode(auth_string.encode('utf-8')).decode('utf-8')
                }
    # osmo cred block unchanged
    ...
```

The returned `registry_creds_user` is fed into a single `.dockerconfigjson` Secret (the `auths` map kubelet reads). See "Secret structure" and "Kubelet pull-time semantics" below for why one Secret with many `auths` entries is the right shape.

### Secret structure: one user-Secret with many `auths` entries

Pod `imagePullSecrets` is already a list, and today `task.py:3024,3033` attaches two Secrets per pod: `<group_uid>-user` and (optionally) `<group_uid>-osmo`. We keep that shape — the user-Secret simply grows additional `auths` entries when the user has path-scoped credentials. Considered and rejected: a "one Secret per matching credential" model that would push a list of N Secrets into `imagePullSecrets`. Both work identically at pull time per the kubelet docs, but the multi-Secret model adds K8s objects per workflow, more cleanup paths, and no benefit since Secrets here are group-scoped and torn down with the group (no sharing or rotation story).

### Kubelet pull-time semantics

This is critical to the safety of the design and should not be re-litigated:

- **All K8s versions of interest support multiple `auths` entries in a `kubernetes.io/dockerconfigjson` Secret.** This is a long-standing kubelet feature that predates 1.24 and has had no breaking changes since.
- **The kubelet tries every credential whose pattern matches the image, in sequence, until one succeeds.** Quoting the Kubernetes docs (Interpretation of config.json):
  > "Image pull operations pass the credentials to the CRI container runtime for every valid pattern."
  >
  > "The kubelet performs image pulls sequentially for every found credential … if one authentication source fails, the kubelet will attempt to download using alternate credentials."
- Implication for OSMO: our `select_registry_cred` resolver matters only for the **pre-flight manifest probe** in `workflow.py:636` (an HTTP call OSMO itself makes). At pull time, kubelet sees every prefix-matching entry and falls back automatically. There is no risk of a "wrong" credential being silently selected — if a path-scoped robot account lacks access to a different image on the same host, kubelet falls through to the host-level credential.
- Known edge case: kubernetes/kubernetes#122821 (closed) affects CRI-O when registry *mirrors* have a different prefix vs. location. We do not use mirror redirection, so this does not apply.

### CLI

`src/cli/credential.py` needs no schema changes — `--payload registry=...` already accepts arbitrary strings. We add:

- Help text update on the `set` subcommand: `registry can be a host (nvcr.io) or a path prefix (nvcr.io/nvstaging/osmo).`
- An example in `--help` output and in any user docs.
- `osmo credential list` already prints `Profile`, which will now show the path-prefix for new entries with no formatting changes.

### API

`POST /api/credentials/{cred_name}` body shape (`UserRegistryCredential`) is unchanged. Validation logic in `valid_cred` is updated to accept path prefixes and to probe `https://{host}/v2/` rather than `https://{registry}/v2/`. Returning `409 Conflict` on profile collision is already handled by the `ON CONFLICT (user_name, profile)` clause.

### Alternatives Considered

**1. New `path` column on `credential` table.** Cleaner schema but requires a pgroll migration, a UNIQUE constraint change, and a code path to read/write a second column. Functionally equivalent to overloading `profile` because the longest-prefix match still has to be computed in code. Rejected for marginal cost/benefit.

**2. Raw imagePullSecret pass-through.** Let users supply a full K8s `.dockerconfigjson` Secret. Most flexible but:
- Leaks K8s implementation details into the user-facing API.
- Bypasses `SecretManager` (JWE encryption in `utils/secret_manager/`) — credentials would be stored as opaque blobs OSMO can't inspect, rotate, or audit.
- Allows users to craft arbitrary Secret manifests (auth-store handles, file references) that OSMO's data plane is not prepared to honor.
Rejected on security grounds.

### Backwards Compatibility

This is the load-bearing section. The plan is backward compatible by construction:

| Aspect | Pre-change behavior | Post-change behavior | Notes |
|---|---|---|---|
| Existing host-only rows (e.g. `profile='nvcr.io'`) | Match every image on that host | Still match every image on that host (path-prefix match where the "path" portion of the prefix is empty) | The matcher treats `host` as a prefix of `host/anything` |
| `get_registry_cred(user, host)` callers | Direct exact-match SELECT | Function removed or kept as a thin wrapper that calls the new resolver | Audit call sites; only two known (workflow.py:636 and task.py:2661) |
| DB schema | `profile TEXT` + `UNIQUE (user_name, profile)` | Identical | No migration |
| Credential API request body | `{registry, username, auth}` | Identical | Only the accepted *value* of `registry` is broadened |
| CLI payload | `--payload registry=nvcr.io …` | `--payload registry=nvcr.io/nvstaging/osmo …` (still accepts host-only) | Help text updated |
| Generated imagePullSecret JSON shape | `{auths: {host: {auth: …}}}` | `{auths: {host-or-path: {auth: …}}}` — kubelet supports both | Kubernetes documented behavior |
| `valid_cred` registry probe | `https://{registry}/v2/` (worked when registry was a host) | `https://{host_only}/v2/` | Required so probes work for path-bearing profiles |
| OSMO-owned credential (`backend_images.credential`) | Single host-keyed entry | Unchanged | Out of scope |

**Risks specifically called out by the user**:

- *"Don't break old things."* Existing rows are untouched; existing API/CLI calls produce identical results; existing resolution behavior is a strict subset of new resolution behavior. The matcher MUST treat a bare-host profile as matching everything on that host — covered by the "Host-only fallback" use case test below.
- The substring-vs-prefix bug (`nvcr.io/nvstaging/osmo` matching `nvcr.io/nvstaging/osmo-private`) is explicitly handled in `select_registry_cred` and gets a dedicated unit test.
- `decrypt_credential` (postgres.py:659) returns the same payload shape; we don't touch payload encoding.

### Performance

Resolution goes from a single indexed exact-match SELECT to a single indexed range SELECT (`WHERE user_name = %s AND cred_type = 'REGISTRY'`) returning all of one user's registry credentials, with longest-prefix selection in Python. Typical users have well under 20 registry credentials, so the in-memory selection is O(N) with negligible cost. The result is cached per-workflow-submission in `_get_registry_creds` (the existing `registry_cred_cache` becomes a one-shot fetch instead of per-host). Net: same or fewer round-trips to Postgres.

At pull time, kubelet retries each matching credential in turn (see "Kubelet pull-time semantics"). A user who registers a stale or broken credential whose prefix matches an image will see pull latency increase by one auth round-trip per failing credential before kubelet falls through to a working one. Soft cost; matches existing K8s behavior — a user with a broken host-level credential sees the same effect today.

### Operations

- No new services, no new K8s objects, no new env vars.
- No migration step in deploy.
- Rollback is a code revert: any path-scoped credentials registered before rollback will continue to resolve as host-level only — which means they may stop matching images. Operators rolling back should warn affected users to re-register, but this is a soft failure (image pull error, no data loss).

### Security

- No change to credential storage encryption (JWE via `SecretManager`).
- The `valid_cred` probe is the only outbound network call and continues to target the registry's published auth endpoint (`/v2/`).
- Path-scoped credentials reduce blast radius vs. the current state (users no longer need to grant a single credential broad access to satisfy multiple paths). Net security improvement.
- We must reject profiles containing `..`, `.`, leading/trailing `/`, scheme, or query string — covered by the validator and a security-focused unit test.

### Documentation

- Update `RegistryCredential` field docstring (auto-flows to OpenAPI / Swagger UI).
- Update `osmo credential set --help` text.
- Add a "Path-scoped registry credentials" subsection to the credential management page under `docs/user_guide/` with the K8s parallel and at least one worked example.
- Reference the Kubernetes docs page (`https://kubernetes.io/docs/concepts/containers/images/#config-json`) in both code comments and user docs so readers understand the matching semantics didn't come from nowhere.

### Testing

**Unit tests**:

- `select_registry_cred` — table-driven test covering: exact host match, longest-prefix win, no match, prefix-vs-substring (`osmo` vs `osmo-private`), trailing-slash handling, host-only fallback when path-scoped exists for sibling org.
- `RegistryCredential` validator — accepts `nvcr.io`, `nvcr.io:5000`, `nvcr.io/nvstaging/osmo`; rejects `https://nvcr.io`, `nvcr.io/`, `nvcr.io/..`, empty, scheme-bearing.
- `get_registry_creds_for_user` — returns all user rows in one query.
- `_get_registry_creds` — emits multiple `auths` entries when several profiles prefix-match a task image.

**Regression tests** (the "don't break old things" gate):

- Test using a single host-only profile resolves correctly for any image under that host — both at the workflow.py:615 site and the task.py:2654 site.
- Test that the existing `test_credential.py` set/list/delete flows pass unchanged with host-only payloads.

**Integration test** (testcontainers + real Postgres):

- Insert one host-only row and one path-scoped row for the same host; submit two workflows (one image matching each); assert the correct credential is picked at the manifest pre-flight and the correct entry appears in the generated docker config.

**E2E manual verification**:

- Stand up a workflow against staging `nvcr.io` using a path-scoped robot account; confirm pull succeeds in the cluster.

### Dependencies

- None outside this repo. `tests/common/database/` already provides the Postgres testcontainers fixture used by the integration test above.
- Frontend (`ui/`) credential management screen may want to update its label/help text; coordinate with the UI owner but it can ship independently.

## Implementation Plan

Single feature flag–free PR is acceptable because of the strict backward-compatibility guarantees, but we'll split for review hygiene:

1. **PR 1 — Resolver and validator (no behavior change for existing users)**
   - Add `common.image_repo_path` (`src/lib/utils/common.py`).
   - Add `select_registry_cred` helper and unit tests.
   - Add `PostgresConnector.get_registry_creds_for_user` and unit tests.
   - Update `RegistryCredential` field description + validator; tests for accept/reject cases.

2. **PR 2 — Wire resolver into the two resolution sites**
   - `src/utils/job/workflow.py:615` `validate_registry` → use new resolver.
   - `src/utils/job/task.py:2654` `_get_registry_creds` → emit one entry per matching profile.
   - Update `test_task.py` mocks and assertions.
   - Update error message wording in `workflow.py:646`.
   - Update `valid_cred` (`src/service/core/workflow/objects.py:614`) to probe host-only endpoint.

3. **PR 3 — CLI help + user docs**
   - Help text updates in `src/cli/credential.py`.
   - User guide page under `docs/user_guide/`.
   - Example workflow / sample command.

4. **PR 4 — Integration test**
   - Add testcontainers-based integration test under `src/utils/job/tests/` covering both resolution sites with path-scoped + host-only rows.

After PR 2 lands, existing users see no change. After PR 3 lands, the feature is discoverable. The work is safe to release together.

## Open Questions

- [ ] Where does `select_registry_cred` live? Options: `src/lib/utils/common.py` (next to `docker_parse`) or `src/utils/job/task.py` (only consumer). Leaning `common.py` so workflow.py and task.py share one implementation.
- [ ] Do we want `osmo credential list` to also display which images each credential would match for a given workflow spec? Useful for debugging, but adds API surface — defer to a follow-up.
- [ ] Should we lint `profile` length / segment count to head off pathological inputs (e.g. 200-segment paths)? Recommend a soft cap of 8 path segments and 256 chars total, enforced in the validator.
- [ ] OSMO-owned credential (`workflow_config.backend_images.credential`) is currently host-only and still emitted as a single entry. Do we expose path scoping for the system credential too, or keep it host-only for now? Leaning keep host-only; revisit if a concrete need surfaces.
- [ ] JIRA / GitHub issue number to attach to this doc.
