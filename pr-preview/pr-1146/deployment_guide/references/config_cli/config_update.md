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

<a id="cli-reference-config-update"></a>

# osmo config update

<!-- CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst -->
<!-- cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=config update | ref-prefix=cli_reference_config_update | flags=argument-anchor -->

Update a configuration

```text
usage: osmo config update [-h] config_type [name] [--file FILE] [--description DESCRIPTION] [--tags TAGS [TAGS ...]]
```

<a id="cli-reference-config-update-positional-arguments"></a>

## Positional Arguments

`config_type`
: Possible choices: BACKEND, BACKEND_TEST, DATASET, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW
  <br/>
  Config type to update (CONFIG_TYPE)

`name`
: Optional name of the config to update

<a id="cli-reference-config-update-named-arguments"></a>

## Named Arguments

`--file, -f`
: Path to a JSON file containing the updated config

`--description, -d`
: Description of the config update

`--tags, -t`
: Tags for the config update

Available config types (CONFIG_TYPE): BACKEND, BACKEND_TEST, DATASET, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW

### Examples

Update a service configuration:

```default
osmo config update SERVICE
```

Update a backend configuration from a file:

```default
osmo config update BACKEND my-backend --file config.json
```

Update with description and tags:

```default
osmo config update POOL my-pool --description "Updated pool settings" --tags production high-priority
```
