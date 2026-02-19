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

<a id="cli-reference-config-history"></a>

# osmo config history

List history of configuration changes

```default
usage: osmo config history [-h] [config_type] [--offset OFFSET] [--count COUNT] [--order {asc,desc}] [--name NAME] [--revision REVISION] [--tags TAGS [TAGS ...]] [--at-timestamp AT_TIMESTAMP] [--created-before CREATED_BEFORE] [--created-after CREATED_AFTER] [--format-type {json,text}] [--fit-width]
```

## Positional Arguments

* **config_type**: 

Possible choices: BACKEND, BACKEND_TEST, DATASET, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW

Config type to show history for (CONFIG_TYPE)

## Named Arguments

* **--offset, -o**: 

Number of records to skip for pagination (default 0)

Default: `0`
* **--count, -c**: 

Maximum number of records to return (default 20, max 1000)

Default: `20`
* **--order**: 

Possible choices: asc, desc

Sort order by creation time (default asc)

Default: `'asc'`
* **--name, -n**: 

Filter by changes to a particular config, e.g. “isaac-hil” pool
* **--revision, -r**: 

Filter by revision number
* **--tags**: 

Filter by tags
* **--at-timestamp**: 

Get config state at specific timestamp (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS) in current timezone
* **--created-before**: 

Filter by creation time before (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS) in current timezone
* **--created-after**: 

Filter by creation time after (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS) in current timezone
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (default text)

Default: `'text'`
* **--fit-width**: 

Fit the table width to the terminal width

Default: `False`

Available config types (CONFIG_TYPE): BACKEND, BACKEND_TEST, DATASET, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW

## Examples

View history in text format (default):

```default
osmo config history
```

View history in JSON format with pagination:

```default
osmo config history --format-type json --offset 10 --count 2
```

View history for a specific configuration type:

```default
osmo config history SERVICE
```

View history for a specific time range:

```default
osmo config history --created-after "2025-05-18" --created-before "2025-05-25"
```
