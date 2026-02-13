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

<a id="cli-reference-pool"></a>

# osmo pool

```default
usage: osmo pool [-h] {list} ...
```

## Positional Arguments

* **command**: 

Possible choices: list

## Sub-commands

### list

Pool resource display formats:

```default
Mode           | Description
---------------|----------------------------------------------------
Used (default) | Shows the number of GPUs used and total GPUs
Free           | Shows the number of GPUs available for use
```

Display table columns:

```default
Column          | Description
----------------|----------------------------------------------------
Quota Limit     | Max GPUs for HIGH/NORMAL priority workflows
Quota Used      | GPUs used by HIGH/NORMAL priority workflows
Quota Free      | Available GPUs for HIGH/NORMAL priority workflows
Total Capacity  | Total GPUs available on nodes in the pool
Total Usage     | Total GPUs used by all workflows in pool
Total Free      | Free GPUs on nodes in the pool
```

```default
osmo pool list [-h] [--pool POOL [POOL ...]] [--format-type {json,text}]
               [--mode {free,used}]
```

#### Named Arguments

* **--pool, -p**: 

Display resources for specified pool.

Default: `[]`
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`
* **--mode, -m**: 

Possible choices: free, used

Show free or used resources (Default used).

Default: `'used'`
