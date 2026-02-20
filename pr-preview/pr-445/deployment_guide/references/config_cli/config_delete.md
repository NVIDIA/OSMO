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

<a id="cli-reference-config-delete"></a>

# osmo config delete

Delete a named configuration or a specific config revision

```default
usage: osmo config delete [-h] config_type [name] [--description DESCRIPTION] [--tags TAGS [TAGS ...]]
```

## Positional Arguments

* **config_type**: 

Type of config to delete (CONFIG_TYPE) or CONFIG_TYPE:revision_number to delete a specific revision
* **name**: 

Name of the config to delete (required when not deleting a revision)

## Named Arguments

* **--description, -d**: 

Description of the deletion (only used when deleting a named config)
* **--tags, -t**: 

Tags for the deletion (only used when deleting a named config)

Available config types (CONFIG_TYPE): BACKEND, BACKEND_TEST, DATASET, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE

## Examples

Delete a named pool configuration:

```default
osmo config delete POOL my-pool
```

Delete a specific revision:

```default
osmo config delete SERVICE:123
```

Delete with description and tags:

```default
osmo config delete BACKEND my-backend --description "Removing unused backend" --tags cleanup deprecated
```
