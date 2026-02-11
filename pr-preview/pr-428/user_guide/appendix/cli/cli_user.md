<!-- SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

<a id="cli-reference-user"></a>

# osmo user

```default
usage: osmo user [-h] {list,create,update,delete,get} ...
```

## Positional Arguments

* **command**: 

Possible choices: list, create, update, delete, get

## Sub-commands

### list

List users with optional filtering.

```default
osmo user list [-h] [--id-prefix ID_PREFIX] [--roles ROLES [ROLES ...]]
               [--count COUNT] [--format-type {json,text}]
```

#### Named Arguments

* **--id-prefix, -p**: 

Filter users whose ID starts with this prefix.
* **--roles, -r**: 

Filter users who have ANY of these roles.
* **--count, -c**: 

Number of results per page (default: 100).

Default: `100`
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo user list
Ex. osmo user list –id-prefix service-
Ex. osmo user list –roles osmo-admin osmo-user

### create

Create a new user with optional roles.

```default
osmo user create [-h] [--roles ROLES [ROLES ...]] [--format-type {json,text}]
                 user_id
```

#### Positional Arguments

* **user_id**: 

User ID (e.g., email or username).

#### Named Arguments

* **--roles, -r**: 

Initial roles to assign to the user.
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo user create [myuser@example.com](mailto:myuser@example.com)
Ex. osmo user create service-account –roles osmo-user osmo-ml-team

### update

Add or remove roles from a user.

```default
osmo user update [-h] [--add-roles ADD_ROLES [ADD_ROLES ...]]
                 [--remove-roles REMOVE_ROLES [REMOVE_ROLES ...]]
                 [--format-type {json,text}]
                 user_id
```

#### Positional Arguments

* **user_id**: 

User ID to update.

#### Named Arguments

* **--add-roles, -a**: 

Roles to add to the user.
* **--remove-roles, -r**: 

Roles to remove from the user.
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo user update [myuser@example.com](mailto:myuser@example.com) –add-roles osmo-admin
Ex. osmo user update [myuser@example.com](mailto:myuser@example.com) –remove-roles osmo-ml-team
Ex. osmo user update [myuser@example.com](mailto:myuser@example.com) –add-roles admin –remove-roles guest

### delete

Delete a user and all associated data (tokens, roles, profile).

```default
osmo user delete [-h] [--force] user_id
```

#### Positional Arguments

* **user_id**: 

User ID to delete.

#### Named Arguments

* **--force, -f**: 

Skip confirmation prompt.

Default: `False`

Ex. osmo user delete [myuser@example.com](mailto:myuser@example.com)

### get

Get detailed information about a user including their roles.

```default
osmo user get [-h] [--format-type {json,text}] user_id
```

#### Positional Arguments

* **user_id**: 

User ID to get details for.

#### Named Arguments

* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo user get [myuser@example.com](mailto:myuser@example.com)
