/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * PoolPanelLayout Component
 *
 * Pool-specific overlay panel for pool details.
 * Composes from generic ResizablePanel component.
 */

"use client";

import { useCallback } from "react";
import type { Pool } from "@/lib/api/adapter";
import { ResizablePanel } from "@/components/resizable-panel";
import { usePoolsTableStore } from "../../stores/pools-table-store";
import { PanelHeader } from "./panel-header";
import { PanelContent } from "./panel-content";

// =============================================================================
// Types
// =============================================================================

export interface PoolPanelProps {
  /** Currently selected pool (null when panel is closed) */
  pool: Pool | null;
  /** Sharing groups for capacity display */
  sharingGroups: string[][];
  /** Callback when panel should close */
  onClose: () => void;
  /** Callback when a pool is selected (for navigating to shared pools) */
  onPoolSelect?: (poolName: string) => void;
  /** Currently selected platform (URL-synced) */
  selectedPlatform?: string | null;
  /** Callback when platform is selected */
  onPlatformSelect?: (platform: string | null) => void;
  /** Main content to render behind the panel (the table) */
  children: React.ReactNode;
}

// =============================================================================
// Component
// =============================================================================

/**
 * PoolPanelLayout - Pool-specific panel wrapper.
 *
 * Composes from ResizablePanel and adds pool-specific:
 * - PanelHeader with width presets
 * - PanelContent with quota, platforms, sharing info
 *
 * @example
 * ```tsx
 * <PoolPanelLayout
 *   pool={selectedPool}
 *   sharingGroups={sharingGroups}
 *   onClose={handleClose}
 * >
 *   <PoolsTable ... />
 * </PoolPanelLayout>
 * ```
 */
export function PoolPanelLayout({
  pool,
  sharingGroups,
  onClose,
  onPoolSelect,
  selectedPlatform,
  onPlatformSelect,
  children,
}: PoolPanelProps) {
  const panelWidth = usePoolsTableStore((s) => s.panelWidth);
  const setPanelWidth = usePoolsTableStore((s) => s.setPanelWidth);

  const handleWidthPreset = useCallback(
    (pct: number) => setPanelWidth(pct),
    [setPanelWidth]
  );

  return (
    <ResizablePanel
      open={!!pool}
      onClose={onClose}
      width={panelWidth}
      onWidthChange={setPanelWidth}
      mainContent={children}
      aria-label={pool ? `Pool details: ${pool.name}` : undefined}
      className="pools-panel"
    >
      {pool && (
        <>
          <PanelHeader pool={pool} onClose={onClose} onWidthPreset={handleWidthPreset} />
          <PanelContent
            pool={pool}
            sharingGroups={sharingGroups}
            onPoolSelect={onPoolSelect}
            selectedPlatform={selectedPlatform}
            onPlatformSelect={onPlatformSelect}
          />
        </>
      )}
    </ResizablePanel>
  );
}
