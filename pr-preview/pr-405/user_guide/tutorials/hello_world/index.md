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

<a id="tutorials-hello-world"></a>

# Your First Workflow: Hello World

## Using the CLI

> **Note**
>
> For CLI installation and setup instructions, see [Install Client](../../getting_started/install/index.md#cli-install).

The CLI encompasses many commands that allow you to manage your workflows without leaving your
terminal. This tutorial will walk you through using the CLI to submit your first workflow to OSMO.

### Creating a Workflow File

You can download the workflow definition here: [`hello_world.yaml`](../../../../workflows/tutorials/hello_world.yaml).
Below is the contents of the file:

```yaml

workflow:
  name: hello-osmo
  resources:
    default:
      cpu: 1
      memory: 1Gi
      storage: 1Gi
  tasks:
  - name: hello
    image: ubuntu:24.04
    command: ["echo"]
    args: ["Hello from OSMO!"]
```

### Submitting a Workflow

You can submit the workflow by running the following command:

```bash
$ osmo workflow submit hello_world.yaml
Workflow submit successful.
Workflow ID        - hello-osmo-1
Workflow Overview  - https://osmo-example-url.com/workflows/hello-osmo-1
```

To get the status of the workflow, you can use the `osmo workflow query` command.

```bash
$ osmo workflow query hello-osmo-1
Workflow ID : hello-osmo-1
Status      : COMPLETED
User        : osmo-user
Submit Time : Oct 08, 2025 16:23 EDT
Overview    : https://osmo-example-url.com/workflows/hello-osmo-1

Task Name     Start Time               Status
================================================
hello         Oct 08, 2025 16:24 EDT   COMPLETED
```

To get the logs of the workflow, you can use the `osmo workflow logs` command.
This will output the logs for all of the tasks in the workflow.

```bash
$ osmo workflow logs hello-osmo-1
Workflow hello-osmo-1 has logs:
2025/10/08 20:23:43 [hello][osmo] Hello from OSMO!
```

> **Note**
>
> For more detailed information on the workflow CLI, see [Workflow CLI Reference](../../appendix/cli/cli_workflow.md#cli-reference-workflow).

<a id="getting-started-ui"></a>

## Using the Web UI

Another way to try out submitting workflows to OSMO is to use the Web UI.

The following steps will guide you through submitting a workflow to OSMO using the Web UI.

1. Navigate to the OSMO web interface in your browser
2. Click **“Submit Workflow”** or the **+** button
3. Paste your workflow YAML definition or upload a workflow file
4. Configure any parameters or select a compute pool
5. Click **Submit**

#### SEE ALSO
Please refer to [System Requirements](../../getting_started/system_requirements.md#getting-started-system-requirements) for the recommended web browsers.

![OSMO Web UI workflow](user_guide/tutorials/hello_world/ui_hello_world.gif)
