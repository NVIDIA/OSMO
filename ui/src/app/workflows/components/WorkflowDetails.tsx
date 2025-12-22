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
import Link from "next/link";

import { FilledIcon } from "~/components/Icon";
import StatusBadge from "~/components/StatusBadge";
import { Colors, Tag } from "~/components/Tag";
import type { WorkflowResponse } from "~/models";
import { useRuntimeEnv } from "~/runtime-env";
import { convertSeconds, convertToReadableTimezone, formatForWrapping } from "~/utils/string";

import WorkflowActions from "./WorkflowActions";
import { getStatusDescription } from "./WorkfowStatusInfo";
import { type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

interface WorkflowDetailsProps {
  workflow: WorkflowResponse;
  includeName?: boolean;
  includeTasks?: boolean;
  updateUrl: (params: ToolParamUpdaterProps) => void;
}

export const linkToUserWorkflows = (username: string) => {
  return `/workflows?allUsers=false&dateRange=-2&users=${encodeURIComponent(username)}`;
};

const WorkflowDetails = ({ workflow, includeName = false, includeTasks = false, updateUrl }: WorkflowDetailsProps) => {
  const runtimeEnv = useRuntimeEnv();
  const totalTasks = workflow.groups?.reduce((acc, group) => acc + group.tasks.length, 0);

  return (
    <div className="h-full w-full flex flex-col">
      <div className="w-full grow">
        <div className="flex flex-col gap-1 body-header text-center py-global">
          {includeName && <p className="px-global font-semibold">{workflow.name}</p>}
          <p className="px-1 italic overflow-hidden text-ellipsis whitespace-nowrap">
            <strong>UUID:</strong> {workflow.uuid}
          </p>
        </div>
        <div className="p-global w-full flex flex-col">
          <dl aria-label={workflow.name}>
            <dt>Status</dt>
            <dd>
              {workflow.status && (
                <a
                  className="tag-container-round"
                  href={`${runtimeEnv.DOCS_BASE_URL}workflows/lifecycle/index.html#status-reference`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={getStatusDescription(workflow.status)}
                >
                  <StatusBadge status={workflow.status} />
                </a>
              )}
            </dd>
            {workflow.submitted_by && (
              <>
                <dt>Submitted by</dt>
                <dd>
                  <Link
                    href={linkToUserWorkflows(workflow.submitted_by)}
                    className="no-underline p-0 flex items-center gap-1"
                  >
                    {formatForWrapping(workflow.submitted_by)}
                    <FilledIcon
                      name="open_in_new"
                      className="my-[-1rem] text-base!"
                    />
                  </Link>
                </dd>
              </>
            )}
            {workflow.cancelled_by && (
              <>
                <dt>Cancelled by</dt>
                <dd>{formatForWrapping(workflow.cancelled_by)}</dd>
              </>
            )}
            {workflow.pool && (
              <>
                <dt>Pool</dt>
                <dd>
                  <Link
                    href={`/pools/${workflow.pool}`}
                    className="tag-container"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Tag color={Colors.pool}>{workflow.pool}</Tag>
                  </Link>
                </dd>
              </>
            )}
            <dt>Priority</dt>
            <dd>
              <a
                href={`${runtimeEnv.DOCS_BASE_URL}resource_pools/scheduling/index.html#priority`}
                target="_blank"
                rel="noopener noreferrer"
                className="tag-container"
              >
                <Tag color={Colors.platform}>{workflow.priority}</Tag>
              </a>
            </dd>
            {workflow.backend && !workflow.pool && (
              <>
                <dt>Backend</dt>
                <dd>
                  <Tag
                    className="inline-block"
                    color={Colors.platform}
                  >
                    {workflow.backend}
                  </Tag>
                </dd>
              </>
            )}
            {workflow.submit_time && (
              <>
                <dt>Submit Time</dt>
                <dd>{convertToReadableTimezone(workflow.submit_time)}</dd>
              </>
            )}
            {workflow.start_time && (
              <>
                <dt>Start Time</dt>
                <dd>{convertToReadableTimezone(workflow.start_time)}</dd>
              </>
            )}
            {workflow.end_time && (
              <>
                <dt>End Time</dt>
                <dd>{convertToReadableTimezone(workflow.end_time)}</dd>
              </>
            )}
            <dt>Queued Time</dt>
            <dd>{convertSeconds(workflow.queued_time)}</dd>
            <dt>Duration</dt>
            <dd>{convertSeconds(workflow.duration)}</dd>
            {includeTasks && totalTasks > 0 && (
              <>
                <dt>Tasks</dt>
                <dd>
                  <Link
                    href={`/workflows/${workflow.name}?task=${workflow.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tag-container"
                  >
                    <Tag color={Colors.pool}>{`${totalTasks} ${totalTasks > 1 ? "tasks" : "task"}`}</Tag>
                  </Link>
                </dd>
              </>
            )}
          </dl>
          {workflow.events &&
            ["SCHEDULING", "WAITING", "PROCESSING", "INITIALIZING", "RUNNING", "PENDING"].includes(workflow.status) && (
              <div>
                <a
                  className="btn btn-action font-bold justify-between"
                  href={workflow.events}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Events <FilledIcon name="open_in_new" />
                </a>
                <iframe
                  className="w-full border-1 border-border"
                  src={workflow.events}
                  title="Events"
                />
              </div>
            )}
        </div>
      </div>
      <WorkflowActions
        workflow={workflow}
        className="xl:sticky xl:bottom-0"
        updateUrl={updateUrl}
      />
    </div>
  );
};

export default WorkflowDetails;
