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
import { OutlinedIcon } from "~/components/Icon";
import { type Task } from "~/models";
import { useRuntimeEnv } from "~/runtime-env";

import { ToolType, type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

function getConvertedDashboardLink(dashboard_url: string): string {
  // Looks for a forward slash, followed by one or more characters that are not forward slashes, followed by a question mark.
  const regex = /\/([^\/]+)\?/;
  return dashboard_url.replace(regex, (match: string, taskName: string) => `/${taskName.replace(/_/g, "-")}?`);
}

export default function TaskActions({
  task,
  className,
  updateUrl,
}: {
  task: Task;
  className?: string;
  updateUrl: (params: ToolParamUpdaterProps) => void;
}) {
  const runtimeEnv = useRuntimeEnv();
  return (
    <div
      className={`dag-actions body-footer ${className}`}
      aria-label="Task Actions"
      id="task-actions-list"
    >
      <div
        className="flex flex-col gap-1"
        role="list"
        aria-labelledby="task-actions-list"
      >
        {task.logs && (
          <button
            className="btn btn-action"
            onClick={() => updateUrl({ tool: ToolType.TaskLogs })}
            role="listitem"
          >
            <OutlinedIcon name="assignment" />
            Task Logs
          </button>
        )}
        {task.error_logs && (
          <button
            className="btn btn-action"
            onClick={() => updateUrl({ tool: ToolType.TaskErrorLogs })}
            role="listitem"
          >
            <OutlinedIcon name="bug_report" />
            Task Error Logs
          </button>
        )}
        {task.events && (
          <button
            className="btn btn-action"
            onClick={() => updateUrl({ tool: ToolType.TaskEvents })}
            role="listitem"
          >
            <OutlinedIcon name="access_alarm" />
            Task Events
          </button>
        )}
      </div>
      <div
        className="flex flex-col gap-1"
        role="list"
        aria-labelledby="task-actions-list"
      >
        {task.dashboard_url && (
          <a
            href={getConvertedDashboardLink(task.dashboard_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-action"
            role="listitem"
          >
            <OutlinedIcon name="cloud" />
            Dashboard
          </a>
        )}
        {task.status == "RUNNING" && (
          <>
            <button
              className="btn btn-action"
              onClick={() => updateUrl({ tool: ToolType.ShellPicker })}
              role="listitem"
            >
              <OutlinedIcon name="keyboard_alt" />
              Shell
            </button>
            {runtimeEnv.PORT_FORWARD_ENABLED && (
              <button
                className="btn btn-action"
                onClick={() => updateUrl({ tool: ToolType.PortForwarding })}
                role="listitem"
              >
                <OutlinedIcon name="settings_remote" />
                Port Forwarding
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
