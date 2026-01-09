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
import type { TaskQueryResponse, GroupWithLayout } from "./workflow-types";

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
  return <DAGContext.Provider value={{ onSelectGroup, onSelectTask, onToggleExpand }}>{children}</DAGContext.Provider>;
}

export function useDAGContext() {
  const context = useContext(DAGContext);
  if (!context) {
    throw new Error("useDAGContext must be used within a DAGProvider");
  }
  return context;
}
