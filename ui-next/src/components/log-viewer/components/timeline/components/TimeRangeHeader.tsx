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
 * Time Range Header Component
 *
 * Displays time range inputs and optional preset selector.
 */

"use client";

import { TimeRangePresets } from "./TimeRangePresets";
import type { TimeRangePreset } from "../lib/timeline-constants";

// =============================================================================
// Types
// =============================================================================

export interface TimeRangeHeaderProps {
  /** Start time for the range */
  startTime?: Date;
  /** End time for the range */
  endTime?: Date;
  /** Callback when start time changes */
  onStartTimeChange?: (date: Date) => void;
  /** Callback when end time changes */
  onEndTimeChange?: (date: Date) => void;
  /** Whether to show preset selector */
  showPresets?: boolean;
  /** Currently active preset */
  activePreset?: TimeRangePreset;
  /** Callback when a preset is selected */
  onPresetSelect?: (preset: TimeRangePreset) => void;
  /** Minimum allowed start time (entity start time) - UI constraint */
  minStartTime?: Date;
  /** Maximum allowed end time (entity end time, if completed) - UI constraint */
  maxEndTime?: Date;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format a Date for datetime-local input value.
 */
function formatForInput(date?: Date): string {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// =============================================================================
// Component
// =============================================================================

export function TimeRangeHeader({
  startTime,
  endTime,
  onStartTimeChange,
  onEndTimeChange,
  showPresets,
  activePreset,
  onPresetSelect,
  minStartTime,
  maxEndTime,
}: TimeRangeHeaderProps): React.ReactNode {
  function handleStartChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const date = new Date(e.target.value);
    if (!isNaN(date.getTime())) {
      onStartTimeChange?.(date);
      onPresetSelect?.("custom");
    }
  }

  function handleEndChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const date = new Date(e.target.value);
    if (!isNaN(date.getTime())) {
      onEndTimeChange?.(date);
      onPresetSelect?.("custom");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Time Range:</span>
        <div className="flex items-center gap-2">
          <input
            type="datetime-local"
            value={formatForInput(startTime)}
            onChange={handleStartChange}
            min={formatForInput(minStartTime)}
            max={formatForInput(maxEndTime)}
            className="border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring h-7 rounded-md border px-3 text-xs transition-colors focus-visible:ring-1 focus-visible:outline-none"
          />
          <span className="text-muted-foreground text-xs">to</span>
          <input
            type="datetime-local"
            value={formatForInput(endTime)}
            onChange={handleEndChange}
            min={formatForInput(startTime ?? minStartTime)}
            max={formatForInput(maxEndTime)}
            className="border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring h-7 rounded-md border px-3 text-xs transition-colors focus-visible:ring-1 focus-visible:outline-none"
          />
        </div>
        {showPresets && (
          <TimeRangePresets
            activePreset={activePreset}
            onPresetSelect={onPresetSelect}
          />
        )}
      </div>
    </div>
  );
}
