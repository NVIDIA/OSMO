/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * ResourcePanelLayout Component
 *
 * Overlay panel for resource details using the shared ResizablePanel component.
 * Handles resource-specific content rendering and state management.
 */

"use client";

import { useCallback } from "react";
import type { Resource } from "@/lib/api/adapter";
import { ResizablePanel } from "@/components/resizable-panel";
import { useResourcesTableStore } from "../../stores/resources-table-store";
import { PANEL } from "../../lib/constants";
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
  const panelWidth = useResourcesTableStore((s) => s.panelWidth);
  const setPanelWidth = useResourcesTableStore((s) => s.setPanelWidth);

  const handleWidthPreset = useCallback((pct: number) => setPanelWidth(pct), [setPanelWidth]);

  return (
    <ResizablePanel
      open={!!resource}
      onClose={onClose}
      width={panelWidth}
      onWidthChange={setPanelWidth}
      minWidth={PANEL.MIN_WIDTH_PCT}
      maxWidth={PANEL.MAX_WIDTH_PCT}
      mainContent={children}
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
