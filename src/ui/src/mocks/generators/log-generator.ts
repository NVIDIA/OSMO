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

import { faker } from "@faker-js/faker";
import { HttpResponse, delay } from "msw";
import type { LogLevel, LogIOType } from "@/lib/api/log-adapter/types";
import { getWorkflowLogConfig, type WorkflowLogConfig } from "@/mocks/mock-workflows";
import {
  hashString,
  abortableDelay,
  getMockDelay,
  abortExistingStream,
  buildChunkedStream,
  pickFromDistribution,
  createStreamingResponse,
} from "@/mocks/utils";

const LOG_RESPONSE_HEADERS = {
  "Content-Type": "text/plain; charset=us-ascii",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-cache",
} as const;

/** Minimal workflow shape needed by log handlers — satisfied by MockWorkflow and WorkflowQueryResponse. */
export interface LogWorkflowInput {
  name: string;
  start_time?: string;
  end_time?: string;
  groups: Array<{
    name: string;
    tasks?: Array<{ name: string; task_uuid?: string }>;
  }>;
}

/** Minimal task shape needed by handleTaskLogs. */
export interface LogTaskInput {
  name: string;
  start_time?: string;
  end_time?: string;
}

const BASE_SEED = 11111;

// Reference date rounded to the hour for stable log timestamps within the same hour.
function getMockReferenceDate(): Date {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return now;
}

const MOCK_REFERENCE_DATE = getMockReferenceDate();

export interface GeneratedLogLine {
  timestamp: string;
  level: LogLevel;
  source: string;
  ioType: LogIOType;
  message: string;
  retryAttempt?: number;
  raw: string;
}

interface TaskContext {
  name: string;
  retryAttempt?: number;
}

const ANSI_COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
} as const;

const STACK_TRACES = [
  `Traceback (most recent call last):
  File "/app/train.py", line 245, in forward
    output = self.model(input_ids)
  File "/usr/local/lib/python3.10/site-packages/torch/nn/modules/module.py", line 1501, in _call_impl
    return forward_call(*args, **kwargs)
  File "/app/models/transformer.py", line 89, in forward
    attn_output = self.attention(hidden_states)
RuntimeError: CUDA out of memory. Tried to allocate 2.00 GiB`,
  `Exception in thread "main" java.lang.OutOfMemoryError: Java heap space
    at java.util.Arrays.copyOf(Arrays.java:3236)
    at java.util.ArrayList.grow(ArrayList.java:265)
    at com.nvidia.training.DataLoader.load(DataLoader.java:127)
    at com.nvidia.training.Main.main(Main.java:45)`,
  `Error: ENOENT: no such file or directory, open '/data/checkpoints/model.pt'
    at Object.openSync (node:fs:585:3)
    at Object.readFileSync (node:fs:453:35)
    at loadCheckpoint (/app/src/checkpoint.js:23:14)
    at main (/app/src/index.js:45:5)`,
];

const JSON_BLOBS = [
  `{
  "epoch": 15,
  "metrics": {
    "train_loss": 0.0234,
    "val_loss": 0.0289,
    "accuracy": 0.9823,
    "learning_rate": 1.5e-5
  },
  "checkpoint": "/data/checkpoints/epoch_15.pt"
}`,
  `{
  "event": "batch_complete",
  "batch_id": 1024,
  "samples_processed": 65536,
  "gpu_memory": {
    "allocated": "45.2GB",
    "reserved": "48.0GB",
    "max_allocated": "47.8GB"
  }
}`,
];

export class LogGenerator {
  generateForWorkflow(options: {
    workflowName: string;
    taskNames?: string[];
    startTime?: Date;
    endTime?: Date;
  }): string {
    const { workflowName, taskNames, startTime: requestedStartTime, endTime: requestedEndTime } = options;
    const config = getWorkflowLogConfig(workflowName);

    if (config.volume.max === 0) {
      return "";
    }

    faker.seed(BASE_SEED + hashString(workflowName));

    const numLines = faker.number.int({
      min: config.volume.min,
      max: config.volume.max,
    });

    const tasks = taskNames ?? this.generateTaskNames(config.features.taskCount ?? 3);

    const taskContexts = this.buildTaskContexts(tasks, config);

    const lines: GeneratedLogLine[] = [];
    let startTime: Date;
    let endTime: Date;

    if (requestedStartTime && requestedEndTime) {
      startTime = new Date(requestedStartTime);
      endTime = new Date(requestedEndTime);
    } else if (requestedStartTime) {
      startTime = new Date(requestedStartTime);
      // Use Date.now() not MOCK_REFERENCE_DATE — the reference date is rounded to the
      // hour and may be BEFORE the workflow started, producing negative durations.
      endTime = new Date();
    } else if (requestedEndTime) {
      endTime = new Date(requestedEndTime);
      startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
    } else {
      endTime = new Date(MOCK_REFERENCE_DATE);
      startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
    }

    const durationMs = endTime.getTime() - startTime.getTime();

    // Non-linear time distribution: sine wave creates natural activity bursts
    for (let i = 0; i < numLines; i++) {
      const normalizedProgress = i / Math.max(1, numLines - 1); // 0 to 1
      const burstPattern = 0.5 + 0.3 * Math.sin(normalizedProgress * Math.PI * 3); // 3 bursts across timeline
      const jitter = faker.number.float({ min: -0.1, max: 0.1 }); // Random variance
      const timeProgress = Math.max(0, Math.min(1, normalizedProgress + burstPattern * 0.2 + jitter * 0.1));

      const timestamp = new Date(startTime.getTime() + timeProgress * durationMs);
      const taskCtx = faker.helpers.arrayElement(taskContexts);
      const level = this.pickLevel(config.levelDistribution);
      const ioType = this.pickIOType(config.ioTypeDistribution);

      let message = this.generateMessage(level, ioType, i, numLines);

      if (config.features.ansiCodes) {
        message = this.addAnsiCodes(message, level);
      }

      if (config.features.multiLine && faker.number.float() < 0.1) {
        const contentLines = this.generateMultilineContentLines(level);

        for (const lineMessage of contentLines) {
          const formattedLine = this.formatLogLineV2(timestamp, taskCtx, ioType, lineMessage);

          lines.push({
            timestamp: this.formatTimestamp(timestamp),
            level,
            source: taskCtx.name,
            ioType,
            message: lineMessage,
            retryAttempt: taskCtx.retryAttempt,
            raw: formattedLine,
          });
        }
        continue; // Skip the normal single-line push below
      }

      const line = this.formatLogLineV2(timestamp, taskCtx, ioType, message);
      lines.push({
        timestamp: this.formatTimestamp(timestamp),
        level,
        source: taskCtx.name,
        ioType,
        message,
        retryAttempt: taskCtx.retryAttempt,
        raw: line,
      });
    }

    lines.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return lines.map((l) => l.raw).join("\n");
  }

  async *createStream(options: {
    workflowName: string;
    taskNames?: string[];
    continueFrom?: Date;
    streamDelayMs?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<string, void, unknown> {
    const { workflowName, taskNames, continueFrom, streamDelayMs, signal } = options;
    const config = getWorkflowLogConfig(workflowName);

    const delay = streamDelayMs ?? config.features.streamDelayMs ?? 200;

    faker.seed(BASE_SEED + hashString(workflowName));

    const tasks = taskNames ?? this.generateTaskNames(config.features.taskCount ?? 3);
    const taskContexts = this.buildTaskContexts(tasks, config);

    let currentTime = continueFrom ? new Date(continueFrom.getTime()) : new Date(MOCK_REFERENCE_DATE);

    const isInfinite = config.features.infinite === true;
    const numLines = isInfinite
      ? Infinity
      : faker.number.int({
          min: config.volume.min,
          max: config.volume.max,
        });

    for (let i = 0; i < numLines; i++) {
      if (signal?.aborted) return;

      // Jitter prevents timestamp collisions between consecutive lines
      const jitter = faker.number.int({ min: 0, max: 50 }); // 0-50ms variance
      currentTime = new Date(currentTime.getTime() + delay + jitter);

      const taskCtx = faker.helpers.arrayElement(taskContexts);

      const level = this.pickLevel(config.levelDistribution);
      const ioType = this.pickIOType(config.ioTypeDistribution);

      let message = this.generateMessage(level, ioType, i, numLines);

      if (config.features.ansiCodes) {
        message = this.addAnsiCodes(message, level);
      }

      if (config.features.multiLine && faker.number.float() < 0.1) {
        const contentLines = this.generateMultilineContentLines(level);

        for (const lineMessage of contentLines) {
          if (signal?.aborted) return;
          const formattedLine = this.formatLogLineV2(currentTime, taskCtx, ioType, lineMessage);
          yield formattedLine + "\n";
        }

        await abortableDelay(delay, signal);
        continue; // Skip the normal single-line yield below
      }

      const line = this.formatLogLineV2(currentTime, taskCtx, ioType, message);
      yield line + "\n";

      // Abort-aware delay: reject the promise immediately if signal fires
      await abortableDelay(delay, signal);
    }
  }

  handleWorkflowLogs = async (request: Request, name: string, workflow: LogWorkflowInput): Promise<Response> => {
    const url = new URL(request.url);
    const taskFilter = url.searchParams.get("task_name");
    const taskId = url.searchParams.get("task_id");
    const groupId = url.searchParams.get("group_id");

    const streamKey = `workflow:${name}`;
    abortExistingStream(streamKey);

    let taskNames: string[];
    if (taskId) {
      const task = workflow.groups.flatMap((g) => g.tasks ?? []).find((t) => t.task_uuid === taskId);
      taskNames = task ? [task.name] : [];
    } else if (groupId) {
      const group = workflow.groups.find((g) => g.name === groupId);
      taskNames = group?.tasks?.map((t) => t.name) ?? [];
    } else if (taskFilter) {
      taskNames = [taskFilter];
    } else {
      taskNames = workflow.groups.flatMap((g) => g.tasks?.map((t) => t.name) ?? []);
      if (taskNames.length === 0) taskNames = ["main"];
    }

    const workflowStartTime = workflow.start_time ? new Date(workflow.start_time) : undefined;

    if (workflow.end_time !== undefined) {
      const allLogs = this.generateForWorkflow({
        workflowName: name,
        taskNames,
        startTime: workflowStartTime,
        endTime: new Date(workflow.end_time),
      });
      return new HttpResponse(buildChunkedStream(allLogs), { headers: LOG_RESPONSE_HEADERS });
    }

    return createStreamingResponse({
      streamKey,
      headers: LOG_RESPONSE_HEADERS,
      makeGenerator: (signal) =>
        this.createStream({ workflowName: name, taskNames, continueFrom: workflowStartTime, signal }),
    });
  };

  handleTaskLogs = async (
    request: Request,
    workflowName: string,
    taskName: string,
    task?: LogTaskInput,
  ): Promise<Response> => {
    const url = new URL(request.url);
    const delayOverride = url.searchParams.get("log_delay");
    const isTailing = url.searchParams.get("tail") === "true";

    const taskStartTime = task?.start_time ? new Date(task.start_time) : undefined;
    const taskEndTime = task?.end_time ? new Date(task.end_time) : undefined;

    if (isTailing) {
      const parsed = delayOverride ? parseInt(delayOverride, 10) : undefined;
      const streamDelay = parsed !== undefined && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
      const streamKey = `task:${workflowName}:${taskName}`;
      abortExistingStream(streamKey);
      return createStreamingResponse({
        streamKey,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
        makeGenerator: (signal) =>
          this.createStream({
            workflowName,
            taskNames: [taskName],
            continueFrom: taskStartTime,
            streamDelayMs: streamDelay,
            signal,
          }),
      });
    }

    await delay(getMockDelay());
    const logs = this.generateForWorkflow({
      workflowName,
      taskNames: [taskName],
      startTime: taskStartTime,
      endTime: taskEndTime,
    });
    return HttpResponse.text(logs, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  };

  private generateTaskNames(count: number): string[] {
    const taskTypes = ["train", "preprocess", "eval", "export", "validate", "infer", "download", "upload"];
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const type = faker.helpers.arrayElement(taskTypes);
      names.push(`${type}-${faker.string.alphanumeric(6).toLowerCase()}`);
    }
    return names;
  }

  private buildTaskContexts(taskNames: string[], config: WorkflowLogConfig): TaskContext[] {
    const contexts: TaskContext[] = [];

    for (const name of taskNames) {
      if (config.features.retries) {
        contexts.push({ name });
        const maxRetry = config.features.maxRetryAttempt ?? 2;
        for (let r = 1; r <= faker.number.int({ min: 1, max: maxRetry }); r++) {
          contexts.push({ name, retryAttempt: r });
        }
      } else {
        contexts.push({ name });
      }
    }

    return contexts;
  }

  private pickLevel(distribution: Record<LogLevel, number>): LogLevel {
    return pickFromDistribution(distribution, "info");
  }

  private pickIOType(distribution: Record<LogIOType, number>): LogIOType {
    return pickFromDistribution(distribution, "stdout");
  }

  private generateMessage(level: LogLevel, ioType: LogIOType, index: number, total: number): string {
    if (ioType === "osmo_ctrl") {
      return this.generateOsmoMessage(index, total);
    }
    if (ioType === "download") {
      return this.generateDownloadMessage(index);
    }
    if (ioType === "upload") {
      return this.generateUploadMessage(index);
    }
    if (ioType === "dump") {
      return this.generateDumpMessage(index, total);
    }

    switch (level) {
      case "error":
      case "fatal":
        return this.generateErrorMessage();
      case "warn":
        return this.generateWarningMessage();
      case "debug":
        return this.generateDebugMessage();
      default:
        return this.generateInfoMessage(index, total);
    }
  }

  private generateDumpMessage(index: number, total: number): string {
    const progress = Math.floor((index / total) * 100);
    const filled = Math.floor(progress / 2);
    const empty = 50 - filled;

    return faker.helpers.arrayElement([
      // tqdm-style progress bar
      `${progress}%|${"█".repeat(filled)}${" ".repeat(empty)}| ${index}/${total} [00:${String(Math.floor(index / 10)).padStart(2, "0")}<00:${String(Math.floor((total - index) / 10)).padStart(2, "0")}, ${faker.number.float({ min: 0.5, max: 5.0 }).toFixed(2)}it/s]`,
      // Simple progress bar
      `[${"=".repeat(filled)}>${"-".repeat(empty)}] ${progress}%`,
      // Download-style progress
      `Downloading: ${progress}% (${faker.number.int({ min: 100, max: 5000 })}MB/${faker.number.int({ min: 5000, max: 10000 })}MB)`,
      // Epoch progress
      `Epoch ${Math.floor((index / total) * 100)}: 100%|${"█".repeat(50)}| 1000/1000 [00:42<00:00, 23.50it/s, loss=${faker.number.float({ min: 0.01, max: 0.5 }).toFixed(4)}]`,
    ]);
  }

  private generateOsmoMessage(index: number, total: number): string {
    const messages = [
      "Initializing container",
      "Downloading inputs",
      "All inputs gathered",
      `Running on node dgx-a100-${faker.number.int({ min: 1, max: 100 }).toString().padStart(3, "0")}`,
      `Container started with ${faker.helpers.arrayElement([1, 2, 4, 8])} GPUs`,
      "Health check passed",
      "Container ready",
      "Uploading outputs",
      "Task completed",
      `Progress: ${((index / total) * 100).toFixed(1)}%`,
    ];
    return faker.helpers.arrayElement(messages);
  }

  private generateDownloadMessage(index: number): string {
    const files = ["model.pt", "checkpoint.pth", "config.yaml", "dataset.tar.gz", "weights.bin"];
    const file = faker.helpers.arrayElement(files);
    const progress = faker.number.int({ min: 0, max: 100 });
    return faker.helpers.arrayElement([
      `Downloading ${file}: ${progress}%`,
      `Downloaded ${file} (${faker.number.int({ min: 100, max: 5000 })}MB)`,
      `Verifying checksum for ${file}`,
      `Fetching s3://osmo-data/inputs/${file}`,
      `Transfer rate: ${faker.number.int({ min: 50, max: 500 })}MB/s [${index}]`,
    ]);
  }

  private generateUploadMessage(index: number): string {
    const files = ["output.tar.gz", "model_final.pt", "metrics.json", "logs.zip", "artifacts.tar"];
    const file = faker.helpers.arrayElement(files);
    const progress = faker.number.int({ min: 0, max: 100 });
    return faker.helpers.arrayElement([
      `Uploading ${file}: ${progress}%`,
      `Uploaded ${file} (${faker.number.int({ min: 10, max: 2000 })}MB)`,
      `Compressing ${file}`,
      `Writing to s3://osmo-outputs/${file}`,
      `Upload speed: ${faker.number.int({ min: 50, max: 300 })}MB/s [${index}]`,
    ]);
  }

  private generateErrorMessage(): string {
    const errors = [
      "ERROR: CUDA out of memory. Tried to allocate 2.00 GiB",
      "ERROR: Connection timeout: Failed to reach storage endpoint",
      "ERROR: RuntimeError: Expected tensor on GPU but got CPU",
      "ERROR: AssertionError: Batch size mismatch in forward pass",
      "ERROR: FileNotFoundError: Checkpoint file not found",
      "ERROR: ValueError: Invalid learning rate: must be positive",
      "ERROR: OOM: Process killed by kernel",
      "ERROR: NCCL error: unhandled system error",
      "ERROR: Gradient overflow detected, skipping update",
      "ERROR: Model diverged: loss became NaN",
    ];
    return faker.helpers.arrayElement(errors);
  }

  private generateWarningMessage(): string {
    const warnings = [
      "WARNING: Learning rate scheduler: reducing LR to 1e-6",
      "WARNING: GPU memory usage at 95%",
      "WARNING: Gradient clipping applied: norm=10.5",
      "WARNING: Slow data loading: consider increasing num_workers",
      "WARNING: Checkpoint saving delayed by 30s",
      "WARNING: Validation accuracy plateaued for 5 epochs",
      "WARNING: Deprecated API: torch.cuda.amp will be removed",
      "WARNING: Mixed precision: falling back to FP32 for this op",
      "WARNING: Network latency spike: 250ms",
      "WARNING: Cache miss rate above threshold",
    ];
    return faker.helpers.arrayElement(warnings);
  }

  private generateDebugMessage(): string {
    const debug = [
      `DEBUG: Memory allocated: ${faker.number.int({ min: 10, max: 80 })}GB`,
      `DEBUG: Tensor shape: [${faker.number.int({ min: 1, max: 32 })}, ${faker.number.int({ min: 128, max: 4096 })}, ${faker.number.int({ min: 128, max: 4096 })}]`,
      `DEBUG: Forward pass time: ${faker.number.float({ min: 0.1, max: 5.0 }).toFixed(3)}s`,
      `DEBUG: Backward pass time: ${faker.number.float({ min: 0.1, max: 5.0 }).toFixed(3)}s`,
      `DEBUG: DataLoader worker ${faker.number.int({ min: 0, max: 7 })} initialized`,
      `DEBUG: Layer gradients: mean=${faker.number.float({ min: -0.1, max: 0.1 }).toFixed(6)}`,
      `DEBUG: Optimizer state size: ${faker.number.int({ min: 100, max: 500 })}MB`,
    ];
    return faker.helpers.arrayElement(debug);
  }

  private generateInfoMessage(index: number, total: number): string {
    const epoch = Math.floor((index / total) * 100);
    const step = faker.number.int({ min: 1, max: 1000 });
    const loss = Math.max(0.01, 5 - epoch * 0.03 + faker.number.float({ min: -0.2, max: 0.2 }));
    const lr = 1e-4 * Math.pow(0.95, epoch);

    const messages = [
      `Epoch ${epoch}/100 Step ${step}: loss=${loss.toFixed(4)}, lr=${lr.toExponential(2)}`,
      `[train] loss: ${loss.toFixed(4)} | step: ${step}`,
      `Training step ${step} complete. Loss: ${loss.toFixed(6)}`,
      `Progress: ${((index / total) * 100).toFixed(1)}%`,
      `Processed ${index}/${total} batches`,
      `GPU Util: ${faker.number.int({ min: 80, max: 100 })}% | Mem: ${faker.number.float({ min: 60, max: 79 }).toFixed(1)}/80GB`,
      `Tokens/sec: ${faker.number.int({ min: 10000, max: 50000 })}`,
      `Gradient norm: ${faker.number.float({ min: 0.1, max: 2.0 }).toFixed(4)}`,
      `Batch ${step}: ${faker.number.int({ min: 50, max: 200 })}ms forward, ${faker.number.int({ min: 100, max: 400 })}ms backward`,
      `Saving checkpoint at step ${step}`,
    ];
    return faker.helpers.arrayElement(messages);
  }

  private addAnsiCodes(message: string, level: LogLevel): string {
    const { reset, bold, red, yellow, green, cyan, dim } = ANSI_COLORS;

    switch (level) {
      case "error":
      case "fatal":
        return `${bold}${red}ERROR${reset} ${message}`;
      case "warn":
        return `${yellow}WARN${reset} ${message}`;
      case "debug":
        return `${dim}DEBUG${reset} ${message}`;
      case "info":
        return faker.helpers.arrayElement([`${green}✓${reset} ${message}`, `${cyan}→${reset} ${message}`, message]);
      default:
        return message;
    }
  }

  private generateMultilineContentLines(level: LogLevel): string[] {
    const template =
      level === "error" || level === "fatal"
        ? faker.helpers.arrayElement(STACK_TRACES)
        : faker.helpers.arrayElement(JSON_BLOBS);

    return template.split("\n");
  }

  // Format matches backend redis.py:redis_log_formatter exactly.
  // DUMP type outputs raw message; ctrl logs (OSMO_CTRL, DOWNLOAD, UPLOAD) get [osmo] suffix.
  private formatLogLineV2(time: Date, task: TaskContext, ioType: LogIOType, message: string): string {
    if (ioType === "dump") {
      return message;
    }

    const timestamp = this.formatTimestamp(time);
    let taskPart = task.name;

    if (task.retryAttempt !== undefined) {
      taskPart = `${task.name} retry-${task.retryAttempt}`;
    }

    const isCtrlLog = ioType === "osmo_ctrl" || ioType === "download" || ioType === "upload";
    const ioSuffix = isCtrlLog ? "[osmo]" : "";

    return `${timestamp} [${taskPart}]${ioSuffix} ${message}`;
  }

  private formatTimestamp(date: Date): string {
    const y = date.getUTCFullYear();
    const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
    const d = date.getUTCDate().toString().padStart(2, "0");
    const h = date.getUTCHours().toString().padStart(2, "0");
    const min = date.getUTCMinutes().toString().padStart(2, "0");
    const s = date.getUTCSeconds().toString().padStart(2, "0");
    return `${y}/${m}/${d} ${h}:${min}:${s}`;
  }
}

export const logGenerator = new LogGenerator();
