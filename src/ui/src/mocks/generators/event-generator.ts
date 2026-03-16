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
import {
  hashString,
  abortableDelay,
  getMockDelay,
  abortExistingStream,
  buildChunkedStream,
  createStreamingResponse,
} from "@/mocks/utils";
import { TaskGroupStatus } from "@/lib/api/generated";

const EVENT_HEADERS = {
  "Content-Type": "text/plain; charset=us-ascii",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-cache",
} as const;

const BASE_SEED = 22222;

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal workflow shape needed for event generation.
 * Satisfied by both MockWorkflow (from workflow-generator) and
 * WorkflowQueryResponse (from generated API / mock-workflows).
 */
export interface EventWorkflowInput {
  name: string;
  submit_time: string;
  end_time?: string;
  groups: Array<{
    tasks?: Array<{
      name: string;
      status: TaskGroupStatus;
      start_time?: string;
      node_name?: string;
    }>;
  }>;
}

export interface GeneratedEvent {
  type: "Normal" | "Warning";
  reason: string;
  message: string;
  source: {
    component: string;
    host?: string;
  };
  first_timestamp: string;
  last_timestamp: string;
  count: number;
  involved_object: {
    kind: string;
    name: string;
    namespace?: string;
  };
}

// ============================================================================
// Generator Class
// ============================================================================

export class EventGenerator {
  /**
   * Generate events for an existing workflow (uses actual tasks from workflow generator).
   * Primary method called by MSW handlers.
   */
  generateEventsForWorkflow(workflow: EventWorkflowInput, taskNameFilter?: string): GeneratedEvent[] {
    faker.seed(BASE_SEED + hashString(workflow.name));

    // Use showcase events if workflow name contains "showcase" or "demo"
    if (workflow.name.toLowerCase().includes("showcase") || workflow.name.toLowerCase().includes("demo")) {
      return this.generateShowcaseEvents(new Date(workflow.submit_time));
    }

    // Get all tasks (filtered if taskName specified)
    const allTasks = workflow.groups.flatMap((g) => g.tasks ?? []);
    const tasks = taskNameFilter ? allTasks.filter((t) => t.name === taskNameFilter) : allTasks;

    // Generate events based on each task's status
    const events: GeneratedEvent[] = [];
    for (const task of tasks) {
      const lifecycleStatus = this.mapTaskStatusToLifecycle(task.status);
      const taskEvents = this.generateTaskLifecycleEventsWithFailureType(
        task.name,
        new Date(task.start_time || workflow.submit_time),
        lifecycleStatus,
        task.status,
        task.node_name,
      );
      events.push(...taskEvents);
    }

    events.sort((a, b) => new Date(a.first_timestamp).getTime() - new Date(b.first_timestamp).getTime());

    return events;
  }

  /**
   * Create an async generator for streaming event generation.
   * Yields formatted event lines with configurable delay for real-time simulation.
   *
   * Simulates ongoing pod lifecycle events for active (non-terminal) workflows:
   * - New task scheduling events
   * - Container pulling/creating/starting events
   * - Periodic health check events
   * - Occasional warnings (probe failures, resource pressure)
   *
   * @param options.workflow - The mock workflow to generate events for
   * @param options.taskNameFilter - Optional task name to filter events
   * @param options.signal - AbortSignal to stop generation when the consumer disconnects
   * @param options.streamDelayMs - Delay between stream entries in milliseconds (default: 3000)
   */
  async *createStream(options: {
    workflow: EventWorkflowInput;
    taskNameFilter?: string;
    signal?: AbortSignal;
    streamDelayMs?: number;
  }): AsyncGenerator<string, void, unknown> {
    const { workflow, taskNameFilter, signal, streamDelayMs = 3000 } = options;

    faker.seed(BASE_SEED + hashString(workflow.name + ":stream"));

    // Get running/initializing tasks for ongoing event generation
    const allTasks = workflow.groups.flatMap((g) => g.tasks ?? []);
    const tasks = taskNameFilter ? allTasks.filter((t) => t.name === taskNameFilter) : allTasks;

    // Filter to tasks that would produce ongoing events (running, initializing, pending)
    const activeTasks = tasks.filter((t) => {
      const lifecycle = this.mapTaskStatusToLifecycle(t.status);
      return lifecycle === "running" || lifecycle === "initializing" || lifecycle === "pending";
    });

    // If no active tasks, use all tasks for event generation (simulate new activity)
    const streamTasks = activeTasks.length > 0 ? activeTasks : tasks;
    if (streamTasks.length === 0) return;

    // Ongoing event templates for realistic lifecycle simulation
    const ongoingEventTemplates: Array<{
      type: "Normal" | "Warning";
      reason: string;
      messageTemplate: (taskName: string) => string;
      weight: number;
    }> = [
      // Normal lifecycle events (high frequency)
      {
        type: "Normal",
        reason: "Pulling",
        messageTemplate: (name) => `Pulling image "nvcr.io/nvidia/pytorch:24.12" for ${name}`,
        weight: 5,
      },
      {
        type: "Normal",
        reason: "Pulled",
        messageTemplate: () => "Successfully pulled image",
        weight: 5,
      },
      {
        type: "Normal",
        reason: "Created",
        messageTemplate: () => "Created container training",
        weight: 4,
      },
      {
        type: "Normal",
        reason: "Started",
        messageTemplate: () => "Started container training",
        weight: 4,
      },
      {
        type: "Normal",
        reason: "Scheduled",
        messageTemplate: (name) =>
          `Successfully assigned ${name} to dgx-a100-${faker.number.int({ min: 1, max: 48 }).toString().padStart(2, "0")}`,
        weight: 3,
      },
      // Health check events (medium frequency)
      {
        type: "Normal",
        reason: "HealthCheckPassed",
        messageTemplate: () => "Liveness probe succeeded",
        weight: 6,
      },
      {
        type: "Normal",
        reason: "Ready",
        messageTemplate: () => "Readiness probe succeeded",
        weight: 4,
      },
      // Warning events (low frequency)
      {
        type: "Warning",
        reason: "Unhealthy",
        messageTemplate: () => "Readiness probe failed: connection refused",
        weight: 1,
      },
      {
        type: "Warning",
        reason: "FailedScheduling",
        messageTemplate: () => "0/48 nodes available: 48 Insufficient nvidia.com/gpu",
        weight: 1,
      },
      {
        type: "Warning",
        reason: "BackOff",
        messageTemplate: (name) => `Back-off restarting failed container in pod ${name}`,
        weight: 1,
      },
    ];

    // Stream events indefinitely until aborted
    let currentTime = new Date();

    while (!signal?.aborted) {
      // Pick a random task and event template
      const task = faker.helpers.arrayElement(streamTasks);
      const template = faker.helpers.weightedArrayElement(
        ongoingEventTemplates.map((t) => ({ value: t, weight: t.weight })),
      );

      // Advance time with jitter
      const jitter = faker.number.int({ min: 0, max: 1000 });
      currentTime = new Date(currentTime.getTime() + streamDelayMs + jitter);

      // Format to backend event line format:
      // "{timestamp} [{entity}] {reason}: {message}"
      const timestamp = currentTime
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, "+00:00");
      const message = template.messageTemplate(task.name);
      const line = `${timestamp} [${task.name}] ${template.reason}: ${message}\n`;

      yield line;

      // Abort-aware delay between events
      await abortableDelay(streamDelayMs, signal);
    }
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Map TaskGroupStatus enum to lifecycle status for event generation
   */
  private mapTaskStatusToLifecycle(
    status: TaskGroupStatus,
  ): "completed" | "running" | "failed" | "initializing" | "pending" {
    if (status === TaskGroupStatus.COMPLETED) return "completed";
    if (status === TaskGroupStatus.RUNNING) return "running";
    if (status === TaskGroupStatus.INITIALIZING) return "initializing";
    if (
      status === TaskGroupStatus.WAITING ||
      status === TaskGroupStatus.PROCESSING ||
      status === TaskGroupStatus.SCHEDULING ||
      status === TaskGroupStatus.SUBMITTING
    ) {
      return "pending";
    }
    // All FAILED_* statuses map to "failed"
    return "failed";
  }

  /**
   * Generate events for a specific failure type
   */
  private generateTaskLifecycleEventsWithFailureType(
    taskName: string,
    startTime: Date,
    status: "completed" | "running" | "failed" | "initializing" | "pending",
    fullStatus: TaskGroupStatus,
    nodeName?: string,
  ): GeneratedEvent[] {
    const events: GeneratedEvent[] = [];
    let currentTime = startTime.getTime();
    const node = nodeName || `dgx-a100-${faker.number.int({ min: 1, max: 48 }).toString().padStart(2, "0")}`;

    // 1. Scheduling phase (always happens unless WAITING/SUBMITTING)
    if (fullStatus !== TaskGroupStatus.WAITING && fullStatus !== TaskGroupStatus.SUBMITTING) {
      events.push(
        this.createTaskEvent(
          new Date(currentTime),
          "Normal",
          "Scheduled",
          taskName,
          `Successfully assigned to ${node}`,
        ),
      );
      currentTime += faker.number.int({ min: 1000, max: 3000 });
    }

    if (status === "pending") {
      // Pending tasks: add FailedScheduling events for specific types
      if (fullStatus === TaskGroupStatus.FAILED_PREEMPTED) {
        // Preemption scenario
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            "Preempting",
            taskName,
            "Preempting to accommodate higher priority pod",
          ),
        );
      }
      return events;
    }

    // 2. Image pull phase
    if (fullStatus !== TaskGroupStatus.FAILED_IMAGE_PULL) {
      events.push(
        this.createTaskEvent(
          new Date(currentTime),
          "Normal",
          "Pulling",
          taskName,
          'Pulling image "nvcr.io/nvidia/pytorch:24.12"',
        ),
      );
      currentTime += faker.number.int({ min: 5000, max: 20000 });

      events.push(
        this.createTaskEvent(
          new Date(currentTime),
          "Normal",
          "Pulled",
          taskName,
          `Successfully pulled image in ${(currentTime - startTime.getTime()) / 1000}s`,
        ),
      );
      currentTime += faker.number.int({ min: 500, max: 2000 });
    } else {
      // Image pull failure
      events.push(
        this.createTaskEvent(
          new Date(currentTime),
          "Normal",
          "Pulling",
          taskName,
          'Pulling image "nvcr.io/nvidia/invalid:latest"',
        ),
      );
      currentTime += faker.number.int({ min: 5000, max: 10000 });
      events.push(
        this.createTaskEvent(
          new Date(currentTime),
          "Warning",
          "ErrImagePull",
          taskName,
          `Failed to pull image "nvcr.io/nvidia/invalid:latest": rpc error: code=Unknown desc=failed to pull and unpack image "nvcr.io/nvidia/invalid:latest": failed to resolve reference "nvcr.io/nvidia/invalid:latest": failed to authorize: failed to fetch anonymous token: unexpected status from GET request to https://nvcr.io/proxy_auth?scope=repository%3Anvidia%2Finvalid%3Apull&service=nvcr.io: 401 Unauthorized`,
        ),
      );
      currentTime += faker.number.int({ min: 10000, max: 20000 });
      events.push(
        this.createTaskEvent(
          new Date(currentTime),
          "Warning",
          "ImagePullBackOff",
          taskName,
          "Back-off pulling image: ErrImagePull:sha256:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2/nvcr.io/nvidia/invalid:latest:manifest_unknown:manifest_unknown_to_registry",
        ),
      );
      return events;
    }

    if (status === "initializing") {
      // Initializing tasks are stuck at container creation
      return events;
    }

    // 3. Container phase
    events.push(
      this.createTaskEvent(new Date(currentTime), "Normal", "Created", taskName, "Created container training"),
    );
    currentTime += faker.number.int({ min: 500, max: 1500 });

    events.push(
      this.createTaskEvent(new Date(currentTime), "Normal", "Started", taskName, "Started container training"),
    );
    currentTime += faker.number.int({ min: 1000, max: 5000 });

    if (status === "running") {
      // Running tasks don't have completion events yet
      return events;
    }

    if (status === "failed") {
      // Generate specific failure events based on fullStatus
      currentTime += faker.number.int({ min: 60000, max: 300000 }); // Fail after 1-5 minutes

      if (fullStatus === TaskGroupStatus.FAILED_EVICTED) {
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            "Evicted",
            taskName,
            `The node ${node} was under DiskPressure condition; pod ${taskName} (UID: ${faker.string.uuid()}) was evicted because the node's ephemeral-storage usage exceeded the eviction threshold. Usage: 92.4Gi of 100Gi limit. Container training was using 48.2Gi of local ephemeral storage for checkpoint files and model weights`,
          ),
        );
      } else if (fullStatus.toString().includes("OOM")) {
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            "OOMKilled",
            taskName,
            `Container training in pod ${taskName} exceeded memory limit: the container was using 33.8Gi against a limit of 32Gi. The kernel OOM killer terminated process pid=4821 (python3) with signal SIGKILL(9). Current memory usage breakdown: RSS=32.1Gi, Cache=1.7Gi, Swap=0B. Peak memory usage recorded at container_memory_working_set_bytes=${faker.number.int({ min: 33000000000, max: 35000000000 })}`,
          ),
        );
        currentTime += faker.number.int({ min: 1000, max: 3000 });
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            "BackOff",
            taskName,
            `Back-off restarting failed container training in pod ${taskName}: restart_count=3 last_exit_code=137 reason=OOMKilled back-off_delay=40s container_id=containerd://a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2`,
          ),
        );
      } else if (fullStatus === TaskGroupStatus.FAILED_START_ERROR) {
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            "BackOff",
            taskName,
            `Error from container runtime: OCI runtime create failed: runc create failed: unable to start container process: exec: "/usr/local/bin/entrypoint.sh": permission denied: unknown. Container_id=containerd://sha256:f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4`,
          ),
        );
        currentTime += faker.number.int({ min: 5000, max: 10000 });
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            "CrashLoopBackOff",
            taskName,
            `Back-off restarting container training in pod ${taskName}: the container has crashed 5 times consecutively with exit code 1 over the last 240 seconds. Back-off delay increasing exponentially: 10s, 20s, 40s, 80s, 160s. Last known container state: terminated at ${new Date(currentTime).toISOString()} with reason=Error`,
          ),
        );
      } else {
        // Generic failure
        const exitCode = faker.helpers.arrayElement([1, 137, 139]);
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            "Failed",
            taskName,
            `Container terminated with exit code ${exitCode}: the main process (pid 1) in container training received signal ${exitCode === 137 ? "SIGKILL(9)" : exitCode === 139 ? "SIGSEGV(11)" : "EXIT(1)"} after running for ${faker.number.int({ min: 30, max: 600 })}s. Last 512 bytes of stderr: RuntimeError:CUDA_error:an_illegal_memory_access_was_encountered_at_/opt/pytorch/aten/src/ATen/native/cuda/Indexing.cu:1261:block=[256,1,1],thread=[128,0,0]_Assertion_srcIndex<srcSelectDimSize_failed`,
          ),
        );
      }
      return events;
    }

    // 4. Completion phase (for completed tasks)
    currentTime += faker.number.int({ min: 120000, max: 600000 }); // Complete after 2-10 minutes
    events.push(this.createTaskEvent(new Date(currentTime), "Normal", "Ready", taskName, "Container is ready"));

    return events;
  }

  /**
   * Generate comprehensive showcase events demonstrating all possible scenarios
   */
  private generateShowcaseEvents(baseTime: Date): GeneratedEvent[] {
    const events: GeneratedEvent[] = [];
    let currentOffset = 0;

    const addShowcaseTask = (
      taskName: string,
      offsetMs: number,
      eventsFn: (taskName: string, startTime: Date) => GeneratedEvent[],
    ) => {
      const taskTime = new Date(baseTime.getTime() + currentOffset);
      events.push(...eventsFn(taskName, taskTime));
      currentOffset += offsetMs;
    };

    // ========================================================================
    // COMPLETED TASKS (Success Cases)
    // ========================================================================

    addShowcaseTask("checkpoint-0", 5000, (name, time) => this.generateCompleteSuccessEvents(name, time, 30000));
    addShowcaseTask("checkpoint-1", 5000, (name, time) => this.generateCompleteSuccessEvents(name, time, 120000));
    addShowcaseTask("checkpoint-2", 5000, (name, time) => this.generateCompleteSuccessEvents(name, time, 300000));

    // ========================================================================
    // RUNNING TASKS (In Progress)
    // ========================================================================

    addShowcaseTask("eval-0", 5000, (name, time) => this.generateRunningHealthyEvents(name, time));
    addShowcaseTask("eval-1", 5000, (name, time) => this.generateRunningWithWarningsEvents(name, time));

    // ========================================================================
    // INITIALIZING TASKS (Stuck at Various Init Stages)
    // ========================================================================

    addShowcaseTask("trainer-0", 5000, (name, time) => this.generateInitializingPullingEvents(name, time));
    addShowcaseTask("trainer-1", 5000, (name, time) => this.generateImagePullBackOffEvents(name, time));

    // ========================================================================
    // PENDING TASKS (Scheduling Issues - TRANSIENT)
    // ========================================================================

    addShowcaseTask("worker-0", 5000, (name, time) =>
      this.generateFailedSchedulingEvents(name, time, "0/48 nodes available: 48 Insufficient nvidia.com/gpu"),
    );
    addShowcaseTask("worker-1", 5000, (name, time) =>
      this.generateFailedSchedulingEvents(
        name,
        time,
        "0/48 nodes available: 3 node(s) had untolerated taint {gpu: a100}",
      ),
    );
    addShowcaseTask("worker-2", 5000, (name, time) => this.generatePreemptingEvents(name, time));
    addShowcaseTask("worker-3", 5000, () => []); // No events yet - stuck in queue

    // ========================================================================
    // FAILED TASKS (Terminal Failures)
    // ========================================================================

    addShowcaseTask("worker-4", 5000, (name, time) => this.generateOOMKilledEvents(name, time));
    addShowcaseTask("worker-5", 5000, (name, time) => this.generateCrashLoopEvents(name, time));
    addShowcaseTask("worker-6", 5000, (name, time) => this.generateEvictedEvents(name, time));

    events.sort((a, b) => new Date(a.first_timestamp).getTime() - new Date(b.first_timestamp).getTime());

    return events;
  }

  // ========================================================================
  // Showcase Event Generators for Each Scenario
  // ========================================================================

  private generateCompleteSuccessEvents(taskName: string, startTime: Date, durationMs: number): GeneratedEvent[] {
    const events = this.generateRunningHealthyEvents(taskName, startTime);
    const lastTime = new Date(events[events.length - 1].first_timestamp).getTime();
    events.push(
      this.createTaskEvent(new Date(lastTime + durationMs - 10000), "Normal", "Ready", taskName, "Container is ready"),
    );
    return events;
  }

  private generateRunningHealthyEvents(taskName: string, startTime: Date): GeneratedEvent[] {
    const events: GeneratedEvent[] = [];
    let t = startTime.getTime();

    events.push(this.createTaskEvent(new Date(t), "Normal", "Scheduled", taskName, "Successfully assigned to node"));
    t += 1000;
    events.push(
      this.createTaskEvent(new Date(t), "Normal", "Pulling", taskName, 'Pulling image "nvcr.io/nvidia/pytorch:24.12"'),
    );
    t += 8000;
    events.push(this.createTaskEvent(new Date(t), "Normal", "Pulled", taskName, "Successfully pulled image"));
    t += 500;
    events.push(this.createTaskEvent(new Date(t), "Normal", "Created", taskName, "Created container"));
    t += 500;
    events.push(this.createTaskEvent(new Date(t), "Normal", "Started", taskName, "Started container"));

    return events;
  }

  private generateRunningWithWarningsEvents(taskName: string, startTime: Date): GeneratedEvent[] {
    const events = this.generateRunningHealthyEvents(taskName, startTime);
    const lastTime = new Date(events[events.length - 1].first_timestamp).getTime();
    events.push(
      this.createTaskEvent(
        new Date(lastTime + 30000),
        "Warning",
        "Unhealthy",
        taskName,
        "Readiness probe failed: connection refused",
      ),
    );
    return events;
  }

  private generateInitializingPullingEvents(taskName: string, startTime: Date): GeneratedEvent[] {
    const events: GeneratedEvent[] = [];
    let t = startTime.getTime();

    events.push(this.createTaskEvent(new Date(t), "Normal", "Scheduled", taskName, "Successfully assigned to node"));
    t += 1000;
    events.push(
      this.createTaskEvent(new Date(t), "Normal", "Pulling", taskName, 'Pulling image "nvcr.io/nvidia/llama:70b"'),
    );
    // Still pulling - large image, no Pulled event yet

    return events;
  }

  private generateImagePullBackOffEvents(taskName: string, startTime: Date): GeneratedEvent[] {
    const events: GeneratedEvent[] = [];
    let t = startTime.getTime();

    events.push(this.createTaskEvent(new Date(t), "Normal", "Scheduled", taskName, "Successfully assigned to node"));
    t += 1000;
    events.push(
      this.createTaskEvent(new Date(t), "Normal", "Pulling", taskName, 'Pulling image "nvcr.io/nvidia/invalid:latest"'),
    );
    t += 5000;
    events.push(
      this.createTaskEvent(
        new Date(t),
        "Warning",
        "ErrImagePull",
        taskName,
        "Failed to pull image: manifest not found",
      ),
    );
    t += 10000;
    events.push(
      this.createTaskEvent(
        new Date(t),
        "Warning",
        "ImagePullBackOff",
        taskName,
        "Back-off pulling image: manifest not found",
      ),
    );

    return events;
  }

  private generateFailedSchedulingEvents(taskName: string, startTime: Date, reason: string): GeneratedEvent[] {
    const events: GeneratedEvent[] = [];
    let t = startTime.getTime();
    for (let i = 0; i < 5; i++) {
      events.push(this.createTaskEvent(new Date(t), "Warning", "FailedScheduling", taskName, reason));
      t += 10000; // Retry every 10 seconds
    }
    return events;
  }

  private generatePreemptingEvents(taskName: string, startTime: Date): GeneratedEvent[] {
    const events: GeneratedEvent[] = [];
    let t = startTime.getTime();

    events.push(
      this.createTaskEvent(
        new Date(t),
        "Warning",
        "Preempting",
        taskName,
        "Preempting to accommodate higher priority pod",
      ),
    );
    t += 15000;
    events.push(
      this.createTaskEvent(new Date(t), "Normal", "Scheduled", taskName, "Successfully assigned after preemption"),
    );

    return events;
  }

  private generateOOMKilledEvents(taskName: string, startTime: Date): GeneratedEvent[] {
    const events = this.generateRunningHealthyEvents(taskName, startTime);
    const lastTime = new Date(events[events.length - 1].first_timestamp).getTime();
    events.push(
      this.createTaskEvent(
        new Date(lastTime + 120000),
        "Warning",
        "OOMKilled",
        taskName,
        "Container exceeded memory limit (32Gi)",
      ),
    );
    return events;
  }

  private generateCrashLoopEvents(taskName: string, startTime: Date): GeneratedEvent[] {
    const events = this.generateRunningHealthyEvents(taskName, startTime);
    const lastTime = new Date(events[events.length - 1].first_timestamp).getTime();
    events.push(
      this.createTaskEvent(
        new Date(lastTime + 2000),
        "Warning",
        "BackOff",
        taskName,
        "Container exited with code 1 (error)",
      ),
    );
    events.push(
      this.createTaskEvent(
        new Date(lastTime + 7000),
        "Warning",
        "CrashLoopBackOff",
        taskName,
        "Container is in crash loop, back-off restarting",
      ),
    );
    return events;
  }

  private generateEvictedEvents(taskName: string, startTime: Date): GeneratedEvent[] {
    const events = this.generateRunningHealthyEvents(taskName, startTime);
    const lastTime = new Date(events[events.length - 1].first_timestamp).getTime();
    events.push(
      this.createTaskEvent(
        new Date(lastTime + 60000),
        "Warning",
        "Evicted",
        taskName,
        "Pod evicted due to node memory pressure",
      ),
    );
    return events;
  }

  /**
   * Create a task-scoped event (uses task name as entity)
   */
  private createTaskEvent(
    time: Date,
    type: "Normal" | "Warning",
    reason: string,
    taskName: string,
    message: string,
  ): GeneratedEvent {
    return {
      type,
      reason,
      message,
      source: {
        component: "kubelet",
        host: `dgx-a100-${faker.number.int({ min: 1, max: 48 }).toString().padStart(2, "0")}`,
      },
      first_timestamp: time.toISOString(),
      last_timestamp: time.toISOString(),
      count: 1,
      involved_object: {
        kind: "Task",
        name: taskName,
        namespace: "default",
      },
    };
  }

  // ==========================================================================
  // MSW Handler Methods
  // ==========================================================================

  /**
   * Handles GET /api/workflow/:name/events
   * Workflow is pre-resolved by handlers.ts (checks mock-workflows first, then generated).
   */
  handleWorkflowEvents = async (
    request: Request,
    name: string,
    workflow: EventWorkflowInput,
    taskNameOverride?: string,
  ): Promise<Response> => {
    await delay(getMockDelay());

    const url = new URL(request.url);
    const taskName = taskNameOverride ?? url.searchParams.get("task_name");

    const streamKey = `events:${name}`;
    abortExistingStream(streamKey);

    const events = this.generateEventsForWorkflow(workflow, taskName ?? undefined);
    const lines = this.formatEventLines(events);

    if (workflow.end_time !== undefined) {
      return new HttpResponse(buildChunkedStream(lines.join("\n")), { headers: EVENT_HEADERS });
    }

    return createStreamingResponse({
      streamKey,
      headers: EVENT_HEADERS,
      prefixLines: lines,
      makeGenerator: (signal) => this.createStream({ workflow, taskNameFilter: taskName ?? undefined, signal }),
    });
  };

  formatEventLines(events: GeneratedEvent[]): string[] {
    return events.map((event) => {
      const timestamp = new Date(event.first_timestamp)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, "+00:00");
      return `${timestamp} [${event.involved_object.name}] ${event.reason}: ${event.message}`;
    });
  }
}

export const eventGenerator = new EventGenerator();
