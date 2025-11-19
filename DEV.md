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

# NVIDIA OSMO - Developer Guide

For developers who want to try out OSMO or test out their changes, this guide will demonstrate how
to run OSMO using Bazel:

## Prerequisites

Install the [required tools](./CONTRIBUTING.md#prerequisites) for developing OSMO.

Set the following environment variables:

```sh
export HOST_IP=$(ifconfig | grep "inet " | grep -Fv 127.0.0.1 | grep 10. | awk '{print $2}' | head -1)
```

## Compile OSMO with Bazel

Bazel mode runs OSMO services directly as local processes using bazel, providing faster iteration
for development.

### Start OSMO Services

```sh
bazel run @osmo_workspace//run:start_service -- --mode bazel
```

This command:

- Creates postgres, redis, and localstack-s3 docker containers if they do not exist
- Starts core OSMO services (osmo, ui, router) using bazel

### Start OSMO Backend

After OSMO services are started, start the backend:

```sh
bazel run @osmo_workspace//run:start_backend -- --mode bazel
```

This command:

- Checks for a KIND backend cluster that can be used for compute
  - If one is not accessible, a new KIND cluster is created for compute
- Starts backend operators (listener, worker) using bazel

### Update Configuration

```sh
bazel run @osmo_workspace//run:update_configs -- --mode bazel
```

This command:

- Updates workflow configuration with local development settings
- Configures object storage endpoints and credentials
- Sets up backend image configurations
- Sets the default pool for the user profile

### Access OSMO

The OSMO UI and APIs can be accessed at: `http://$HOST_IP:8080`

## Next steps

Log into OSMO using the CLI:
```sh
bazel run @osmo_workspace//src/cli -- login http://$HOST_IP:8000 --method=dev --username=testuser
```

Test your setup with:

```sh
bazel run @osmo_workspace//src/cli -- workflow submit ~/path/to/osmo/workflows/basics/hello_world/hello_world.yaml
```

The workflow should successfully submit and run to a "completed" state.
