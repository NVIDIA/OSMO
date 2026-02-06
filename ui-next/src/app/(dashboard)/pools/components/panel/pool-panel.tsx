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
 * PoolPanelLayout Component
 *
 * Pool-specific overlay panel for pool details.
 * Composes from generic ResizablePanel component.
 */

"use client";

import { useCallback, useMemo } from "react";
import type { Pool } from "@/lib/api/adapter/types";
import { PANEL } from "@/components/panel/panel-header-controls";
import { ResizablePanel } from "@/components/panel/resizable-panel";
import { usePoolsTableStore } from "../../stores/pools-table-store";
import { PoolPanelHeader } from "./panel-header";
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
  const storedPanelWidth = usePoolsTableStore((s) => s.panelWidth);
  const setPanelWidth = usePoolsTableStore((s) => s.setPanelWidth);

  // Clamp panel width to max 80% (stored value might be > 80% from before the constraint was added)
  const panelWidth = useMemo(() => Math.min(storedPanelWidth, PANEL.OVERLAY_MAX_WIDTH_PCT), [storedPanelWidth]);

  const handleWidthPreset = useCallback((pct: number) => setPanelWidth(pct), [setPanelWidth]);

  return (
    <ResizablePanel
      open={!!pool}
      onClose={onClose}
      width={panelWidth}
      onWidthChange={setPanelWidth}
      minWidth={PANEL.MIN_WIDTH_PCT}
      maxWidth={PANEL.OVERLAY_MAX_WIDTH_PCT}
      mainContent={children}
      backdrop={false}
      aria-label={pool ? `Pool details: ${pool.name}` : undefined}
      className="pools-panel"
    >
      {pool && (
        <>
          <PoolPanelHeader
            pool={pool}
            onClose={onClose}
            onWidthPreset={handleWidthPreset}
          />
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
