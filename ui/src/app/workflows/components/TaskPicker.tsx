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
import { useMemo } from "react";

import { Select } from "~/components/Select";
import { type WorkflowResponse } from "~/models";

export interface TaskParams {
  task?: string | null;
  retry_id?: number;
}

interface TaskPickerProps {
  task?: string;
  retry_id?: number;
  onRefresh: (params: TaskParams) => void;
  workflow?: WorkflowResponse;
  suffix?: string;
  includeWorkflow?: boolean;
  includeBlank?: boolean;
  label?: string;
  errorText?: string;
  verbose?: boolean;
}

interface TaskOption {
  label: string;
  data: TaskParams;
}

// Make a unique key for a task, including the retry_id and whether it's an error task
export const formatTaskID = (task: string, retry_id?: number | null, isError?: boolean) => {
  const parts = [task];
  if (retry_id !== undefined && retry_id !== null) {
    parts.push(retry_id.toString());
  }
  if (isError) {
    parts.push("error");
  }
  return parts.join("-");
};

export const formatTaskLabel = (task: string, retry_id?: number | null, verbose?: boolean) => {
  return `${task}${verbose ? ` (retry ${retry_id})` : ""}`;
};

export const WORKFLOW_KEY = "workflow";

const TaskPicker = ({
  task,
  retry_id,
  onRefresh,
  workflow,
  suffix,
  includeWorkflow,
  includeBlank,
  label,
  errorText,
  verbose,
}: TaskPickerProps) => {
  const options = useMemo(() => {
    const localOptions: Record<string, TaskOption> = {};
    if (includeWorkflow) {
      localOptions[WORKFLOW_KEY] = {
        label: `Workflow ${suffix}`,
        data: { task: undefined },
      };
    } else if (includeBlank) {
      localOptions[WORKFLOW_KEY] = {
        label: "-- Select Task --",
        data: { task: undefined },
      };
    }

    workflow?.groups.forEach((group) => {
      group.tasks.forEach((task) => {
        const key = formatTaskID(task.name, task.retry_id);
        localOptions[key] = {
          label: `Task${suffix?.length ? ` ${suffix}` : ""}: ${formatTaskLabel(task.name, task.retry_id, verbose)}`,
          data: { task: task.name, retry_id: task.retry_id ?? undefined },
        };
      });
    });

    return localOptions;
  }, [workflow, includeWorkflow, suffix, includeBlank, verbose]);

  if (!workflow) {
    return null;
  }

  return (
    <Select
      id="task"
      value={task ? formatTaskID(task, retry_id) : WORKFLOW_KEY}
      className="rounded-sm"
      label={label}
      errorText={errorText}
      aria-label={label ?? "Task Picker"}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
        const key = e.target.value;
        const selectedOption = options[key];
        if (selectedOption?.data) {
          onRefresh(selectedOption.data);
        }
      }}
    >
      {Object.entries(options).map(([key, option]) => (
        <option
          key={key}
          value={key}
        >
          {option.label}
        </option>
      ))}
    </Select>
  );
};

export default TaskPicker;
