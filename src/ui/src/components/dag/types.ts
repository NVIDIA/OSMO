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
 * Generic DAG Types
 *
 * Type definitions for the generic DAG visualization component.
 * These types are framework-agnostic and can be used with any domain data.
 */

// ============================================================================
// Layout Types
// ============================================================================

/** Layout direction for the DAG */
export type LayoutDirection = "TB" | "LR";

/** Node dimensions */
export interface NodeDimensions {
  width: number;
  height: number;
}

// ============================================================================
// Graph Input Types
// ============================================================================

/**
 * Input node for DAG layout calculation.
 * Represents a node before layout positioning.
 */
export interface DAGInputNode {
  /** Unique identifier */
  id: string;

  /** Display label */
  label: string;

  /** Node width in pixels */
  width: number;

  /** Node height in pixels */
  height: number;

  /** IDs of downstream/child nodes */
  downstreamIds: string[];

  /** Optional additional data to pass to the node */
  data?: Record<string, unknown>;
}

// ============================================================================
// Layout Result Types
// ============================================================================

/**
 * Position data returned from layout calculation.
 */
export interface LayoutPosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Result of pure layout calculation (positions only).
 */
export interface LayoutPositionResult {
  positions: Map<string, LayoutPosition>;
  dimensions: Map<string, NodeDimensions>;
}

// ============================================================================
// Edge Styling Types
// ============================================================================

/**
 * Edge style configuration.
 * Used for styling edges based on status or other criteria.
 */
export interface EdgeStyle {
  /** Stroke color */
  color: string;

  /** Stroke color for selected/hover state */
  strokeColor: string;

  /** Whether the edge should be animated */
  animated?: boolean;

  /** Whether the edge should be dashed */
  dashed?: boolean;
}
