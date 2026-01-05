// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Mock Workflow Generator V2 - Backend-Aligned
 *
 * Generates mock data that exactly matches the backend API schema:
 * - GroupQueryResponse
 * - TaskQueryResponse
 * - WorkflowQueryResponse
 *
 * Layout information (level, lane) is NOT included here - it must be
 * computed on the frontend using computeTopologicalLevelsFromGraph().
 */

import { faker } from "@faker-js/faker";
import type {
  GroupQueryResponse,
  TaskQueryResponse,
  WorkflowQueryResponse,
  TaskGroupStatus,
} from "@/lib/api/generated";
import { TaskGroupStatus as Status } from "@/lib/api/generated";
import { isFailedStatus } from "./workflow-types";

// ============================================================================
// Mock Data Generator
// ============================================================================

export type WorkflowPattern =
  | "linear"
  | "diamond"
  | "parallel"
  | "complex"
  | "massiveParallel"
  | "manyGroups"
  | "multiRoot"
  | "showcase";

interface GeneratorOptions {
  pattern?: WorkflowPattern;
  seed?: number;
}

/**
 * Generate a mock task matching TaskQueryResponse schema.
 */
function generateTask(
  name: string,
  groupName: string,
  status: TaskGroupStatus,
  workflowUuid: string,
  baseUrl: string,
  startTime: Date | null,
  endTime: Date | null,
  retryId: number = 0,
  isLead: boolean = false,
): TaskQueryResponse {
  const taskUuid = faker.string.uuid();
  const podName = `${workflowUuid.slice(0, 8)}-${taskUuid.slice(0, 8)}`;

  // Defensive check - status should never be undefined but helps debugging
  const statusStr = status || Status.WAITING;
  const isFailed = isFailedStatus(statusStr);

  return {
    name,
    retry_id: retryId,
    status: statusStr,
    failure_message: isFailed ? faker.lorem.sentence() : undefined,
    exit_code: statusStr === Status.COMPLETED ? 0 : isFailed ? 1 : undefined,
    logs: `${baseUrl}/api/workflow/${groupName}/logs?task_name=${name}&retry_id=${retryId}`,
    error_logs: isFailed ? `${baseUrl}/api/workflow/${groupName}/error_logs?task_name=${name}` : undefined,
    processing_start_time: startTime?.toISOString(),
    scheduling_start_time: startTime?.toISOString(),
    initializing_start_time: startTime?.toISOString(),
    events: `${baseUrl}/api/workflow/${groupName}/events?task_name=${name}`,
    start_time: startTime?.toISOString(),
    end_time: endTime?.toISOString(),
    dashboard_url: `https://dashboard.example.com/pod/${podName}`,
    pod_name: podName,
    pod_ip: statusStr !== Status.WAITING ? faker.internet.ipv4() : undefined,
    task_uuid: taskUuid,
    node_name:
      statusStr !== Status.WAITING
        ? `${faker.helpers.arrayElement(["dgx", "gpu", "node"])}-${faker.helpers.arrayElement(["a100", "h100", "l40s"])}-${faker.number.int({ min: 100, max: 999 })}`
        : undefined,
    lead: isLead,
  };
}

/**
 * Generate a mock group matching GroupQueryResponse schema.
 */
function generateGroup(
  name: string,
  status: TaskGroupStatus,
  upstreamGroups: string[],
  downstreamGroups: string[],
  tasks: TaskQueryResponse[],
  startTime: Date | null,
  endTime: Date | null,
): GroupQueryResponse {
  // remaining_upstream_groups = upstreams that haven't completed
  // For mock, we'll show all upstreams as remaining if not completed
  const remainingUpstream = status === Status.WAITING ? upstreamGroups : [];

  return {
    name,
    status,
    start_time: startTime?.toISOString(),
    end_time: endTime?.toISOString(),
    processing_start_time: startTime?.toISOString(),
    scheduling_start_time: startTime?.toISOString(),
    initializing_start_time: startTime?.toISOString(),
    remaining_upstream_groups: remainingUpstream,
    downstream_groups: downstreamGroups,
    failure_message: isFailedStatus(status) ? faker.lorem.sentence() : undefined,
    tasks,
  };
}

// ============================================================================
// Pattern Generators - Return GroupQueryResponse[]
// ============================================================================

/**
 * Linear: A -> B -> C -> D -> E
 */
function generateLinearPattern(
  workflowUuid: string,
  baseUrl: string,
  submitTime: Date,
  startTime: Date,
): GroupQueryResponse[] {
  const groupNames = ["fetch", "validate", "process", "export", "deploy"];
  const groups: GroupQueryResponse[] = [];
  let currentTime = startTime;

  groupNames.forEach((name, i) => {
    // Status based on position
    let status: TaskGroupStatus;
    let groupStartTime: Date | null = null;
    let groupEndTime: Date | null = null;

    if (i < 2) {
      status = Status.COMPLETED;
      groupStartTime = currentTime;
      groupEndTime = new Date(currentTime.getTime() + 300000); // 5 min
      currentTime = groupEndTime;
    } else if (i === 2) {
      status = Status.RUNNING;
      groupStartTime = currentTime;
    } else {
      status = Status.WAITING;
    }

    const tasks = [generateTask(`${name}-0`, name, status, workflowUuid, baseUrl, groupStartTime, groupEndTime)];

    groups.push(
      generateGroup(
        name,
        status,
        i > 0 ? [groupNames[i - 1]] : [],
        i < groupNames.length - 1 ? [groupNames[i + 1]] : [],
        tasks,
        groupStartTime,
        groupEndTime,
      ),
    );
  });

  return groups;
}

/**
 * Diamond: A -> (B, C) -> D
 */
function generateDiamondPattern(
  workflowUuid: string,
  baseUrl: string,
  submitTime: Date,
  startTime: Date,
): GroupQueryResponse[] {
  const groups: GroupQueryResponse[] = [];

  // Start node
  groups.push(
    generateGroup(
      "start",
      Status.COMPLETED,
      [],
      ["branch-a", "branch-b"],
      [
        generateTask(
          "start-0",
          "start",
          Status.COMPLETED,
          workflowUuid,
          baseUrl,
          startTime,
          new Date(startTime.getTime() + 120000),
        ),
      ],
      startTime,
      new Date(startTime.getTime() + 120000),
    ),
  );

  // Branch A
  const branchAStart = new Date(startTime.getTime() + 120000);
  groups.push(
    generateGroup(
      "branch-a",
      Status.COMPLETED,
      ["start"],
      ["merge"],
      [
        generateTask(
          "branch-a-0",
          "branch-a",
          Status.COMPLETED,
          workflowUuid,
          baseUrl,
          branchAStart,
          new Date(branchAStart.getTime() + 300000),
        ),
      ],
      branchAStart,
      new Date(branchAStart.getTime() + 300000),
    ),
  );

  // Branch B
  groups.push(
    generateGroup(
      "branch-b",
      Status.RUNNING,
      ["start"],
      ["merge"],
      [generateTask("branch-b-0", "branch-b", Status.RUNNING, workflowUuid, baseUrl, branchAStart, null)],
      branchAStart,
      null,
    ),
  );

  // Merge
  groups.push(
    generateGroup(
      "merge",
      Status.WAITING,
      ["branch-a", "branch-b"],
      ["end"],
      [generateTask("merge-0", "merge", Status.WAITING, workflowUuid, baseUrl, null, null)],
      null,
      null,
    ),
  );

  // End
  groups.push(
    generateGroup(
      "end",
      Status.WAITING,
      ["merge"],
      [],
      [generateTask("end-0", "end", Status.WAITING, workflowUuid, baseUrl, null, null)],
      null,
      null,
    ),
  );

  return groups;
}

/**
 * Complex: Multi-level DAG with fan-out and fan-in
 *
 * fetch -> (validate, preproc-a, preproc-b) -> train -> evaluate -> (export, report) -> deploy
 */
function generateComplexPattern(
  workflowUuid: string,
  baseUrl: string,
  submitTime: Date,
  startTime: Date,
): GroupQueryResponse[] {
  const groups: GroupQueryResponse[] = [];
  let currentTime = startTime;

  // Level 0: fetch
  const fetchEnd = new Date(currentTime.getTime() + 180000);
  groups.push(
    generateGroup(
      "fetch",
      Status.COMPLETED,
      [],
      ["validate", "preproc-a", "preproc-b"],
      [generateTask("fetch-0", "fetch", Status.COMPLETED, workflowUuid, baseUrl, currentTime, fetchEnd)],
      currentTime,
      fetchEnd,
    ),
  );
  currentTime = fetchEnd;

  // Level 1: validate, preproc-a, preproc-b (parallel)
  const level1End = new Date(currentTime.getTime() + 600000);

  groups.push(
    generateGroup(
      "validate",
      Status.COMPLETED,
      ["fetch"],
      ["train"],
      [
        generateTask(
          "validate-0",
          "validate",
          Status.COMPLETED,
          workflowUuid,
          baseUrl,
          currentTime,
          new Date(currentTime.getTime() + 120000),
        ),
      ],
      currentTime,
      new Date(currentTime.getTime() + 120000),
    ),
  );

  groups.push(
    generateGroup(
      "preproc-a",
      Status.COMPLETED,
      ["fetch"],
      ["train"],
      [generateTask("preproc-a-0", "preproc-a", Status.COMPLETED, workflowUuid, baseUrl, currentTime, level1End)],
      currentTime,
      level1End,
    ),
  );

  groups.push(
    generateGroup(
      "preproc-b",
      Status.COMPLETED,
      ["fetch"],
      ["train"],
      [
        generateTask(
          "preproc-b-0",
          "preproc-b",
          Status.COMPLETED,
          workflowUuid,
          baseUrl,
          currentTime,
          new Date(currentTime.getTime() + 480000),
        ),
      ],
      currentTime,
      new Date(currentTime.getTime() + 480000),
    ),
  );
  currentTime = level1End;

  // Level 2: train (multi-task, running)
  const trainTasks: TaskQueryResponse[] = [];
  for (let i = 0; i < 4; i++) {
    const taskStatus = i === 0 ? Status.COMPLETED : i < 3 ? Status.RUNNING : Status.WAITING;
    trainTasks.push(
      generateTask(
        `train-shard-${i}`,
        "train",
        taskStatus,
        workflowUuid,
        baseUrl,
        i < 3 ? currentTime : null,
        i === 0 ? new Date(currentTime.getTime() + 3600000) : null,
        0,
        i === 0, // First task is the lead
      ),
    );
  }

  groups.push(
    generateGroup(
      "train",
      Status.RUNNING,
      ["validate", "preproc-a", "preproc-b"],
      ["evaluate"],
      trainTasks,
      currentTime,
      null,
    ),
  );

  // Level 3: evaluate
  groups.push(
    generateGroup(
      "evaluate",
      Status.WAITING,
      ["train"],
      ["export", "report"],
      [generateTask("evaluate-0", "evaluate", Status.WAITING, workflowUuid, baseUrl, null, null)],
      null,
      null,
    ),
  );

  // Level 4: export, report
  groups.push(
    generateGroup(
      "export",
      Status.WAITING,
      ["evaluate"],
      ["deploy"],
      [generateTask("export-0", "export", Status.WAITING, workflowUuid, baseUrl, null, null)],
      null,
      null,
    ),
  );

  groups.push(
    generateGroup(
      "report",
      Status.WAITING,
      ["evaluate"],
      ["deploy"],
      [generateTask("report-0", "report", Status.WAITING, workflowUuid, baseUrl, null, null)],
      null,
      null,
    ),
  );

  // Level 5: deploy
  groups.push(
    generateGroup(
      "deploy",
      Status.WAITING,
      ["export", "report"],
      [],
      [generateTask("deploy-0", "deploy", Status.WAITING, workflowUuid, baseUrl, null, null)],
      null,
      null,
    ),
  );

  return groups;
}

/**
 * Many Groups: 100 groups with 5 tasks each, 10 groups per level
 */
function generateManyGroupsPattern(
  workflowUuid: string,
  baseUrl: string,
  submitTime: Date,
  startTime: Date,
): GroupQueryResponse[] {
  const groups: GroupQueryResponse[] = [];
  const numGroups = 100;
  const tasksPerGroup = 5;
  const groupsPerLevel = 10;
  const numLevels = Math.ceil(numGroups / groupsPerLevel);

  let currentTime = startTime;

  for (let level = 0; level < numLevels; level++) {
    const groupsInThisLevel = Math.min(groupsPerLevel, numGroups - level * groupsPerLevel);

    for (let lane = 0; lane < groupsInThisLevel; lane++) {
      const groupIndex = level * groupsPerLevel + lane;
      const groupName = `group-${groupIndex.toString().padStart(3, "0")}`;

      // Status based on level
      let status: TaskGroupStatus;
      let groupStartTime: Date | null = null;
      let groupEndTime: Date | null = null;

      if (level < numLevels * 0.3) {
        status = Status.COMPLETED;
        groupStartTime = currentTime;
        groupEndTime = new Date(currentTime.getTime() + 300000);
      } else if (level < numLevels * 0.5) {
        status = Status.RUNNING;
        groupStartTime = currentTime;
      } else {
        status = Status.WAITING;
      }

      // Generate tasks
      const tasks: TaskQueryResponse[] = [];
      for (let t = 0; t < tasksPerGroup; t++) {
        const taskStatus =
          status === Status.COMPLETED
            ? Status.COMPLETED
            : status === Status.RUNNING
              ? faker.helpers.arrayElement([Status.COMPLETED, Status.RUNNING])
              : Status.WAITING;

        tasks.push(
          generateTask(
            `${groupName}-task-${t}`,
            groupName,
            taskStatus,
            workflowUuid,
            baseUrl,
            taskStatus !== Status.WAITING ? groupStartTime : null,
            taskStatus === Status.COMPLETED ? groupEndTime : null,
            0,
            t === 0, // First task is the lead
          ),
        );
      }

      // Dependencies: connect to 2 groups in previous level
      const upstreamGroups: string[] = [];
      if (level > 0) {
        for (let i = 0; i < Math.min(2, groupsPerLevel); i++) {
          const prevIndex = (level - 1) * groupsPerLevel + ((lane + i) % groupsPerLevel);
          upstreamGroups.push(`group-${prevIndex.toString().padStart(3, "0")}`);
        }
      }

      // Downstream: connect to 2 groups in next level
      const downstreamGroups: string[] = [];
      if (level < numLevels - 1) {
        for (let i = 0; i < Math.min(2, groupsPerLevel); i++) {
          const nextIndex =
            (level + 1) * groupsPerLevel +
            ((lane + i) % Math.min(groupsPerLevel, numGroups - (level + 1) * groupsPerLevel));
          if (nextIndex < numGroups) {
            downstreamGroups.push(`group-${nextIndex.toString().padStart(3, "0")}`);
          }
        }
      }

      groups.push(
        generateGroup(groupName, status, upstreamGroups, downstreamGroups, tasks, groupStartTime, groupEndTime),
      );
    }

    currentTime = new Date(currentTime.getTime() + 600000);
  }

  return groups;
}

/**
 * Massive Parallel: 1 group with 200 tasks
 */
function generateMassiveParallelPattern(
  workflowUuid: string,
  baseUrl: string,
  submitTime: Date,
  startTime: Date,
): GroupQueryResponse[] {
  const groups: GroupQueryResponse[] = [];

  // Preprocess
  groups.push(
    generateGroup(
      "preprocess",
      Status.COMPLETED,
      [],
      ["distributed-training"],
      [
        generateTask(
          "preprocess-0",
          "preprocess",
          Status.COMPLETED,
          workflowUuid,
          baseUrl,
          startTime,
          new Date(startTime.getTime() + 300000),
        ),
      ],
      startTime,
      new Date(startTime.getTime() + 300000),
    ),
  );

  // Distributed training with 200 tasks
  const trainStart = new Date(startTime.getTime() + 300000);
  const trainTasks: TaskQueryResponse[] = [];
  for (let i = 0; i < 200; i++) {
    const taskStatus = i < 50 ? Status.COMPLETED : i < 150 ? Status.RUNNING : Status.WAITING;

    trainTasks.push(
      generateTask(
        `train-shard-${i.toString().padStart(3, "0")}`,
        "distributed-training",
        taskStatus,
        workflowUuid,
        baseUrl,
        taskStatus !== Status.WAITING ? trainStart : null,
        taskStatus === Status.COMPLETED
          ? new Date(trainStart.getTime() + faker.number.int({ min: 1800000, max: 7200000 }))
          : null,
        0,
        i === 0, // First task is the lead
      ),
    );
  }

  groups.push(
    generateGroup("distributed-training", Status.RUNNING, ["preprocess"], ["aggregate"], trainTasks, trainStart, null),
  );

  // Aggregate
  groups.push(
    generateGroup(
      "aggregate",
      Status.WAITING,
      ["distributed-training"],
      [],
      [generateTask("aggregate-0", "aggregate", Status.WAITING, workflowUuid, baseUrl, null, null)],
      null,
      null,
    ),
  );

  return groups;
}

/**
 * Multi-Root: 3 independent starting points that converge
 */
function generateMultiRootPattern(
  workflowUuid: string,
  baseUrl: string,
  submitTime: Date,
  startTime: Date,
): GroupQueryResponse[] {
  const groups: GroupQueryResponse[] = [];

  // 3 root nodes
  const roots = ["download-images", "generate-labels", "fetch-config"];
  roots.forEach((name, i) => {
    groups.push(
      generateGroup(
        name,
        Status.COMPLETED,
        [],
        ["validate"],
        [
          generateTask(
            `${name}-0`,
            name,
            Status.COMPLETED,
            workflowUuid,
            baseUrl,
            startTime,
            new Date(startTime.getTime() + (i + 1) * 60000),
          ),
        ],
        startTime,
        new Date(startTime.getTime() + (i + 1) * 60000),
      ),
    );
  });

  // Validate (convergence point)
  const validateStart = new Date(startTime.getTime() + 180000);
  groups.push(
    generateGroup(
      "validate",
      Status.COMPLETED,
      roots,
      ["train-a", "train-b"],
      [
        generateTask(
          "validate-0",
          "validate",
          Status.COMPLETED,
          workflowUuid,
          baseUrl,
          validateStart,
          new Date(validateStart.getTime() + 120000),
        ),
      ],
      validateStart,
      new Date(validateStart.getTime() + 120000),
    ),
  );

  // Training branches - each with multiple tasks (distributed training shards)
  const trainStart = new Date(validateStart.getTime() + 120000);

  // train-a: 6 tasks (2 completed, 3 running, 1 waiting)
  const trainATasks: TaskQueryResponse[] = [];
  for (let i = 0; i < 6; i++) {
    const taskStatus = i < 2 ? Status.COMPLETED : i < 5 ? Status.RUNNING : Status.WAITING;
    trainATasks.push(
      generateTask(
        `train-a-shard-${i}`,
        "train-a",
        taskStatus,
        workflowUuid,
        baseUrl,
        taskStatus !== Status.WAITING ? trainStart : null,
        taskStatus === Status.COMPLETED ? new Date(trainStart.getTime() + (i + 1) * 600000) : null,
        0,
        i === 0, // First task is the lead
      ),
    );
  }
  groups.push(generateGroup("train-a", Status.RUNNING, ["validate"], ["merge"], trainATasks, trainStart, null));

  // train-b: 4 tasks (1 completed, 2 running, 1 waiting)
  const trainBTasks: TaskQueryResponse[] = [];
  for (let i = 0; i < 4; i++) {
    const taskStatus = i < 1 ? Status.COMPLETED : i < 3 ? Status.RUNNING : Status.WAITING;
    trainBTasks.push(
      generateTask(
        `train-b-shard-${i}`,
        "train-b",
        taskStatus,
        workflowUuid,
        baseUrl,
        taskStatus !== Status.WAITING ? trainStart : null,
        taskStatus === Status.COMPLETED ? new Date(trainStart.getTime() + (i + 1) * 900000) : null,
        0,
        i === 0, // First task is the lead
      ),
    );
  }
  groups.push(generateGroup("train-b", Status.RUNNING, ["validate"], ["merge"], trainBTasks, trainStart, null));

  // Merge
  groups.push(
    generateGroup(
      "merge",
      Status.WAITING,
      ["train-a", "train-b"],
      ["evaluate", "export", "report"],
      [generateTask("merge-0", "merge", Status.WAITING, workflowUuid, baseUrl, null, null)],
      null,
      null,
    ),
  );

  // Final level
  ["evaluate", "export", "report"].forEach((name) => {
    groups.push(
      generateGroup(
        name,
        Status.WAITING,
        ["merge"],
        ["deploy"],
        [generateTask(`${name}-0`, name, Status.WAITING, workflowUuid, baseUrl, null, null)],
        null,
        null,
      ),
    );
  });

  // Deploy
  groups.push(
    generateGroup(
      "deploy",
      Status.WAITING,
      ["evaluate", "export", "report"],
      [],
      [generateTask("deploy-0", "deploy", Status.WAITING, workflowUuid, baseUrl, null, null)],
      null,
      null,
    ),
  );

  return groups;
}

/**
 * Showcase: Demonstrates all status combinations in a logical flow.
 *
 * Flow:
 * - completed-single (COMPLETED) → running-single (RUNNING) → waiting-single (WAITING for 1)
 * - completed-group (COMPLETED, 4 tasks) → running-group (RUNNING, 6 tasks) → waiting-group (WAITING for 2)
 * - failed-single (FAILED_APP_ERROR) ↘
 *                                       → failed-downstream (WAITING - blocked by failed)
 * - timeout-single (FAILED_TIMEOUT) ↗
 * - cancelled-single (FAILED_USER_CANCELLED) - standalone
 * - preempted-group (FAILED_PREEMPTED, 8 tasks - partial failure)
 * - initializing-single (INITIALIZING)
 * - scheduling-single (SCHEDULING)
 */
function generateShowcasePattern(
  workflowUuid: string,
  baseUrl: string,
  submitTime: Date,
  startTime: Date,
): GroupQueryResponse[] {
  const groups: GroupQueryResponse[] = [];
  const currentTime = startTime;

  // ========== COMPLETED BRANCH ==========

  // 1. completed-single: Single task, completed
  const completedSingleEnd = new Date(currentTime.getTime() + 45000);
  groups.push(
    generateGroup(
      "fetch-data",
      Status.COMPLETED,
      [],
      ["process-data"],
      [
        generateTask(
          "fetch-data-0",
          "fetch-data",
          Status.COMPLETED,
          workflowUuid,
          baseUrl,
          currentTime,
          completedSingleEnd,
        ),
      ],
      currentTime,
      completedSingleEnd,
    ),
  );

  // 2. completed-group: Multi-task, all completed
  const completedGroupEnd = new Date(completedSingleEnd.getTime() + 300000);
  const completedGroupTasks: TaskQueryResponse[] = [];
  for (let i = 0; i < 4; i++) {
    completedGroupTasks.push(
      generateTask(
        `validate-shard-${i}`,
        "validate-data",
        Status.COMPLETED,
        workflowUuid,
        baseUrl,
        completedSingleEnd,
        new Date(completedGroupEnd.getTime() - (3 - i) * 10000),
        0,
        i === 0, // First task is the lead
      ),
    );
  }
  groups.push(
    generateGroup(
      "validate-data",
      Status.COMPLETED,
      [],
      ["train-model"],
      completedGroupTasks,
      completedSingleEnd,
      completedGroupEnd,
    ),
  );

  // 3. running-single: Single task, running
  const runningSingleStart = new Date(completedGroupEnd.getTime());
  groups.push(
    generateGroup(
      "process-data",
      Status.RUNNING,
      ["fetch-data"],
      ["export-results"],
      [generateTask("process-data-0", "process-data", Status.RUNNING, workflowUuid, baseUrl, runningSingleStart, null)],
      runningSingleStart,
      null,
    ),
  );

  // 4. running-group: Multi-task, running (mixed statuses)
  const runningGroupStart = new Date(completedGroupEnd.getTime());
  const runningGroupTasks: TaskQueryResponse[] = [];
  for (let i = 0; i < 6; i++) {
    const taskStatus = i < 2 ? Status.COMPLETED : i < 5 ? Status.RUNNING : Status.WAITING;
    runningGroupTasks.push(
      generateTask(
        `train-shard-${i}`,
        "train-model",
        taskStatus,
        workflowUuid,
        baseUrl,
        taskStatus !== Status.WAITING ? runningGroupStart : null,
        taskStatus === Status.COMPLETED ? new Date(runningGroupStart.getTime() + (i + 1) * 600000) : null,
        0,
        i === 0, // First task is the lead
      ),
    );
  }
  groups.push(
    generateGroup(
      "train-model",
      Status.RUNNING,
      ["validate-data"],
      ["evaluate-model"],
      runningGroupTasks,
      runningGroupStart,
      null,
    ),
  );

  // 5. waiting-single: Waiting for 1 upstream (process-data)
  groups.push(
    generateGroup(
      "export-results",
      Status.WAITING,
      ["process-data"],
      [],
      [generateTask("export-results-0", "export-results", Status.WAITING, workflowUuid, baseUrl, null, null)],
      null,
      null,
    ),
  );

  // 6. waiting-group: Waiting for 2 upstreams (train-model, process-data)
  const waitingGroupTasks: TaskQueryResponse[] = [];
  for (let i = 0; i < 3; i++) {
    waitingGroupTasks.push(
      generateTask(`evaluate-shard-${i}`, "evaluate-model", Status.WAITING, workflowUuid, baseUrl, null, null),
    );
  }
  groups.push(generateGroup("evaluate-model", Status.WAITING, ["train-model"], [], waitingGroupTasks, null, null));

  // ========== FAILURE BRANCH ==========

  // 7. failed-single: Generic failure with message (OOM)
  const failedSingleStart = new Date(currentTime.getTime());
  const failedSingleEnd = new Date(failedSingleStart.getTime() + 120000);
  const failedTask = generateTask(
    "check-gpu-0",
    "check-gpu",
    Status.FAILED,
    workflowUuid,
    baseUrl,
    failedSingleStart,
    failedSingleEnd,
  );
  failedTask.failure_message = "OutOfMemoryError: CUDA out of memory. Tried to allocate 32.00 GiB";
  failedTask.exit_code = 1;
  groups.push(
    generateGroup("check-gpu", Status.FAILED, [], ["deploy-model"], [failedTask], failedSingleStart, failedSingleEnd),
  );

  // 8. timeout-single: Execution timeout
  const timeoutStart = new Date(currentTime.getTime());
  const timeoutEnd = new Date(timeoutStart.getTime() + 3600000);
  const timeoutTask = generateTask(
    "long-running-0",
    "long-running",
    Status.FAILED_EXEC_TIMEOUT,
    workflowUuid,
    baseUrl,
    timeoutStart,
    timeoutEnd,
  );
  timeoutTask.failure_message = "Task exceeded execution timeout of 1h";
  groups.push(
    generateGroup(
      "long-running",
      Status.FAILED_EXEC_TIMEOUT,
      [],
      ["deploy-model"],
      [timeoutTask],
      timeoutStart,
      timeoutEnd,
    ),
  );

  // 9. failed-downstream: Waiting but blocked by failed upstreams
  groups.push(
    generateGroup(
      "deploy-model",
      Status.WAITING,
      ["check-gpu", "long-running"],
      [],
      [generateTask("deploy-model-0", "deploy-model", Status.WAITING, workflowUuid, baseUrl, null, null)],
      null,
      null,
    ),
  );

  // 10. cancelled-single: User cancelled
  const cancelledStart = new Date(currentTime.getTime() + 60000);
  const cancelledEnd = new Date(cancelledStart.getTime() + 30000);
  const cancelledTask = generateTask(
    "cleanup-0",
    "cleanup",
    Status.FAILED_CANCELED,
    workflowUuid,
    baseUrl,
    cancelledStart,
    cancelledEnd,
  );
  cancelledTask.failure_message = "Cancelled by user";
  groups.push(generateGroup("cleanup", Status.FAILED_CANCELED, [], [], [cancelledTask], cancelledStart, cancelledEnd));

  // 11. preempted-group: Multi-task with partial preemption
  const preemptedStart = new Date(currentTime.getTime());
  const preemptedTasks: TaskQueryResponse[] = [];
  for (let i = 0; i < 8; i++) {
    const taskStatus = i < 5 ? Status.COMPLETED : Status.FAILED_PREEMPTED;
    const task = generateTask(
      `distributed-${i}`,
      "distributed-job",
      taskStatus,
      workflowUuid,
      baseUrl,
      preemptedStart,
      new Date(preemptedStart.getTime() + (i + 1) * 300000),
      0,
      i === 0, // First task is the lead
    );
    if (taskStatus === Status.FAILED_PREEMPTED) {
      task.failure_message = "Preempted by higher priority job";
    }
    preemptedTasks.push(task);
  }
  groups.push(generateGroup("distributed-job", Status.FAILED_PREEMPTED, [], [], preemptedTasks, preemptedStart, null));

  // ========== PENDING STATES ==========

  // 12. initializing-single: Starting up
  groups.push(
    generateGroup(
      "warmup-cache",
      Status.INITIALIZING,
      [],
      [],
      [generateTask("warmup-cache-0", "warmup-cache", Status.INITIALIZING, workflowUuid, baseUrl, new Date(), null)],
      new Date(),
      null,
    ),
  );

  // 13. scheduling-single: In queue
  groups.push(
    generateGroup(
      "batch-job",
      Status.SCHEDULING,
      [],
      [],
      [generateTask("batch-job-0", "batch-job", Status.SCHEDULING, workflowUuid, baseUrl, null, null)],
      null,
      null,
    ),
  );

  return groups;
}

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate a complete mock workflow matching WorkflowQueryResponse schema.
 */
export function generateMockWorkflow(options: GeneratorOptions = {}): WorkflowQueryResponse {
  const { pattern = "complex", seed = 42 } = options;
  faker.seed(seed);

  const workflowName = `train-${faker.word.adjective()}-${faker.string.alphanumeric(6)}`;
  const workflowUuid = faker.string.uuid();
  const baseUrl = "https://osmo.example.com";
  const submitTime = new Date(Date.now() - faker.number.int({ min: 3600000, max: 14400000 }));
  const queuedTime = faker.number.int({ min: 60, max: 600 });
  const startTime = new Date(submitTime.getTime() + queuedTime * 1000);

  // Generate groups based on pattern
  let groups: GroupQueryResponse[];
  switch (pattern) {
    case "linear":
      groups = generateLinearPattern(workflowUuid, baseUrl, submitTime, startTime);
      break;
    case "diamond":
      groups = generateDiamondPattern(workflowUuid, baseUrl, submitTime, startTime);
      break;
    case "parallel":
      groups = generateMassiveParallelPattern(workflowUuid, baseUrl, submitTime, startTime);
      break;
    case "massiveParallel":
      groups = generateMassiveParallelPattern(workflowUuid, baseUrl, submitTime, startTime);
      break;
    case "manyGroups":
      groups = generateManyGroupsPattern(workflowUuid, baseUrl, submitTime, startTime);
      break;
    case "multiRoot":
      groups = generateMultiRootPattern(workflowUuid, baseUrl, submitTime, startTime);
      break;
    case "showcase":
      groups = generateShowcasePattern(workflowUuid, baseUrl, submitTime, startTime);
      break;
    case "complex":
    default:
      groups = generateComplexPattern(workflowUuid, baseUrl, submitTime, startTime);
      break;
  }

  // Calculate workflow status
  const allTasks = groups.flatMap((g) => g.tasks || []);
  const hasRunning = allTasks.some((t) => t.status === Status.RUNNING || t.status === Status.INITIALIZING);
  const hasFailed = allTasks.some((t) => isFailedStatus(t.status));
  const allCompleted = allTasks.every((t) => t.status === Status.COMPLETED);

  let workflowStatus: TaskGroupStatus;
  if (allCompleted) {
    workflowStatus = Status.COMPLETED;
  } else if (hasFailed) {
    workflowStatus = Status.FAILED;
  } else if (hasRunning) {
    workflowStatus = Status.RUNNING;
  } else {
    workflowStatus = Status.WAITING;
  }

  // Calculate end time if completed
  const endTime = allCompleted
    ? groups.reduce(
        (latest, g) => {
          const gEnd = g.end_time ? new Date(g.end_time) : null;
          return gEnd && (!latest || gEnd > latest) ? gEnd : latest;
        },
        null as Date | null,
      )
    : null;

  return {
    name: workflowName,
    uuid: workflowUuid,
    submitted_by: faker.internet.username(),
    cancelled_by: undefined,
    spec: `${baseUrl}/api/workflow/${workflowName}/spec`,
    template_spec: `${baseUrl}/api/workflow/${workflowName}/spec?use_template=true`,
    logs: `${baseUrl}/api/workflow/${workflowName}/logs`,
    events: `${baseUrl}/api/workflow/${workflowName}/events`,
    overview: `${baseUrl}/workflows/${workflowName}`,
    parent_name: undefined,
    parent_job_id: undefined,
    dashboard_url: `https://dashboard.example.com/workflow/${workflowUuid}`,
    grafana_url: `https://grafana.example.com/d/workflow/${workflowUuid}`,
    tags: [faker.word.noun(), faker.word.noun()],
    submit_time: submitTime.toISOString(),
    start_time: startTime.toISOString(),
    end_time: endTime?.toISOString(),
    exec_timeout: 86400,
    queue_timeout: 3600,
    duration: endTime ? (endTime.getTime() - startTime.getTime()) / 1000 : undefined,
    queued_time: queuedTime,
    status: workflowStatus,
    outputs: undefined,
    groups,
    pool: faker.helpers.arrayElement(["default", "gpu-pool", "high-priority"]),
    backend: faker.helpers.arrayElement(["k8s-prod", "k8s-dev"]),
    app_owner: faker.internet.username(),
    app_name: faker.word.noun(),
    app_version: faker.number.int({ min: 1, max: 10 }),
    plugins: {},
    priority: faker.helpers.arrayElement(["HIGH", "NORMAL", "LOW"]),
  };
}

// ============================================================================
// Pre-built Examples (for quick testing)
// ============================================================================

export const EXAMPLE_WORKFLOWS: Record<WorkflowPattern, () => WorkflowQueryResponse> = {
  linear: () => generateMockWorkflow({ pattern: "linear", seed: 100 }),
  diamond: () => generateMockWorkflow({ pattern: "diamond", seed: 200 }),
  parallel: () => generateMockWorkflow({ pattern: "parallel", seed: 300 }),
  complex: () => generateMockWorkflow({ pattern: "complex", seed: 400 }),
  massiveParallel: () => generateMockWorkflow({ pattern: "massiveParallel", seed: 500 }),
  manyGroups: () => generateMockWorkflow({ pattern: "manyGroups", seed: 600 }),
  multiRoot: () => generateMockWorkflow({ pattern: "multiRoot", seed: 700 }),
  showcase: () => generateMockWorkflow({ pattern: "showcase", seed: 800 }),
};
