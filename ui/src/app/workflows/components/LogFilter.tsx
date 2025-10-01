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
import { useMemo, useRef, useState } from "react";

import { Checkbox } from "~/components/Checkbox";
import { OutlinedIcon } from "~/components/Icon";
import { Select } from "~/components/Select";
import { SlideOut } from "~/components/SlideOut";
import { TextInput } from "~/components/TextInput";
import type { WorkflowResponse } from "~/models";

import { formatTaskID, formatTaskLabel, WORKFLOW_KEY } from "./TaskPicker";
import { ToolType } from "../hooks/useToolParamUpdater";

interface LogOption {
  label: string;
  data: LogParams;
}

interface LogFilterProps {
  workflow: WorkflowResponse;
  task?: string;
  tool: ToolType;
  fullLog: boolean;
  lines: number;
  onRefreshLines: (fullLog: boolean, lines: number) => void;
  onRefreshLog: (tool: ToolType, task?: string, retry_id?: number) => void;
  verbose?: boolean;
  retry_id?: number;
}

interface LogParams {
  task?: string;
  tool: ToolType;
  retry_id?: number;
}

const LogFilter = ({
  task,
  tool,
  fullLog,
  lines,
  onRefreshLines,
  onRefreshLog,
  workflow,
  verbose,
  retry_id,
}: LogFilterProps) => {
  const [localFullLog, setLocalFullLog] = useState(fullLog);
  const [localLines, setLocalLines] = useState(lines);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const options = useMemo(() => {
    const localOptions: Record<string, LogOption> = {};

    if (workflow.logs) {
      localOptions[formatTaskID(WORKFLOW_KEY, null, false)] = {
        label: "Workflow Logs",
        data: { tool: ToolType.WorkflowLogs, task },
      };
    }

    if (workflow.error_logs) {
      localOptions[formatTaskID(WORKFLOW_KEY, null, true)] = {
        label: "Workflow Error Logs",
        data: { tool: ToolType.WorkflowErrorLogs, task },
      };
    }

    workflow.groups.forEach((group) => {
      group.tasks.forEach((task) => {
        if (task.logs) {
          localOptions[formatTaskID(task.name, task.retry_id, false)] = {
            label: `Task Logs: ${formatTaskLabel(task.name, task.retry_id, verbose)}`,
            data: { tool: ToolType.TaskLogs, task: task.name, retry_id: task.retry_id ?? undefined },
          };
        }
        if (task.error_logs) {
          localOptions[formatTaskID(task.name, task.retry_id, true)] = {
            label: `Task Error Logs: ${formatTaskLabel(task.name, task.retry_id, verbose)}`,
            data: {
              tool: ToolType.TaskErrorLogs,
              task: task.name,
              retry_id: task.retry_id ?? undefined,
            },
          };
        }
      });
    });

    return localOptions;
  }, [task, workflow, verbose]);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOpen(false);
    onRefreshLines(localFullLog, localLines);
  };

  return (
    <>
      <Select
        id="log-select"
        aria-label="Logs"
        className="rounded-sm"
        value={formatTaskID(
          task ?? WORKFLOW_KEY,
          retry_id,
          tool === ToolType.WorkflowErrorLogs || tool === ToolType.TaskErrorLogs,
        )}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
          const key = e.target.value;
          const data = options[key]?.data;
          if (data) {
            onRefreshLog(data.tool, data.task, data.retry_id);
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
      <button
        ref={buttonRef}
        className={`btn btn-dropdown ${open ? "border-b-2 border-b-brand" : ""}`}
        onClick={() => {
          if (!open) {
            setOpen(true);
          }
        }}
      >
        Lines
        <OutlinedIcon name="keyboard_arrow_down" />
      </button>
      <SlideOut
        id="log-filter"
        open={open}
        onClose={() => setOpen(false)}
        position="left"
        top={(buttonRef.current?.getBoundingClientRect().height ?? 0) + 8}
        left={(buttonRef.current?.getBoundingClientRect().left ?? 20) - 20}
        className="p-3 rounded-md"
        dimBackground={false}
      >
        <form onSubmit={onSubmit}>
          <div className="flex flex-row gap-3">
            <div className="flex flex-row">
              <TextInput
                id="lines"
                value={localLines.toString()}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const num = Number(e.target.value);
                  if (!Number.isNaN(num)) setLocalLines(num);
                }}
                label="Lines"
                readOnly={localFullLog}
                helperText="Show last # lines"
              />
              <div className="flex flex-col items-end gap-1">
                <label htmlFor="fullLog">Full Log</label>
                <Checkbox
                  id="fullLog"
                  checked={localFullLog}
                  onChange={() => setLocalFullLog(!localFullLog)}
                  checkSize="large"
                />
              </div>
            </div>
            <button
              type="submit"
              className="btn btn-primary h-8 mt-4"
            >
              <OutlinedIcon name="refresh" />
              Refresh
            </button>
          </div>
        </form>
      </SlideOut>
    </>
  );
};

export default LogFilter;
