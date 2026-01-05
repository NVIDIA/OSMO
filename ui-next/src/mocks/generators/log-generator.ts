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
 */

import { faker } from "@faker-js/faker";
import { MOCK_CONFIG, type LogPatterns, type MockVolume } from "../seed";

// ============================================================================
// Types
// ============================================================================

export interface GeneratedLogLine {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

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

  /**
   * Generate logs for a task
   */
  generateTaskLogs(workflowName: string, taskName: string, status: string, durationSeconds?: number): string {
    faker.seed(this.baseSeed + this.hashString(workflowName + taskName));

    const lines: string[] = [];
    const numLines = faker.number.int(this.volume.logsPerTask);
    const duration = durationSeconds || faker.number.int({ min: 60, max: 3600 });

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

  /**
   * Generate logs for an entire workflow (all tasks interleaved)
   */
  generateWorkflowLogs(workflowName: string, taskNames: string[], status: string): string {
    const allLines: { timestamp: Date; line: string }[] = [];

    for (const taskName of taskNames) {
      const taskLogs = this.generateTaskLogs(workflowName, taskName, status);
      const lines = taskLogs.split("\n");

      for (const line of lines) {
        // Parse timestamp from line
        const match = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/);
        if (match) {
          const timestamp = new Date(match[1].replace(/\//g, "-").replace(" ", "T"));
          allLines.push({ timestamp, line });
        } else {
          allLines.push({ timestamp: new Date(), line });
        }
      }
    }

    // Sort by timestamp
    allLines.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return allLines.map((l) => l.line).join("\n");
  }

  // --------------------------------------------------------------------------
  // Private log generators
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

    const errors = errorMessages[errorType] || errorMessages.General;
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

  private formatLogLine(time: Date, level: string, source: string, message: string): string {
    const timestamp = this.formatTimestamp(time);
    return `${timestamp} [${source}] ${level}: ${message}`;
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

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash;
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

export const logGenerator = new LogGenerator();
