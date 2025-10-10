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

# NVIDIA OSMO - Filebrowser

This workflow sets up a web-based file browser interface for remote workspace access, allowing you to browse, upload, download, and manage files through a convenient web interface.

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/integration_and_tools/filebrowser/filebrowser.yaml
osmo workflow submit filebrowser.yaml
```

## Accessing Filebrowser

When the workflow is running, run the port-forward command:

```bash
# Get the workflow ID from the submit command output
osmo workflow port-forward <workflow-id> browser --port 8080:8080
```

Once this command is running, open your browser and navigate to `http://localhost:8080`.

Enter the default username `admin` and the password shown in the workflow logs to access the file browser.

![Filebrowser Interface](filebrowser.gif)

