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
 * WorkflowTasksTab Component
 *
 * Embeds the WorkflowTableContent component in the Workflow panel's Tasks tab.
 * This provides a table view of all tasks within the workflow panel itself.
 */

"use client";

import { memo } from "react";
import type { WorkflowQueryResponse } from "@/lib/api/adapter";
import type { GroupWithLayout, TaskQueryResponse } from "../../../lib/workflow-types";
import { WorkflowTableContent } from "../../WorkflowTableContent";

export interface WorkflowTasksTabProps {
  workflow: WorkflowQueryResponse;
  groups: GroupWithLayout[];
  selectedGroupName: string | null;
  selectedTaskName: string | null;
  onSelectGroup: (group: GroupWithLayout) => void;
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
}

export const WorkflowTasksTab = memo(function WorkflowTasksTab({
  workflow,
  groups,
  selectedGroupName,
  selectedTaskName,
  onSelectGroup,
  onSelectTask,
}: WorkflowTasksTabProps) {
  return (
    <div className="h-full">
      <WorkflowTableContent
        workflow={workflow}
        groups={groups}
        selectedGroupName={selectedGroupName}
        selectedTaskName={selectedTaskName}
        onSelectGroup={onSelectGroup}
        onSelectTask={onSelectTask}
      />
    </div>
  );
});
