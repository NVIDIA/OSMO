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
 * Components Index
 *
 * Re-exports components from both generic DAG and workflow-specific modules.
 */

// Re-export generic components from @/components/dag
export {
  DAGControls,
  DAGErrorBoundary,
  FitViewOnLayoutChange,
  MiniMapNode,
  MINIMAP_COLORS,
  type DAGControlsProps,
  type FitViewOnLayoutChangeProps,
} from "@/components/dag";

// Workflow-specific components
export { GroupNode, nodeTypes } from "./GroupNode";

// Unified details panel
export { DetailsPanel, GroupDetails, TaskDetails } from "./DetailsPanel";
export type { DetailsPanelProps, DetailsPanelView } from "./DetailsPanel";
