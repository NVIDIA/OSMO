/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PanelHeader Component
 *
 * Two-row header layout:
 * Row 1: Title + View badge                              [Menu] [Close]
 * Row 2: Status indicator · Backend info
 */

"use client";

import { memo } from "react";
import { Server } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Pool } from "@/lib/api/adapter";
import { PanelHeaderActions } from "@/components/panel";
import { getStatusDisplay, getStatusStyles } from "../../lib/constants";

export interface PanelHeaderProps {
  pool: Pool;
  onClose: () => void;
  onWidthPreset: (pct: number) => void;
}

export const PanelHeader = memo(function PanelHeader({ pool, onClose, onWidthPreset }: PanelHeaderProps) {
  const statusDisplay = getStatusDisplay(pool.status);
  const statusStyles = getStatusStyles(pool.status);

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
      {/* Row 1: Title row */}
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="truncate font-semibold text-zinc-900 dark:text-zinc-100">{pool.name}</h2>
        </div>
        <PanelHeaderActions
          badge="Pool"
          onWidthPreset={onWidthPreset}
          onClose={onClose}
        />
      </div>

      {/* Row 2: Status + Backend info */}
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", statusStyles.dot)} />
          <span className="font-medium text-zinc-600 dark:text-zinc-300">{statusDisplay.label}</span>
        </span>
        <span className="text-zinc-400 dark:text-zinc-600">·</span>
        <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
          <Server className="size-3" />
          {pool.backend}
        </span>
        {pool.platforms.length > 0 && (
          <>
            <span className="text-zinc-400 dark:text-zinc-600">·</span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {pool.platforms.length} platform{pool.platforms.length !== 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>
    </header>
  );
});
