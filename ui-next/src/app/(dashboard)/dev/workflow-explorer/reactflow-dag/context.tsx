// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * DAG Context
 *
 * Provides handlers for node interactions without passing them through node data.
 * This prevents layout re-calculation when callbacks change.
 *
 * Navigation flow:
 * - onSelectGroup: Called when clicking a multi-task group node → Opens GroupPanel
 * - onSelectTask: Called when clicking a single-task node or task in GroupPanel → Opens DetailPanel
 * - onToggleExpand: Called when expanding/collapsing a group in the DAG view
 */

"use client";

import { createContext, useContext } from "react";
import type { TaskQueryResponse, GroupWithLayout } from "../workflow-types";

interface DAGContextValue {
  /** Called when clicking on a multi-task group node - opens GroupPanel */
  onSelectGroup: (group: GroupWithLayout) => void;
  /** Called when clicking on a single-task node or a task within GroupPanel - opens DetailPanel */
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  /** Called when expanding/collapsing a group in the DAG view */
  onToggleExpand: (groupId: string) => void;
}

const DAGContext = createContext<DAGContextValue | null>(null);

export function DAGProvider({
  children,
  onSelectGroup,
  onSelectTask,
  onToggleExpand,
}: DAGContextValue & { children: React.ReactNode }) {
  return (
    <DAGContext.Provider value={{ onSelectGroup, onSelectTask, onToggleExpand }}>
      {children}
    </DAGContext.Provider>
  );
}

export function useDAGContext() {
  const context = useContext(DAGContext);
  if (!context) {
    throw new Error("useDAGContext must be used within a DAGProvider");
  }
  return context;
}
