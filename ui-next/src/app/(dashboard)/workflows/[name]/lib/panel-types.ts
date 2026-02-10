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

import type { WorkflowQueryResponse } from "@/lib/api/adapter/types";
import type { TaskQueryResponse, GroupWithLayout } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";
import type { TaskTab, WorkflowTab, GroupTab } from "@/app/(dashboard)/workflows/[name]/hooks/use-navigation-state";
import type { RefreshControlProps } from "@/components/refresh/types";

export type DetailsPanelView = "workflow" | "group" | "task";

export interface DetailsPanelProps {
  view: DetailsPanelView;
  workflow?: WorkflowQueryResponse;
  group: GroupWithLayout | null;
  allGroups: GroupWithLayout[];
  task: TaskQueryResponse | null;
  onBackToGroup: () => void;
  onBackToWorkflow: () => void;
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  onSelectGroup?: (group: GroupWithLayout) => void;
  panelPct: number;
  onPanelResize: (pct: number) => void;
  isDetailsExpanded: boolean;
  onToggleDetailsExpanded: () => void;
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** react-hotkeys-hook syntax: mod = Cmd on Mac, Ctrl on Windows/Linux */
  toggleHotkey?: string;
  onCancelWorkflow?: () => void;
  onResubmitWorkflow?: () => void;
  /** Loading skeletons, error states, etc. */
  fallbackContent?: React.ReactNode;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  onDraggingChange?: (isDragging: boolean) => void;
  onShellTabChange?: (taskName: string | null) => void;
  selectedTab?: TaskTab;
  setSelectedTab?: (tab: TaskTab) => void;
  selectedWorkflowTab?: WorkflowTab;
  setSelectedWorkflowTab?: (tab: WorkflowTab) => void;
  selectedGroupTab?: GroupTab;
  setSelectedGroupTab?: (tab: GroupTab) => void;
  minWidth?: number;
  /** Takes precedence over minWidth percentage when set */
  minWidthPx?: number;
  maxWidth?: number;
  className?: string;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** When true, panel fills its grid cell instead of using percentage width */
  fillContainer?: boolean;
  /** Terminal workflows show manual-only refresh (no interval selector) */
  isTerminal?: boolean;
  autoRefresh?: RefreshControlProps;
}

export interface GroupDetailsProps {
  group: GroupWithLayout;
  allGroups: GroupWithLayout[];
  workflowName?: string;
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  onSelectGroup?: (group: GroupWithLayout) => void;
  selectedGroupTab?: GroupTab;
  setSelectedGroupTab?: (tab: GroupTab) => void;
}

export interface TaskDetailsProps {
  group: GroupWithLayout;
  task: TaskQueryResponse;
  workflowName?: string;
  onBackToGroup: () => void;
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  selectedTab?: TaskTab;
  setSelectedTab?: (tab: TaskTab) => void;
}

export type HeaderViewType = "workflow" | "group" | "task";

export interface SiblingTask {
  name: string;
  retryId: number;
  status: string;
  isCurrent: boolean;
  isLead?: boolean;
}

export interface BreadcrumbSegment {
  label: string;
  onClick: () => void;
}

export interface DetailsPanelHeaderProps {
  title: string;
  subtitle?: string;
  statusContent?: React.ReactNode;
  breadcrumbs?: BreadcrumbSegment[];
  onPanelResize?: (pct: number) => void;
  menuContent?: React.ReactNode;
  actions?: React.ReactNode;
  viewType?: HeaderViewType;
  isLead?: boolean;
  siblingTasks?: SiblingTask[];
  onSelectSibling?: (name: string, retryId: number) => void;
  expandableContent?: React.ReactNode;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}
