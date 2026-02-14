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
 * Event Generator
 *
 * Generates Kubernetes-style lifecycle events for workflows and tasks.
 */

import { faker } from "@faker-js/faker";
import { MOCK_CONFIG, type EventPatterns } from "@/mocks/seed/types";
import { hashString } from "@/mocks/utils";
import { TaskGroupStatus } from "@/lib/api/generated";
import type { MockWorkflow } from "@/mocks/generators/workflow-generator";

// ============================================================================
// Types
// ============================================================================

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
  private patterns: EventPatterns;
  private baseSeed: number;

  constructor(patterns: EventPatterns = MOCK_CONFIG.events, baseSeed: number = 22222) {
    this.patterns = patterns;
    this.baseSeed = baseSeed;
  }

  /**
   * Generate events for an existing workflow (uses actual tasks from workflow generator)
   * This is the primary method called by MSW handlers.
   */
  generateEventsForWorkflow(workflow: MockWorkflow, taskNameFilter?: string): GeneratedEvent[] {
    faker.seed(this.baseSeed + hashString(workflow.name));

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
        task.status, // Pass full status for specific failure types
        task.node_name,
      );
      events.push(...taskEvents);
    }

    // Sort all events by timestamp to interleave them
    events.sort((a, b) => new Date(a.first_timestamp).getTime() - new Date(b.first_timestamp).getTime());

    return events;
  }

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
          "Failed to pull image: manifest not found",
        ),
      );
      currentTime += faker.number.int({ min: 10000, max: 20000 });
      events.push(
        this.createTaskEvent(
          new Date(currentTime),
          "Warning",
          "ImagePullBackOff",
          taskName,
          "Back-off pulling image: manifest not found",
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
            "Pod evicted due to node memory pressure",
          ),
        );
      } else if (fullStatus.toString().includes("OOM")) {
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            "OOMKilled",
            taskName,
            "Container training exceeded memory limit (32Gi)",
          ),
        );
        currentTime += faker.number.int({ min: 1000, max: 3000 });
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            "BackOff",
            taskName,
            `Back-off restarting failed container training in pod ${taskName}`,
          ),
        );
      } else if (fullStatus === TaskGroupStatus.FAILED_START_ERROR) {
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            "BackOff",
            taskName,
            "Container exited with code 1 (error)",
          ),
        );
        currentTime += faker.number.int({ min: 5000, max: 10000 });
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            "CrashLoopBackOff",
            taskName,
            "Container is in crash loop, back-off restarting",
          ),
        );
      } else {
        // Generic failure
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            "Failed",
            taskName,
            `Container terminated with exit code ${faker.helpers.arrayElement([1, 137, 139])}`,
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
   * Generate events for a workflow with multiple tasks (10-15 tasks with interleaved events)
   */
  generateWorkflowEvents(
    workflowName: string,
    _status: string,
    submitTime: string,
    _startTime?: string,
    _endTime?: string,
  ): GeneratedEvent[] {
    faker.seed(this.baseSeed + hashString(workflowName));

    const events: GeneratedEvent[] = [];
    const baseTime = new Date(submitTime);

    // For "showcase" workflows, generate comprehensive examples of all scenarios
    if (workflowName.toLowerCase().includes("showcase") || workflowName.toLowerCase().includes("demo")) {
      return this.generateShowcaseEvents(baseTime);
    }

    // Generate 10-15 tasks with interleaved events
    const numTasks = faker.number.int({ min: 10, max: 15 });

    for (let i = 0; i < numTasks; i++) {
      const taskName = `worker-${i}`;

      // Each task starts at slightly different times (0-60 seconds apart)
      const taskStartOffset = i * faker.number.int({ min: 2000, max: 8000 });
      const taskSubmitTime = new Date(baseTime.getTime() + taskStartOffset);

      // Determine task status (most succeed, some fail, some still running)
      let taskStatus: "completed" | "running" | "failed" | "initializing" | "pending";
      const rand = faker.number.float({ min: 0, max: 1 });

      if (rand < 0.6) {
        // 60% completed
        taskStatus = "completed";
      } else if (rand < 0.75) {
        // 15% running
        taskStatus = "running";
      } else if (rand < 0.85) {
        // 10% failed
        taskStatus = "failed";
      } else if (rand < 0.95) {
        // 10% initializing
        taskStatus = "initializing";
      } else {
        // 5% pending
        taskStatus = "pending";
      }

      // Generate task lifecycle events
      const taskEvents = this.generateTaskLifecycleEvents(taskName, taskSubmitTime, taskStatus);
      events.push(...taskEvents);
    }

    // Sort all events by timestamp to interleave them
    events.sort((a, b) => new Date(a.first_timestamp).getTime() - new Date(b.first_timestamp).getTime());

    return events;
  }

  /**
   * Generate comprehensive showcase events demonstrating all possible scenarios
   */
  private generateShowcaseEvents(baseTime: Date): GeneratedEvent[] {
    const events: GeneratedEvent[] = [];
    let currentOffset = 0;

    // Helper to create task events with specific scenarios
    const addShowcaseTask = (
      taskName: string,
      offsetMs: number,
      eventsFn: (taskName: string, startTime: Date) => GeneratedEvent[],
    ) => {
      const taskTime = new Date(baseTime.getTime() + currentOffset);
      const taskEvents = eventsFn(taskName, taskTime);
      events.push(...taskEvents);
      currentOffset += offsetMs;
    };

    // ========================================================================
    // COMPLETED TASKS (Success Cases)
    // ========================================================================

    addShowcaseTask("checkpoint-0", 5000, (name, time) => {
      return this.generateCompleteSuccessEvents(name, time, 30000); // 30s duration
    });

    addShowcaseTask("checkpoint-1", 5000, (name, time) => {
      return this.generateCompleteSuccessEvents(name, time, 120000); // 2min duration
    });

    addShowcaseTask("checkpoint-2", 5000, (name, time) => {
      return this.generateCompleteSuccessEvents(name, time, 300000); // 5min duration
    });

    // ========================================================================
    // RUNNING TASKS (In Progress)
    // ========================================================================

    addShowcaseTask("eval-0", 5000, (name, time) => {
      return this.generateRunningHealthyEvents(name, time);
    });

    addShowcaseTask("eval-1", 5000, (name, time) => {
      return this.generateRunningWithWarningsEvents(name, time);
    });

    // ========================================================================
    // INITIALIZING TASKS (Stuck at Various Init Stages)
    // ========================================================================

    addShowcaseTask("trainer-0", 5000, (name, time) => {
      return this.generateInitializingPullingEvents(name, time);
    });

    addShowcaseTask("trainer-1", 5000, (name, time) => {
      return this.generateImagePullBackOffEvents(name, time);
    });

    // ========================================================================
    // PENDING TASKS (Scheduling Issues - TRANSIENT)
    // ========================================================================

    addShowcaseTask("worker-0", 5000, (name, time) => {
      return this.generateFailedSchedulingEvents(name, time, "0/48 nodes available: 48 Insufficient nvidia.com/gpu");
    });

    addShowcaseTask("worker-1", 5000, (name, time) => {
      return this.generateFailedSchedulingEvents(
        name,
        time,
        "0/48 nodes available: 3 node(s) had untolerated taint {gpu: a100}",
      );
    });

    addShowcaseTask("worker-2", 5000, (name, time) => {
      return this.generatePreemptingEvents(name, time);
    });

    addShowcaseTask("worker-3", 5000, () => {
      return []; // No events yet - stuck in queue
    });

    // ========================================================================
    // FAILED TASKS (Terminal Failures)
    // ========================================================================

    addShowcaseTask("worker-4", 5000, (name, time) => {
      return this.generateOOMKilledEvents(name, time);
    });

    addShowcaseTask("worker-5", 5000, (name, time) => {
      return this.generateCrashLoopEvents(name, time);
    });

    addShowcaseTask("worker-6", 5000, (name, time) => {
      return this.generateEvictedEvents(name, time);
    });

    // Sort all events by timestamp
    events.sort((a, b) => new Date(a.first_timestamp).getTime() - new Date(b.first_timestamp).getTime());

    return events;
  }

  // ========================================================================
  // Showcase Event Generators for Each Scenario
  // ========================================================================

  private generateCompleteSuccessEvents(taskName: string, startTime: Date, durationMs: number): GeneratedEvent[] {
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
    t += durationMs - 10000;

    events.push(this.createTaskEvent(new Date(t), "Normal", "Ready", taskName, "Container is ready"));

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
    // Still running - no completion event

    return events;
  }

  private generateRunningWithWarningsEvents(taskName: string, startTime: Date): GeneratedEvent[] {
    const events = this.generateRunningHealthyEvents(taskName, startTime);
    const lastTime = new Date(events[events.length - 1].first_timestamp).getTime();

    // Add some probe warnings during runtime
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

    // Multiple FailedScheduling attempts
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

    // Run for 2 minutes, then OOM
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
    t += 2000;

    // Crash immediately
    events.push(
      this.createTaskEvent(new Date(t), "Warning", "BackOff", taskName, "Container exited with code 1 (error)"),
    );
    t += 5000;

    events.push(
      this.createTaskEvent(
        new Date(t),
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

    // Run for 1 minute, then evicted
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
   * Generate lifecycle events for a single task
   */
  private generateTaskLifecycleEvents(
    taskName: string,
    startTime: Date,
    status: "completed" | "running" | "failed" | "initializing" | "pending",
  ): GeneratedEvent[] {
    const events: GeneratedEvent[] = [];
    let currentTime = startTime.getTime();

    // 1. Scheduling phase (always happens)
    events.push(
      this.createTaskEvent(new Date(currentTime), "Normal", "Scheduled", taskName, "Successfully assigned pod to node"),
    );
    currentTime += faker.number.int({ min: 1000, max: 3000 });

    if (status === "pending") {
      // Pending tasks have scheduling issues
      events.push(
        this.createTaskEvent(
          new Date(currentTime),
          "Warning",
          "FailedScheduling",
          taskName,
          "0/48 nodes available: 48 Insufficient nvidia.com/gpu",
        ),
      );
      return events;
    }

    // 2. Image pull phase
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
      // Failed tasks have OOM or other errors
      currentTime += faker.number.int({ min: 60000, max: 300000 }); // Fail after 1-5 minutes
      const failureReason = faker.helpers.arrayElement(["OOMKilled", "Error", "BackOff"]);

      if (failureReason === "OOMKilled") {
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            "OOMKilled",
            taskName,
            "Container training exceeded memory limit (32Gi)",
          ),
        );
        currentTime += faker.number.int({ min: 1000, max: 3000 });
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            "BackOff",
            taskName,
            `Back-off restarting failed container training in pod ${taskName}`,
          ),
        );
      } else {
        events.push(
          this.createTaskEvent(
            new Date(currentTime),
            "Warning",
            failureReason,
            taskName,
            "Container terminated with exit code 1",
          ),
        );
      }
      return events;
    }

    // 4. Completion phase (for completed tasks)
    currentTime += faker.number.int({ min: 120000, max: 600000 }); // Complete after 2-10 minutes
    events.push(this.createTaskEvent(new Date(currentTime), "Normal", "Ready", taskName, "True"));

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

  /**
   * Generate events for a task
   */
  generateTaskEvents(
    workflowName: string,
    taskName: string,
    status: string,
    startTime?: string,
    endTime?: string,
  ): GeneratedEvent[] {
    faker.seed(this.baseSeed + hashString(workflowName + taskName));

    const events: GeneratedEvent[] = [];
    const objectName = `${workflowName}/${taskName}`;
    const now = new Date();

    // Scheduling
    events.push(
      this.createEvent(
        startTime ? new Date(new Date(startTime).getTime() - 30000) : now,
        "Normal",
        "Scheduled",
        objectName,
        "Task",
      ),
    );

    // If started
    if (startTime) {
      const start = new Date(startTime);
      events.push(
        this.createEvent(start, "Normal", "Pulling", objectName, "Task"),
        this.createEvent(new Date(start.getTime() + 5000), "Normal", "Pulled", objectName, "Task"),
        this.createEvent(new Date(start.getTime() + 6000), "Normal", "Created", objectName, "Task"),
        this.createEvent(new Date(start.getTime() + 7000), "Normal", "Started", objectName, "Task"),
      );
    }

    // Completion
    if (endTime) {
      const end = new Date(endTime);
      if (status === "COMPLETED") {
        events.push(this.createEvent(end, "Normal", "Completed", objectName, "Task"));
      } else if (status.startsWith("FAILED")) {
        events.push(this.createEvent(end, "Warning", "Failed", objectName, "Task", status));
      }
    }

    return events;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private createEvent(
    time: Date,
    type: "Normal" | "Warning",
    reason: string,
    objectName: string,
    kind: string,
    failureType?: string,
  ): GeneratedEvent {
    const messages = this.patterns.messages[reason];
    let message = messages ? faker.helpers.arrayElement(messages) : `${reason} for ${objectName}`;

    // Replace placeholders
    message = message
      .replace("{namespace}", "default")
      .replace("{pod}", objectName.replace("/", "-"))
      .replace("{node}", `dgx-a100-${faker.number.int({ min: 1, max: 100 }).toString().padStart(3, "0")}`)
      .replace("{image}", faker.helpers.arrayElement(MOCK_CONFIG.images.repositories))
      .replace("{container}", "main")
      .replace("{duration}", faker.number.int({ min: 5, max: 30 }).toString())
      .replace("{code}", faker.helpers.arrayElement(["1", "137", "139"]))
      .replace("{resource}", faker.helpers.arrayElement(["memory", "nvidia.com/gpu"]))
      .replace("{total}", faker.number.int({ min: 10, max: 100 }).toString())
      .replace("{reason}", failureType || "insufficient resources");

    return {
      type,
      reason,
      message,
      source: {
        component: faker.helpers.arrayElement(this.patterns.sources.components),
        host:
          kind === "Task"
            ? `dgx-a100-${faker.number.int({ min: 1, max: 100 }).toString().padStart(3, "0")}`
            : undefined,
      },
      first_timestamp: time.toISOString(),
      last_timestamp: time.toISOString(),
      count: 1,
      involved_object: {
        kind,
        name: objectName,
        namespace: "default",
      },
    };
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

export const eventGenerator = new EventGenerator();
