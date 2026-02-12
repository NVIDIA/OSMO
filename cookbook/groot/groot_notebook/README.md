<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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

# Isaac Groot: Interactive Notebook for Inference and Fine-tuning

## Overview

This workflow demonstrates how to perform inference and fine-tuning using [Isaac Groot](https://github.com/NVIDIA/Isaac-GR00T),
through an interactive Jupyter notebook.

The workflow consists of:

- A JupyterLab interface
- All of the Isaac Groot tutorial Jupyter notebooks that feature fine-tuning and inference

## Running the Workflow
```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/groot/groot_notebook/groot_notebook.yaml
osmo workflow submit groot_notebook.yaml
```

There is a timeout set in the workflow, so that after 2 hours, the workflow will end. To increase that, you will
need to modify the timeout field.
