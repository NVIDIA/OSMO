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

<a id="workflow-spec-host-mounts"></a>

# Host Mounts

Host directories can be mounted from the node to a task’s container image before the task is
started. Here are some examples:

```yaml
workflow:
  name: "host-mount"
  tasks:
  - name: task1
    volumeMounts:
    - /dev/shm             # (1)
    ...
  - name: task2
    image: ubuntu
    command: [sh]
    args: [/tmp/run.sh]
    files:
    - contents: |
        ls /home/opt
      path: /tmp/run.sh
    volumeMounts:
    - /opt:/home/opt       # (2)
```

1. Mount the `/dev/shm` directory from the node to the task container, allowing it to use
   shared memory.
2. Mount the `/opt` directory from the node to the `/home/opt` directory in the
   task container, allowing it to access the `/opt` directory.

> **Note**
>
> The default list of host directories that are allowed to be mounted in your task
> for each type of pool and platform can be configured but requires service-level configuration.
> If you have administrative access, you can enable this directly. Otherwise, contact someone
> with pool administration privileges.
