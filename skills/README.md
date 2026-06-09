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

# Agent Skills

Agent skills for the OSMO platform, built on the [Agent Skills](https://agentskills.io) open standard. Enables AI
agents to check GPU resources, generate and submit workflows, monitor progress, diagnose failures, deploy OSMO, and
prepare config-file admin changes.

Compatible with Claude Code, Cursor, Codex, GitHub Copilot, Gemini CLI, and [30+ other agent tools](https://skills.sh/).

## Prerequisites

- `osmo-user`: the OSMO CLI must be installed and authenticated. See the [Getting Started](https://nvidia.github.io/OSMO/main/user_guide/getting_started/install/index.html) guide.
- `osmo-deploy`: deployment tools such as `kubectl`, `helm`, and provider CLIs may be required depending on the target.
- `osmo-admin`: work from a user-provided config root that stores OSMO service config values.

## Installation

To install:

```bash
npx skills add NVIDIA/osmo
```

To update an existing installation:

```bash
npx skills update
```

To uninstall one skill:

```bash
npx skills remove osmo-user
```

## Usage

Once installed, the skill activates automatically when the agent detects relevant requests. Example prompts:

| Category | Example |
|----------|---------|
| Resource availability | "What GPUs are available?" |
| Workflow submission | "Submit workflow.yaml to an available pool" |
| Monitoring | "What's the status of my last workflow?" |
| Failure diagnosis | "My workflow failed; figure out why and resubmit" |
| Deployment | "Deploy OSMO to this Kubernetes cluster" |
| Admin desired state | "Show the service-values diff to put this pool in maintenance" |

For complex workflows, the skill spawns specialized sub-agents to handle resource selection, YAML generation, submission, monitoring, logs fetching, failure diagnosis, and retries autonomously.

## Skills

```text
skills/
├── osmo-user/    # End-user CLI workflow operations
├── osmo-deploy/  # OSMO installation and deployment
└── osmo-admin/   # Config-file admin reads and local diffs
```

Use `osmo-user` for live workflow operations, `osmo-deploy` for standing up OSMO, and `osmo-admin` for config-file
service administration in a user-provided config root. `osmo-admin` does not run `osmo config`, mutate live Kubernetes
resources, run deployment syncs, or print secret payloads.

## License

Apache-2.0.
