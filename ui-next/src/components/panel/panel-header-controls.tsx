// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo } from "react";
import { X, MoreVertical, PanelLeft, PanelLeftClose, Columns2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";

// =============================================================================
// Panel Constants
// =============================================================================

/**
 * Shared panel configuration for resizable detail panels.
 * Used by both pools and resources panels.
 */
export const PANEL = {
  /** Width presets for snap-to menu (percentage) */
  WIDTH_PRESETS: [33, 50, 75] as const,
  /** Minimum width percentage */
  MIN_WIDTH_PCT: 20,
  /** Maximum width percentage */
  MAX_WIDTH_PCT: 80,
} as const;

// =============================================================================
// Width Preset Icons
// =============================================================================

/**
 * Icons for panel width presets.
 * Maps percentage to appropriate icon.
 */
export const WIDTH_PRESET_ICONS: Record<number, React.FC<{ className?: string }>> = {
  33: PanelLeftClose,
  50: Columns2,
  75: PanelLeft,
};

// =============================================================================
// Panel Width Menu
// =============================================================================

export interface PanelWidthMenuProps {
  onWidthPreset: (pct: number) => void;
}

/**
 * Dropdown menu for panel width presets.
 * Provides "snap to" options for 33%, 50%, 75% widths.
 */
export const PanelWidthMenu = memo(function PanelWidthMenu({
  onWidthPreset,
}: PanelWidthMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
          <MoreVertical className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs text-zinc-500 dark:text-zinc-500">
          Snap to
        </DropdownMenuLabel>
        {PANEL.WIDTH_PRESETS.map((pct) => {
          const Icon = WIDTH_PRESET_ICONS[pct];
          return (
            <DropdownMenuItem key={pct} onClick={() => onWidthPreset(pct)}>
              <Icon className="mr-2 size-4" />
              <span>{pct}%</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

// =============================================================================
// Panel Close Button
// =============================================================================

export interface PanelCloseButtonProps {
  onClose: () => void;
}

/**
 * Close button for panel headers.
 */
export const PanelCloseButton = memo(function PanelCloseButton({
  onClose,
}: PanelCloseButtonProps) {
  return (
    <button
      onClick={onClose}
      className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
      aria-label="Close panel"
    >
      <X className="size-4" />
    </button>
  );
});

// =============================================================================
// Panel Header Actions
// =============================================================================

export interface PanelHeaderActionsProps {
  /** Label badge text (e.g., "Pool", "Resource") */
  badge: string;
  onWidthPreset: (pct: number) => void;
  onClose: () => void;
}

/**
 * Combined actions for panel header: badge + menu + close.
 */
export const PanelHeaderActions = memo(function PanelHeaderActions({
  badge,
  onWidthPreset,
  onClose,
}: PanelHeaderActionsProps) {
  return (
    <div className="-mr-1.5 flex shrink-0 items-center gap-1">
      <span className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-zinc-500 ring-1 ring-inset ring-zinc-300 dark:text-zinc-400 dark:ring-zinc-600">
        {badge}
      </span>
      <PanelWidthMenu onWidthPreset={onWidthPreset} />
      <PanelCloseButton onClose={onClose} />
    </div>
  );
});
