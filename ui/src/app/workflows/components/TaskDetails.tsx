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
import React from "react";

import Link from "next/link";

import { FilledIcon, OutlinedIcon } from "~/components/Icon";
import { Colors, Tag } from "~/components/Tag";
import { type Task } from "~/models";
import { useRuntimeEnv } from "~/runtime-env";
import { calcDuration, convertToReadableTimezone } from "~/utils/string";

import TaskActions from "./TaskActions";
import TaskStatusInfo from "./TaskStatusInfo";
import { type ToolParamUpdaterProps, ToolType } from "../hooks/useToolParamUpdater";

interface TaskDetailsProps {
  task: Task;
  updateUrl: (params: ToolParamUpdaterProps) => void;
  extraData?: Record<string, React.ReactNode>;
  hasNavigation?: boolean;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
}

const TaskDetails = ({
  task,
  updateUrl,
  extraData,
  hasNavigation,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
}: TaskDetailsProps) => {
  const runtimeEnv = useRuntimeEnv();
  const [processingDuration, setProcessingDuration] = useState<string | undefined>(undefined);
  const [schedulingDuration, setSchedulingDuration] = useState<string | undefined>(undefined);
  const [initializingDuration, setInitializingDuration] = useState<string | undefined>(undefined);
  const [runningDuration, setRunningDuration] = useState<string | undefined>(undefined);

  useEffect(() => {
    setProcessingDuration(calcDuration(task?.processing_start_time, task?.scheduling_start_time));
    setSchedulingDuration(calcDuration(task?.scheduling_start_time, task?.initializing_start_time));
    setInitializingDuration(calcDuration(task?.initializing_start_time, task?.start_time ?? task?.end_time));
    setRunningDuration(calcDuration(task?.start_time, task?.end_time));
  }, [task]);

  return (
    <div className="h-full w-full flex flex-col">
      <div className="body-header flex flex-row items-center justify-between">
        {!hasNavigation ? (
          <p className="font-semibold p-global text-center w-full">{task.name}</p>
        ) : (
          <>
            <button
              className="no-underline p-0 m-1"
              onClick={() => {
                if (hasPrevious) {
                  onPrevious?.();
                }
              }}
              title="Previous Task"
              aria-disabled={!hasPrevious}
            >
              <OutlinedIcon
                name="keyboard_double_arrow_left"
                className="text-lg!"
              />
            </button>
            <p className="font-semibold">{task.name}</p>
            <button
              className="no-underline p-0 m-1"
              onClick={() => {
                if (hasNext) {
                  onNext?.();
                }
              }}
              title="Next Task"
              aria-disabled={!hasNext}
            >
              <OutlinedIcon
                name="keyboard_double_arrow_right"
                className="text-lg!"
              />
            </button>
          </>
        )}
      </div>
      <div className="p-global w-full flex flex-col grow">
        <dl aria-label={task.name}>
          <dt>Status</dt>
          <dd>
            <TaskStatusInfo status={task.status} />
          </dd>
          <dt>Lead</dt>
          <dd>{task.lead ? "True" : "False"}</dd>
          {task.retry_id !== null && (
            <>
              <dt>Retry ID</dt>
              <dd>{task.retry_id}</dd>
            </>
          )}
          {task.node_name && (
            <>
              <dt>Node</dt>
              <dd>
                <button
                  className="tag-container"
                  onClick={() => {
                    updateUrl({
                      task: task.name,
                      retry_id: task.retry_id,
                      tool: ToolType.Nodes,
                    });
                  }}
                >
                  <Tag color={Colors.platform}>{task.node_name}</Tag>
                </button>
              </dd>
            </>
          )}
          {task.pod_name && (
            <>
              <dt>Pod Name</dt>
              <dd>{task.pod_name}</dd>
            </>
          )}
          {task.pod_ip && (
            <>
              <dt>Pod IP</dt>
              <dd>{task.pod_ip}</dd>
            </>
          )}
          {processingDuration && (
            <>
              <dt>Processing Time</dt>
              <dd>{processingDuration}</dd>
            </>
          )}
          {schedulingDuration && (
            <>
              <dt>Scheduling Time</dt>
              <dd>{schedulingDuration}</dd>
            </>
          )}
          {initializingDuration && (
            <>
              <dt>Initializing Time</dt>
              <dd>{initializingDuration}</dd>
            </>
          )}
          {runningDuration && (
            <>
              <dt>Run Time</dt>
              <dd>{runningDuration}</dd>
            </>
          )}
          {task.start_time && (
            <>
              <dt>Start</dt>
              <dd>{convertToReadableTimezone(task.start_time)}</dd>
            </>
          )}
          {task.end_time && (
            <>
              <dt>End</dt>
              <dd>{convertToReadableTimezone(task.end_time)}</dd>
            </>
          )}
          {task.exit_code !== null && (
            <>
              <dt>Exit Code</dt>
              <dd>
                <Link
                  color={task.exit_code === 0 ? Colors.tag : Colors.error}
                  href={`${runtimeEnv.DOCS_BASE_URL}workflows/exit_codes.html`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tag-container"
                >
                  <Tag color={task.exit_code === 0 ? Colors.tag : Colors.error}>{task.exit_code}</Tag>
                </Link>
              </dd>
            </>
          )}
          {extraData &&
            Object.entries(extraData).map(([key, value]) => (
              <React.Fragment key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </React.Fragment>
            ))}
        </dl>
        {task.failure_message && (
          <div className="mt-2">
            <label>Failure Reason</label>
            <p className="break-words">{task.failure_message}</p>
          </div>
        )}
        {task.events &&
          ["SUBMITTING", "SCHEDULING", "WAITING", "PROCESSING", "INITIALIZING", "RUNNING"].includes(task.status) && (
            <div>
              <a
                className="btn btn-action font-bold justify-between"
                href={task.events}
                target="_blank"
                rel="noopener noreferrer"
              >
                Events <FilledIcon name="open_in_new" />
              </a>
              <iframe
                className="w-full border-1 border-border"
                src={task.events}
                title="Events"
              />
            </div>
          )}
      </div>
      <TaskActions
        task={task}
        className="xl:sticky xl:bottom-0"
        updateUrl={updateUrl}
      />
    </div>
  );
};

export default TaskDetails;
