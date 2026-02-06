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
import { CollapsibleSection } from "./CollapsibleSection";

export interface PrioritySectionProps {
  /** Currently selected priority */
  priority: WorkflowPriority;
  /** Callback when priority changes */
  onChange: (priority: WorkflowPriority) => void;
}

const PRIORITY_OPTIONS = Object.values(WorkflowPriority) as WorkflowPriority[];

const PRIORITY_LABELS: Record<WorkflowPriority, string> = {
  [WorkflowPriority.HIGH]: "High",
  [WorkflowPriority.NORMAL]: "Normal",
  [WorkflowPriority.LOW]: "Low",
};

export const PrioritySection = memo(function PrioritySection({ priority, onChange }: PrioritySectionProps) {
  const [open, setOpen] = useState(true);
  const groupId = useId();

  return (
    <CollapsibleSection
      step={3}
      title="Priority Level"
      open={open}
      onOpenChange={setOpen}
    >
      <div className="flex flex-col gap-2">
        <label
          id={`${groupId}-label`}
          className="text-sm font-medium"
        >
          Execution priority
        </label>

        <div
          className="bg-muted flex gap-2 rounded-md p-1.5"
          role="radiogroup"
          aria-labelledby={`${groupId}-label`}
        >
          {PRIORITY_OPTIONS.map((option) => {
            const isSelected = priority === option;
            const inputId = `${groupId}-${option}`;

            return (
              <label
                key={option}
                htmlFor={inputId}
                className={cn(
                  "flex-1 cursor-pointer rounded-sm px-3 py-2 text-center text-sm font-medium",
                  "transition-[color,background-color,box-shadow] duration-150 ease-out",
                  isSelected
                    ? "bg-nvidia text-white shadow-sm"
                    : "text-muted-foreground hover:bg-nvidia-bg hover:text-foreground dark:hover:bg-nvidia-bg-dark",
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

        <p className="text-muted-foreground text-xs">Higher priority jobs are scheduled to execute first</p>
      </div>
    </CollapsibleSection>
  );
});
