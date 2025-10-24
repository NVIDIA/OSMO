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
import StatusBadge from "~/components/StatusBadge";
import { type TaskStatusType } from "~/models";
import { useRuntimeEnv } from "~/runtime-env";
import { checkExhaustive } from "~/utils/common";

const MAX_LENGTH = 100;

interface Props {
  status: TaskStatusType;
  failureMessage?: string | null;
  onClick?: () => void;
}

const getStatusDescription = (status: TaskStatusType) => {
  switch (status) {
    case "SUBMITTING":
      return "Task is being submitted";
    case "WAITING":
      return "Task is waiting for an upstream task to complete";
    case "PROCESSING":
      return "Task is being processed by the service";
    case "SCHEDULING":
      return "Task is in the backend queue waiting to run";
    case "INITIALIZING":
      return "Task is pulling images and running preflight tests";
    case "RUNNING":
      return "Task is running";
    case "COMPLETED":
      return "Task has finished successfully";
    case "FAILED":
      return "Task has failed with non-zero exit code";
    case "FAILED_CANCELED":
      return "Task was canceled by the user";
    case "FAILED_SERVER_ERROR":
      return "Task has failed due to internal service error";
    case "FAILED_BACKEND_ERROR":
      return "Task has failed due to some backend error like the node entering a Not Ready state";
    case "FAILED_EXEC_TIMEOUT":
      return "Task ran longer than the set execution timeout";
    case "FAILED_QUEUE_TIMEOUT":
      return "Task was queued longer than the set queue timeout";
    case "FAILED_IMAGE_PULL":
      return "Task has failed to pull docker image";
    case "FAILED_UPSTREAM":
      return "Task has failed due to failed upstream dependencies";
    case "FAILED_EVICTED":
      return "Task was evicted due to memory or storage usage exceeding limits";
    case "FAILED_PREEMPTED":
      return "Task was preempted to make room for a higher priority task";
    case "FAILED_START_ERROR":
      return "Task failed to start up properly due to a system error";
    case "FAILED_START_TIMEOUT":
      return "Task timed-out while initializing";
    case "RESCHEDULED":
      return "Task has finished and a new task with the same spec has been created";
    default:
      checkExhaustive(status);
      return "";
  }
};

const TaskStatusInfo = ({ status, failureMessage, onClick }: Props) => {
  const runtimeEnv = useRuntimeEnv();
  const truncatedMessage =
    failureMessage && failureMessage.length > MAX_LENGTH
      ? `${failureMessage.substring(0, MAX_LENGTH)}... Click to see full message`
      : failureMessage;

  return (
    <div className="flex flex-row gap-1 items-center">
      <a
        href={`${runtimeEnv.DOCS_BASE_URL}workflows/lifecycle/index.html#task-statuses`}
        target="_blank"
        rel="noopener noreferrer"
        className="tag-container-round"
        title={getStatusDescription(status)}
      >
        <StatusBadge status={status} />
      </a>
      {truncatedMessage && (
        <button
          className="tag-container-round min-h-auto"
          onClick={onClick}
          title={truncatedMessage}
        >
          <OutlinedIcon name="info" />
        </button>
      )}
    </div>
  );
};

export default TaskStatusInfo;
