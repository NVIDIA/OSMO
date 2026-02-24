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

"use client";

import { memo } from "react";
import { PanelHeader, PanelTitle } from "@/components/panel/panel-header";
import { WorkflowDetails } from "@/features/workflows/detail/components/panel/ui/workflow/workflow-details";
import { GroupDetails } from "@/features/workflows/detail/components/panel/ui/group/group-details";
import { TaskDetails } from "@/features/workflows/detail/components/panel/ui/task/task-details";
import type { DetailsPanelProps } from "@/features/workflows/detail/components/panel/core/lib/panel-types";

type PanelViewContentProps = Pick<
  DetailsPanelProps,
  | "view"
  | "workflow"
  | "group"
  | "allGroups"
  | "task"
  | "onBackToGroup"
  | "onBackToWorkflow"
  | "onSelectTask"
  | "onSelectGroup"
  | "onShellTabChange"
  | "selectedTab"
  | "setSelectedTab"
  | "selectedWorkflowTab"
  | "setSelectedWorkflowTab"
  | "selectedGroupTab"
  | "setSelectedGroupTab"
  | "onCancelWorkflow"
  | "onResubmitWorkflow"
  | "isDetailsExpanded"
  | "onToggleDetailsExpanded"
  | "fallbackContent"
>;

export const PanelViewContent = memo(function PanelViewContent({
  view,
  workflow,
  group,
  allGroups,
  task,
  onBackToGroup,
  onBackToWorkflow,
  onSelectTask,
  onSelectGroup,
  onShellTabChange,
  selectedTab,
  setSelectedTab,
  selectedWorkflowTab,
  setSelectedWorkflowTab,
  selectedGroupTab,
  setSelectedGroupTab,
  onCancelWorkflow,
  onResubmitWorkflow,
  isDetailsExpanded,
  onToggleDetailsExpanded,
  fallbackContent,
}: PanelViewContentProps) {
  return (
    <>
      {view === "workflow" && workflow && (
        <WorkflowDetails
          workflow={workflow}
          onCancel={onCancelWorkflow}
          onResubmit={onResubmitWorkflow}
          isDetailsExpanded={isDetailsExpanded}
          onToggleDetailsExpanded={onToggleDetailsExpanded}
          selectedTab={selectedWorkflowTab}
          setSelectedTab={setSelectedWorkflowTab}
          allGroups={allGroups}
          selectedGroupName={group?.name ?? null}
          selectedTaskName={task?.name ?? null}
          onSelectGroup={onSelectGroup}
          onSelectTask={onSelectTask}
        />
      )}

      {view === "group" && group && (
        <GroupDetails
          group={group}
          allGroups={allGroups}
          workflowName={workflow?.name}
          onSelectTask={onSelectTask}
          onSelectGroup={onSelectGroup}
          onBack={onBackToWorkflow}
          selectedGroupTab={selectedGroupTab}
          setSelectedGroupTab={setSelectedGroupTab}
        />
      )}

      {view === "task" && task && group && (
        <TaskDetails
          group={group}
          allGroups={allGroups}
          task={task}
          workflowName={workflow?.name}
          onBackToGroup={onBackToGroup}
          onBackToWorkflow={onBackToWorkflow}
          onSelectTask={onSelectTask}
          onSelectGroup={onSelectGroup}
          onShellTabChange={onShellTabChange}
          selectedTab={selectedTab}
          setSelectedTab={setSelectedTab}
        />
      )}

      {fallbackContent && (
        <>
          <PanelHeader title={<PanelTitle>{workflow?.name ?? "Workflow Details"}</PanelTitle>} />
          {fallbackContent}
        </>
      )}
    </>
  );
});
