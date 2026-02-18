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

<a id="cli-reference-config-set"></a>

# osmo config set

Set a field into the config

```default
usage: osmo config set [-h] config_type name type [--field FIELD] [--description DESCRIPTION] [--tags TAGS [TAGS ...]]
```

## Positional Arguments

* **config_type**: 

Possible choices: ROLE

Config type to set (CONFIG_TYPE)
* **name**: 

Name of the role
* **type**: 

Type of field

## Named Arguments

* **--field**: 

Field name in context. For example, the backend to target.
* **--description**: 

Optional description for the set action
* **--tags**: 

Optional tags for the set action

Available config types (CONFIG_TYPE): ROLE

## Examples

Creating a new pool role:

```default
osmo config set ROLE osmo-pool-name pool
```

> **Note**
>
> The pool name **MUST** start with `osmo-` to be correctly recognized so that users
> can see the pool in the UI and profile settings. This will be changed to be more flexible
> in the future.

Creating a new backend role:

```default
osmo config set ROLE my-backend-role backend --field name-of-backend
```
