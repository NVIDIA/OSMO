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

<a id="tutorials-template-and-tokens"></a>

# Templates and Tokens

This tutorial introduces two key concepts for flexible workflows: **templates** (variables
you define) and **special tokens** (values OSMO provides automatically).

## Templates

Templates let you customize workflows at submission time without editing the YAML file.
Variables are denoted by double curly braces `{{ }}` with default values defined in
the `default-values` section.

**Hello World with template variables example:**

Here’s the Hello World example with template variables: [`template_hello_world.yaml`](../../../workflows/tutorials/template_hello_world.yaml).

```yaml

workflow:
  name: {{workflow_name}}
  tasks:
  - name: hello
    image: ubuntu:{{ubuntu_version}}
    command: ["echo"]
    args: ["{{message}}"]

default-values:
  workflow_name: hello-osmo
  ubuntu_version: 22.04
  message: Hello from OSMO!
```

Submit with defaults:

```bash
$ osmo workflow submit template_hello_world.yaml
Workflow ID - hello-osmo-1
```

Override values at submission:

```bash
$ osmo workflow submit template_hello_world.yaml --set \
    workflow_name=greetings \
    ubuntu_version=24.04 \
    message='Custom message!'

Workflow ID - greetings-1
```

> **Tip**
>
> You can reuse the same workflow with different values - no file editing needed!

## Special Tokens

Besides templates, OSMO provides **special tokens** - reserved variables that are
automatically set by the system. Unlike templates, you **cannot** override them with `--set`.

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

| **Token**              | **Description**                                                                                  |
|------------------------|--------------------------------------------------------------------------------------------------|
| `{{input:<#>}}`        | The directory where inputs are downloaded to. The `<#>` is the index of an input, starting at 0. |
| `{{output}}`           | The directory where files will be uploaded from when the task finishes.                          |
| `{{workflow_id}}`      | The workflow ID.                                                                                 |
| `{{host:<task_name>}}` | The hostname of a currently running task. Useful for tasks to communicate with each other.       |

**Token example:**

The `{{workflow_id}}` token is useful for tracking workflow runs and creating unique
identifiers.

```yaml

workflow:
  name: {{experiment_name}}
  tasks:
  - name: experiment
    image: ubuntu:24.04
    command: ["bash", "-c"]
    args:
    - |
      echo "Running experiment: {{experiment_name}}"
      echo "Workflow ID: {{workflow_id}}"

default-values:
  experiment_name: my-experiment
```

Each submission gets a unique `{{workflow_id}}` (e.g., `my-experiment-1`,
`my-experiment-2`), even with the same `experiment_name`.

#### SEE ALSO
The other tokens (`{{input:N}}`, `{{output}}`, `{{host:task_name}}`) are covered
in later tutorials when you learn about [Working with Data](data/index.md#tutorials-working-with-data) and
[Task Communication](parallel_workflows/index.md#tutorials-parallel-workflows-task-communication).

## Next Steps

Now that you understand templates and special tokens, continue to [Requesting Resources](requesting_resources.md#tutorials-requesting-resources)
to learn how to specify CPU, GPU, memory, and storage requirements for your workflows.

#### SEE ALSO
- [Templates and Special Tokens](../workflows/specification/templates_and_tokens.md#workflow-spec-templates-and-special-tokens) - Reference for templates and special tokens
- [Workflow Templates](advanced_patterns.md#tutorials-advanced-patterns-jinja) - Advanced patterns for workflow templating with Jinja
