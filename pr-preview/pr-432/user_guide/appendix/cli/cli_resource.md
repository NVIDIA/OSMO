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

<a id="cli-reference-resource"></a>

# osmo resource

```default
usage: osmo resource [-h] {list,info} ...
```

## Positional Arguments

* **command**: 

Possible choices: list, info

## Sub-commands

### list

Resource display formats:

```default
Mode           | Description
---------------|----------------------------------------------------
Used (default) | Shows "used/total" (e.g., 40/100 means 40 Gi used
               | out of 100 Gi total memory)
Free           | Shows available resources as a single number
               | (e.g., 60 means 60 Gi of memory is available for use)
```

This applies to all allocatable resources: CPU, memory, storage, and GPU.

```default
osmo resource list [-h] [--pool POOL [POOL ...]]
                   [--platform PLATFORM [PLATFORM ...]] [--all]
                   [--format-type {json,text}] [--mode {free,used}]
```

#### Named Arguments

* **--pool, -p**: 

Display resources for specified pool.

Default: `[]`
* **--platform**: 

Display resources for specified platform.

Default: `[]`
* **--all, -a**: 

Show all resources from all pools.

Default: `False`
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`
* **--mode, -m**: 

Possible choices: free, used

Show free or used resources (Default used).

Default: `'used'`

### info

Get resource allocatable and configurations of a node.

```default
osmo resource info [-h] [--pool POOL] [--platform PLATFORM] node_name
```

#### Positional Arguments

* **node_name**: 

Name of node.

#### Named Arguments

* **--pool, -p**: 

Specify the pool to see specific allocatable and configurations.
* **--platform, -pl**: 

Specify the platform to see specific allocatable and configurations.
