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

import { History } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/shadcn/hover-card";
import { STATUS_DESCRIPTIONS } from "@/app/(dashboard)/workflows/[name]/lib/status-utils";
import type { TaskGroupStatus, WorkflowStatus } from "@/lib/api/generated";

interface StatusHoverCardProps {
  /** The raw status enum value (used to look up description) */
  status: TaskGroupStatus | WorkflowStatus;
  /** Display label for the hover trigger */
  label: string;
  /** Additional className for the trigger span */
  triggerClassName?: string;
  /** Navigate to the Events tab */
  onNavigateToEvents?: () => void;
}

// Option I: ghost dotted underline at rest → full-color solid + bg swatch on hover
const TRIGGER_BASE =
  "cursor-help underline decoration-dotted decoration-1 underline-offset-[3px] " +
  "decoration-black/[0.22] dark:decoration-white/25 " +
  "rounded px-0.5 -mx-0.5 " +
  "transition-[background-color,text-decoration-color] duration-150 " +
  "hover:decoration-current hover:decoration-solid hover:bg-black/[0.07] dark:hover:bg-white/[0.08]";

export function StatusHoverCard({ status, label, triggerClassName, onNavigateToEvents }: StatusHoverCardProps) {
  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <span className={cn(TRIGGER_BASE, triggerClassName)}>{label}</span>
      </HoverCardTrigger>
      <HoverCardContent
        className="w-56 p-3"
        side="bottom"
        align="start"
      >
        <p className="text-muted-foreground mb-2 text-xs">{STATUS_DESCRIPTIONS[status]}</p>
        {onNavigateToEvents && (
          <button
            onClick={onNavigateToEvents}
            className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-xs hover:underline"
          >
            <History className="size-3" />
            View Events tab
          </button>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
