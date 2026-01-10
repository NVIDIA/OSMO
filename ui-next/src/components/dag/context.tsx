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
 * Generic DAG Context
 *
 * Provides handlers for node interactions without passing them through node data.
 * This prevents layout re-calculation when callbacks change.
 *
 * Consumers should extend this context with their domain-specific callbacks.
 */

"use client";

import { createContext, useContext, type ReactNode } from "react";

// ============================================================================
// Types
// ============================================================================

/**
 * Base DAG context value with generic callbacks.
 * Extend this interface for domain-specific needs.
 */
export interface DAGContextValue<TNodeData = unknown> {
  /** Called when a node is selected */
  onSelectNode: (nodeId: string, data: TNodeData) => void;
  /** Called when a node's expanded state is toggled */
  onToggleExpand: (nodeId: string) => void;
}

// ============================================================================
// Context
// ============================================================================

const DAGContext = createContext<DAGContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export interface DAGProviderProps<TNodeData = unknown> extends DAGContextValue<TNodeData> {
  children: ReactNode;
}

/**
 * Generic DAG provider component.
 *
 * @example
 * ```tsx
 * <DAGProvider
 *   onSelectNode={(id, data) => setSelectedNode(data)}
 *   onToggleExpand={(id) => toggleExpanded(id)}
 * >
 *   <ReactFlow nodes={nodes} edges={edges} />
 * </DAGProvider>
 * ```
 */
export function DAGProvider<TNodeData = unknown>({
  children,
  onSelectNode,
  onToggleExpand,
}: DAGProviderProps<TNodeData>) {
  return (
    <DAGContext.Provider value={{ onSelectNode: onSelectNode as DAGContextValue["onSelectNode"], onToggleExpand }}>
      {children}
    </DAGContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access DAG context.
 * Must be used within a DAGProvider.
 */
export function useDAGContext<TNodeData = unknown>(): DAGContextValue<TNodeData> {
  const context = useContext(DAGContext);
  if (!context) {
    throw new Error("useDAGContext must be used within a DAGProvider");
  }
  return context as DAGContextValue<TNodeData>;
}
