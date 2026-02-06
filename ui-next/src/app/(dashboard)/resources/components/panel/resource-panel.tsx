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
 * ResourcePanelLayout Component
 *
 * Overlay panel for resource details using the shared ResizablePanel component.
 * Handles resource-specific content rendering and state management.
 */

"use client";

import { useCallback, useMemo } from "react";
import type { Resource } from "@/lib/api/adapter/types";
import { PANEL } from "@/components/panel/panel-header-controls";
import { ResizablePanel } from "@/components/panel/resizable-panel";
import { useResourcesTableStore } from "../../stores/resources-table-store";
import { ResourcePanelHeader } from "./panel-header";
import { ResourcePanelContent } from "./panel-content";

export interface ResourcePanelLayoutProps {
  resource: Resource | null;
  onClose: () => void;
  /** Currently selected pool for config tab (URL-synced) */
  selectedPool?: string | null;
  /** Callback when pool tab is selected */
  onPoolSelect?: (pool: string | null) => void;
  children: React.ReactNode;
}

export function ResourcePanelLayout({
  resource,
  onClose,
  selectedPool,
  onPoolSelect,
  children,
}: ResourcePanelLayoutProps) {
  const storedPanelWidth = useResourcesTableStore((s) => s.panelWidth);
  const setPanelWidth = useResourcesTableStore((s) => s.setPanelWidth);

  // Clamp panel width to max 80% (stored value might be > 80% from before the constraint was added)
  const panelWidth = useMemo(() => Math.min(storedPanelWidth, PANEL.OVERLAY_MAX_WIDTH_PCT), [storedPanelWidth]);

  const handleWidthPreset = useCallback((pct: number) => setPanelWidth(pct), [setPanelWidth]);

  return (
    <ResizablePanel
      open={!!resource}
      onClose={onClose}
      width={panelWidth}
      onWidthChange={setPanelWidth}
      minWidth={PANEL.MIN_WIDTH_PCT}
      maxWidth={PANEL.OVERLAY_MAX_WIDTH_PCT}
      mainContent={children}
      backdrop={false}
      aria-label={resource ? `Resource details: ${resource.name}` : undefined}
    >
      {resource && (
        <>
          <ResourcePanelHeader
            resource={resource}
            onClose={onClose}
            onWidthPreset={handleWidthPreset}
          />
          <ResourcePanelContent
            resource={resource}
            selectedPool={selectedPool}
            onPoolSelect={onPoolSelect}
          />
        </>
      )}
    </ResizablePanel>
  );
}
