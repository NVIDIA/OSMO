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
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// =============================================================================
// Panel Constants
// =============================================================================

/**
 * Shared panel configuration for resizable detail panels.
 * Used by pools, resources, workflows/DAG panels.
 */
export const PANEL = {
  /** Minimum width percentage */
  MIN_WIDTH_PCT: 33,
  /** Overlay maximum width percentage */
  OVERLAY_MAX_WIDTH_PCT: 80,
  /** Maximum width percentage (100 for auto-snap zones) */
  MAX_WIDTH_PCT: 100,
  /** Default panel width percentage */
  DEFAULT_WIDTH_PCT: 50,
  /** Width of collapsed panel strip in pixels */
  COLLAPSED_WIDTH_PX: 40,
} as const;

// =============================================================================
// Panel Header Container
// =============================================================================

export interface PanelHeaderContainerProps {
  /** Header content */
  children: React.ReactNode;
  /** Additional className */
  className?: string;
}

/**
 * Sticky header container for panel headers.
 * Provides consistent styling: sticky positioning, border, backdrop blur.
 *
 * @example
 * ```tsx
 * <PanelHeaderContainer>
 *   <div className="flex items-center justify-between">
 *     <h2>Title</h2>
 *     <PanelCloseButton onClose={onClose} />
 *   </div>
 *   <div className="mt-1.5 text-xs">Status info</div>
 * </PanelHeaderContainer>
 * ```
 */
export const PanelHeaderContainer = memo(function PanelHeaderContainer({
  children,
  className,
}: PanelHeaderContainerProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur",
        "dark:border-zinc-700 dark:bg-zinc-900/95",
        className,
      )}
    >
      {children}
    </header>
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
export const PanelCloseButton = memo(function PanelCloseButton({ onClose }: PanelCloseButtonProps) {
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
  onClose: () => void;
}

/**
 * Combined actions for panel header: badge + close.
 */
export const PanelHeaderActions = memo(function PanelHeaderActions({ badge, onClose }: PanelHeaderActionsProps) {
  return (
    <div className="-mr-1.5 flex shrink-0 items-center gap-1">
      <span className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tracking-wide text-zinc-500 uppercase ring-1 ring-zinc-300 ring-inset dark:text-zinc-400 dark:ring-zinc-600">
        {badge}
      </span>
      <PanelCloseButton onClose={onClose} />
    </div>
  );
});
