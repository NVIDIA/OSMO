// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Spec Generator - YAML and Jinja2 Template Generation
 *
 * Generates workflow specifications in two formats:
 * 1. Resolved YAML spec (concrete values)
 * 2. Jinja2 template spec (parameterized with variables)
 */

import type { MockWorkflow } from "@/mocks/generators/workflow-generator";

/**
 * Generate resolved YAML specification for a workflow
 */
export function generateYamlSpec(workflow: MockWorkflow): string {
  const taskSpecs = workflow.groups.flatMap((g) =>
    g.tasks.map((t, idx) => {
      return `  # Task ${idx + 1}: ${t.name}
  # Group: ${g.name}
  # Status: ${t.status}
  - name: ${t.name}
    image: ${t.image || workflow.image || "nvcr.io/nvidia/pytorch:24.08-py3"}

    # Resource allocation
    resources:
      gpu: ${t.gpu}
      cpu: ${t.cpu}
      memory: ${t.memory}Gi
      shm_size: 16Gi

    # Environment variables
    environment:
      CUDA_VISIBLE_DEVICES: "all"
      NCCL_DEBUG: "INFO"
      NCCL_DEBUG_SUBSYS: "ALL"
      PYTHONUNBUFFERED: "1"
      TORCH_DISTRIBUTED_DEBUG: "DETAIL"
      TASK_UUID: "${t.task_uuid}"
      WORKFLOW_NAME: "${workflow.name}"
      GROUP_NAME: "${g.name}"
      TASK_INDEX: "${idx}"

    # Volume mounts
    volumes:
      - /data:/workspace/data:rw
      - /models:/workspace/models:ro
      - /scratch:/workspace/scratch:rw
      - /shared:/workspace/shared:rw

    # Network configuration
    network_mode: bridge
    dns:
      - 8.8.8.8
      - 8.8.4.4

    # Security settings
    security:
      privileged: false
      read_only_root_filesystem: false

    # Health check
    healthcheck:
      test: ["CMD", "python", "-c", "import torch; print(torch.cuda.is_available())"]
      interval: 30s
      timeout: 10s
      retries: 3

    # Resource limits
    limits:
      max_memory: ${t.memory + 8}Gi
      max_cpu: ${t.cpu + 4}

    # Command to execute
    command: >
      python train.py
      --data-dir /workspace/data
      --model-dir /workspace/models
      --output-dir /workspace/data/outputs
      --epochs 100
      --batch-size 32
      --learning-rate 0.001
      --optimizer adam
      --scheduler cosine
      --warmup-steps 1000
      --gradient-clip 1.0
      --seed 42
      --log-interval 100
      --save-interval 1000`;
    }),
  );

  return `# =============================================================================
# Workflow Specification: ${workflow.name}
# Generated: ${new Date().toISOString()}
# Priority: ${workflow.priority || "NORMAL"}
# Pool: ${workflow.pool || "default-pool"}
# =============================================================================
#
# This workflow specification defines a distributed training job with
# automatic checkpointing, monitoring, and fault tolerance.
#
# =============================================================================

workflow:
  name: ${workflow.name}
  priority: ${workflow.priority || "NORMAL"}
  pool: ${workflow.pool || "default-pool"}

  # Workflow configuration
  config:
    max_retries: 3
    timeout: 24h
    enable_monitoring: true
    log_level: INFO
    enable_profiling: true

  # Notification settings
  notifications:
    on_failure: true
    on_success: false

  # Storage configuration
  storage:
    output_path: /data/outputs/${workflow.name}
    checkpoint_path: /data/checkpoints/${workflow.name}
    log_path: /data/logs/${workflow.name}
    checkpoint_interval: 1000
    keep_last_n_checkpoints: 5

  # Task definitions
  tasks:
${taskSpecs.length > 0 ? taskSpecs.join("\n\n") : "  # No tasks defined\n  - name: placeholder\n    image: nvcr.io/nvidia/pytorch:24.08-py3\n    resources:\n      gpu: 1\n      cpu: 8\n      memory: 32Gi"}

# =============================================================================
# End of workflow specification
# =============================================================================
`;
}

/**
 * Generate Jinja2 template specification for a workflow
 */
export function generateTemplateSpec(workflow: MockWorkflow): string {
  const taskTemplates = workflow.groups.flatMap((g) =>
    g.tasks.map((t, idx) => {
      return `  # Task ${idx + 1}: ${t.name}
  # Group: ${g.name}
  # Status: ${t.status}
  - name: {{ task_prefix | default("") }}${t.name}
    image: {{ container_registry | default("nvcr.io") }}/{{ image_path | default("nvidia/pytorch:24.08-py3") }}

    # Resource allocation
    resources:
      gpu: {{ gpu_count | default(${t.gpu}) }}
      cpu: {{ cpu_count | default(${t.cpu}) }}
      memory: {{ memory_gb | default(${t.memory}) }}Gi
      {% if use_shared_memory | default(false) %}
      shm_size: {{ shm_size_gb | default(16) }}Gi
      {% endif %}

    # Environment variables
    environment:
      CUDA_VISIBLE_DEVICES: "{{ cuda_devices | default('all') }}"
      NCCL_DEBUG: "{{ nccl_debug_level | default('INFO') }}"
      PYTHONUNBUFFERED: "1"
      TASK_UUID: "${t.task_uuid}"
      WORKFLOW_NAME: "{{ workflow_name }}"
      {% for key, value in extra_env.items() %}
      {{ key }}: "{{ value }}"
      {% endfor %}

    # Volume mounts
    volumes:
      - /data:/workspace/data:rw
      - /models:/workspace/models:ro
      {% if use_scratch | default(false) %}
      - /scratch:/workspace/scratch:rw
      {% endif %}

    # Dependencies
    {% if task_dependencies | length > 0 %}
    depends_on:
      {% for dep in task_dependencies %}
      - {{ dep }}
      {% endfor %}
    {% endif %}

    # Command to execute
    command: >
      python train.py
      --epochs {{ epochs | default(100) }}
      --batch-size {{ batch_size | default(32) }}
      --learning-rate {{ learning_rate | default(0.001) }}
      {% if use_distributed | default(false) %}
      --distributed
      --world-size {{ world_size | default(1) }}
      {% endif %}
`;
    }),
  );

  return `# =============================================================================
# Workflow Template: ${workflow.name}
# Generated: {{ generation_timestamp | default(now()) }}
# =============================================================================
#
# This Jinja2 template defines a distributed training workflow with
# configurable parameters for resource allocation, environment setup,
# and task orchestration.
#
# Variables:
#   workflow_name: Name of the workflow (required)
#   pool_name: Compute pool to use (default: "default-pool")
#   priority_level: Workflow priority (default: "NORMAL")
#   enable_checkpointing: Enable checkpoint saving (default: true)
#   checkpoint_interval: Checkpoint frequency in steps (default: 1000)
#   use_distributed: Enable distributed training (default: false)
#   world_size: Number of processes for distributed training (default: 1)
#
# =============================================================================

{% set workflow_name = "${workflow.name}" %}
{% set pool_name = pool | default("${workflow.pool || "default-pool"}") %}
{% set priority_level = priority | default("${workflow.priority || "NORMAL"}") %}

# Workflow metadata
workflow:
  name: {{ workflow_name }}
  priority: {{ priority_level }}
  pool: {{ pool_name }}

  # Optional: Workflow-level configuration
  config:
    max_retries: {{ max_retries | default(3) }}
    timeout: {{ timeout_hours | default(24) }}h
    enable_monitoring: {{ enable_monitoring | default(true) }}
    log_level: {{ log_level | default("INFO") }}

  # Optional: Notification settings
  {% if notification_email %}
  notifications:
    email: {{ notification_email }}
    on_failure: true
    on_success: {{ notify_on_success | default(false) }}
  {% endif %}

  # Optional: Storage configuration
  storage:
    output_path: {{ output_path | default("/data/outputs/" + workflow_name) }}
    checkpoint_path: {{ checkpoint_path | default("/data/checkpoints/" + workflow_name) }}
    log_path: {{ log_path | default("/data/logs/" + workflow_name) }}
    {% if enable_checkpointing | default(true) %}
    checkpoint_interval: {{ checkpoint_interval | default(1000) }}
    keep_last_n_checkpoints: {{ keep_checkpoints | default(5) }}
    {% endif %}

  # Task definitions
  tasks:
${
  taskTemplates.length > 0
    ? taskTemplates.join("\n\n")
    : `  # Default task configuration
  - name: {{ task_name | default("main") }}
    image: {{ image | default("nvcr.io/nvidia/pytorch:24.08-py3") }}

    resources:
      gpu: {{ gpu_count | default(1) }}
      cpu: {{ cpu_count | default(8) }}
      memory: {{ memory_gb | default(32) }}Gi

    environment:
      CUDA_VISIBLE_DEVICES: "all"
      PYTHONUNBUFFERED: "1"

    command: >
      python main.py
      --config {{ config_file | default("config.yaml") }}`
}

  # Optional: Post-processing tasks
  {% if enable_postprocessing | default(false) %}
  - name: postprocess
    image: {{ postprocess_image | default("nvcr.io/nvidia/pytorch:24.08-py3") }}
    resources:
      cpu: {{ postprocess_cpus | default(4) }}
      memory: {{ postprocess_memory | default(16) }}Gi
    depends_on:
      {% for task in tasks %}
      - {{ task.name }}
      {% endfor %}
    command: >
      python postprocess.py
      --input {{ output_path }}
      --output {{ postprocess_output | default(output_path + "/processed") }}
  {% endif %}

# =============================================================================
# End of workflow template
# =============================================================================
`;
}
