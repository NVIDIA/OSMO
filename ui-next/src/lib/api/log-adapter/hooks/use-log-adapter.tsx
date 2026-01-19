//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * useLogAdapter Hook
 *
 * Provides access to the log adapter instance.
 * Uses a singleton pattern for the default adapter.
 */

"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { LogAdapter } from "../types";
import { PlainTextAdapter, type PlainTextAdapterConfig } from "../adapters/plain-text-adapter";

// =============================================================================
// Singleton Adapter
// =============================================================================

let defaultAdapter: PlainTextAdapter | null = null;

/**
 * Gets or creates the default PlainTextAdapter.
 * Uses singleton pattern for shared caching across components.
 */
function getDefaultAdapter(): PlainTextAdapter {
  if (!defaultAdapter) {
    defaultAdapter = new PlainTextAdapter();
  }
  return defaultAdapter;
}

// =============================================================================
// Context
// =============================================================================

const LogAdapterContext = createContext<LogAdapter | null>(null);

/**
 * Props for LogAdapterProvider.
 */
export interface LogAdapterProviderProps {
  /** Custom adapter instance */
  adapter?: LogAdapter;
  /** Configuration for default PlainTextAdapter */
  config?: PlainTextAdapterConfig;
  /** Children */
  children: ReactNode;
}

/**
 * Provider for custom log adapter instances.
 * If no adapter is provided, uses the default PlainTextAdapter.
 *
 * @example
 * ```tsx
 * // Use default adapter
 * <LogAdapterProvider>
 *   <LogViewer workflowId="my-workflow" />
 * </LogAdapterProvider>
 *
 * // Use custom adapter (e.g., for testing)
 * <LogAdapterProvider adapter={mockAdapter}>
 *   <LogViewer workflowId="my-workflow" />
 * </LogAdapterProvider>
 * ```
 */
export function LogAdapterProvider({ adapter, config, children }: LogAdapterProviderProps): ReactNode {
  const value = useMemo(() => {
    if (adapter) return adapter;
    if (config) return new PlainTextAdapter(config);
    return getDefaultAdapter();
  }, [adapter, config]);

  return <LogAdapterContext.Provider value={value}>{children}</LogAdapterContext.Provider>;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access the log adapter.
 *
 * Returns the adapter from context if provided, otherwise returns the
 * default PlainTextAdapter singleton.
 *
 * @returns LogAdapter instance
 */
export function useLogAdapter(): PlainTextAdapter {
  const contextAdapter = useContext(LogAdapterContext);

  // If we have a context adapter that's a PlainTextAdapter, use it
  // Otherwise use the default singleton
  if (contextAdapter instanceof PlainTextAdapter) {
    return contextAdapter;
  }

  return getDefaultAdapter();
}

/**
 * Hook to access capabilities of the current adapter.
 *
 * @returns Adapter capabilities
 */
export function useLogAdapterCapabilities() {
  const adapter = useLogAdapter();
  return adapter.capabilities;
}
