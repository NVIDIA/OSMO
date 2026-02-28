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
 * SubmitWorkflowPriority - Section 3 of the config panel.
 *
 * Renders three priority cards: LOW / NORMAL / HIGH.
 * Each card shows an icon, name, and short description.
 */

"use client";

import { memo } from "react";
import { ChevronsDown, Minus, Zap } from "lucide-react";
import { WorkflowPriority } from "@/lib/api/generated";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface PriorityOption {
  value: WorkflowPriority;
  label: string;
  description: string;
  Icon: LucideIcon;
  selectedClass: string;
  iconClass: string;
}

const PRIORITY_OPTIONS: PriorityOption[] = [
  {
    value: WorkflowPriority.LOW,
    label: "LOW",
    description: "Preemptible, best-effort",
    Icon: ChevronsDown,
    selectedClass: "border-violet-400/50 bg-violet-500/5 dark:border-violet-500/40 dark:bg-violet-500/10",
    iconClass: "text-violet-500 dark:text-violet-400",
  },
  {
    value: WorkflowPriority.NORMAL,
    label: "NORMAL",
    description: "Standard scheduling",
    Icon: Minus,
    selectedClass: "border-nvidia/60 bg-nvidia/5 dark:border-nvidia/40 dark:bg-nvidia/10",
    iconClass: "text-nvidia",
  },
  {
    value: WorkflowPriority.HIGH,
    label: "HIGH",
    description: "Priority queue slot",
    Icon: Zap,
    selectedClass: "border-red-400/50 bg-red-500/5 dark:border-red-500/40 dark:bg-red-500/10",
    iconClass: "text-red-500 dark:text-red-400",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SubmitWorkflowPriorityProps {
  priority: WorkflowPriority;
  onChange: (priority: WorkflowPriority) => void;
}

export const SubmitWorkflowPriority = memo(function SubmitWorkflowPriority({
  priority,
  onChange,
}: SubmitWorkflowPriorityProps) {
  return (
    <div
      className="flex gap-2"
      role="radiogroup"
      aria-label="Scheduling priority"
    >
      {PRIORITY_OPTIONS.map(({ value, label, description, Icon, selectedClass, iconClass }) => {
        const isSelected = priority === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(value)}
            className={cn(
              "flex flex-1 cursor-pointer flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all",
              isSelected
                ? selectedClass
                : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700/60 dark:bg-zinc-800/20 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/40",
            )}
          >
            <Icon
              className={cn("size-5", isSelected ? iconClass : "text-zinc-400 dark:text-zinc-500")}
              aria-hidden="true"
            />
            <span className="font-mono text-xs font-bold tracking-wide text-zinc-900 dark:text-zinc-100">{label}</span>
            <span className="font-mono text-[10px] leading-tight text-zinc-400 dark:text-zinc-500">{description}</span>
          </button>
        );
      })}
    </div>
  );
});
