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
 * CollapsibleSection - Shared layout for drawer collapsible sections
 *
 * Provides:
 * - Numbered step indicator
 * - Expand/collapse with GPU-accelerated chevron rotation
 * - Optional action slot (e.g., "Edit" button)
 * - Optional badge slot (e.g., availability badge)
 * - Accessible keyboard navigation
 */

"use client";

import { memo, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/shadcn/collapsible";
import { cn } from "@/lib/utils";

export interface CollapsibleSectionProps {
  /** Step number (1, 2, 3) */
  step: number;
  /** Section title */
  title: string;
  /** Whether the section is expanded */
  open: boolean;
  /** Callback when expand/collapse state changes */
  onOpenChange: (open: boolean) => void;
  /** Optional action element (e.g., "Edit" button) */
  action?: ReactNode;
  /** Optional badge element (e.g., availability count) */
  badge?: ReactNode;
  /** Optional selected value to show when collapsed (e.g., pool name, priority level) */
  selectedValue?: string;
  /** Section content */
  children: ReactNode;
}

export const CollapsibleSection = memo(function CollapsibleSection({
  step,
  title,
  open,
  onOpenChange,
  action,
  badge,
  selectedValue,
  children,
}: CollapsibleSectionProps) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="border-border border-b"
    >
      <CollapsibleTrigger
        className={cn(
          "group flex w-full items-center justify-between px-6 py-4",
          "cursor-pointer select-none",
          "focus-visible:ring-nvidia focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        )}
        aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full",
              "bg-nvidia text-white",
              "text-xs font-semibold",
            )}
            aria-hidden="true"
          >
            {step}
          </span>
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-medium">{title}</span>
            {!open && selectedValue && (
              <code className="text-muted-foreground rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium dark:bg-zinc-800">
                {selectedValue}
              </code>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {badge}
          {action && (
            <div
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {action}
            </div>
          )}
          <ChevronDown
            className={cn(
              "text-muted-foreground size-5 shrink-0",
              "transition-all duration-200 ease-out",
              "group-hover:text-foreground",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-6 pb-5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
});
