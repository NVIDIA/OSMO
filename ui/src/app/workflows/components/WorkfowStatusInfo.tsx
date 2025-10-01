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
import { type TaskStatusType, type WorkflowStatusType } from "~/models";
import { checkExhaustive } from "~/utils/common";

export const getStatusDescription = (status: WorkflowStatusType | TaskStatusType) => {
  switch (status) {
    case "PENDING":
      return "Workflow is submitted to the pool, but not scheduled yet";
    case "RUNNING":
      return "Workflow is running";
    case "WAITING":
      return "Workflow has started but doesn't have any tasks running. Either a downstream task is waiting to be scheduled, or a task is waiting to be rescheduled";
    case "COMPLETED":
      return "Workflow execution was successful and all tasks had exit code 0";
    case "FAILED":
      return "Workflow failed to complete. One or more tasks returned non zero error exit code";
    case "FAILED_EXEC_TIMEOUT":
      return "Workflow was running longer than the set execution timeout";
    case "FAILED_QUEUE_TIMEOUT":
      return "Workflow was queued longer than the set queued timeout";
    case "FAILED_SUBMISSION":
      return "Workflow failed to submit due to resource or credential validation failure";
    case "FAILED_SERVER_ERROR":
      return "Workflow failed due to internal server error";
    case "FAILED_CANCELED":
      return "Workflow was canceled by a user";
    case "FAILED_BACKEND_ERROR":
      return "Workflow has failed due to some backend error like the node entering a Not Ready state";
    case "FAILED_IMAGE_PULL":
      return "Workflow has failed to pull docker image";
    case "FAILED_EVICTED":
      return "Workflow was evicted due to memory or storage usage exceeding limits";
    case "FAILED_START_ERROR":
      return "Workflow failed to start up properly due to a system error";
    case "FAILED_START_TIMEOUT":
      return "Workflow timed-out while initializing";
    case "FAILED_PREEMPTED":
      return "Workflow was preempted to make room for a higher priority workflow";
    case "SUBMITTING":
      return "Workflow is being submitted to the pool";
    case "SCHEDULING":
      return "Workflow is being scheduled";
    case "PROCESSING":
      return "Workflow is being processed";
    case "INITIALIZING":
      return "Workflow is being initialized";
    case "RESCHEDULED":
      return "Workflow has finished and a new task with the same spec has been created";
    case "FAILED_UPSTREAM":
      return "Workflow failed due to a failed upstream task";
    default:
      checkExhaustive(status);
      return "";
  }
};
