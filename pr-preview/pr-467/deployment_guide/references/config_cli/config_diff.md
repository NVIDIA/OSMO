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

<a id="cli-reference-config-diff"></a>

# osmo config diff

Show the difference between two config revisions

Available config types (config_type): BACKEND, BACKEND_TEST, DATASET, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW

```default
usage: osmo config diff [-h] first [second]
```

## Positional Arguments

* **first**: 

First config to compare. Format: <config_type>[:<revision>] (e.g. BACKEND:3). If no revision is provided, uses the current revision.
* **second**: 

Second config to compare. Format: <config_type>[:<revision>] (e.g. BACKEND:6). If no revision is provided, uses the current revision.

## Examples

Show changes made to the workflow config since revision 15:

```default
osmo config diff WORKFLOW:15
```

![image](deployment_guide/references/config_cli/images/config_diff_workflow.png)

Show changes made between two revisions of the service configuration:

```default
osmo config diff SERVICE:14 SERVICE:15
```

![image](deployment_guide/references/config_cli/images/config_diff_service.png)
