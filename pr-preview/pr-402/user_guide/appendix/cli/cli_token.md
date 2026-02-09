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

<a id="cli-reference-token"></a>

# osmo token

```default
usage: osmo token [-h] {set,delete,list} ...
```

## Positional Arguments

* **command**: 

Possible choices: set, delete, list

## Sub-commands

### set

Set a token for the current user.

```default
osmo token set [-h] [--expires-at EXPIRES_AT] [--description DESCRIPTION]
               [--service] [--roles ROLES [ROLES ...]]
               [--format-type {json,text}]
               name
```

#### Positional Arguments

* **name**: 

Name of the token.

#### Named Arguments

* **--expires-at, -e**: 

Expiration date of the token. The date is based on UTC time. Format: YYYY-MM-DD

Default: `2026-03-12`
* **--description, -d**: 

Description of the token.
* **--service, -s**: 

Create a service token.

Default: `False`
* **--roles, -r**: 

Roles for the token. Only applicable for service tokens.
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo token set my-token –expires-at 2026-05-01 –description “My token description”

### delete

Delete a token for the current user.

```default
osmo token delete [-h] [--service] name
```

#### Positional Arguments

* **name**: 

Name of the token.

#### Named Arguments

* **--service, -s**: 

Delete a service token.

Default: `False`

Ex. osmo token delete my-token

### list

List all tokens for the current user.

```default
osmo token list [-h] [--service] [--format-type {json,text}]
```

#### Named Arguments

* **--service, -s**: 

List all service tokens.

Default: `False`
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo token list
