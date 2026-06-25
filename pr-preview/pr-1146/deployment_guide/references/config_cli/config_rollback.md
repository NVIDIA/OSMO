<!-- SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0 -->

<a id="cli-reference-config-rollback"></a>

# osmo config rollback

<!-- CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst -->
<!-- cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=config rollback | ref-prefix=cli_reference_config_rollback | flags=argument-anchor -->

Roll back a configuration to a previous revision

When rolling back a configuration, the revision number is incremented by 1 and a new revision is created. The new revision will have the same data as the desired rollback revision.

```text
usage: osmo config rollback [-h] revision [--description DESCRIPTION] [--tags TAGS [TAGS ...]]
```

<a id="cli-reference-config-rollback-positional-arguments"></a>

## Positional Arguments

`revision`
: Revision to roll back to in format <CONFIG_TYPE>:<revision>, e.g. [SERVICE:12](SERVICE:12)

<a id="cli-reference-config-rollback-named-arguments"></a>

## Named Arguments

`--description`
: Optional description for the rollback action

`--tags`
: Optional tags for the rollback action

Available config types (CONFIG_TYPE): BACKEND, BACKEND_TEST, DATASET, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW

### Examples

Roll back a service configuration:

```default
osmo config rollback SERVICE:4
```

Roll back with description and tags:

```default
osmo config rollback BACKEND:7 --description "Rolling back to stable version" --tags rollback stable
```
