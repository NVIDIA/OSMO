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

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { type TaskGroup } from "@/lib/api/adapter/events/events-grouping";
import { K8S_EVENT_REASONS } from "@/lib/api/adapter/events/events-types";

/**
 * Visual lifecycle stages for the progress bar.
 *
 * These split the K8s Pending phase into two visual sub-stages for clarity:
 *
 *   pending  -> K8s "Pending" phase, scheduling sub-phase
 *               (waiting for PodScheduled condition)
 *   init     -> K8s "Pending" phase, initialization sub-phase
 *               (PodReadyToStartContainers, image pull, init containers,
 *                container creation -- everything between scheduling and running)
 *   running  -> K8s "Running" phase
 *               (at least one container started)
 *   done     -> K8s "Succeeded" or "Failed" phase (terminal)
 *
 * Transition points:
 *   pending -> init:    When "Scheduled" event appears (PodScheduled=True)
 *   init -> running:    When "Started" event appears (phase transitions to Running)
 *   running -> done:    When all containers terminate (Succeeded or Failed)
 *
 * Reference: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
 */
const LIFECYCLE_STAGES = [
  { key: "pending", label: "Pending" },
  { key: "init", label: "Init" },
  { key: "running", label: "Running" },
  { key: "done", label: "Done" },
] as const;

type StageKey = (typeof LIFECYCLE_STAGES)[number]["key"];

/**
 * Check whether the pod was successfully scheduled by looking for a
 * "Scheduled" event. This is the dividing line between the scheduling
 * sub-phase (visual "Pending") and the initialization sub-phase
 * (visual "Init") within the K8s Pending phase.
 *
 * Note: FailedScheduling and Preempting also have stage "scheduling"
 * but do NOT indicate successful scheduling. Only "Scheduled" does.
 */
function hasBeenScheduled(task: TaskGroup): boolean {
  return task.events.some((e) => e.reason === K8S_EVENT_REASONS.SCHEDULED);
}

/**
 * Determine how far a failed task progressed before failure.
 *
 * Examines non-failure events to find the furthest lifecycle stage reached.
 * Uses the "Scheduled" event as the marker between the scheduling (index 0)
 * and initialization (index 1) sub-phases, since both map to stage "scheduling"
 * in the event classification.
 */
function getFailedProgressIndex(task: TaskGroup): number {
  const nonFailureEvents = task.events.filter((e) => e.stage !== "failure");
  if (nonFailureEvents.length === 0) return 0;

  const lastStage = nonFailureEvents[nonFailureEvents.length - 1]?.stage;
  if (lastStage === "completion") return 3;
  if (lastStage === "container" || lastStage === "runtime") return 2;
  if (lastStage === "image" || lastStage === "initialization") return 1;
  // lastStage is "scheduling" -- check if scheduling actually succeeded
  if (hasBeenScheduled(task)) return 1;
  return 0;
}

/**
 * Get progress index (0-3) based on pod phase and event history.
 *
 * Maps the K8s pod lifecycle to our 4 visual stages:
 *   0 = Pending (scheduling)  -- waiting for node assignment
 *   1 = Init (initialization) -- scheduled, pulling images, creating containers
 *   2 = Running               -- at least one container executing
 *   3 = Done                  -- terminal state (Succeeded or Failed)
 *
 * Within the K8s "Pending" phase, we use the presence of a "Scheduled" event
 * to distinguish scheduling (index 0) from initialization (index 1). Per the
 * K8s spec, after PodScheduled=True the pod progresses through
 * PodReadyToStartContainers, init containers, image pulls, and container
 * creation -- all still within the Pending phase but past scheduling.
 */
export function getProgressIndex(task: TaskGroup): number {
  if (task.podPhase === "Failed") {
    return getFailedProgressIndex(task);
  }

  switch (task.podPhase) {
    case "Succeeded":
      return 3; // done
    case "Running":
      return 2; // running
    case "Pending":
      // Within Pending, the "Scheduled" event marks the boundary between
      // the scheduling sub-phase (waiting for a node) and the initialization
      // sub-phase (image pull, init containers, container creation).
      return hasBeenScheduled(task) ? 1 : 0;
    case "Unknown":
    default:
      return 0; // pending
  }
}

interface LifecycleSegmentProps {
  stage: StageKey;
  label: string;
  state: "done" | "active" | "failed" | "inactive";
  showPulse: boolean;
}

function LifecycleSegment({ stage, label, state, showPulse }: LifecycleSegmentProps) {
  return (
    <div
      className={cn(
        "lifecycle-segment flex flex-1 items-center justify-center",
        "text-[10px] leading-none font-medium tracking-wide",
        "gap-0.5 whitespace-nowrap select-none",
        "first:rounded-l last:rounded-r",
        showPulse && "animate-[stage-pulse_2s_ease-in-out_infinite]",
      )}
      data-state={state}
      data-stage={stage}
    >
      {state === "done" && (
        <Check
          className="size-2.5"
          strokeWidth={3}
        />
      )}
      {state === "failed" && (
        <X
          className="size-2.5"
          strokeWidth={3}
        />
      )}
      <span>{state === "failed" ? "Failed" : label}</span>
    </div>
  );
}

export interface LifecycleProgressBarProps {
  task: TaskGroup;
  className?: string;
}

export function LifecycleProgressBar({ task, className }: LifecycleProgressBarProps) {
  const isFailed = task.podPhase === "Failed";
  const progressIdx = getProgressIndex(task);
  const isTerminal = task.podPhase === "Succeeded" || isFailed;

  return (
    <div className={cn("flex h-5.5 gap-0.5 overflow-hidden rounded", className)}>
      {LIFECYCLE_STAGES.map((stage, idx) => {
        let state: "done" | "active" | "failed" | "inactive";

        if (idx < progressIdx) {
          state = "done";
        } else if (idx === progressIdx) {
          state = isFailed ? "failed" : "active";
        } else {
          state = "inactive";
        }

        return (
          <LifecycleSegment
            key={stage.key}
            stage={stage.key}
            label={stage.label}
            state={state}
            showPulse={state === "active" && !isTerminal}
          />
        );
      })}
    </div>
  );
}
