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

# Using NIMs in an OSMO Workflow

This example demonstrates how to use NVIDIA Inference Microservices (NIMs) in your OSMO workflows. You can either connect to an external NIM server (e.g., hosted on NGC) or run a NIM server as part of your workflow.

## Prerequisites

You'll need an NGC API key to authenticate with NIM services. If you don't have one, create it on the [NGC website](https://org.ngc.nvidia.com/setup/api-keys).

Store your API key as a secret credential in OSMO:

```bash
export NGC_API_KEY=<your-api-key>
osmo credential set ngc-api-key --type GENERIC --payload key=$NGC_API_KEY
```

## Connect to an external NIM server

To use a NIM server hosted externally (such as the [NVIDIA API catalog](https://build.nvidia.com/explore/discover)), submit the workflow with the external server URL:

```bash
osmo workflow submit use_nim.yaml --set external_nim_server_url=https://integrate.api.nvidia.com
```

This will connect directly to the specified NIM server and make API calls to generate text. The workflow will:
1. Run a client container with curl and jq installed
2. Connect to the external NIM server
3. Send prompts to the NIM API and display responses

## Running the NIM server as part of the workflow

To deploy and run a NIM server within your workflow, you'll need to add your NGC API key as a registry credential so OSMO can pull the NIM image:

```bash
export NGC_API_KEY=<your-api-key>
osmo credential set nvcr --type REGISTRY --payload registry=nvcr.io username=\$oauthtoken auth=$NGC_API_KEY
```

Then submit the workflow without specifying an external server:

```bash
osmo workflow submit use_nim.yaml
```

The workflow will:
1. Start a NIM server in a container with GPU resources
2. Run a client container that waits for the server to be ready
3. Make API calls to the NIM server to generate text

The NIM server task is configurable with GPU, CPU, memory, and storage resources. See `use_nim.yaml` for available parameters and their default values
