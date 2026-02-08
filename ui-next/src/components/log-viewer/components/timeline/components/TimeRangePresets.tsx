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
 * Time Range Presets Component
 *
 * Dropdown menu for selecting predefined time ranges.
 */

"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Button } from "@/components/shadcn/button";
import { ChevronDown, Check } from "lucide-react";
import {
  type TimeRangePreset,
  PRESET_LABELS,
  PRESET_ORDER,
} from "@/components/log-viewer/components/timeline/lib/timeline-constants";

// =============================================================================
// Types
// =============================================================================

export interface TimeRangePresetsProps {
  /** Currently active preset */
  activePreset?: TimeRangePreset;
  /** Callback when a preset is selected */
  onPresetSelect?: (preset: TimeRangePreset) => void;
}

// =============================================================================
// Component
// =============================================================================

export function TimeRangePresets({ activePreset, onPresetSelect }: TimeRangePresetsProps): React.ReactNode {
  const displayLabel = activePreset ? PRESET_LABELS[activePreset] : "Range";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
        >
          {displayLabel}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-32"
      >
        {PRESET_ORDER.map((preset) => (
          <DropdownMenuItem
            key={preset}
            onClick={() => onPresetSelect?.(preset)}
            className="justify-between text-xs"
          >
            <span>{PRESET_LABELS[preset]}</span>
            {activePreset === preset ? <Check className="size-3" /> : <span className="size-3" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          disabled
          className="justify-between text-xs"
        >
          <span className="text-muted-foreground">Custom</span>
          {activePreset === "custom" ? <Check className="text-muted-foreground size-3" /> : <span className="size-3" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
