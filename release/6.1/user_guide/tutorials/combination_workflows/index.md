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

<a id="tutorials-combination-workflows"></a>

# Combination Workflows

This tutorial teaches you how to combine serial and parallel execution patterns by creating
**groups with dependencies**—enabling sophisticated multi-stage workflows.

So far, you have learned:

- **Serial workflows** ([Tutorial #5](../serial_workflows/index.md#tutorials-serial-workflows)) - Tasks run one after another with dependencies
- **Parallel workflows** ([Tutorial #6](../parallel_workflows/index.md#tutorials-parallel-workflows)) - Tasks run simultaneously using groups

**Combination workflows** merge both patterns by creating **groups with dependencies**.

By the end, you’ll understand:

- How to create workflows with groups that depend on each other
- How data flows between groups
- How to build complex multi-stage pipelines

> **Tip**
>
> Combination workflows are ideal for:

> - **Data processing pipelines** - Preprocess → train/validate in parallel → aggregate
> - **ML workflows** - Data prep → train multiple models → compare results
> - **Testing workflows** - Build → test on multiple configs → report
> - **ETL pipelines** - Extract → transform in parallel → load

## Simple Example

Let’s build a data processing pipeline with multiple stages by downloading the workflow definition
here: [`combination_workflow_simple.yaml`](../../../../workflows/tutorials/combination_workflow_simple.yaml).

![Simple Combination Workflow](user_guide/tutorials/combination_workflows/combination_workflow_simple.svg)
```yaml

workflow:
  name: data-pipeline

  groups:
  ##################################################
  # Group 1: Data Preparation (runs first)
  ##################################################
  - name: prepare-data
    tasks:
    - name: generate-dataset
      lead: true
      image: ubuntu:24.04
      command: ["bash", "-c"]
      args:
      - |
        echo "Generating training dataset..."
        mkdir -p {{output}}/data
        for i in {1..10}; do
          echo "sample_$i,value_$i" >> {{output}}/data/dataset.csv
        done
        echo "✓ Dataset generation complete!"

    - name: validate-data
      image: ubuntu:24.04
      command: ["bash", "-c"]
      args:
      - |
        echo "Validating dataset..."
        sleep 3
        echo "✓ Validation passed!"

  ##################################################
  # Group 2: Training (depends on Group 1)
  ##################################################
  - name: train-models
    tasks:
    - name: train-model-a
      lead: true
      image: ubuntu:24.04
      command: ["bash", "-c"]
      args:
      - |
        echo "Training Model A..."
        cat {{input:0}}/data/dataset.csv
        echo "✓ Model A complete!"
      inputs:
      - task: generate-dataset  # (1)

    - name: train-model-b
      image: ubuntu:24.04
      command: ["bash", "-c"]
      args:
      - |
        echo "Training Model B..."
        wc -l {{input:0}}/data/dataset.csv
        echo "✓ Model B complete!"
      inputs:
      - task: generate-dataset
```

1. The `generate-dataset` task is an input task for the `train-model-a` task. Therefore,
   the entire group `train-models` waits for `prepare-data` to complete.

**Execution Flow:**

1. Group `prepare-data` starts → `generate-dataset` and `validate-data` run in parallel.
2. Task `generate-dataset` completes → Group `train-models` dependencies are satisfied.
3. Group `train-models` starts → `train-model-a` and `train-model-b` run in parallel.

> **Important**
>
> **Group dependencies** are established through **task dependencies**.

> If any task in a group depends on a task from another group, the entire group waits for the other
> group to complete.

**Key Characteristics:**

- ✅ Serial execution **between** groups
- ✅ Parallel execution **within** groups
- ✅ Data flows from Group 1 to Group 2
- ✅ All tasks access the same data from the previous group

## Complex Example

Let’s build a more complex data processing pipeline by downloading the workflow definition
here: [`combination_workflow_complex.yaml`](../../../../workflows/tutorials/combination_workflow_complex.yaml).

![Complex Combination Workflow](user_guide/tutorials/combination_workflows/combination_workflow_complex.svg)
```yaml

workflow:
  name: complex-pipeline

  groups:
  ##################################################
  # Group 1: Fetch data
  ##################################################
  - name: fetch
    tasks:
    - name: download
      lead: true
      image: ubuntu:24.04
      command: ["bash", "-c"]
      args:
      - |
        echo 'Downloading data...'
        mkdir -p {{output}}/data
        echo "apple" > {{output}}/data/fruits.txt
        echo "banana" >> {{output}}/data/fruits.txt
        echo "cherry" >> {{output}}/data/fruits.txt
        echo "Data downloaded!"

  ##################################################
  # Group 2: Process (depends on Group 1)
  ##################################################
  - name: process
    tasks:
    - name: transform-a
      lead: true
      image: ubuntu:24.04
      command: ["bash", "-c"]
      args:
      - |
        echo 'Transform A: Converting to uppercase...'
        mkdir -p {{output}}/transformed
        tr '[:lower:]' '[:upper:]' < {{input:0}}/data/fruits.txt > {{output}}/transformed/uppercase.txt

        sleep 120 # (1)
        echo "✓ Transform A complete!"
      inputs:
      - task: download

    - name: transform-b
      image: ubuntu:24.04
      command: ["bash", "-c"]
      args:
      - |
        echo 'Transform B: Adding line numbers...'
        mkdir -p {{output}}/transformed
        cat -n {{input:0}}/data/fruits.txt > {{output}}/transformed/numbered.txt
        echo "✓ Transform B complete!"
      inputs:
      - task: download

  ##################################################
  # Group 3: Aggregate (depends on Group 2)
  ##################################################
  - name: aggregate
    tasks:
    - name: combine
      lead: true
      image: ubuntu:24.04
      command: ["bash", "-c"]
      args:
      - |
        echo 'Combining results from both transforms...'
        mkdir -p {{output}}/final

        echo "=== UPPERCASE VERSION ===" > {{output}}/final/combined.txt
        cat {{input:0}}/transformed/uppercase.txt >> {{output}}/final/combined.txt

        echo "" >> {{output}}/final/combined.txt
        echo "=== NUMBERED VERSION ===" >> {{output}}/final/combined.txt
        cat {{input:1}}/transformed/numbered.txt >> {{output}}/final/combined.txt

        echo "✓ Results combined!"
        cat {{output}}/final/combined.txt
      inputs:  # (2)
      - task: transform-a
      - task: transform-b
```

1. The `transform-a` task is intentionally longer than the `transform-b` task to ensure that
   the `lead` task doesn’t prematurely terminate non-lead tasks.
2. Group 3 depends on both tasks from Group 2, so it waits for Group 2 to complete.

**Execution:**

1. Group `fetch` starts → `download` task runs
2. `download` task completes → Group `process` dependencies are satisfied.
3. Group `process` starts → `transform-a` and `transform-b` run in parallel.
4. `transform-b` task completes → Group `aggregate` dependencies not yet satisfied.
5. `transform-a` task completes → Group `aggregate` dependencies are satisfied.
6. Group `aggregate` starts → `combine` task runs with outputs from both transforms.

> **Caution**
>
> To ensure that **all tasks** in a group run to completion, you should make sure that
> the `lead` task **does not terminate** before non-lead tasks.

> This can be done by coordinating task completion through a barrier script
> ([osmo_barrier.py](https://github.com/NVIDIA/OSMO/blob/main/workflows/dnn_training/torchrun_multinode/osmo_barrier.py))
> or by ensuring that the `lead` task duration is longer than the non-lead tasks.

> **Important**
>
> **Best Practices:**

> - ✅ Always designate one task as `lead: true` in each group
> - ✅ Use clear group names that reflect their purpose (e.g., `prepare-data`, `train-models`)
> - ✅ Make dependencies explicit through task inputs
> - ✅ Consider which tasks should run in parallel vs. serially

## Next Steps

**Continue Learning:**

- [Gang Scheduling](../hardware_in_the_loop/index.md#tutorials-gang-scheduling) - Run tasks across different hardware platforms (x86, ARM, GPU) simultaneously
- [Advanced Patterns](../advanced_patterns.md#tutorials-advanced-patterns) - Workflow templates, checkpointing, error handling, and more

#### SEE ALSO
**Related Documentation:**

- [Groups](../../workflows/specification/index.md#workflow-spec-group) - Full specification for groups
- [Inputs and Outputs](../../workflows/specification/inputs_and_outputs.md#workflow-spec-inputs-and-outputs) - Data flow between tasks
