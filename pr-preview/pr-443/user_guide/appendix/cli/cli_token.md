<!-- SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
usage: osmo token [-h] {set,delete,list,roles} ...
```

## Positional Arguments

* **command**: 

Possible choices: set, delete, list, roles

## Sub-commands

### set

Create a personal access token for yourself or another user (admin only).

```default
osmo token set [-h] [--expires-at EXPIRES_AT] [--description DESCRIPTION]
               [--user USER] [--roles ROLES] [--format-type {json,text}]
               name
```

#### Positional Arguments

* **name**: 

Name of the token.

#### Named Arguments

* **--expires-at, -e**: 

Expiration date of the token (UTC). Format: YYYY-MM-DD. Default: 31 days from now.

Default: `2026-03-21`
* **--description, -d**: 

Description of the token.
* **--user, -u**: 

Create token for a specific user (admin only). By default, creates token for the current user.
* **--roles, -r**: 

Role to assign to the token. Can be specified multiple times. If not specified, inherits all of the user’s current roles.
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo token set my-token –expires-at 2026-05-01
Ex. osmo token set my-token -e 2026-05-01 -d “My token description”
Ex. osmo token set my-token -r role1 -r role2
Ex. osmo token set service-token –user [service-account@example.com](mailto:service-account@example.com) –roles osmo-backend

### delete

Delete an access token for yourself or another user (admin only).

```default
osmo token delete [-h] [--user USER] name
```

#### Positional Arguments

* **name**: 

Name of the token to delete.

#### Named Arguments

* **--user, -u**: 

Delete token for a specific user (admin only). By default, deletes token for the current user.

Ex. osmo token delete my-token
Ex. osmo token delete old-token –user [other-user@example.com](mailto:other-user@example.com)

### list

List access tokens for yourself or another user (admin only).

```default
osmo token list [-h] [--user USER] [--format-type {json,text}]
```

#### Named Arguments

* **--user, -u**: 

List tokens for a specific user (admin only). By default, lists tokens for the current user.
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo token list
Ex. osmo token list –user [service-account@example.com](mailto:service-account@example.com)

### roles

List all roles assigned to an access token.

```default
osmo token roles [-h] [--format-type {json,text}] name
```

#### Positional Arguments

* **name**: 

Name of the token.

#### Named Arguments

* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo token roles my-token
