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
import { useState } from "react";

import { InlineBanner } from "~/components/InlineBanner";
import { Select } from "~/components/Select";
import { TextInput } from "~/components/TextInput";
import { type WorkflowResponse } from "~/models/workflows-model";

import { ToolType, type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

export const ShellPicker = ({
  workflow,
  selectedTask,
  entryCommand = "/bin/bash",
  updateUrl,
}: {
  workflow: WorkflowResponse;
  selectedTask?: string;
  entryCommand?: string;
  updateUrl: (params: ToolParamUpdaterProps) => void;
}) => {
  const [task, setTask] = useState<string | undefined>(selectedTask ?? workflow.groups[0]?.tasks[0]?.name);
  const [cmd, setCmd] = useState<string | undefined>(entryCommand);
  const [cmdError, setCmdError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    setError(undefined);
    setCmdError(undefined);

    if (!cmd) {
      setCmdError("Command is required");
      return;
    }

    if (!task) {
      return;
    }

    updateUrl({ tool: ToolType.Shell, task, entry_command: cmd });
  };

  if (!task) {
    return null;
  }

  return (
    <div className="flex flex-col h-full w-full">
      <InlineBanner status={error ? "error" : "none"}>{error}</InlineBanner>
      <form onSubmit={handleSubmit}>
        <div className="flex flex-row gap-global p-global">
          <Select
            id="task"
            value={task}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              setTask(e.target.value);
              setError(undefined);
            }}
            label="Task"
          >
            {workflow.groups.map((group) =>
              group.tasks.map((task) => (
                <option
                  key={task.name}
                  value={task.name}
                >
                  {task.name}
                </option>
              )),
            )}
          </Select>
          <TextInput
            id="command"
            label="Command"
            value={cmd ?? ""}
            type="text"
            className="w-32"
            onChange={(e) => {
              setCmd(e.target.value);
              setCmdError(undefined);
              setError(undefined);
            }}
            errorText={cmdError}
          />
          <button
            className="btn btn-primary mt-5 mb-5"
            type="submit"
          >
            Start
          </button>
        </div>
      </form>
    </div>
  );
};
