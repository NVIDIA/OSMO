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

import { cn } from "@/lib/utils";
import { type TaskGroup } from "@/lib/api/adapter/events/events-grouping";

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
 * Get progress index (0-3) from the derived furthest progress.
 *
 * Maps the K8s pod lifecycle to our 4 visual stages:
 *   0 = Pending (scheduling)  -- waiting for node assignment
 *   1 = Init (initialization) -- scheduled, pulling images, creating containers
 *   2 = Running               -- at least one container executing
 *   3 = Done                  -- terminal state (Succeeded or Failed)
 *
 * Uses `furthestProgressIndex` from the derived state, which scans ALL events
 * for the highest stage reached. This is robust to:
 * - Missing events: a "Running" event without "Pending"/"Init" events still
 *   shows the task at the Running stage (and infers earlier stages).
 * - Out-of-order events: a late "Pending" event after "Running" does not
 *   regress the progress.
 */
export function getProgressIndex(task: TaskGroup): number {
  const { furthestProgressIndex } = task.derived;
  return furthestProgressIndex >= 0 ? furthestProgressIndex : 0;
}

/**
 * Segment state for the lifecycle progress bar.
 *
 *   done      – Stage completed successfully (green + check icon)
 *   inferred  – Stage was passed through but no events were observed for it.
 *               Shown in darker gray to indicate implicit completion.
 *               Example: we received a "Running" event but no "Pending" or
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

export interface LifecycleProgressBarProps {
  task: TaskGroup;
  /**
   * Whether the parent entity (workflow or task) has reached a terminal state.
   *
   * When true, enables inference for missing terminal events:
   * - Last phase is Running → inferred as Done (completed successfully)
   * - Last phase is Pending/Init → shown as "terminal" (settled, no pulse)
   */
  isParentTerminal?: boolean;
  className?: string;
}

export function LifecycleProgressBar({ task, isParentTerminal, className }: LifecycleProgressBarProps) {
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
  // Pending/Init). Show as "terminal" — same color as active but no pulse.
  const showTerminal = !isPodTerminal && !inferredDone && !!isParentTerminal;

  // Determine final timeline color, overriding for inferred completion
  // When inferredDone is true, show green (success) instead of blue (in-progress)
  let timelineColor = task.derived.timelineColor;
  if (inferredDone) {
    timelineColor = "green";
  }

  // Calculate fill percentage for each line segment
  // Timeline always goes to a dot, never stops in the middle
  // lineIdx 0 = line after first dot (Pending -> Init)
  // lineIdx 1 = line after second dot (Init -> Running)
  // lineIdx 2 = line after third dot (Running -> Done)
  const getLineFillPercentage = (lineIdx: number): number => {
    // Line is filled if we've reached or passed the next stage
    return lineIdx < progressIdx ? 100 : 0;
  };

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
                  style={{ width: `${getLineFillPercentage(idx)}%` }}
                />
              </div>
            )}
            <span
              className="timeline-label"
              data-state={state}
            >
              {stage.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
