//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import { useCallback } from "react";

import { type Task, type WorkflowResponse } from "~/models";
import { checkExhaustive } from "~/utils/common";

import LogFilter from "./LogFilter";
import TaskPicker from "./TaskPicker";
import { ToolType, type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

interface FullPageModalHeadingProps {
  workflow: WorkflowResponse;
  tool?: ToolType;
  selectedTask?: Task;
  fullLog: boolean;
  lines: number;
  verbose?: boolean;
  updateUrl: (params: ToolParamUpdaterProps) => void;
}

const FullPageModalHeading = ({
  workflow,
  tool,
  selectedTask,
  fullLog,
  lines,
  verbose,
  updateUrl,
}: FullPageModalHeadingProps): JSX.Element | string => {
  const onRefreshLines = useCallback(
    (newFullLog: boolean, newLines: number) => {
      updateUrl({
        fullLog: newFullLog,
        lines: newLines,
      });
    },
    [updateUrl],
  );

  const onRefreshLog = useCallback(
    (newTool: ToolType, task?: string, retry_id?: number) => {
      updateUrl({
        tool: newTool,
        task,
        retry_id,
      });
    },
    [updateUrl],
  );

  if (!tool) {
    return "";
  }

  switch (tool) {
    case ToolType.TaskLogs:
    case ToolType.TaskErrorLogs:
    case ToolType.WorkflowLogs:
    case ToolType.WorkflowErrorLogs:
      return (
        <LogFilter
          workflow={workflow}
          task={tool === ToolType.TaskLogs || tool === ToolType.TaskErrorLogs ? selectedTask?.name : undefined}
          tool={tool}
          fullLog={fullLog}
          lines={lines}
          onRefreshLines={onRefreshLines}
          onRefreshLog={onRefreshLog}
          verbose={verbose}
          retry_id={selectedTask?.retry_id ?? undefined}
        />
      );

    case ToolType.Spec:
      return <h2>Workflow Spec</h2>;

    case ToolType.Template:
      return <h2>Workflow Template Spec</h2>;

    case ToolType.Shell:
    case ToolType.ShellPicker:
      return <h2>{selectedTask?.name ?? "Shell"}</h2>;

    case ToolType.JSON:
      return <h2>Workflow JSON</h2>;

    case ToolType.TaskEvents:
    case ToolType.WorkflowEvents:
      return (
        <TaskPicker
          includeWorkflow
          task={tool === ToolType.TaskEvents ? selectedTask?.name : undefined}
          retry_id={selectedTask?.retry_id ?? undefined}
          onRefresh={(params) => {
            if (params.task) {
              updateUrl({ ...params, tool: ToolType.TaskEvents });
            } else {
              updateUrl({ tool: ToolType.WorkflowEvents, retry_id: null });
            }
          }}
          workflow={workflow}
          suffix="Events"
          verbose={verbose}
        />
      );

    case ToolType.Outputs:
      return <h2>Workflow Outputs</h2>;

    case ToolType.Nodes:
      return <h2>{selectedTask?.node_name ?? "Node Details"}</h2>;

    case ToolType.PortForwarding:
      return <h2>Port Forwarding</h2>;

    case ToolType.Cancel:
      return <h2>Cancel Workflow</h2>;

    default:
      checkExhaustive(tool);
      return <h2>Workflow Details</h2>;
  }
};

export default FullPageModalHeading;
