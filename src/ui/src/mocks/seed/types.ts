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

export interface MockVolume {
  workflows: number;
  pools: number;
  resourcesPerPool: number;
  tasksPerWorkflow: { min: number; max: number };
  logsPerTask: { min: number; max: number };
  eventsPerWorkflow: { min: number; max: number };
}

const isDev = process.env.NODE_ENV === "development";

export const DEFAULT_VOLUME: MockVolume = {
  workflows: isDev ? 100 : 10_000,
  pools: isDev ? 6 : 8,
  resourcesPerPool: isDev ? 20 : 50,
  tasksPerWorkflow: { min: 1, max: isDev ? 4 : 16 },
  logsPerTask: { min: 10, max: isDev ? 50 : 500 },
  eventsPerWorkflow: { min: 3, max: isDev ? 8 : 20 },
};

export interface WorkflowPatterns {
  statusDistribution: Record<string, number>;
  priorityDistribution: Record<string, number>;
  pools: string[];
  users: string[];
  tags: string[];
  namePatterns: { prefixes: string[]; suffixes: string[] };
  groupPatterns: {
    names: string[];
    tasksPerGroup: { min: number; max: number };
    groupsPerWorkflow: { min: number; max: number };
  };
  timing: {
    queueTime: { min: number; max: number; p50: number; p90: number };
    duration: { min: number; max: number; p50: number; p90: number };
  };
  failures: {
    typeDistribution: Record<string, number>;
    messages: Record<string, string[]>;
  };
}

export const DEFAULT_WORKFLOW_PATTERNS: WorkflowPatterns = {
  statusDistribution: {
    RUNNING: 0.2,
    COMPLETED: 0.35,
    WAITING: 0.08,
    PENDING: 0.07,
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
    "dgx-cloud-eu-west-1",
    "dgx-cloud-ap-northeast-1",
    "shared-pool-alpha",
    "shared-pool-beta",
    "gpu-cluster-prod",
    "gpu-cluster-dev",
    "gpu-cluster-staging",
    "spot-gpu-pool",
    "on-demand-gpu",
    "preemptible-a100",
    "preemptible-h100",
    "high-priority",
    "reserved-capacity",
    "research-cluster",
    "inference-pool",
    "training-pool",
    "multi-tenant-shared",
    "dedicated-a100-80gb",
    "dedicated-h100-80gb",
    "benchmark-pool",
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
    tasksPerGroup: { min: 5, max: isDev ? 7 : 8 },
    groupsPerWorkflow: { min: 2, max: isDev ? 2 : 6 },
  },
  timing: {
    queueTime: { min: 0, max: 7200, p50: 60, p90: 900 },
    duration: { min: 60, max: 172800, p50: 3600, p90: 28800 },
  },
  failures: {
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

export interface PoolPatterns {
  names: string[];
  platforms: string[];
  regions: string[];
  gpuTypes: string[];
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

export interface ResourcePatterns {
  gpuTypes: string[];
  nodePatterns: { prefixes: string[]; formats: string[] };
  gpusPerNode: number[];
  cpuPerGpu: { min: number; max: number };
  memoryPerGpu: { min: number; max: number };
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

export interface TaskPatterns {
  statusDistribution: Record<string, number>;
  namePatterns: { prefixes: string[]; indexed: boolean };
  gpuCounts: number[];
  exitCodes: number[];
  commands: { prefixes: string[]; examples: string[][] };
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

export interface LogPatterns {
  formats: { timestamp: string; levels: string[]; prefixes: string[] };
  messages: {
    osmo: string[];
    training: string[];
    progress: string[];
    errors: Record<string, string[]>;
  };
  metrics: { loss: string[]; accuracy: string[]; gpu: string[] };
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

export interface EventPatterns {
  types: string[];
  reasons: {
    scheduling: string[];
    execution: string[];
    completion: string[];
    failure: string[];
  };
  messages: Record<string, string[]>;
  sources: { components: string[] };
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

// Shared pool configuration: alpha and beta share resources under SHARED_PLATFORM.
// Alpha additionally has ALPHA_EXTRA_PLATFORM covering half the resources.
export const SHARED_POOL_ALPHA = "shared-pool-alpha";
export const SHARED_POOL_BETA = "shared-pool-beta";
export const SHARED_PLATFORM = "dgx-cloud";
export const ALPHA_EXTRA_PLATFORM = "on-prem";

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
