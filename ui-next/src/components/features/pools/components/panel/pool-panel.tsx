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

import { useCallback } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { Pool } from "@/lib/api/adapter";
import { usePoolsTableStore } from "../../stores/pools-table-store";
import { PanelHeader } from "./panel-header";
import { PanelContent } from "./panel-content";

export interface PoolPanelProps {
  pool: Pool | null;
  sharingGroups: string[][];
  onClose: () => void;
  children: React.ReactNode;
}

export function PoolPanelLayout({ pool, sharingGroups, onClose, children }: PoolPanelProps) {
  const panelWidth = usePoolsTableStore((s) => s.panelWidth);
  const setPanelWidth = usePoolsTableStore((s) => s.setPanelWidth);

  const handleLayoutChange = useCallback(
    (layout: Record<string, number>) => {
      const detailsSize = layout["details"];
      if (detailsSize !== undefined && detailsSize !== panelWidth) {
        setPanelWidth(detailsSize);
      }
    },
    [panelWidth, setPanelWidth],
  );

  const handleWidthPreset = useCallback((pct: number) => setPanelWidth(pct), [setPanelWidth]);

  if (!pool) {
    return <div className="h-full w-full">{children}</div>;
  }

  return (
    <Group
      orientation="horizontal"
      id="pools-panel-layout"
      onLayoutChange={handleLayoutChange}
      defaultLayout={{ main: 100 - panelWidth, details: panelWidth }}
      className="h-full w-full"
    >
      <Panel id="main" minSize="30%">
        {children}
      </Panel>

      <Separator className="w-1 bg-zinc-200 transition-colors hover:bg-blue-500 data-[active]:bg-blue-500 dark:bg-zinc-700 dark:hover:bg-blue-500" />

      <Panel id="details" minSize="20%" maxSize="80%" defaultSize={`${panelWidth}%`}>
        <aside className="pools-panel flex h-full flex-col border-l border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
          <PanelHeader pool={pool} onClose={onClose} onWidthPreset={handleWidthPreset} />
          <PanelContent pool={pool} sharingGroups={sharingGroups} />
        </aside>
      </Panel>
    </Group>
  );
}
