/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo } from "react";
import { X, MoreVertical, PanelLeft, PanelLeftClose, Columns2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { clearButton } from "@/lib/styles";
import type { Pool } from "@/lib/api/adapter";
import { getStatusDisplay, getStatusStyles, PANEL } from "../../lib";

const WIDTH_PRESET_ICONS: Record<number, React.FC<{ className?: string }>> = {
  33: PanelLeftClose,
  50: Columns2,
  75: PanelLeft,
};

export interface PanelHeaderProps {
  pool: Pool;
  onClose: () => void;
  onWidthPreset: (pct: number) => void;
}

export const PanelHeader = memo(function PanelHeader({ pool, onClose, onWidthPreset }: PanelHeaderProps) {
  const statusDisplay = getStatusDisplay(pool.status);
  const statusStyles = getStatusStyles(pool.status);

  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
      <div className="flex items-center gap-3">
        <span className={cn("size-2 rounded-full", statusStyles.dot)} />
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{pool.name}</h2>
        <Badge variant="outline" className="text-xs">
          {statusDisplay.label}
        </Badge>
      </div>

      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="size-8 p-0">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs text-zinc-500">Snap to</DropdownMenuLabel>
            {PANEL.WIDTH_PRESETS.map((pct) => {
              const Icon = WIDTH_PRESET_ICONS[pct];
              return (
                <DropdownMenuItem key={pct} onClick={() => onWidthPreset(pct)}>
                  <Icon className="mr-2 size-4" />
                  <span>{pct}%</span>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onClose}>
              <X className="mr-2 size-4" />
              Close panel
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button onClick={onClose} className={clearButton}>
          <X className="size-4" />
        </button>
      </div>
    </header>
  );
});
