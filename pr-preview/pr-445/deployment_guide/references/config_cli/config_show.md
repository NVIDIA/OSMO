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

<a id="cli-reference-config-show"></a>

# osmo config show

Show a configuration or previous revision of a configuration

```default
usage: osmo config show [-h] config_type [names ...]
```

## Positional Arguments

* **config_type**: 

Config to show in format <CONFIG_TYPE>[:<revision>]
* **names**: 

Optional names/indices to index into the config. Can be used to show a named config.

Available config types (CONFIG_TYPE): BACKEND, BACKEND_TEST, DATASET, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW

## Examples

Show a service configuration in JSON format:

```default
osmo config show SERVICE
```

Show the `default_cpu` resource validation rule:

```default
osmo config show RESOURCE_VALIDATION default_cpu
```

Show the `user_workflow_limits` workflow configuration in a previous revision:

```default
osmo config show WORKFLOW:3 user_workflow_limits
```
