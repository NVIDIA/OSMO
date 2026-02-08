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
 * Workflow DAG Context
 *
 * Workflow-specific DAG context that extends the generic DAG context.
 * Provides handlers for workflow group and task interactions.
 */

"use client";

import { createContext, useContext, useMemo } from "react";
import { useEventCallback } from "usehooks-ts";
import type { TaskQueryResponse, GroupWithLayout } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";

// ============================================================================
// Workflow-Specific Context
// ============================================================================

interface WorkflowDAGContextValue {
  /** Currently selected node ID (group name) - for visual selection state */
  selectedNodeId: string | null;
  /** Called when clicking on a multi-task group node - opens GroupPanel */
  onSelectGroup: (group: GroupWithLayout) => void;
  /** Called when clicking on a single-task node or a task within GroupPanel - opens DetailPanel */
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  /** Called when expanding/collapsing a group in the DAG view */
  onToggleExpand: (groupId: string) => void;
}

const WorkflowDAGContext = createContext<WorkflowDAGContextValue | null>(null);

/** Props for DAGProvider - separates state from callbacks */
interface DAGProviderProps {
  children: React.ReactNode;
  /** Currently selected node ID (group name) - for visual selection state */
  selectedNodeId?: string | null;
  /** Called when clicking on a multi-task group node */
  onSelectGroup: (group: GroupWithLayout) => void;
  /** Called when clicking on a single-task node or a task within GroupPanel */
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  /** Called when expanding/collapsing a group */
  onToggleExpand: (groupId: string) => void;
}

/**
 * DAGProvider - Provides workflow-specific DAG handlers to child components.
 *
 * Performance optimizations:
 * - Callbacks are stabilized with useEventCallback to prevent stale closures
 * - Context value is memoized to prevent unnecessary re-renders
 */
export function DAGProvider({
  children,
  selectedNodeId = null,
  onSelectGroup,
  onSelectTask,
  onToggleExpand,
}: DAGProviderProps) {
  // Stabilize callbacks to prevent context value from changing
  const stableOnSelectGroup = useEventCallback(onSelectGroup);
  const stableOnSelectTask = useEventCallback(onSelectTask);
  const stableOnToggleExpand = useEventCallback(onToggleExpand);

  // Memoize context value - include selectedNodeId for selection state
  const value = useMemo<WorkflowDAGContextValue>(
    () => ({
      selectedNodeId,
      onSelectGroup: stableOnSelectGroup,
      onSelectTask: stableOnSelectTask,
      onToggleExpand: stableOnToggleExpand,
    }),
    [selectedNodeId, stableOnSelectGroup, stableOnSelectTask, stableOnToggleExpand],
  );

  return <WorkflowDAGContext.Provider value={value}>{children}</WorkflowDAGContext.Provider>;
}

export function useDAGContext() {
  const context = useContext(WorkflowDAGContext);
  if (!context) {
    throw new Error("useDAGContext must be used within a DAGProvider");
  }
  return context;
}

// Re-export types for convenience
export type { WorkflowDAGContextValue as DAGContextValue };
