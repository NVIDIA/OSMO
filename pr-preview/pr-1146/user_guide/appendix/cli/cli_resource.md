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

<!-- CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst -->
<!-- cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=resource | ref-prefix=cli_reference_resource | flags=argument-anchor -->
```text
usage: osmo resource [-h] {list,info} ...
```

<a id="cli-reference-resource-positional-arguments"></a>

## Positional Arguments

`command`
: Possible choices: list, info

## Sub-commands

<a id="cli-reference-resource-list"></a>

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

```text
osmo resource list [-h] [--pool POOL [POOL ...]]
                   [--platform PLATFORM [PLATFORM ...]] [--all]
                   [--format-type {json,text}]
                   [--mode {free,used}]
```

<a id="cli-reference-resource-list-named-arguments"></a>

#### Named Arguments

`--pool, -p`
: Display resources for specified pool.
  <br/>
  Default: `[]`

`--platform`
: Display resources for specified platform.
  <br/>
  Default: `[]`

`--all, -a`
: Show all resources from all pools.
  <br/>
  Default: `False`

`--format-type, -t`
: Possible choices: json, text
  <br/>
  Specify the output format type (Default text).
  <br/>
  Default: `'text'`

`--mode, -m`
: Possible choices: free, used
  <br/>
  Show free or used resources (Default used).
  <br/>
  Default: `'used'`

<a id="cli-reference-resource-info"></a>

### info

Get resource allocatable and configurations of a node.

```text
osmo resource info [-h] [--pool POOL] [--platform PLATFORM]
                   node_name
```

<a id="cli-reference-resource-info-positional-arguments"></a>

#### Positional Arguments

`node_name`
: Name of node.

<a id="cli-reference-resource-info-named-arguments"></a>

#### Named Arguments

`--pool, -p`
: Specify the pool to see specific allocatable and configurations.

`--platform, -pl`
: Specify the platform to see specific allocatable and configurations.
