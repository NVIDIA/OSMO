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
 * Timeline Selection Overlay
 *
 * Visual feedback for drag-to-select gestures.
 * Shows the selected range with highlight and handles.
 */

"use client";

import { cn } from "@/lib/utils";
import type { SelectionRange } from "@/components/log-viewer/components/timeline/hooks/use-timeline-selection";

// =============================================================================
// Types
// =============================================================================

export interface TimelineSelectionOverlayProps {
  /** Selection range to display */
  selectionRange: SelectionRange | null;
  /** Whether currently dragging */
  isDragging: boolean;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export function TimelineSelectionOverlay({
  selectionRange,
  isDragging,
  className,
}: TimelineSelectionOverlayProps): React.ReactNode {
  if (!selectionRange || !isDragging) return null;

  const width = selectionRange.endPercent - selectionRange.startPercent;
  const left = selectionRange.startPercent;

  return (
    <div className={cn("pointer-events-none absolute inset-0", className)}>
      {/* Dimmed areas outside selection */}
      {/* Left dim */}
      {left > 0 && (
        <div
          className="bg-background/40 absolute inset-y-0 left-0"
          style={{ width: `${left}%` }}
        />
      )}

      {/* Right dim */}
      {left + width < 100 && (
        <div
          className="bg-background/40 absolute inset-y-0 right-0"
          style={{ width: `${100 - (left + width)}%` }}
        />
      )}

      {/* Selection highlight */}
      <div
        className="border-primary/50 absolute inset-y-0 border-x-2"
        style={{
          left: `${left}%`,
          width: `${width}%`,
        }}
      />

      {/* Start handle */}
      <div
        className="bg-primary absolute inset-y-0 w-1 rounded-full"
        style={{ left: `${left}%` }}
      />

      {/* End handle */}
      <div
        className="bg-primary absolute inset-y-0 w-1 rounded-full"
        style={{ left: `${left + width}%` }}
      />
    </div>
  );
}
