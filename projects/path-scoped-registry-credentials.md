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

**Author**: [Tushar Dewan](https://github.com/tdewanNvidia)<br>
**PIC**: [Tushar Dewan](https://github.com/tdewanNvidia)<br>
**Proposal Issue**: [#1113](https://github.com/nvidia/osmo/issues/1113)

## Overview

OSMO should allow registry credentials to be scoped to a registry path, not only
a registry host. This lets workflows select the correct credential when multiple
repositories share the same registry host.

### Motivation

Docker and Kubernetes image pull configuration supports matching credentials by
registry path. OSMO should preserve that behavior so users can safely configure
separate credentials for separate repository namespaces under one registry host.

### Problem

OSMO previously normalized registry credentials to host-only keys. That made
path-specific credentials indistinguishable and could cause workflow validation
or generated image pull secrets to use the wrong credential for an image path.

## Use Cases

| Use Case | Description |
|---|---|
| Separate credentials by path | A user configures different credentials for different repository paths under the same registry host. |
| Pull workflow images | OSMO validates and pulls an image using only credentials whose scope matches that image path. |
| Preserve host-level fallback | A host-level credential still applies when no more specific path-scoped credential exists. |

## Requirements

| Title | Description | Type |
|---|---|---|
| Preserve registry path | OSMO shall store the full registry path supplied for a registry credential. | Functional |
| Path-aware matching | OSMO shall match image references to credentials by registry host and path segment. | Functional |
| Specificity ordering | OSMO shall try more specific matching scopes before less specific scopes. | Functional |
| Pull secret generation | OSMO shall include matching registry credentials in generated image pull secrets. | Functional |
| Backwards compatibility | Existing host-scoped registry credentials shall continue to work. | Functional |

## Architectural Details

The change adds shared registry-scope helpers and routes all registry credential
lookup paths through them. A registry scope is the registry host plus an optional
repository path. Matching is segment-aware, so a scope for one sibling path does
not match another sibling path.

Key components:

| Component | Purpose |
|---|---|
| `src/lib/utils/common.py` | Normalizes registry scopes and provides matching helpers. |
| `src/utils/connectors/postgres.py` | Returns registry credentials keyed by normalized scope and decrypts only matching credentials. |
| `src/utils/job/workflow.py` | Validates private workflow images against matching user credentials. |
| `src/utils/job/task.py` | Builds image pull secrets from matching registry credentials. |
| `src/service/core/workflow/objects.py` | Validates registry credential creation using the normalized scope. |

## Detailed Design

Registry profiles are normalized into a canonical scope:

```text
<registry-host>[/repository/path]
```

Default HTTPS port notation is canonicalized so equivalent scopes compare the
same way. Non-default ports remain part of the scope.

When validating or preparing a workflow image, OSMO:

1. Parses the image reference.
2. Computes the image registry scope.
3. Finds all stored credential scopes that contain the image scope.
4. Orders matches from most specific to least specific.
5. Uses only those matching credentials for validation and image pull secret
   generation.

## Backwards Compatibility

Existing host-scoped credentials continue to match all image paths under the
same registry host. Path-scoped credentials add a more specific option without
changing the host-level behavior.

## Security

Credential matching is narrowed to the image path being used. The filtered
lookup avoids decrypting unrelated registry credentials during image validation.

## Testing

- Unit tests cover scope normalization, matching, workflow validation, and pull secret generation.
- Manual CLI validation confirms distinct path-scoped credentials are stored and matched separately.

## Open Questions

- None.
