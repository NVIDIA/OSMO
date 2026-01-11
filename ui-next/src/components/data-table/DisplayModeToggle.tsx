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

import { memo } from "react";
import { MonitorCheck, MonitorX } from "lucide-react";
import { Toggle } from "@/components/shadcn/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { useSharedPreferences } from "@/stores";

/**
 * DisplayModeToggle - Toggle between "free" (available) and "used" display modes.
 *
 * Used by pools and resources tables to filter the view.
 */
export const DisplayModeToggle = memo(function DisplayModeToggle() {
  const displayMode = useSharedPreferences((s) => s.displayMode);
  const toggleDisplayMode = useSharedPreferences((s) => s.toggleDisplayMode);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={displayMode === "free"}
          onPressedChange={toggleDisplayMode}
          aria-label={displayMode === "free" ? "Showing used" : "Showing available"}
        >
          {displayMode === "free" ? <MonitorCheck className="size-4" /> : <MonitorX className="size-4" />}
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{displayMode === "free" ? "Showing available" : "Showing used"}</TooltipContent>
    </Tooltip>
  );
});
