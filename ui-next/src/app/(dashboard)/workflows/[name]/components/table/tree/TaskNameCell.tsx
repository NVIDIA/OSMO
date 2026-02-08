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
 * TaskNameCell Component
 *
 * Renders the Name column content for task rows:
 * - Task name with optional "Lead" badge
 * - No left padding (flush with header and group names)
 *
 * Hierarchy is shown via the tree column, not via text indentation.
 */

import { memo } from "react";
import { cn } from "@/lib/utils";
import { LeadBadge } from "@/app/(dashboard)/workflows/[name]/components/shared/LeadBadge";

// =============================================================================
// Types
// =============================================================================

export interface TaskNameCellProps {
  /** Task name to display */
  name: string;
  /** Whether this is the lead task */
  isLead?: boolean;
  /** Whether this task is in a single-task group (affects left padding) */
  isSingleTaskGroup?: boolean;
  /** Optional className */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const TaskNameCell = memo(function TaskNameCell({
  name,
  isLead,
  isSingleTaskGroup,
  className,
}: TaskNameCellProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2",
        // Single-task groups: remove left padding to align flush with header
        // Multi-task groups: keep default padding for visual hierarchy
        isSingleTaskGroup && "-ml-4",
        className,
      )}
    >
      <span className="text-foreground truncate font-medium">{name}</span>
      {isLead && <LeadBadge />}
    </div>
  );
});
