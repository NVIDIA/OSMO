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

<a id="workflow-submission"></a>

# Workflow Submission

OSMO offers two flexible ways to submit workflows: through the **Web UI** for quick, visual submissions,
or via the **CLI** for advanced features and automation. Choose the method that best fits your needs.

🌐 Web Browser

Quick and intuitive. Perfect for getting started, prototyping, and monitoring workflows
through a visual interface.

Submit via Web UI💻 Command Line

Powerful and script-able. Essential for uploading local files, automating submissions,
and integrating with CI/CD pipelines.

Submit via CLI

---

<a id="submit-web-ui"></a>

## Submit via Web UI

The Web UI provides the fastest way to submit and monitor workflows with an intuitive interface.

**When to use:**

* ✅ Your workflow doesn’t require local files from your machine
* ✅ You prefer point-and-click interactions

1. Navigate to the OSMO web interface in your browser
2. Click **“Submit Workflow”** or the **+** button
3. Paste your workflow YAML definition or upload a workflow file
4. Configure any parameters or select a compute pool
5. Click **Submit**

![Submitting a workflow via Web UI](user_guide/tutorials/hello_world/ui_hello_world.gif)

#### SEE ALSO
Try the [Hello World tutorial](../tutorials/hello_world/index.md#tutorials-hello-world) for a guided walk-through
of submitting your first workflow via the Web UI.

---

<a id="submit-cli"></a>

## Submit via CLI

The CLI unlocks advanced submission capabilities, especially for workflows that use local files
or require automation.

**When to use:**

* ✅ You need to upload **local files or directories** to your workflow
* ✅ You want to automate workflow submissions in scripts or CI/CD pipelines
* ✅ You need to continuously sync local changes to running tasks
* ✅ You prefer working from the terminal

> **Note**
>
> For CLI installation and setup, see [Install Client](../getting_started/install/index.md#cli-install).

### Basic Submission

Submit a workflow from a YAML file:

```bash
$ osmo workflow submit my_workflow.yaml

Workflow submit successful.
Workflow ID        - my-workflow-1
Workflow Overview  - https://osmo.example.com/workflows/my-workflow-1
```

### CLI-Exclusive Features

> **Important**
>
> The following capabilities are **only available via CLI** and cannot be done through the Web UI.

#### Uploading Local Files

**Files** can be injected directly into tasks using the `files` field with `localpath`:

```yaml
tasks:
- name: train
  image: pytorch/pytorch
  command: ["python"]
  args: ["/workspace/train.py"]
  files:
  - localpath: scripts/train.py       # Local file from your machine
    path: /workspace/train.py         # Destination in the container
```

```bash
$ osmo workflow submit training.yaml
# The CLI automatically uploads scripts/train.py during submission
```

#### SEE ALSO
See [File Injection](specification/file_injection.md#workflow-spec-file-injection) for more file injection options.

#### Uploading Local Directories

**Large datasets or directories** can be uploaded as dataset inputs:

```yaml
tasks:
- name: preprocess
  image: python:3.10
  inputs:
  - dataset:
      name: my-bucket/training-data
      localpath: ./data                # Upload entire local directory
```

```bash
$ ls data/
train/  validation/  test/

$ osmo workflow submit preprocess.yaml
# The CLI uploads the entire data/ directory to the dataset
```

> **Caution**
>
> Local file uploads happen during submission. For **continuously updating files**,
> use the rsync feature instead.

#### Continuous File Sync with Rsync

Upload files continuously to a running task as they change on your local machine:

```bash
$ osmo workflow submit training.yaml --rsync ./code:/workspace

Workflow submit successful.
Workflow ID        - training-1
Workflow Overview  - https://osmo.example.com/workflows/training-1

Rsync daemon started in detached process: PID 12345
To view daemon logs: tail -f ~/.local/state/osmo/rsync/rsync_daemon_training-1_train.log
```

This is perfect for:

* **Active development** - Edit code locally and have it instantly available in your running task
* **Iterative debugging** - Update scripts without resubmitting the workflow
* **Live data feeds** - Stream data files to long-running jobs

#### SEE ALSO
See [Rsync](interactive/rsync.md#workflow-interactive-rsync) for detailed rsync usage and options.

### Advanced CLI Options

#### Parameterize Workflows

Override workflow values at submission time:

```bash
$ osmo workflow submit train.yaml \
    --set learning_rate=0.001 \
    --set batch_size=32 \
    --set-string model_name="bert-base" \
    --set-env WANDB_PROJECT=my-experiment
```

#### Dry Run Validation

Validate your workflow without actually submitting it:

```bash
$ osmo workflow submit training.yaml --dry-run
# Prints the rendered workflow specification without submitting
```

#### Target Specific Pools

Submit to a specific compute pool:

```bash
$ osmo workflow submit training.yaml --pool gpu-pool-a100
```

#### Set Priority

Control scheduling priority:

```bash
$ osmo workflow submit training.yaml --priority HIGH
# Options: HIGH, NORMAL, LOW
```

#### SEE ALSO
For complete CLI reference, see [submit](../appendix/cli/cli_workflow.md#cli_reference_workflow_submit).
