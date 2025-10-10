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

# NVIDIA OSMO - Parallel tasks communication

This workflow has two tasks in a group that communicate with each other. It creates a simple TCP
server and client setup:

- The server task:

  - Opens a TCP server listening on port 24831
  - Has a text file containing "hello"
  - Waits for a client connection and sends the file contents
  - Saves the file to the output directory

- The client task:

  - Waits for the server container to be ready using DNS lookup
  - Connects to the server using the special {{host:server}} token to get server IP
  - Receives the "hello" message

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/basics/parallel_tasks_comms/parallel_tasks_comms.yaml
osmo workflow submit parallel_tasks_comms.yaml
```
