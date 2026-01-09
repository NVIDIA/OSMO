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
 * Mock Data Configuration
 *
 * Defines patterns and distributions for generating realistic synthetic data.
 * All data is procedurally generated - no scraping required.
 */

// ============================================================================
// Volume Configuration - Controls how much data to generate
// ============================================================================

export interface MockVolume {
  /** Total workflows to generate (default: 10,000 for pagination testing) */
  workflows: number;
  /** Pools to generate */
  pools: number;
  /** Resources (nodes) per pool */
  resourcesPerPool: number;
  /** Tasks per workflow (varies by workflow complexity) */
  tasksPerWorkflow: { min: number; max: number };
  /** Log lines per task */
  logsPerTask: { min: number; max: number };
  /** Events per workflow */
  eventsPerWorkflow: { min: number; max: number };
}

export const DEFAULT_VOLUME: MockVolume = {
  workflows: 10_000, // 10k for pagination stress testing
  pools: 8,
  resourcesPerPool: 50,
  tasksPerWorkflow: { min: 1, max: 16 },
  logsPerTask: { min: 50, max: 500 },
  eventsPerWorkflow: { min: 5, max: 20 },
};

// High volume for stress testing
export const HIGH_VOLUME: MockVolume = {
  workflows: 100_000,
  pools: 20,
  resourcesPerPool: 200,
  tasksPerWorkflow: { min: 1, max: 32 },
  logsPerTask: { min: 100, max: 1000 },
  eventsPerWorkflow: { min: 10, max: 50 },
};

// Low volume for quick iteration
export const LOW_VOLUME: MockVolume = {
  workflows: 100,
  pools: 3,
  resourcesPerPool: 10,
  tasksPerWorkflow: { min: 1, max: 4 },
  logsPerTask: { min: 10, max: 50 },
  eventsPerWorkflow: { min: 3, max: 10 },
};

// ============================================================================
// Workflow Patterns
// ============================================================================

export interface WorkflowPatterns {
  /** Status distribution: status → probability (0-1) */
  statusDistribution: Record<string, number>;
  /** Priority distribution */
  priorityDistribution: Record<string, number>;
  /** Pool names */
  pools: string[];
  /** User names */
  users: string[];
  /** Tags for categorization */
  tags: string[];
  /** Name generation patterns */
  namePatterns: {
    prefixes: string[];
    suffixes: string[];
  };
  /** Group/DAG patterns */
  groupPatterns: {
    names: string[];
    tasksPerGroup: { min: number; max: number };
    groupsPerWorkflow: { min: number; max: number };
  };
  /** Timing in seconds */
  timing: {
    queueTime: { min: number; max: number; p50: number; p90: number };
    duration: { min: number; max: number; p50: number; p90: number };
  };
  /** Failure patterns */
  failures: {
    typeDistribution: Record<string, number>;
    messages: Record<string, string[]>;
  };
}

export const DEFAULT_WORKFLOW_PATTERNS: WorkflowPatterns = {
  // All 16 WorkflowStatus values (not TaskGroupStatus)
  statusDistribution: {
    // Active states
    RUNNING: 0.20,
    COMPLETED: 0.35,
    WAITING: 0.08,
    PENDING: 0.07,
    // Failed states (all 12 failure types)
    FAILED: 0.06,
    FAILED_SUBMISSION: 0.02,
    FAILED_SERVER_ERROR: 0.02,
    FAILED_EXEC_TIMEOUT: 0.03,
    FAILED_QUEUE_TIMEOUT: 0.02,
    FAILED_CANCELED: 0.03,
    FAILED_BACKEND_ERROR: 0.02,
    FAILED_IMAGE_PULL: 0.03,
    FAILED_EVICTED: 0.02,
    FAILED_START_ERROR: 0.02,
    FAILED_START_TIMEOUT: 0.02,
    FAILED_PREEMPTED: 0.01,
  },
  priorityDistribution: {
    HIGH: 0.1,
    NORMAL: 0.8,
    LOW: 0.1,
  },
  pools: [
    "dgx-cloud-us-west-2",
    "dgx-cloud-us-east-1",
    "gpu-cluster-prod",
    "gpu-cluster-dev",
    "spot-gpu-pool",
    "on-demand-gpu",
    "preemptible-a100",
    "high-priority",
  ],
  users: [
    "alice.chen",
    "bob.smith",
    "carol.jones",
    "david.kim",
    "eve.wilson",
    "frank.zhang",
    "grace.lee",
    "henry.patel",
    "system-scheduler",
    "ci-pipeline",
  ],
  tags: [
    "training",
    "inference",
    "research",
    "production",
    "nightly",
    "experiment",
    "benchmark",
    "fine-tuning",
    "evaluation",
    "preprocessing",
  ],
  namePatterns: {
    prefixes: [
      "train",
      "eval",
      "infer",
      "finetune",
      "pretrain",
      "benchmark",
      "test",
      "validate",
      "preprocess",
      "export",
      "convert",
      "distill",
      "quantize",
      "prune",
      "optimize",
    ],
    suffixes: [
      "llama",
      "mistral",
      "gpt",
      "bert",
      "t5",
      "gemma",
      "resnet",
      "vit",
      "clip",
      "whisper",
      "wav2vec",
      "main",
      "dev",
      "prod",
      "exp",
      "v1",
      "v2",
    ],
  },
  groupPatterns: {
    names: ["data-prep", "train", "eval", "export", "validate", "preprocess", "postprocess", "inference", "checkpoint"],
    tasksPerGroup: { min: 1, max: 8 },
    groupsPerWorkflow: { min: 1, max: 6 },
  },
  timing: {
    queueTime: { min: 0, max: 7200, p50: 60, p90: 900 },
    duration: { min: 60, max: 172800, p50: 3600, p90: 28800 },
  },
  failures: {
    // WorkflowStatus failure values only (FAILED_UPSTREAM is TaskGroupStatus only)
    typeDistribution: {
      FAILED: 0.35,
      FAILED_EXEC_TIMEOUT: 0.15,
      FAILED_IMAGE_PULL: 0.15,
      FAILED_EVICTED: 0.1,
      FAILED_PREEMPTED: 0.1,
      FAILED_QUEUE_TIMEOUT: 0.05,
      FAILED_CANCELED: 0.05,
      FAILED_SUBMISSION: 0.05,
    },
    // Messages for all 12 failure types
    messages: {
      FAILED: [
        "Process exited with code 1",
        "Out of memory: killed process",
        "CUDA error: out of memory",
        "RuntimeError: NCCL error",
        "Segmentation fault (core dumped)",
      ],
      FAILED_SUBMISSION: ["Failed to submit workflow", "Invalid workflow spec", "Submission rejected by backend"],
      FAILED_SERVER_ERROR: ["Internal server error", "Backend service unavailable", "API request failed"],
      FAILED_EXEC_TIMEOUT: ["Execution timeout exceeded (24h)", "Task exceeded maximum runtime", "Deadline exceeded"],
      FAILED_QUEUE_TIMEOUT: ["Queue timeout exceeded (48h)", "No resources available within timeout"],
      FAILED_CANCELED: ["Canceled by user", "Workflow canceled via API", "Canceled due to shutdown"],
      FAILED_BACKEND_ERROR: ["Backend cluster unreachable", "Kubernetes API error", "Scheduler failure"],
      FAILED_IMAGE_PULL: [
        "ImagePullBackOff: unauthorized",
        "Failed to pull image: not found",
        "ErrImagePull: connection timeout",
      ],
      FAILED_EVICTED: [
        "Node under memory pressure",
        "Pod evicted due to disk pressure",
        "Evicted for node maintenance",
      ],
      FAILED_START_ERROR: ["Container failed to start", "Entrypoint not found", "Permission denied"],
      FAILED_START_TIMEOUT: ["Container start timeout", "Init container took too long", "Readiness probe failed"],
      FAILED_PREEMPTED: [
        "Preempted by higher priority workload",
        "Spot instance terminated",
        "Resource reclaimed for priority=HIGH",
      ],
    },
  },
};

// ============================================================================
// Pool Patterns
// ============================================================================

export interface PoolPatterns {
  /** Pool names (will be used directly) */
  names: string[];
  /** Platform types */
  platforms: string[];
  /** Cloud regions */
  regions: string[];
  /** GPU types available */
  gpuTypes: string[];
  /** Quota patterns */
  quota: {
    gpuCounts: number[];
    utilizationRange: { min: number; max: number };
  };
}

export const DEFAULT_POOL_PATTERNS: PoolPatterns = {
  names: DEFAULT_WORKFLOW_PATTERNS.pools,
  platforms: ["kubernetes", "slurm", "dgx-cloud", "aws-batch", "azure-ml", "gcp-vertex", "on-prem", "hybrid-cloud"],
  regions: ["us-west-2", "us-east-1", "eu-west-1", "ap-northeast-1"],
  gpuTypes: [
    "NVIDIA-H100-80GB-HBM3",
    "NVIDIA-A100-SXM4-80GB",
    "NVIDIA-A100-SXM4-40GB",
    "NVIDIA-L40S",
    "NVIDIA-A10G",
    "NVIDIA-V100-SXM2-32GB",
  ],
  quota: {
    gpuCounts: [32, 64, 128, 256, 512, 1024],
    utilizationRange: { min: 0.3, max: 0.95 },
  },
};

// ============================================================================
// Resource (Node) Patterns
// ============================================================================

export interface ResourcePatterns {
  /** GPU types (cross-ref with pools) */
  gpuTypes: string[];
  /** Node naming */
  nodePatterns: {
    prefixes: string[];
    formats: string[];
  };
  /** GPUs per node options */
  gpusPerNode: number[];
  /** CPU to GPU ratio */
  cpuPerGpu: { min: number; max: number };
  /** Memory per GPU in GB */
  memoryPerGpu: { min: number; max: number };
  /** Status distribution */
  statusDistribution: Record<string, number>;
}

export const DEFAULT_RESOURCE_PATTERNS: ResourcePatterns = {
  gpuTypes: DEFAULT_POOL_PATTERNS.gpuTypes,
  nodePatterns: {
    prefixes: ["dgx", "gpu", "compute", "worker", "node"],
    formats: ["{prefix}-{gpu}-{zone}-{num:03d}", "{prefix}-{num:04d}"],
  },
  gpusPerNode: [1, 2, 4, 8],
  cpuPerGpu: { min: 8, max: 32 },
  memoryPerGpu: { min: 64, max: 256 },
  statusDistribution: {
    AVAILABLE: 0.5,
    IN_USE: 0.35,
    CORDONED: 0.05,
    DRAINING: 0.05,
    OFFLINE: 0.05,
  },
};

// ============================================================================
// Task Patterns
// ============================================================================

export interface TaskPatterns {
  /** Status distribution */
  statusDistribution: Record<string, number>;
  /** Task naming */
  namePatterns: {
    prefixes: string[];
    indexed: boolean;
  };
  /** GPU count options */
  gpuCounts: number[];
  /** Common exit codes for failures */
  exitCodes: number[];
  /** Command patterns */
  commands: {
    prefixes: string[];
    examples: string[][];
  };
  /** Timing in seconds */
  timing: {
    scheduleLatency: { min: number; max: number };
    initTime: { min: number; max: number };
    duration: { min: number; max: number; p50: number; p90: number };
  };
}

export const DEFAULT_TASK_PATTERNS: TaskPatterns = {
  statusDistribution: {
    RUNNING: 0.25,
    COMPLETED: 0.4,
    FAILED: 0.08,
    WAITING: 0.1,
    SCHEDULING: 0.07,
    INITIALIZING: 0.05,
    FAILED_IMAGE_PULL: 0.02,
    FAILED_EXEC_TIMEOUT: 0.01,
    FAILED_EVICTED: 0.01,
    FAILED_PREEMPTED: 0.01,
  },
  namePatterns: {
    prefixes: ["train", "eval", "preprocess", "export", "worker", "rank"],
    indexed: true, // e.g., train-0, train-1
  },
  gpuCounts: [0, 1, 2, 4, 8],
  exitCodes: [0, 1, 2, 137, 139, 143, 255],
  commands: {
    prefixes: ["python", "torchrun", "deepspeed", "accelerate", "bash"],
    examples: [
      ["python", "-m", "train", "--config", "/workspace/config.yaml"],
      ["torchrun", "--nproc_per_node=8", "train.py", "--epochs", "100"],
      ["deepspeed", "--num_gpus=8", "train.py", "--deepspeed", "ds_config.json"],
      ["python", "eval.py", "--checkpoint", "/workspace/model.pt"],
      ["bash", "-c", "nvidia-smi && python train.py"],
    ],
  },
  timing: {
    scheduleLatency: { min: 1, max: 300 },
    initTime: { min: 5, max: 180 },
    duration: { min: 60, max: 28800, p50: 1800, p90: 7200 },
  },
};

// ============================================================================
// Log Patterns
// ============================================================================

export interface LogPatterns {
  /** Log formats */
  formats: {
    timestamp: string;
    levels: string[];
    prefixes: string[];
  };
  /** Message templates by category */
  messages: {
    osmo: string[];
    training: string[];
    progress: string[];
    errors: Record<string, string[]>;
  };
  /** Metrics patterns */
  metrics: {
    loss: string[];
    accuracy: string[];
    gpu: string[];
  };
}

export const DEFAULT_LOG_PATTERNS: LogPatterns = {
  formats: {
    timestamp: "YYYY/MM/DD HH:mm:ss",
    levels: ["INFO", "WARN", "ERROR", "DEBUG"],
    prefixes: ["[osmo]", "[train]", "[eval]", "[system]"],
  },
  messages: {
    osmo: [
      "[osmo] Downloading Start",
      "[osmo] All Inputs Gathered",
      "[osmo] Upload Start",
      "[osmo] Task completed successfully",
      "[osmo] Initializing container",
      "[osmo] Running on node {node}",
      "[osmo] Container started with {gpus} GPUs",
    ],
    training: [
      "Epoch {epoch}/{total}: loss={loss:.4f}, lr={lr:.2e}",
      "Step {step}: loss={loss:.4f}",
      "Training complete. Best loss: {loss:.4f}",
      "Loading checkpoint from {path}",
      "Saving model to {path}",
      "GPU memory: {used:.1f}GB / {total:.1f}GB",
      "Gradient norm: {norm:.4f}",
      "Tokens/sec: {tps:.0f}",
    ],
    progress: [
      "Progress: {percent:.1f}%",
      "Downloading: {downloaded:.0f}/{total:.0f} MB",
      "Processing batch {batch}/{total}",
      "Validation accuracy: {acc:.2%}",
    ],
    errors: {
      OOM: [
        "CUDA out of memory. Tried to allocate {size} GiB",
        "RuntimeError: CUDA error: out of memory",
        "torch.cuda.OutOfMemoryError",
      ],
      NCCL: ["RuntimeError: NCCL error", "NCCL watchdog timeout", "Connection timed out in NCCL"],
      General: ["RuntimeError: {message}", "Exception: {message}", "Process terminated with signal {signal}"],
    },
  },
  metrics: {
    loss: ["loss: {val:.4f}", "train_loss={val:.4f}", "Loss: {val:.6f}"],
    accuracy: ["accuracy: {val:.2%}", "val_acc={val:.4f}", "Acc: {val:.2%}"],
    gpu: ["GPU Util: {val:.0f}%", "GPU Mem: {used:.0f}/{total:.0f}GB", "Temp: {val:.0f}°C"],
  },
};

// ============================================================================
// Event Patterns (Kubernetes-style)
// ============================================================================

export interface EventPatterns {
  /** Event types */
  types: string[];
  /** Reasons by lifecycle phase */
  reasons: {
    scheduling: string[];
    execution: string[];
    completion: string[];
    failure: string[];
  };
  /** Message templates by reason */
  messages: Record<string, string[]>;
  /** Event sources */
  sources: {
    components: string[];
  };
}

export const DEFAULT_EVENT_PATTERNS: EventPatterns = {
  types: ["Normal", "Warning"],
  reasons: {
    scheduling: ["Scheduled", "SuccessfulCreate", "Pulling", "Pulled", "Created"],
    execution: ["Started", "Running", "Progressing"],
    completion: ["Completed", "Succeeded", "Terminated"],
    failure: ["Failed", "FailedScheduling", "BackOff", "OOMKilled", "Evicted", "Preempted", "FailedMount", "Unhealthy"],
  },
  messages: {
    Scheduled: ["Successfully assigned {namespace}/{pod} to {node}"],
    Pulling: ['Pulling image "{image}"'],
    Pulled: ['Successfully pulled image "{image}" in {duration}s'],
    Created: ["Created container {container}"],
    Started: ["Started container {container}"],
    Running: ["Container {container} is running"],
    Completed: ["Container {container} completed successfully"],
    Failed: ["Container {container} failed with exit code {code}"],
    OOMKilled: ["Container {container} was OOMKilled"],
    Evicted: ["The node was low on resource: {resource}"],
    Preempted: ["Preempted by higher priority workload"],
    FailedScheduling: ["0/{total} nodes available: {reason}", "Insufficient {resource}"],
    BackOff: ['Back-off pulling image "{image}"'],
  },
  sources: {
    components: ["default-scheduler", "kubelet", "osmo-controller"],
  },
};

// ============================================================================
// Container Image Patterns
// ============================================================================

export interface ImagePatterns {
  registries: string[];
  repositories: string[];
  tags: string[];
}

export const DEFAULT_IMAGE_PATTERNS: ImagePatterns = {
  registries: ["nvcr.io", "docker.io", "ghcr.io"],
  repositories: [
    "nvcr.io/nvidia/pytorch",
    "nvcr.io/nvidia/tensorflow",
    "nvcr.io/nvidia/nemo",
    "nvcr.io/nvidia/tritonserver",
    "nvcr.io/nvidia/cuda",
  ],
  tags: ["24.08-py3", "24.07-py3", "24.06-py3", "24.05-py3", "12.4.0-devel-ubuntu22.04", "latest"],
};

// ============================================================================
// Export all defaults
// ============================================================================

export const MOCK_CONFIG = {
  volume: DEFAULT_VOLUME,
  workflows: DEFAULT_WORKFLOW_PATTERNS,
  pools: DEFAULT_POOL_PATTERNS,
  resources: DEFAULT_RESOURCE_PATTERNS,
  tasks: DEFAULT_TASK_PATTERNS,
  logs: DEFAULT_LOG_PATTERNS,
  events: DEFAULT_EVENT_PATTERNS,
  images: DEFAULT_IMAGE_PATTERNS,
};

export type MockConfig = typeof MOCK_CONFIG;
