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

"use client";

import { memo, useId } from "react";
import { WorkflowPriority } from "@/lib/api/generated";
import { cn } from "@/lib/utils";

const PRIORITY_OPTIONS: WorkflowPriority[] = [WorkflowPriority.LOW, WorkflowPriority.NORMAL, WorkflowPriority.HIGH];

export const PRIORITY_LABELS: Record<WorkflowPriority, string> = {
  [WorkflowPriority.HIGH]: "High",
  [WorkflowPriority.NORMAL]: "Normal",
  [WorkflowPriority.LOW]: "Low",
};

const PRIORITY_HINTS: Record<WorkflowPriority, string> = {
  [WorkflowPriority.LOW]: "Preemptible tasks that do not count towards pool quota.",
  [WorkflowPriority.NORMAL]: "Counts towards quota but is not preemptible.",
  [WorkflowPriority.HIGH]: "Counts towards quota, not preemptible, and is prioritized over normal workflows.",
};

export interface PriorityPickerProps {
  priority: WorkflowPriority;
  onChange: (priority: WorkflowPriority) => void;
}

export const PriorityPicker = memo(function PriorityPicker({ priority, onChange }: PriorityPickerProps) {
  const groupId = useId();

  // Sliding indicator position: translateX percentages are relative to own width
  const selectedIndex = PRIORITY_OPTIONS.indexOf(priority);
  const numOptions = PRIORITY_OPTIONS.length;
  const GAP_REM = 0.5; // gap-2 = 0.5rem
  const PADDING_REM = 0.375; // p-1.5 = 0.375rem
  const totalGapsRem = (numOptions - 1) * GAP_REM;

  return (
    <div className="flex flex-col gap-2">
      <div
        className="bg-muted relative flex gap-2 rounded-md p-1.5"
        role="radiogroup"
        aria-label="Priority level"
      >
        <div
          className="bg-foreground/15 pointer-events-none absolute inset-y-1.5 rounded-sm transition-transform duration-200 ease-out"
          style={{
            left: `${PADDING_REM}rem`,
            width: `calc((100% - ${2 * PADDING_REM}rem - ${totalGapsRem}rem) / ${numOptions})`,
            transform: `translateX(calc(${selectedIndex * 100}% + ${selectedIndex * GAP_REM}rem))`,
          }}
        />

        {PRIORITY_OPTIONS.map((option) => {
          const isSelected = priority === option;
          const inputId = `${groupId}-${option}`;

          return (
            <label
              key={option}
              htmlFor={inputId}
              className={cn(
                "relative z-10 flex-1 cursor-pointer rounded-sm px-3 py-2 text-center text-sm font-medium",
                "transition-colors duration-200 ease-out",
                isSelected ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <input
                type="radio"
                id={inputId}
                name={`${groupId}-priority`}
                value={option}
                checked={isSelected}
                onChange={() => onChange(option)}
                className="sr-only"
                aria-label={`${PRIORITY_LABELS[option]} priority`}
              />
              {PRIORITY_LABELS[option]}
            </label>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">{PRIORITY_HINTS[priority]}</p>
    </div>
  );
});
