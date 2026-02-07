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
 * PrioritySection - Segmented radio group for HIGH/NORMAL/LOW priority
 * selection using WorkflowPriority enum.
 */

"use client";

import { memo, useState, useId } from "react";
import { WorkflowPriority } from "@/lib/api/generated";
import { cn } from "@/lib/utils";
import { usePanelFocus } from "@/components/panel/hooks/usePanelFocus";
import { CollapsibleSection } from "./CollapsibleSection";

export interface PrioritySectionProps {
  /** Currently selected priority */
  priority: WorkflowPriority;
  /** Callback when priority changes */
  onChange: (priority: WorkflowPriority) => void;
}

// Display order: Low → Normal → High (left to right)
const PRIORITY_OPTIONS: WorkflowPriority[] = [WorkflowPriority.LOW, WorkflowPriority.NORMAL, WorkflowPriority.HIGH];

const PRIORITY_LABELS: Record<WorkflowPriority, string> = {
  [WorkflowPriority.HIGH]: "High",
  [WorkflowPriority.NORMAL]: "Normal",
  [WorkflowPriority.LOW]: "Low",
};

export const PrioritySection = memo(function PrioritySection({ priority, onChange }: PrioritySectionProps) {
  const [open, setOpen] = useState(true);
  const groupId = useId();
  const focusPanel = usePanelFocus();

  // Handle priority selection: change value and focus panel so ESC works
  const handleChange = (newPriority: WorkflowPriority) => {
    onChange(newPriority);
    focusPanel(); // Return focus to panel after instant action
  };

  // Calculate the position of the sliding indicator.
  // Layout: container has p-1.5 (0.375rem) padding and gap-2 (0.5rem) between flex-1 items.
  // The indicator width = one button width = (container content width - total gaps) / numOptions.
  // In CSS: width = calc((100% - 2 * padding - totalGaps) / numOptions)
  //   where 100% is the container's full width including padding.
  // translateX uses percentages relative to the element's OWN width, so
  //   translateX(100%) = exactly one button width. For index N we need
  //   N * 100% (button widths) + N * gapSize (accumulated gaps) + padding offset.
  const selectedIndex = PRIORITY_OPTIONS.indexOf(priority);
  const numOptions = PRIORITY_OPTIONS.length;
  const GAP_REM = 0.5; // gap-2 = 0.5rem
  const PADDING_REM = 0.375; // p-1.5 = 0.375rem
  const totalGapsRem = (numOptions - 1) * GAP_REM;

  return (
    <CollapsibleSection
      step={3}
      title="Priority Level"
      open={open}
      onOpenChange={setOpen}
    >
      <div className="flex flex-col gap-2">
        <div
          className="bg-muted relative flex gap-2 rounded-md p-1.5"
          role="radiogroup"
          aria-label="Priority level"
        >
          {/* Sliding background indicator */}
          <div
            className="bg-nvidia pointer-events-none absolute inset-y-1.5 rounded-sm shadow-sm transition-transform duration-200 ease-out"
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
                  isSelected ? "text-white" : "text-muted-foreground",
                )}
              >
                <input
                  type="radio"
                  id={inputId}
                  name={`${groupId}-priority`}
                  value={option}
                  checked={isSelected}
                  onChange={() => handleChange(option)}
                  className="sr-only"
                  aria-label={`${PRIORITY_LABELS[option]} priority`}
                />
                {PRIORITY_LABELS[option]}
              </label>
            );
          })}
        </div>
      </div>
    </CollapsibleSection>
  );
});
