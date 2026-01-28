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

/**
 * WorkflowTableView Component
 *
 * Table view for workflows with overlay panel using CSS Grid.
 * Grid creates two columns with explicit sizing (percentages when expanded, pixels when collapsed)
 * with panel overlaying table via z-index stacking. This preserves side-by-side resize math
 * while achieving visual overlay effect. Explicit sizing avoids circular dependency with auto columns.
 */

"use client";

import { memo, useRef } from "react";
import dynamic from "next/dynamic";
import { WorkflowTasksTable, DetailsPanel } from ".";
import { PANEL } from "@/components/panel";
import { usePanelProps } from "../hooks/use-panel-props";
import type { WorkflowViewCommonProps } from "../lib/view-types";

// Shell container is heavy (xterm.js), load dynamically
const ShellContainer = dynamic(() => import("./shell/ShellContainer").then((m) => ({ default: m.ShellContainer })), {
  ssr: false,
});

// =============================================================================
// Types
// =============================================================================

/**
 * Table view props use the common view props without DAG-specific additions.
 * Table view doesn't need panning, selectionKey, or expandPanel.
 */
export type WorkflowTableViewProps = WorkflowViewCommonProps;

// =============================================================================
// Component
// =============================================================================

export const WorkflowTableView = memo(function WorkflowTableView(props: WorkflowTableViewProps) {
  const { workflow, groups, selectedGroupName, selectedTaskName, onSelectGroup, onSelectTask, onPanelDraggingChange } =
    props;

  const containerRef = useRef<HTMLDivElement>(null);

  // Generate common panel props from view props
  const { panelProps, shellContainerProps } = usePanelProps({
    ...props,
    containerRef,
    className: "absolute inset-y-0 right-0 z-10",
  });

  // Reserve space for the edge strip to maintain consistent table layout
  // This prevents the table from jumping when the panel expands/collapses
  const tablePaddingRight = PANEL.COLLAPSED_WIDTH_PX;

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden bg-gray-50 dark:bg-zinc-950"
    >
      {/* Table - full width, lower z-index */}
      <main
        id="workflow-table"
        className="absolute inset-0 overflow-hidden"
        style={{
          paddingRight: `${tablePaddingRight}px`,
          zIndex: 0,
        }}
        role="main"
        aria-label="Workflow tasks table"
      >
        <WorkflowTasksTable
          workflow={workflow}
          groups={groups}
          onSelectGroup={onSelectGroup}
          onSelectTask={onSelectTask}
          selectedGroupName={selectedGroupName ?? undefined}
          selectedTaskName={selectedTaskName ?? undefined}
        />
      </main>

      {/* Panel - positioned on right side */}
      <DetailsPanel
        {...panelProps}
        onDraggingChange={onPanelDraggingChange}
      />

      {/* Shell Container - renders shells, portals into TaskDetails */}
      {shellContainerProps && <ShellContainer {...shellContainerProps} />}
    </div>
  );
});
