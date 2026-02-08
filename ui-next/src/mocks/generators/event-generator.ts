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
import { MOCK_CONFIG, type EventPatterns, type MockVolume } from "@/mocks/seed/types";
import { hashString } from "@/mocks/utils";

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
  private volume: MockVolume;
  private baseSeed: number;

  constructor(
    patterns: EventPatterns = MOCK_CONFIG.events,
    volume: MockVolume = MOCK_CONFIG.volume,
    baseSeed: number = 22222,
  ) {
    this.patterns = patterns;
    this.volume = volume;
    this.baseSeed = baseSeed;
  }

  /**
   * Generate events for a workflow
   */
  generateWorkflowEvents(
    workflowName: string,
    status: string,
    submitTime: string,
    startTime?: string,
    endTime?: string,
  ): GeneratedEvent[] {
    faker.seed(this.baseSeed + hashString(workflowName));

    const events: GeneratedEvent[] = [];
    let currentTime = new Date(submitTime);

    // Scheduling events
    events.push(
      this.createEvent(currentTime, "Normal", "SuccessfulCreate", workflowName, "Workflow"),
      this.createEvent(
        new Date(currentTime.getTime() + faker.number.int({ min: 100, max: 1000 })),
        "Normal",
        "Scheduled",
        workflowName,
        "Workflow",
      ),
    );

    // If started
    if (startTime) {
      currentTime = new Date(startTime);

      events.push(
        this.createEvent(currentTime, "Normal", "Pulling", workflowName, "Workflow"),
        this.createEvent(
          new Date(currentTime.getTime() + faker.number.int({ min: 5000, max: 30000 })),
          "Normal",
          "Pulled",
          workflowName,
          "Workflow",
        ),
        this.createEvent(
          new Date(currentTime.getTime() + faker.number.int({ min: 30000, max: 60000 })),
          "Normal",
          "Started",
          workflowName,
          "Workflow",
        ),
      );
    }

    // If completed
    if (endTime && status === "COMPLETED") {
      currentTime = new Date(endTime);
      events.push(this.createEvent(currentTime, "Normal", "Completed", workflowName, "Workflow"));
    }

    // If failed
    if (status.startsWith("FAILED")) {
      const failTime = endTime ? new Date(endTime) : new Date();
      events.push(this.createEvent(failTime, "Warning", "Failed", workflowName, "Workflow", status));
    }

    // Add some random events based on volume
    const extraEvents = faker.number.int(this.volume.eventsPerWorkflow) - events.length;
    for (let i = 0; i < Math.max(0, extraEvents); i++) {
      const phase = faker.helpers.arrayElement(["scheduling", "execution"] as const);
      const reason = faker.helpers.arrayElement(this.patterns.reasons[phase]);
      const type =
        phase === "execution" ? "Normal" : (faker.helpers.arrayElement(this.patterns.types) as "Normal" | "Warning");

      events.push(
        this.createEvent(
          new Date(new Date(submitTime).getTime() + faker.number.int({ min: 0, max: 3600000 })),
          type,
          reason,
          workflowName,
          "Workflow",
        ),
      );
    }

    // Sort by timestamp
    events.sort((a, b) => new Date(a.first_timestamp).getTime() - new Date(b.first_timestamp).getTime());

    return events;
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
