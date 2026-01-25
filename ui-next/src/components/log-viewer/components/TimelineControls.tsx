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

/**
 * Timeline Controls Component
 *
 * Apply/Cancel buttons for committing or discarding pending time range changes.
 *
 * ## Behavior
 *
 * - Only visible when there are pending changes (dragger moved but not applied)
 * - Apply: Commits changes, triggers data refetch, announces to screen reader
 * - Cancel: Discards changes, draggers snap back to effective range
 * - Smooth transitions (200ms ease-out)
 */

"use client";

import { Check, X } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export interface TimelineControlsProps {
  /** Whether there are pending changes */
  hasPendingChanges: boolean;
  /** Callback when Apply is clicked */
  onApply: () => void;
  /** Callback when Cancel is clicked */
  onCancel: () => void;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Apply/Cancel controls for pending time range changes.
 */
export function TimelineControls({ hasPendingChanges, onApply, onCancel, className }: TimelineControlsProps) {
  if (!hasPendingChanges) return null;

  return (
    <div className={cn("flex items-center gap-2", "animate-in fade-in slide-in-from-top-2 duration-200", className)}>
      <Button
        size="sm"
        variant="default"
        onClick={onApply}
        className="h-7 gap-1 text-xs"
      >
        <Check className="size-3" />
        Apply
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onCancel}
        className="h-7 gap-1 text-xs"
      >
        <X className="size-3" />
        Cancel
      </Button>
    </div>
  );
}
