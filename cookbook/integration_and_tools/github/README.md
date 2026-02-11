<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
-->

# Github: Cloning a Private Repository

This workflow demonstrates how to clone a private GitHub repository in an OSMO workflow.
It sets up Git authentication using a GitHub Personal Access Token (PAT) stored as an OSMO credential,
clones your repository, and keeps the container running so you can exec in and work with the code.

## Setup

### 1. Create a GitHub Personal Access Token

Log into GitHub and create a [classic personal access token](https://github.com/settings/tokens/new) if you don't already have one. Be sure to give the token all **repo** permissions.

### 2. Verify the token is valid

Test that the token works by cloning a private repo locally:

```bash
git clone https://token:ghp_xxxxxxxxxxxx@github.com/<user>/<repo>.git
```

### 3. Create an OSMO credential for the token

Store the GitHub PAT as an OSMO credential:

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
osmo credential set github-pat --type GENERIC --payload "github-pat=$GITHUB_TOKEN"
```

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/integration_and_tools/github/github.yaml
osmo workflow submit github.yaml --set repo=https://github.com/<user>/<repo>.git
```

Replace `<user>/<repo>` with your actual GitHub username and repository name.
