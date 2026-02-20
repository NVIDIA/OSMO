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

<a id="workflow-execution"></a>

# Understanding Task Execution

When you submit a workflow to OSMO, each task runs as a Kubernetes pod on your backend cluster. This page explains the technical architecture of these pods—how they’re structured, how the containers inside the pod communicate, and what happens during execution.

> **Tip**
>
> **Why read this?** Understanding OSMO workflow pod execution helps you debug issues, optimize data operations, and provide necessary support to users in case of workflow failures or when they use interactive features like `exec` and `port-forward`.

## Task Pod Architecture

Every workflow task executes as a Kubernetes pod with three containers that work together. These containers share volumes (`/osmo/data/input` and `/osmo/data/output`) and communicate via Unix sockets to seamlessly orchestrate your task from data download through execution to results upload.

![image](deployment_guide/appendix/pod_architecture.svg)

## The Three Containers

Each pod contains three containers working together to execute your task:

<svg version="1.1" width="1.0em" height="1.0em" class="sd-octicon sd-octicon-gear" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z"></path></svg> OSMO Init

**(Init Container)**

Prepares the environment before your code runs:

- Creates `/osmo/data/input` and `/osmo/data/output` directories
- Installs OSMO CLI (available in your container)
- Sets up Unix socket for inter-container communication

Runs once → Exits after setup

<svg version="1.1" width="1.0em" height="1.0em" class="sd-octicon sd-octicon-sync" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"></path></svg> OSMO Ctrl

**(Sidecar Container)**

Coordinates task execution and data:

- Downloads input data from cloud storage
- Streams logs to OSMO service in real-time for monitoring
- Uploads output artifacts after completion
- Handles interactive requests (exec, port-forward)

Runs throughout task lifetime

<svg version="1.1" width="1.0em" height="1.0em" class="sd-octicon sd-octicon-package" viewBox="0 0 16 16" aria-hidden="true"><path d="m8.878.392 5.25 3.045c.54.314.872.89.872 1.514v6.098a1.75 1.75 0 0 1-.872 1.514l-5.25 3.045a1.75 1.75 0 0 1-1.756 0l-5.25-3.045A1.75 1.75 0 0 1 1 11.049V4.951c0-.624.332-1.201.872-1.514L7.122.392a1.75 1.75 0 0 1 1.756 0ZM7.875 1.69l-4.63 2.685L8 7.133l4.755-2.758-4.63-2.685a.248.248 0 0 0-.25 0ZM2.5 5.677v5.372c0 .09.047.171.125.216l4.625 2.683V8.432Zm6.25 8.271 4.625-2.683a.25.25 0 0 0 .125-.216V5.677L8.75 8.432Z"></path></svg> User Container

**(Main Container)**

Runs your code as a process:

- Executes the command you specified
- Uses requested CPU/GPU/memory resources
- Reads input data from `/osmo/data/input`
- Writes output data to `/osmo/data/output`
- Logs to stdout/stderr

Runs your code from start to exit

## Execution Flow

Every task follows this four-phase progression:

**1. Initialize** 🔧

**OSMO Init** sets up environment

Creates directories, installs OSMO CLI, configures Unix socket for inter-container communication

Time in the order of 5-10 seconds

**2. Download** ⬇️

**OSMO Ctrl** fetches data

Downloads and extracts input datasets to `/osmo/data/input`

Time varies by download size

**3. Execute** ▶️

**Your code** runs inside the container

Reads inputs, writes outputs, logs streamed in real-time

Time varies by code runtime

**4. Upload** ⬆️

**OSMO Ctrl** saves results

Uploads artifacts from `/osmo/data/output`

Time varies by upload size

> **Note**
>
> **Data handling is automatic.** Your code only needs to read from `{{input}}` (`/osmo/data/input`) and write to `{{output}}` (`/osmo/data/output`). The **Ctrl** container manages all transfers.

## Practical Guide

### Directory Structure

Your container automatically has access to these paths:

```text
/osmo/data/
├── input/              ← Read input datasets here
│   ├── 0/dataset1/
│   └── 1/dataset2/
├── output/             ← Write results here
│   └── (your artifacts)
└── socket/             ← Unix socket (managed by OSMO)
    └── data.sock
```

### Example Task Configuration

```yaml
tasks:
  - name: train-model
    image: nvcr.io/nvidia/pytorch:24.01-py3
    command: ["python", "train.py"]
    args:
      - --input={{input:0}}/dataset1
      - --input={{input:1}}/dataset2
      - --output={{output}}/model
```

### Debugging

### View Container Logs

**osmo-ctrl logs** (data operations):

```bash
$ kubectl logs <pod-name> -c osmo-ctrl
```

**Your container logs** (application output):

```bash
$ kubectl logs <pod-name> -c <task-name>
```

### Interactive Access

Access your running container with a shell:

```bash
$ osmo exec my-workflow task-1 -- bash
```

**How it works:** Command flows through OSMO Service → osmo-ctrl → User Container via Unix socket

### Resource Allocation

**Your container:** All requested CPU/GPU/memory

**osmo-ctrl overhead:** ~50-100 MB memory, minimal CPU (active during transfers only)

## Learn More

#### SEE ALSO
- [Workflow Overview](../../user_guide/workflows/index.md#workflow-overview) - User guide for writing workflows
- [Workflow Lifecycle](../../user_guide/workflows/lifecycle/index.md#workflow-lifecycle) - Understanding workflow states
- [Architecture](../introduction/architecture.md#architecture) - Overall OSMO system architecture
