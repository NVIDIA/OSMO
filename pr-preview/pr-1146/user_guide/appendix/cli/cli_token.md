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

<!-- CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst -->
<!-- cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=token | ref-prefix=cli_reference_token | flags=argument-anchor -->
```text
usage: osmo token [-h] {set,delete,list} ...
```

<a id="cli-reference-token-positional-arguments"></a>

## Positional Arguments

`command`
: Possible choices: set, delete, list

## Sub-commands

<a id="cli-reference-token-set"></a>

### set

Set a token for the current user.

```text
osmo token set [-h] [--expires-at EXPIRES_AT]
               [--description DESCRIPTION] [--service]
               [--roles ROLES [ROLES ...]]
               [--format-type {json,text}]
               name
```

<a id="cli-reference-token-set-positional-arguments"></a>

#### Positional Arguments

`name`
: Name of the token.

<a id="cli-reference-token-set-named-arguments"></a>

#### Named Arguments

`--expires-at, -e`
: Expiration date of the token. The date is based on UTC time. Format: YYYY-MM-DD
  <br/>
  Default: `2026-07-26`

`--description, -d`
: Description of the token.

`--service, -s`
: Create a service token.
  <br/>
  Default: `False`

`--roles, -r`
: Roles for the token. Only applicable for service tokens.

`--format-type, -t`
: Possible choices: json, text
  <br/>
  Specify the output format type (Default text).
  <br/>
  Default: `'text'`

Ex. osmo token set my-token –expires-at 2026-05-01 –description “My token description”

<a id="cli-reference-token-delete"></a>

### delete

Delete a token for the current user.

```text
osmo token delete [-h] [--service] name
```

<a id="cli-reference-token-delete-positional-arguments"></a>

#### Positional Arguments

`name`
: Name of the token.

<a id="cli-reference-token-delete-named-arguments"></a>

#### Named Arguments

`--service, -s`
: Delete a service token.
  <br/>
  Default: `False`

Ex. osmo token delete my-token

<a id="cli-reference-token-list"></a>

### list

List all tokens for the current user.

```text
osmo token list [-h] [--service] [--format-type {json,text}]
```

<a id="cli-reference-token-list-named-arguments"></a>

#### Named Arguments

`--service, -s`
: List all service tokens.
  <br/>
  Default: `False`

`--format-type, -t`
: Possible choices: json, text
  <br/>
  Specify the output format type (Default text).
  <br/>
  Default: `'text'`

Ex. osmo token list
