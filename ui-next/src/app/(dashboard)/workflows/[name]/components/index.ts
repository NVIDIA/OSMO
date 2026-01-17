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
 * Route-level components for the workflow detail page.
 * Organized into dag/ (DAG visualization) and panel/ (details panels).
 */

// DAG components
export {
  GroupNode,
  nodeTypes,
  DAGProvider,
  useDAGContext,
  DAGControls,
  DAGErrorBoundary,
  MiniMapNode,
  MINIMAP_COLORS,
  type DAGContextValue,
  type DAGControlsProps,
} from "./dag";

// Panel components
export {
  DetailsPanel,
  WorkflowDetails,
  GroupDetails,
  TaskDetails,
  DetailsPanelHeader,
  GroupTimeline,
  TaskTimeline,
  DependencyPills,
  type DetailsPanelProps,
  type DetailsPanelView,
  type GroupDetailsProps,
  type TaskDetailsProps,
  type DetailsPanelHeaderProps,
} from "./panel";

// Shell components
export {
  ShellContainer,
  ShellPortalProvider,
  ShellProvider,
  useShellPortal,
  useShellContext,
  type ShellContainerProps,
  type ActiveShell,
} from "./shell";
