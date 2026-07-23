<!--
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software without an express license agreement from
NVIDIA CORPORATION is strictly prohibited.
-->

# VDA two-video POC domain skill

Status: opt-in demonstration and framework test

This directory is intentionally separate from
[`../../framework/README.md`](../../framework/README.md). The framework ships only generic agentic
workflow mechanics; this skill owns the VDA topology, PAIDF/image details,
model-cache materializer, fixed video inputs, and output contract. A framework
task loads this domain only when its task-scoped goal explicitly names this
skill at a pinned repository commit.

## Load from the framework

Submit the generic [framework entry capsule](../../framework/agentic-workflow-spec.yaml)
with `STATIC_REPOSITORY_SUBDIR=projects/agents/poc/framework`. The task-scoped
goal must name the same public repository, full commit SHA, and this skill path
(`projects/agents/poc/skills/vda-two-video-poc`), then require the lead to
clone that source and read [SKILL.md](SKILL.md) and its referenced contracts
before it plans or delegates. Do not copy this skill's worker code or contract
text into the framework.

## Local static checks

```bash
cd /Users/fernandol/Workspace/osmo/external/projects/agents/poc/skills/vda-two-video-poc
(
  set -euo pipefail
  bash -n assets/model-artifact-materializer/materialize-model-artifacts.sh
  python3 -m json.tool assets/model-artifact-materializer/model-artifact-sources-v1.json >/dev/null
  python3 -c 'from pathlib import Path; path=Path("assets/model-artifact-materializer/verify-vda-cache.py"); compile(path.read_text(encoding="utf-8"), str(path), "exec")'
  python3 assets/model-artifact-materializer/verify-vda-cache.py --help >/dev/null
  ruby -e '
    require "yaml"
    skill = File.read(ARGV.fetch(0))
    match = skill.match(/\A---\n(.*?)\n---\n/m) or abort "invalid skill frontmatter"
    metadata = YAML.safe_load(match[1], permitted_classes: [], aliases: false)
    abort "invalid skill metadata" unless metadata.keys.sort == ["description", "name"] && metadata["name"] == "vda-two-video-poc"
  ' SKILL.md
  for reference in references/*.md; do test -s "$reference"; done
  rg -Fq 'assets/model-artifact-materializer' SKILL.md
  rg -Fq 'https://inference-api.nvidia.com/v1' SKILL.md references/locked-topology.md
  printf '%s\n' 'VDA skill static checks passed'
)
```

## Purpose

Prove the smallest useful agentic-goals loop without a product UI or changes to
OSMO services. The goal runs entirely in the user's persistent
`fernandol-dev.osmo.nvidia.com` environment through one custom agent image,
pinned upstream PAIDF images, custom workflow YAML, custom task scripts, and
the existing OSMO CLI/API.

The POC must answer four questions:

1. Can a long-lived OSMO-hosted lead translate one VDA goal into a bounded,
   inspectable plan?
2. Can it delegate a bounded environment pipeline and one bounded video
   pipeline per video, each of which performs meaningful recursive work?
3. Can the pipeline produce the agreed VDA `e2e` result contract using
   custom images and existing OSMO mechanisms only?
4. Can the lead reconcile results and completion without treating a model's
   success claim as proof?

## Scope and terminology

`Pipeline` is the user-facing, logical goal plan. An OSMO workflow is a static
execution *capsule*. The dynamic hierarchy is achieved by a running agent task
submitting new workflow capsules through the existing OSMO CLI/API; it never
adds tasks to an already submitted workflow.

The [locked topology](references/locked-topology.md) is the POC authority:

- One long-lived **lead-agent workflow** owns the one overarching VDA goal.
- The lead creates a Swift-backed run workspace, delegates one bounded
  **environment-pipeline workflow**, and waits for its `environment-ready`
  result before video fan-out.
- The environment pipeline verifies the content-addressed model-artifact
  workspace. On a cache miss it dynamically submits exactly one deterministic
  **model-artifact-materializer workflow**.
- The lead then submits one bounded **video-pipeline workflow** per approved
  video, also an agentic loop.
- Each video agent submits original labeling and augmentation in parallel, then
  submits augmented labeling only after valid augmentation evidence.
- Each stage workflow contains one deterministic GPU task, runs a pinned
  upstream PAIDF image directly, and has no agent loop or delegation authority.
- Preflight is a deterministic action within the relevant agent. There is no
  static setup workflow: only the environment pipeline may admit a deterministic
  materializer on a cache miss.
- Each video agent publishes a shared video-stage bundle; every stage performs
  `init -> execute -> validate -> result` inside its one task without installing
  dependencies.
- The target is the VDA `e2e` output contract: original labels, augmented
  video, and augmented labels for every video, not reuse of the reference YAML.

It does not attempt to build a UI, change OSMO services, create static or
unbounded preflight/setup workflows, recursively delegate beyond pipeline agent
to deterministic task, install arbitrary packages at VDA task runtime, or give
deterministic workers agentic authority.

## Plan sequence

For the exact static capsule schema, OSMO commands, and execution sequence, see
[Workflow overview](references/overview.md).

The accepted execution hierarchy and admission rules are in
[Locked topology](references/locked-topology.md). It supersedes earlier local-lead and
generic-worker examples in this directory.

1. [Architecture and contracts](references/00-architecture-and-contracts.md) defines the
   POC boundary, durable files, and the smallest plan/result contracts.
2. [Lead and pipeline compiler](references/01-local-lead-and-pipeline.md) makes the
   OSMO-hosted lead produce, inspect, revise, and compile the plan.
3. [Runtime environment construction](references/02-runtime-environments.md) resolves
   skills, tools, MCP configuration, and plugins into an immutable image.
4. [Worker execution and fan-out](references/03-worker-execution-and-fanout.md) runs a
   bounded agent in OSMO and verifies controlled child submission.
5. [Validation and demo](references/04-validation-and-demo.md) defines the evidence gates
   required before expanding the prototype.
6. [Vocabulary and existing interfaces](references/05-vocabulary-and-interfaces.md)
   defines the canonical POC terms, actions, and reuse boundaries.

Each plan has a build sequence and validation gates. Later plans may be
designed in parallel, but implementation proceeds only when the preceding gate
is satisfied.

## Success condition

From one user request, the OSMO-hosted lead produces an approved plan; starts
one environment-pipeline agent and, after `environment-ready`, one
video-pipeline agent per input video; each video agent dynamically executes the
original-label, augmentation, and augmented-label sequence; and the run
produces the VDA `e2e` result contract with recorded lineage and evidence.

## Related design

- [Overview](../../../01-overview.md)
- [Lifecycle](../../../02-lifecycle.md)
- [Lead agent](../../../04-lead-agent.md)
- [Workflow construction](../../../06-workflow-construction.md)
- [Agent construction](../../../07-agent-construction.md)
- [Agent-to-agent communication](../../../08-agent-agent-communication.md)
