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
agents to check GPU resources, generate and submit workflows, monitor progress, diagnose failures, and orchestrate
end-to-end Physical AI workloads.

Compatible with Claude Code, Cursor, Codex, GitHub Copilot, Gemini CLI, and [30+ other agent tools](https://skills.sh/).

## Prerequisites

The OSMO CLI must be installed and authenticated before using the skill. See the [Getting Started](https://nvidia.github.io/OSMO/main/user_guide/getting_started/install/index.html) guide for instructions.

## Installation

To install:

```bash
npx skills add NVIDIA/osmo
```

To update an existing installation:

```bash
npx skills update
```

To uninstall:

```bash
npx skills remove osmo-agent
```

## Usage

Once installed, the skill activates automatically when the agent detects relevant requests. Example prompts:

| Category | Example |
|----------|---------|
| Resource availability | "What GPUs are available?" |
| Workflow submission | "Submit workflow.yaml to available pool" |
| Monitoring | "What's the status of my last workflow?" |
| Failure diagnosis | "My workflow failed — figure out why and resubmit" |
| End-to-end orchestration | "Create a SDG workflow with Issac Sim, submit and monitor it, and download results when done" |

For complex workflows, the skill spawns specialized sub-agents to handle resource selection, YAML generation, submission, monitoring, logs fetching, failure diagnosis, and retries autonomously.

## Skill Contents

```
skills/osmo-agent/
├── SKILL.md                 # Main skill instructions
├── LICENSE                  # Apache-2.0
├── agents/
│   ├── workflow-expert.md   # Sub-agent: workflow creation, submission, diagnosis
│   └── logs-reader.md       # Sub-agent: log fetching and summarization
└── references/
    ├── cookbook.md           # 40+ real-world workflow templates
    ├── workflow-patterns.md # Multi-task, parallel, data dependency patterns
    └── advanced-patterns.md # Checkpointing, retry logic, node exclusion
```

## License

Apache-2.0 — see [osmo-agent/LICENSE](osmo-agent/LICENSE).
