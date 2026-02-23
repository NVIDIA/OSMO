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

import { cn } from "@/lib/utils";
import { type TaskGroup } from "@/lib/api/adapter/events/events-grouping";
import { TaskGroupStatus } from "@/lib/api/generated";
import { useEventViewerContext } from "@/components/event-viewer/event-viewer-context";

/**
 * Visual lifecycle stages for the progress bar.
 *
 * These split the K8s Pending phase into two visual sub-stages for clarity:
 *
 *   scheduling -> K8s "Pending" phase, scheduling sub-phase
 *                 (waiting for PodScheduled condition)
 *   init       -> K8s "Pending" phase, initialization sub-phase
 *                 (PodReadyToStartContainers, image pull, init containers,
 *                  container creation -- everything between scheduling and running)
 *   running    -> K8s "Running" phase
 *                 (at least one container started)
 *   done       -> K8s "Succeeded" or "Failed" phase (terminal)
 *
 * Transition points:
 *   scheduling -> init:    When "Scheduled" event appears (PodScheduled=True)
 *   init -> running:       When "Started" event appears (phase transitions to Running)
 *   running -> done:       When all containers terminate (Succeeded or Failed)
 *
 * Reference: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
 */
const LIFECYCLE_STAGES = [
  { key: "scheduling", label: "Scheduling" },
  { key: "init", label: "Init" },
  { key: "running", label: "Running" },
  { key: "done", label: "Done" },
] as const;

type StageKey = (typeof LIFECYCLE_STAGES)[number]["key"];

/**
 * Get progress index (0-3) from the derived furthest progress.
 *
 * Maps the K8s pod lifecycle to our 4 visual stages:
 *   0 = Scheduling         -- waiting for node assignment
 *   1 = Init (initialization) -- scheduled, pulling images, creating containers
 *   2 = Running               -- at least one container executing
 *   3 = Done                  -- terminal state (Succeeded or Failed)
 *
 * Uses `furthestProgressIndex` from the derived state, which scans ALL events
 * for the highest stage reached. This is robust to:
 * - Missing events: a "Running" event without "Scheduling"/"Init" events still
 *   shows the task at the Running stage (and infers earlier stages).
 * - Out-of-order events: a late "Scheduling" event after "Running" does not
 *   regress the progress.
 */
export function getProgressIndex(task: TaskGroup): number {
  const { furthestProgressIndex } = task.derived;
  return furthestProgressIndex >= 0 ? furthestProgressIndex : 0;
}

/**
 * Derive the display label for the "Running" lifecycle stage slot.
 *
 * K8s events arrive faster than Postgres state updates. When K8s events
 * indicate a container started (furthestProgressIndex = 2) but OSMO hasn't
 * confirmed the task is running yet, show "Pending" to surface the
 * authoritative OSMO state.
 *
 * Applied for "active", "terminal", and "failed" states:
 * - active: task currently progressing through the running stage
 * - terminal: parent stopped while the race condition was unresolved — must
 *   preserve the "Pending" label rather than reverting to the static "Running"
 * - failed: container started then failed — show "Failed" not "Running"
 */
export function getRunningStageLabel(
  state: "active" | "terminal" | "failed",
  taskStatus: TaskGroupStatus | undefined,
): "Running" | "Pending" | "Failed" {
  if (state === "failed") return "Failed";
  // active or terminal: K8s events may have raced ahead of Postgres
  if (taskStatus === undefined) return "Running";
  if (taskStatus === TaskGroupStatus.RUNNING) return "Running";
  // OSMO hasn't confirmed running yet — K8s events raced ahead of Postgres
  return "Pending";
}

/**
 * Segment state for the lifecycle progress bar.
 *
 *   done      – Stage completed successfully (green + check icon)
 *   inferred  – Stage was passed through but no events were observed for it.
 *               Shown in darker gray to indicate implicit completion.
 *               Example: we received a "Running" event but no "Scheduling" or
 *               "Init" events — those stages are inferred as completed.
 *   active    – Stage currently in progress (stage-specific color, may pulse)
 *   failed    – Stage where failure occurred (red + X icon)
 *   terminal  – Parent entity terminated but pod didn't complete this stage.
 *               Same stage-specific color as "active" but never pulses,
 *               indicating the task is no longer progressing.
 *   inactive  – Stage not yet reached (gray)
 */
type SegmentState = "done" | "inferred" | "active" | "failed" | "terminal" | "inactive";

interface TimelineDotProps {
  stage: StageKey;
  state: SegmentState;
  showPulse: boolean;
}

function TimelineDot({ stage, state, showPulse }: TimelineDotProps) {
  return (
    <div
      className={cn("timeline-dot", showPulse && "animate-[dot-pulse_2s_ease-in-out_infinite]")}
      data-state={state}
      data-stage={stage}
    />
  );
}

interface LifecycleProgressBarProps {
  task: TaskGroup;
  className?: string;
}

export function LifecycleProgressBar({ task, className }: LifecycleProgressBarProps) {
  const { isParentTerminal, taskStatus, taskStatuses } = useEventViewerContext();
  // Task scope: single taskStatus. Workflow scope: look up by name + retry.
  const effectiveTaskStatus = taskStatus ?? taskStatuses?.get(`${task.name}:${task.retryId}`);
  const { podPhase } = task.derived;
  const isFailed = podPhase === "Failed";
  const isPodTerminal = podPhase === "Succeeded" || isFailed;

  let progressIdx = getProgressIndex(task);

  // Infer completion when the parent entity is terminal but pod events are
  // incomplete. If the last known pod phase is Running, we can confidently
  // assume the pod completed — we just never received the terminal event.
  const inferredDone = !isPodTerminal && !!isParentTerminal && podPhase === "Running";
  if (inferredDone) {
    progressIdx = 3; // All stages complete
  }

  // Parent is terminal but pod never reached Running or a terminal phase.
  // The task stopped without progressing further (e.g., canceled while in
  // Scheduling/Init). Show as "terminal" — same color as active but no pulse.
  const showTerminal = !isPodTerminal && !inferredDone && !!isParentTerminal;

  // Determine final timeline color, overriding for inferred completion
  // When inferredDone is true, show green (success) instead of blue (in-progress)
  let timelineColor = task.derived.timelineColor;
  if (inferredDone) {
    timelineColor = "green";
  }

  return (
    <div
      className={cn("lifecycle-timeline", className)}
      data-timeline-color={timelineColor}
    >
      {LIFECYCLE_STAGES.map((stage, idx) => {
        let state: SegmentState;

        if (idx < progressIdx) {
          // Stage before current: completed (observed) or inferred (no events)
          const isObserved = task.derived.observedStageIndices.has(idx);
          state = isObserved ? "done" : "inferred";
        } else if (idx === progressIdx) {
          if (isFailed) {
            state = "failed";
          } else if (inferredDone) {
            state = "done";
          } else if (showTerminal) {
            state = "terminal";
          } else {
            state = "active";
          }
        } else {
          state = "inactive";
        }

        const isLastStage = idx === LIFECYCLE_STAGES.length - 1;

        // K8s events race ahead of Postgres: when the running dot is active,
        // terminal (parent stopped before OSMO confirmed), or failed — show the
        // correct label rather than the static "Running" fallback.
        const effectiveLabel =
          stage.key === "running" && (state === "active" || state === "terminal" || state === "failed")
            ? getRunningStageLabel(state, effectiveTaskStatus)
            : stage.label;

        return (
          <div
            key={stage.key}
            className={cn("timeline-step", isLastStage && "timeline-step-last")}
          >
            <TimelineDot
              stage={stage.key}
              state={state}
              showPulse={state === "active" && !isPodTerminal}
            />
            {!isLastStage && (
              <div className="timeline-line">
                <div
                  className="timeline-line-fill"
                  style={{ transform: `scaleX(${idx < progressIdx ? 1 : 0})` }}
                />
              </div>
            )}
            <span
              className="timeline-label"
              data-state={state}
            >
              {effectiveLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}
