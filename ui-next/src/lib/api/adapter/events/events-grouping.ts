//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

import type { K8sEvent, LifecycleStage, PodPhase } from "@/lib/api/adapter/events/events-types";
import { derivePodPhase } from "@/lib/api/adapter/events/events-utils";
import { naturalCompare } from "@/lib/utils";

/**
 * Grouped task with its events.
 *
 * Represents a single task entity (identified by [entity] in the event stream)
 * and all of its lifecycle events. The `podPhase` field provides the canonical
 * K8s pod phase derived from the event stream.
 *
 * Cheap derivations are available via helper functions (e.g., `getLastStage`)
 * rather than being stored as fields.
 */
export interface TaskGroup {
  /** Unique identifier (entity string from event stream, e.g., "worker_27 retry-2") */
  id: string;
  /** Task name without retry suffix (e.g., "worker_27") */
  name: string;
  /** Retry attempt number (0 for initial, >0 for retries) */
  retryId: number;
  /**
   * Canonical K8s pod phase derived from the event stream.
   * Reference: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-phase
   */
  podPhase: PodPhase;
  /** Human-readable duration string (e.g., "2h 15m", "45s") */
  duration: string;
  /** All events for this task, sorted chronologically (oldest first) */
  events: K8sEvent[];
}

// ============================================================================
// Helper Functions (compute on demand instead of storing)
// ============================================================================

/**
 * Get the lifecycle stage of the most recent event for a task.
 */
export function getLastStage(task: TaskGroup): LifecycleStage | null {
  if (task.events.length === 0) return null;
  return task.events[task.events.length - 1].stage;
}

// ============================================================================
// Internal Helpers
// ============================================================================

function calculateDuration(startTime: Date | null, endTime: Date | undefined, terminal: boolean): string {
  if (!startTime) return "\u2014"; // em dash

  const end = terminal && endTime ? endTime : new Date();
  const diffMs = end.getTime() - startTime.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffHr > 0) {
    const remainingMin = diffMin % 60;
    return `${diffHr}h ${remainingMin}m`;
  }
  if (diffMin > 0) {
    return `${diffMin}m`;
  }
  return `${diffSec}s`;
}

// ============================================================================
// Grouping
// ============================================================================

/**
 * Group interleaved events by task entity and derive pod lifecycle state.
 *
 * Events are grouped by their `entity` field (e.g., "worker_27" or "worker_27 retry-2").
 * Each group gets its pod phase derived from the event stream using `derivePodPhase()`.
 */
export function groupEventsByTask(events: K8sEvent[]): TaskGroup[] {
  const taskMap = new Map<string, K8sEvent[]>();

  for (const event of events) {
    const entity = event.entity;
    if (!taskMap.has(entity)) {
      taskMap.set(entity, []);
    }
    taskMap.get(entity)!.push(event);
  }

  const tasks: TaskGroup[] = [];

  for (const [entity, taskEvents] of taskMap.entries()) {
    // Sort events ASC (chronological order: oldest first)
    taskEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const startTime = taskEvents[0]?.timestamp ?? null;
    const endTime = taskEvents[taskEvents.length - 1]?.timestamp;
    const taskName = taskEvents[0]?.taskName ?? entity;
    const retryId = taskEvents[0]?.retryId ?? 0;
    const podPhase = derivePodPhase(taskEvents);
    const terminal = podPhase === "Succeeded" || podPhase === "Failed";

    tasks.push({
      id: entity,
      name: taskName,
      retryId,
      podPhase,
      duration: calculateDuration(startTime, endTime, terminal),
      events: taskEvents,
    });
  }

  // Sort tasks using natural sort (handles numeric suffixes correctly)
  // Example: task_1, task_2, task_10 (not task_1, task_10, task_2)
  // Groups retries together: task_1 retry-0, task_1 retry-1, task_1 retry-2
  tasks.sort((a, b) => {
    const nameCompare = naturalCompare(a.name, b.name);
    if (nameCompare !== 0) return nameCompare;
    // If names are equal, sort by retry ID (ascending)
    return a.retryId - b.retryId;
  });

  return tasks;
}
