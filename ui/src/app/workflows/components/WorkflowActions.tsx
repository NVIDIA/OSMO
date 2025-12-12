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
import { useEffect, useState } from "react";

import Link from "next/link";

import { OutlinedIcon } from "~/components/Icon";
import { type WorkflowResponse } from "~/models";
import { useRuntimeEnv } from "~/runtime-env";

import { ToolType, type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

export default function WorkflowActions({
  workflow,
  className,
  updateUrl,
}: {
  workflow: WorkflowResponse;
  className?: string;
  updateUrl: (params: ToolParamUpdaterProps) => void;
}) {
  const runtimeEnv = useRuntimeEnv();
  const [submitUrl, setSubmitUrl] = useState<string>("");

  useEffect(() => {
    setSubmitUrl(
      `/workflows/submit/${workflow.name}?pool=${workflow.pool}${workflow.priority ? `&priority=${workflow.priority}` : ""}`,
    );
  }, [workflow]);

  const handleCancel = () => {
    updateUrl({ tool: ToolType.Cancel });
  };

  return (
    <div
      className={`dag-actions body-footer ${className}`}
      aria-label="Workflow Actions"
    >
      <div
        className="flex flex-col gap-1"
        role="list"
      >
        <button
          className="btn btn-action"
          onClick={() => updateUrl({ tool: ToolType.JSON })}
          role="listitem"
        >
          <OutlinedIcon name="data_object" />
          Workflow JSON
        </button>
        {workflow.logs && (
          <button
            className="btn btn-action"
            onClick={() => updateUrl({ tool: ToolType.WorkflowLogs })}
            role="listitem"
          >
            <OutlinedIcon name="assignment" />
            Logs
          </button>
        )}
        {workflow.error_logs && (
          <button
            className="btn btn-action"
            onClick={() => updateUrl({ tool: ToolType.WorkflowErrorLogs })}
            role="listitem"
          >
            <OutlinedIcon name="bug_report" />
            Error Logs
          </button>
        )}
        {workflow.events && (
          <button
            className="btn btn-action"
            onClick={() => updateUrl({ tool: ToolType.WorkflowEvents })}
            role="listitem"
          >
            <OutlinedIcon name="access_alarm" />
            Events
          </button>
        )}
        {workflow.spec && (
          <button
            className="btn btn-action"
            onClick={() => updateUrl({ tool: ToolType.Spec })}
            role="listitem"
          >
            <OutlinedIcon name="article" />
            Spec
          </button>
        )}
        {workflow.template_spec && (
          <button
            className="btn btn-action"
            onClick={() => updateUrl({ tool: ToolType.Template })}
            role="listitem"
          >
            <OutlinedIcon name="article" />
            Template
          </button>
        )}
      </div>
      <div
        className="flex flex-col gap-1"
        role="list"
      >
        {workflow.dashboard_url && (
          <Link
            className="btn btn-action"
            href={workflow.dashboard_url}
            role="listitem"
            target="_blank"
          >
            <OutlinedIcon name="cloud" />
            Dashboard
          </Link>
        )}
        {workflow.grafana_url && (
          <Link
            className="btn btn-action"
            href={workflow.grafana_url}
            target="_blank"
            role="listitem"
          >
            <OutlinedIcon name="analytics" />
            Resource Usage
          </Link>
        )}
        <Link
          className="btn btn-action"
          href={submitUrl}
          role="listitem"
        >
          <OutlinedIcon name="refresh" />
          Resubmit
        </Link>
        {(workflow.status == "PENDING" || workflow.status == "RUNNING" || workflow.status == "WAITING") && (
          <button
            className="btn btn-action"
            onClick={handleCancel}
            role="listitem"
          >
            <OutlinedIcon name="cancel" />
            Cancel
          </button>
        )}
        {workflow.status === "RUNNING" && (
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
