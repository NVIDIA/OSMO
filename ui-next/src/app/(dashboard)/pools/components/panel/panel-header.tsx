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
 * PoolPanelHeader Component
 *
 * Pool-specific header composing from canonical PanelHeader.
 *
 * Layout:
 * Row 1: Title                                    [Pool badge] [Menu] [Close]
 * Row 2: Status indicator · Backend info · Platform count
 */

"use client";

import { memo } from "react";
import { Server } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Pool } from "@/lib/api/adapter/types";
import { PanelHeader, PanelTitle } from "@/components/panel/panel-header";
import { PanelHeaderActions } from "@/components/panel/panel-header-controls";
import { SeparatedParts } from "@/components/panel/separated-parts";
import { getStatusDisplay, getStatusStyles } from "@/app/(dashboard)/pools/lib/constants";

export interface PoolPanelHeaderProps {
  pool: Pool;
  onClose: () => void;
  onWidthPreset: (pct: number) => void;
}

export const PoolPanelHeader = memo(function PoolPanelHeader({ pool, onClose, onWidthPreset }: PoolPanelHeaderProps) {
  const statusDisplay = getStatusDisplay(pool.status);
  const statusStyles = getStatusStyles(pool.status);

  // Build subtitle content with status, backend, and platform count
  const subtitleContent = (
    <SeparatedParts>
      <span className="flex items-center gap-1.5">
        <span className={cn("size-2 rounded-full", statusStyles.dot)} />
        <span className="font-medium text-zinc-600 dark:text-zinc-300">{statusDisplay.label}</span>
      </span>
      <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
        <Server className="size-3" />
        {pool.backend}
      </span>
      {pool.platforms.length > 0 && (
        <span className="text-zinc-500 dark:text-zinc-400">
          {pool.platforms.length} platform{pool.platforms.length !== 1 ? "s" : ""}
        </span>
      )}
    </SeparatedParts>
  );

  return (
    <PanelHeader
      title={<PanelTitle>{pool.name}</PanelTitle>}
      actions={
        <PanelHeaderActions
          badge="Pool"
          onWidthPreset={onWidthPreset}
          onClose={onClose}
        />
      }
      subtitle={subtitleContent}
    />
  );
});
