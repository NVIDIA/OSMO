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
 * Log Generator
 *
 * Generates realistic training/ML logs for workflows and tasks.
 * Supports scenario-based generation for different testing needs.
 *
 * Log format matches real backend from `external/src/utils/connectors/redis.py`:
 * - {YYYY/MM/DD HH:mm:ss} [{task_name}] {message}                    # Normal stdout
 * - {YYYY/MM/DD HH:mm:ss} [{task_name} retry-{N}] {message}          # Retry stdout
 * - {YYYY/MM/DD HH:mm:ss} [{task_name}][osmo] {message}              # OSMO control
 * - {YYYY/MM/DD HH:mm:ss} [{task_name} retry-{N}][osmo] {message}    # Retry OSMO
 */

import { faker } from "@faker-js/faker";
import { MOCK_CONFIG, type LogPatterns, type MockVolume } from "../seed";
import type { LogLevel, LogIOType } from "@/lib/api/log-adapter/types";
import { getLogScenario, getActiveScenario, type LogScenarioConfig } from "./log-scenarios";
import { hashString } from "../utils";

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// ANSI Code Patterns
// ============================================================================

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

// ============================================================================
// Multi-line Content Templates
// ============================================================================

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

// ============================================================================
// Generator Class
// ============================================================================

export class LogGenerator {
  private patterns: LogPatterns;
  private volume: MockVolume;
  private baseSeed: number;

  constructor(
    patterns: LogPatterns = MOCK_CONFIG.logs,
    volume: MockVolume = MOCK_CONFIG.volume,
    baseSeed: number = 11111,
  ) {
    this.patterns = patterns;
    this.volume = volume;
    this.baseSeed = baseSeed;
  }

  // ==========================================================================
  // Scenario-based Generation (NEW)
  // ==========================================================================

  /**
   * Generate logs for a workflow using a specific scenario.
   * This is the primary entry point for scenario-based log generation.
   */
  generateForScenario(workflowName: string, scenarioName?: string, taskNames?: string[]): string {
    const scenario = getLogScenario(scenarioName ?? getActiveScenario());

    // Handle empty scenario
    if (scenario.volume.max === 0) {
      return "";
    }

    faker.seed(this.baseSeed + hashString(workflowName + scenario.name));

    const numLines = faker.number.int({
      min: scenario.volume.min,
      max: scenario.volume.max,
    });

    // Generate task names if not provided
    const tasks = taskNames ?? this.generateTaskNames(scenario.features.taskCount ?? 3);

    // Build task contexts with optional retry info
    const taskContexts = this.buildTaskContexts(tasks, scenario);

    // Generate log lines
    const lines: GeneratedLogLine[] = [];
    const startTime = faker.date.recent({ days: 7 });
    const durationMs = faker.number.int({ min: 60000, max: 3600000 });
    const msPerLog = durationMs / Math.max(1, numLines);

    for (let i = 0; i < numLines; i++) {
      const timestamp = new Date(startTime.getTime() + i * msPerLog);
      const taskCtx = faker.helpers.arrayElement(taskContexts);
      const level = this.pickLevel(scenario.levelDistribution);
      const ioType = this.pickIOType(scenario.ioTypeDistribution);

      let message = this.generateMessage(level, ioType, i, numLines, scenario);

      // Optionally add ANSI codes
      if (scenario.features.ansiCodes) {
        message = this.addAnsiCodes(message, level);
      }

      // Optionally make it multiline
      if (scenario.features.multiLine && faker.number.float() < 0.1) {
        message = this.generateMultilineContent(level);
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

    // Sort by timestamp (already in order, but ensures consistency)
    lines.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return lines.map((l) => l.raw).join("\n");
  }

  /**
   * Create an async generator for streaming log generation.
   * Yields log lines with configurable delay for tailing simulation.
   */
  async *createStream(
    workflowName: string,
    scenario: LogScenarioConfig,
    taskNames?: string[],
  ): AsyncGenerator<string, void, unknown> {
    faker.seed(this.baseSeed + hashString(workflowName + scenario.name));

    const numLines = faker.number.int({
      min: scenario.volume.min,
      max: scenario.volume.max,
    });

    const tasks = taskNames ?? this.generateTaskNames(scenario.features.taskCount ?? 3);
    const taskContexts = this.buildTaskContexts(tasks, scenario);
    const startTime = new Date();

    for (let i = 0; i < numLines; i++) {
      const timestamp = new Date(startTime.getTime() + i * 1000);
      const taskCtx = faker.helpers.arrayElement(taskContexts);
      const level = this.pickLevel(scenario.levelDistribution);
      const ioType = this.pickIOType(scenario.ioTypeDistribution);

      let message = this.generateMessage(level, ioType, i, numLines, scenario);

      if (scenario.features.ansiCodes) {
        message = this.addAnsiCodes(message, level);
      }

      if (scenario.features.multiLine && faker.number.float() < 0.1) {
        message = this.generateMultilineContent(level);
      }

      const line = this.formatLogLineV2(timestamp, taskCtx, ioType, message);
      yield line + "\n";
    }
  }

  // ==========================================================================
  // Legacy Methods (Preserved for Backward Compatibility)
  // ==========================================================================

  /**
   * Generate logs for a task (legacy method).
   */
  generateTaskLogs(workflowName: string, taskName: string, status: string, durationSeconds?: number): string {
    faker.seed(this.baseSeed + hashString(workflowName + taskName));

    const lines: string[] = [];
    const numLines = faker.number.int(this.volume.logsPerTask);
    const duration = durationSeconds ?? faker.number.int({ min: 60, max: 3600 });

    // Start time
    const startTime = faker.date.recent({ days: 7 });

    // Add OSMO startup logs
    lines.push(...this.generateOsmoStartup(startTime, taskName));

    // Add training/execution logs
    const mainLogCount = Math.max(10, numLines - 10);
    lines.push(...this.generateMainLogs(startTime, taskName, mainLogCount, duration));

    // Add completion or error logs
    if (status === "COMPLETED") {
      lines.push(...this.generateCompletionLogs(startTime, taskName, duration));
    } else if (status.startsWith("FAILED")) {
      lines.push(...this.generateErrorLogs(startTime, taskName, duration, status));
    }

    return lines.join("\n");
  }

  // ==========================================================================
  // Private Helpers - Scenario Support
  // ==========================================================================

  private generateTaskNames(count: number): string[] {
    const taskTypes = ["train", "preprocess", "eval", "export", "validate", "infer", "download", "upload"];
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const type = faker.helpers.arrayElement(taskTypes);
      names.push(`${type}-${faker.string.alphanumeric(6).toLowerCase()}`);
    }
    return names;
  }

  private buildTaskContexts(taskNames: string[], scenario: LogScenarioConfig): TaskContext[] {
    const contexts: TaskContext[] = [];

    for (const name of taskNames) {
      if (scenario.features.retries) {
        // Add base task and retry attempts
        contexts.push({ name });
        const maxRetry = scenario.features.maxRetryAttempt ?? 2;
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
    const rand = faker.number.float();
    let cumulative = 0;
    for (const [level, prob] of Object.entries(distribution) as [LogLevel, number][]) {
      cumulative += prob;
      if (rand <= cumulative) {
        return level;
      }
    }
    return "info";
  }

  private pickIOType(distribution: Record<LogIOType, number>): LogIOType {
    const rand = faker.number.float();
    let cumulative = 0;
    for (const [ioType, prob] of Object.entries(distribution) as [LogIOType, number][]) {
      cumulative += prob;
      if (rand <= cumulative) {
        return ioType;
      }
    }
    return "stdout";
  }

  private generateMessage(
    level: LogLevel,
    ioType: LogIOType,
    index: number,
    total: number,
    _scenario: LogScenarioConfig,
  ): string {
    // IO type specific messages
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

    // Level-specific messages
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

  /**
   * Generate DUMP messages - raw output without timestamp/prefix.
   * Used for progress bars, tqdm output, etc.
   */
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
    // Prefix with ERROR: so the parser can detect the level
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
    // Prefix with WARNING: so the parser can detect the level
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
    // Prefix with DEBUG: so the parser can detect the level
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

  private generateMultilineContent(level: LogLevel): string {
    if (level === "error" || level === "fatal") {
      return faker.helpers.arrayElement(STACK_TRACES);
    }
    return faker.helpers.arrayElement(JSON_BLOBS);
  }

  /**
   * Format log line using real backend format from redis.py:redis_log_formatter.
   *
   * Format matches backend exactly:
   * - Regular: {YYYY/MM/DD HH:mm:ss} [{task_name}] {message}
   * - With retry: {YYYY/MM/DD HH:mm:ss} [{task_name} retry-{N}] {message}
   * - Control logs: {YYYY/MM/DD HH:mm:ss} [{task_name}][osmo] {message}
   * - DUMP: {message} (no timestamp or prefix - raw output)
   *
   * Control logs (ctrl_logs() in backend) include: OSMO_CTRL, DOWNLOAD, UPLOAD
   * These all get the [osmo] suffix as per redis.py line 146.
   */
  private formatLogLineV2(time: Date, task: TaskContext, ioType: LogIOType, message: string): string {
    // DUMP type outputs raw message without any formatting (per redis.py line 222-223)
    if (ioType === "dump") {
      return message;
    }

    const timestamp = this.formatTimestamp(time);
    let taskPart = task.name;

    if (task.retryAttempt !== undefined) {
      taskPart = `${task.name} retry-${task.retryAttempt}`;
    }

    // Match backend ctrl_logs() - OSMO_CTRL, DOWNLOAD, UPLOAD all get [osmo] suffix
    const isCtrlLog = ioType === "osmo_ctrl" || ioType === "download" || ioType === "upload";
    const ioSuffix = isCtrlLog ? "[osmo]" : "";

    return `${timestamp} [${taskPart}]${ioSuffix} ${message}`;
  }

  // --------------------------------------------------------------------------
  // Private log generators (legacy)
  // --------------------------------------------------------------------------

  private generateOsmoStartup(startTime: Date, taskName: string): string[] {
    const lines: string[] = [];
    let time = new Date(startTime);

    const osmoMessages = [
      "[osmo] Initializing container",
      "[osmo] Downloading Start",
      "[osmo] All Inputs Gathered",
      `[osmo] Running on node dgx-a100-${faker.number.int({ min: 1, max: 100 }).toString().padStart(3, "0")}`,
      `[osmo] Container started with ${faker.helpers.arrayElement([1, 2, 4, 8])} GPUs`,
    ];

    for (const msg of osmoMessages) {
      lines.push(this.formatLogLine(time, "INFO", taskName, msg));
      time = new Date(time.getTime() + faker.number.int({ min: 100, max: 2000 }));
    }

    return lines;
  }

  private generateMainLogs(startTime: Date, taskName: string, count: number, durationSeconds: number): string[] {
    const lines: string[] = [];
    const msPerLog = (durationSeconds * 1000) / count;

    let time = new Date(startTime.getTime() + 5000); // After startup
    let epoch = 1;
    let step = 0;
    const totalEpochs = faker.number.int({ min: 10, max: 100 });
    const stepsPerEpoch = faker.number.int({ min: 100, max: 1000 });

    for (let i = 0; i < count; i++) {
      step++;
      if (step > stepsPerEpoch) {
        step = 1;
        epoch++;
      }

      const messageType = faker.helpers.weightedArrayElement([
        { value: "training", weight: 0.6 },
        { value: "progress", weight: 0.2 },
        { value: "metrics", weight: 0.2 },
      ]);

      let message: string;
      switch (messageType) {
        case "training":
          message = this.generateTrainingMessage(epoch, totalEpochs, step, stepsPerEpoch);
          break;
        case "progress":
          message = this.generateProgressMessage(i, count);
          break;
        case "metrics":
          message = this.generateMetricsMessage();
          break;
        default:
          message = `Step ${step}`;
      }

      lines.push(this.formatLogLine(time, "INFO", taskName, message));
      time = new Date(time.getTime() + msPerLog + faker.number.int({ min: -100, max: 100 }));
    }

    return lines;
  }

  private generateTrainingMessage(epoch: number, totalEpochs: number, step: number, totalSteps: number): string {
    const loss = Math.max(0.01, 5 - epoch * 0.3 + faker.number.float({ min: -0.2, max: 0.2 }));
    const lr = 1e-4 * Math.pow(0.95, epoch);

    return faker.helpers.arrayElement([
      `Epoch ${epoch}/${totalEpochs} Step ${step}/${totalSteps}: loss=${loss.toFixed(4)}, lr=${lr.toExponential(2)}`,
      `[train] loss: ${loss.toFixed(4)} | step: ${step}`,
      `Training step ${step} complete. Loss: ${loss.toFixed(6)}`,
    ]);
  }

  private generateProgressMessage(current: number, total: number): string {
    const percent = ((current / total) * 100).toFixed(1);
    return faker.helpers.arrayElement([
      `Progress: ${percent}%`,
      `Processed ${current}/${total} batches`,
      `[progress] ${percent}% complete`,
    ]);
  }

  private generateMetricsMessage(): string {
    const gpuUtil = faker.number.int({ min: 80, max: 100 });
    const gpuMem = faker.number.float({ min: 60, max: 79 });
    const gpuTotal = 80;
    const temp = faker.number.int({ min: 55, max: 75 });

    return faker.helpers.arrayElement([
      `GPU Util: ${gpuUtil}% | Mem: ${gpuMem.toFixed(1)}/${gpuTotal}GB | Temp: ${temp}°C`,
      `Tokens/sec: ${faker.number.int({ min: 10000, max: 50000 })}`,
      `Gradient norm: ${faker.number.float({ min: 0.1, max: 2.0 }).toFixed(4)}`,
    ]);
  }

  private generateCompletionLogs(startTime: Date, taskName: string, duration: number): string[] {
    const endTime = new Date(startTime.getTime() + duration * 1000);
    return [
      this.formatLogLine(endTime, "INFO", taskName, "Training complete. Saving final model..."),
      this.formatLogLine(new Date(endTime.getTime() + 1000), "INFO", taskName, "[osmo] Upload Start"),
      this.formatLogLine(new Date(endTime.getTime() + 3000), "INFO", taskName, "[osmo] Task completed successfully"),
    ];
  }

  private generateErrorLogs(startTime: Date, taskName: string, duration: number, status: string): string[] {
    const errorTime = new Date(startTime.getTime() + duration * 1000);
    const errorMessages = this.patterns.messages.errors;

    let errorType: keyof typeof errorMessages = "General";
    if (status.includes("OOM") || status === "FAILED_EVICTED") {
      errorType = "OOM";
    } else if (status === "FAILED_IMAGE_PULL") {
      errorType = "General";
    }

    const errors = errorMessages[errorType] ?? errorMessages.General;
    const errorMsg = faker.helpers.arrayElement(errors).replace("{message}", "Unexpected error occurred");

    return [
      this.formatLogLine(errorTime, "ERROR", taskName, errorMsg),
      this.formatLogLine(
        new Date(errorTime.getTime() + 100),
        "ERROR",
        taskName,
        `Process exited with code ${faker.helpers.arrayElement([1, 137, 139])}`,
      ),
      this.formatLogLine(new Date(errorTime.getTime() + 200), "INFO", taskName, "[osmo] Task failed"),
    ];
  }

  /**
   * Format log line using real backend format from redis.py:redis_log_formatter.
   *
   * IMPORTANT: The backend does NOT include the level in the log line format.
   * The level is detected by parsing the message content (e.g., "ERROR:", "WARNING:").
   *
   * Format matches backend exactly:
   * - Regular: {YYYY/MM/DD HH:mm:ss} [{task_name}] {message}
   * - Control logs: {YYYY/MM/DD HH:mm:ss} [{task_name}][osmo] {message}
   *
   * @param time - Timestamp
   * @param _level - Log level (unused in format, only for message content)
   * @param source - Task name
   * @param message - Log message (may include level prefix like "ERROR:")
   */
  private formatLogLine(time: Date, _level: string, source: string, message: string): string {
    const timestamp = this.formatTimestamp(time);
    // Check if this is a control message (has [osmo] in the message itself - legacy pattern)
    if (message.startsWith("[osmo]")) {
      return `${timestamp} [${source}]${message}`;
    }
    return `${timestamp} [${source}] ${message}`;
  }

  private formatTimestamp(date: Date): string {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, "0");
    const d = date.getDate().toString().padStart(2, "0");
    const h = date.getHours().toString().padStart(2, "0");
    const min = date.getMinutes().toString().padStart(2, "0");
    const s = date.getSeconds().toString().padStart(2, "0");
    return `${y}/${m}/${d} ${h}:${min}:${s}`;
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

export const logGenerator = new LogGenerator();
