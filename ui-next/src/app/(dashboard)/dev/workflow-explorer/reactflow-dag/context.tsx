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
 */

"use client";

import { createContext, useContext } from "react";
import type { TaskQueryResponse, GroupWithLayout } from "../workflow-types";

interface DAGContextValue {
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  onToggleExpand: (groupId: string) => void;
}

const DAGContext = createContext<DAGContextValue | null>(null);

export function DAGProvider({
  children,
  onSelectTask,
  onToggleExpand,
}: DAGContextValue & { children: React.ReactNode }) {
  return <DAGContext.Provider value={{ onSelectTask, onToggleExpand }}>{children}</DAGContext.Provider>;
}

export function useDAGContext() {
  const context = useContext(DAGContext);
  if (!context) {
    throw new Error("useDAGContext must be used within a DAGProvider");
  }
  return context;
}
