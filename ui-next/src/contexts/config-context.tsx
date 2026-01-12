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
 * Configuration Context
 *
 * Provides centralized, injectable configuration for UI components.
 * This enables dependency injection for layout constants, making
 * components more testable and allowing configuration overrides.
 *
 * ## Why Use This?
 *
 * 1. **Testability** - Override configs in tests without mocking imports
 * 2. **Flexibility** - Different configs per section of the app if needed
 * 3. **Discoverability** - Single source for all configuration
 *
 * ## Usage
 *
 * ```tsx
 * // Access config in any component
 * const { table, panel, viewport } = useConfig();
 *
 * // In tests, provide custom config
 * <ConfigContext.Provider value={testConfig}>
 *   <MyComponent />
 * </ConfigContext.Provider>
 * ```
 */

"use client";

import { createContext, useContext, type ReactNode } from "react";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";

// =============================================================================
// Types
// =============================================================================

export interface TableConfig {
  /** Standard row heights in pixels */
  rowHeights: {
    normal: number;
    compact: number;
    compactSm: number;
    section: number;
    header: number;
  };
}

export interface PanelConfig {
  /** Width presets for snap-to menu (percentage) */
  widthPresets: readonly number[];
  /** Minimum panel width (percentage of container) */
  minWidthPct: number;
  /** Maximum panel width (percentage of container) */
  maxWidthPct: number;
  /** Default panel width (percentage of container) */
  defaultWidthPct: number;
  /** Width of collapsed panel strip (pixels) */
  collapsedWidthPx: number;
}

export interface ViewportConfig {
  /** Default zoom level */
  defaultZoom: number;
  /** Initial zoom when centering on node */
  initialZoom: number;
  /** Maximum zoom level */
  maxZoom: number;
  /** Minimum zoom level */
  minZoom: number;
}

export interface TimingConfig {
  /** Copy feedback duration (ms) */
  copyFeedbackMs: number;
  /** Query stale time (ms) */
  queryStaleTimeMs: number;
}

export interface AppConfig {
  /** Table configuration */
  table: TableConfig;
  /** Panel configuration */
  panel: PanelConfig;
  /** DAG viewport configuration */
  viewport: ViewportConfig;
  /** Timing configuration */
  timing: TimingConfig;
}

// =============================================================================
// Default Configuration
// =============================================================================

const defaultConfig: AppConfig = {
  table: {
    rowHeights: {
      normal: TABLE_ROW_HEIGHTS.NORMAL,
      compact: TABLE_ROW_HEIGHTS.COMPACT,
      compactSm: TABLE_ROW_HEIGHTS.COMPACT_SM,
      section: TABLE_ROW_HEIGHTS.SECTION,
      header: TABLE_ROW_HEIGHTS.HEADER,
    },
  },
  panel: {
    widthPresets: [33, 50, 75] as const,
    minWidthPct: 20,
    maxWidthPct: 80,
    defaultWidthPct: 50,
    collapsedWidthPx: 40,
  },
  viewport: {
    defaultZoom: 0.8,
    initialZoom: 1.0,
    maxZoom: 1.5,
    minZoom: 0.1,
  },
  timing: {
    copyFeedbackMs: 2000,
    queryStaleTimeMs: 60 * 1000, // 1 minute
  },
};

// =============================================================================
// Context
// =============================================================================

export const ConfigContext = createContext<AppConfig>(defaultConfig);

/**
 * Access the application configuration.
 *
 * @returns The current AppConfig from context
 *
 * @example
 * ```tsx
 * function MyTable() {
 *   const { table } = useConfig();
 *   return <div style={{ height: table.rowHeights.normal }}>Row</div>;
 * }
 * ```
 */
export function useConfig(): AppConfig {
  return useContext(ConfigContext);
}

// =============================================================================
// Provider
// =============================================================================

export interface ConfigProviderProps {
  children: ReactNode;
  /** Override specific config values */
  config?: Partial<AppConfig>;
}

/**
 * Configuration provider component.
 *
 * Wraps children with app configuration context. Merges any overrides
 * with the default configuration.
 */
export function ConfigProvider({ children, config }: ConfigProviderProps) {
  // Deep merge overrides with defaults
  const mergedConfig: AppConfig = config
    ? {
        table: { ...defaultConfig.table, ...config.table },
        panel: { ...defaultConfig.panel, ...config.panel },
        viewport: { ...defaultConfig.viewport, ...config.viewport },
        timing: { ...defaultConfig.timing, ...config.timing },
      }
    : defaultConfig;

  return <ConfigContext.Provider value={mergedConfig}>{children}</ConfigContext.Provider>;
}

// =============================================================================
// Exports
// =============================================================================

export { defaultConfig };
