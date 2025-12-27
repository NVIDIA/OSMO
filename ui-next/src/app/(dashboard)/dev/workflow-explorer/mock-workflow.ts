// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Complex Workflow Mock Generator
 *
 * Generates a realistic, complex workflow for visualization exploration.
 * This creates a non-linear DAG with parallel tasks, dependencies, and
 * various task states.
 */

import { faker } from "@faker-js/faker";
import { TaskGroupStatus } from "@/lib/api/generated";

// Re-export for convenience
export { TaskGroupStatus };

// ============================================================================
// Types
// ============================================================================

export interface MockTaskNode {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  status: TaskGroupStatus;
  // Timing
  submitTime: Date;
  startTime: Date | null;
  endTime: Date | null;
  duration: number | null; // seconds
  // Resources
  gpu: number;
  cpu: number;
  memory: number; // GB
  // Placement
  node: string | null;
  // Lifecycle phases (for timeline)
  phases: {
    name: string;
    startTime: Date;
    endTime: Date | null;
    duration: number | null; // seconds
  }[];
  // Failure info
  failureMessage?: string;
  exitCode?: number;
}

export interface MockGroupNode {
  id: string;
  name: string;
  status: TaskGroupStatus;
  tasks: MockTaskNode[];
  upstreamGroups: string[];
  downstreamGroups: string[];
  // For layout
  level: number; // Vertical level (0 = top)
  lane: number; // Horizontal position within level
}

export interface MockComplexWorkflow {
  id: string;
  name: string;
  status: TaskGroupStatus;
  priority: "LOW" | "NORMAL" | "HIGH";
  pool: string;
  user: string;
  submitTime: Date;
  startTime: Date | null;
  endTime: Date | null;
  queuedTime: number; // seconds
  duration: number | null; // seconds
  groups: MockGroupNode[];
  // Derived for convenience
  totalTasks: number;
  completedTasks: number;
  runningTasks: number;
  failedTasks: number;
  waitingTasks: number;
}

// ============================================================================
// Status Helpers
// ============================================================================

export function getStatusCategory(
  status: TaskGroupStatus
): "waiting" | "running" | "completed" | "failed" {
  const waitingStatuses: TaskGroupStatus[] = [
    TaskGroupStatus.WAITING,
    TaskGroupStatus.SUBMITTING,
    TaskGroupStatus.SCHEDULING,
  ];
  const runningStatuses: TaskGroupStatus[] = [
    TaskGroupStatus.INITIALIZING,
    TaskGroupStatus.RUNNING,
  ];

  if (waitingStatuses.includes(status)) return "waiting";
  if (runningStatuses.includes(status)) return "running";
  if (status === TaskGroupStatus.COMPLETED) return "completed";
  return "failed";
}

// ============================================================================
// Complex Workflow Generator
// ============================================================================

export function generateComplexWorkflow(
  seed: number = 42,
  options: {
    pattern?: WorkflowPattern;
  } = {}
): MockComplexWorkflow {
  faker.seed(seed);

  const pattern = options.pattern || "complex";
  const workflowName = `train-${faker.word.adjective()}-${faker.string.alphanumeric(6)}`;
  const submitTime = new Date(Date.now() - faker.number.int({ min: 3600000, max: 14400000 }));
  const queuedTime = faker.number.int({ min: 60, max: 600 });
  const startTime = new Date(submitTime.getTime() + queuedTime * 1000);

  let groups: MockGroupNode[];

  switch (pattern) {
    case "linear":
      groups = generateLinearDAG(workflowName, submitTime, startTime);
      break;
    case "diamond":
      groups = generateDiamondDAG(workflowName, submitTime, startTime);
      break;
    case "parallel":
      groups = generateParallelDAG(workflowName, submitTime, startTime);
      break;
    case "massiveParallel":
      groups = generateMassiveParallelDAG(workflowName, submitTime, startTime);
      break;
    case "manyGroups":
      groups = generateManyGroupsDAG(workflowName, submitTime, startTime);
      break;
    case "multiRoot":
      groups = generateMultiRootDAG(workflowName, submitTime, startTime);
      break;
    case "complex":
    default:
      groups = generateComplexDAG(workflowName, submitTime, startTime);
      break;
  }

  // Calculate workflow status from groups
  const allTasks = groups.flatMap((g) => g.tasks);
  const hasRunning = allTasks.some((t) => getStatusCategory(t.status) === "running");
  const hasFailed = allTasks.some((t) => getStatusCategory(t.status) === "failed");
  const allCompleted = allTasks.every((t) => t.status === TaskGroupStatus.COMPLETED);

  let workflowStatus: TaskGroupStatus;
  if (allCompleted) {
    workflowStatus = TaskGroupStatus.COMPLETED;
  } else if (hasFailed) {
    workflowStatus = TaskGroupStatus.FAILED;
  } else if (hasRunning) {
    workflowStatus = TaskGroupStatus.RUNNING;
  } else {
    workflowStatus = TaskGroupStatus.WAITING;
  }

  const duration = hasRunning
    ? (Date.now() - startTime.getTime()) / 1000
    : allCompleted
      ? faker.number.int({ min: 3600, max: 14400 })
      : null;

  return {
    id: workflowName,
    name: workflowName,
    status: workflowStatus,
    priority: faker.helpers.arrayElement(["LOW", "NORMAL", "HIGH"]),
    pool: faker.helpers.arrayElement([
      "dgx-cloud-us-west-2",
      "gpu-cluster-prod",
      "spot-gpu-pool",
    ]),
    user: faker.helpers.arrayElement([
      "alice.chen",
      "bob.smith",
      "carol.jones",
    ]),
    submitTime,
    startTime,
    endTime: allCompleted ? new Date(startTime.getTime() + (duration || 0) * 1000) : null,
    queuedTime,
    duration,
    groups,
    totalTasks: allTasks.length,
    completedTasks: allTasks.filter((t) => t.status === TaskGroupStatus.COMPLETED).length,
    runningTasks: allTasks.filter((t) => getStatusCategory(t.status) === "running").length,
    failedTasks: allTasks.filter((t) => getStatusCategory(t.status) === "failed").length,
    waitingTasks: allTasks.filter((t) => getStatusCategory(t.status) === "waiting").length,
  };
}

// ============================================================================
// DAG Pattern Generators
// ============================================================================

function generateLinearDAG(
  workflowName: string,
  submitTime: Date,
  startTime: Date
): MockGroupNode[] {
  const groupNames = ["fetch-data", "preprocess", "train", "evaluate", "deploy"];
  const groups: MockGroupNode[] = [];
  let currentTime = startTime;

  for (let i = 0; i < groupNames.length; i++) {
    const isCompleted = i < 2;
    const isRunning = i === 2;
    const status = isCompleted
      ? TaskGroupStatus.COMPLETED
      : isRunning
        ? TaskGroupStatus.RUNNING
        : TaskGroupStatus.WAITING;

    const taskDuration = isCompleted ? faker.number.int({ min: 300, max: 1800 }) : null;
    const taskStartTime = isCompleted || isRunning ? new Date(currentTime) : null;
    const taskEndTime = isCompleted && taskDuration
      ? new Date(currentTime.getTime() + taskDuration * 1000)
      : null;

    if (taskEndTime) {
      currentTime = taskEndTime;
    }

    groups.push({
      id: groupNames[i],
      name: groupNames[i],
      status,
      upstreamGroups: i > 0 ? [groupNames[i - 1]] : [],
      downstreamGroups: i < groupNames.length - 1 ? [groupNames[i + 1]] : [],
      level: i,
      lane: 0,
      tasks: [
        generateTask(
          groupNames[i],
          groupNames[i],
          status,
          submitTime,
          taskStartTime,
          taskEndTime,
          taskDuration
        ),
      ],
    });
  }

  return groups;
}

function generateDiamondDAG(
  workflowName: string,
  submitTime: Date,
  startTime: Date
): MockGroupNode[] {
  // Diamond pattern: start -> [branch-a, branch-b] -> merge -> end
  const groups: MockGroupNode[] = [];
  let currentTime = startTime;

  // Start node - completed
  groups.push({
    id: "start",
    name: "data-download",
    status: TaskGroupStatus.COMPLETED,
    upstreamGroups: [],
    downstreamGroups: ["branch-a", "branch-b"],
    level: 0,
    lane: 1,
    tasks: [
      generateTask("start-0", "data-download", TaskGroupStatus.COMPLETED, submitTime, currentTime, new Date(currentTime.getTime() + 300000), 300),
    ],
  });
  currentTime = new Date(currentTime.getTime() + 300000);

  // Branch A - completed
  groups.push({
    id: "branch-a",
    name: "preprocess-images",
    status: TaskGroupStatus.COMPLETED,
    upstreamGroups: ["start"],
    downstreamGroups: ["merge"],
    level: 1,
    lane: 0,
    tasks: [
      generateTask("branch-a-0", "preprocess-images", TaskGroupStatus.COMPLETED, submitTime, currentTime, new Date(currentTime.getTime() + 600000), 600),
    ],
  });

  // Branch B - running
  groups.push({
    id: "branch-b",
    name: "preprocess-labels",
    status: TaskGroupStatus.RUNNING,
    upstreamGroups: ["start"],
    downstreamGroups: ["merge"],
    level: 1,
    lane: 2,
    tasks: [
      generateTask("branch-b-0", "preprocess-labels", TaskGroupStatus.RUNNING, submitTime, currentTime, null, null),
    ],
  });

  // Merge node - waiting
  groups.push({
    id: "merge",
    name: "merge-data",
    status: TaskGroupStatus.WAITING,
    upstreamGroups: ["branch-a", "branch-b"],
    downstreamGroups: ["end"],
    level: 2,
    lane: 1,
    tasks: [
      generateTask("merge-0", "merge-data", TaskGroupStatus.WAITING, submitTime, null, null, null),
    ],
  });

  // End node - waiting
  groups.push({
    id: "end",
    name: "train",
    status: TaskGroupStatus.WAITING,
    upstreamGroups: ["merge"],
    downstreamGroups: [],
    level: 3,
    lane: 1,
    tasks: [
      generateTask("end-0", "train", TaskGroupStatus.WAITING, submitTime, null, null, null),
    ],
  });

  return groups;
}

function generateParallelDAG(
  workflowName: string,
  submitTime: Date,
  startTime: Date
): MockGroupNode[] {
  // Parallel training: start -> [train-0..train-7] -> aggregate
  const groups: MockGroupNode[] = [];
  const numShards = 8;

  // Start node - completed
  groups.push({
    id: "preprocess",
    name: "preprocess",
    status: TaskGroupStatus.COMPLETED,
    upstreamGroups: [],
    downstreamGroups: Array.from({ length: numShards }, (_, i) => `train-${i}`),
    level: 0,
    lane: Math.floor(numShards / 2),
    tasks: [
      generateTask("preprocess-0", "preprocess", TaskGroupStatus.COMPLETED, submitTime, startTime, new Date(startTime.getTime() + 300000), 300),
    ],
  });

  // Training shards - mix of completed, running
  const shardStatuses: TaskGroupStatus[] = [];
  for (let i = 0; i < numShards; i++) {
    if (i < 3) {
      shardStatuses.push(TaskGroupStatus.COMPLETED);
    } else if (i < 6) {
      shardStatuses.push(TaskGroupStatus.RUNNING);
    } else {
      shardStatuses.push(TaskGroupStatus.INITIALIZING);
    }
  }

  const shardTasks: MockTaskNode[] = [];
  for (let i = 0; i < numShards; i++) {
    const taskStartTime = new Date(startTime.getTime() + 300000 + i * 10000);
    const taskEndTime = shardStatuses[i] === TaskGroupStatus.COMPLETED
      ? new Date(taskStartTime.getTime() + faker.number.int({ min: 3600000, max: 7200000 }))
      : null;
    const duration = taskEndTime
      ? (taskEndTime.getTime() - taskStartTime.getTime()) / 1000
      : shardStatuses[i] === TaskGroupStatus.RUNNING
        ? (Date.now() - taskStartTime.getTime()) / 1000
        : null;

    shardTasks.push(
      generateTask(
        `train-shard-${i}`,
        `train-shard-${i}`,
        shardStatuses[i],
        submitTime,
        taskStartTime,
        taskEndTime,
        duration
      )
    );

    groups.push({
      id: `train-${i}`,
      name: `train-shard-${i}`,
      status: shardStatuses[i],
      upstreamGroups: ["preprocess"],
      downstreamGroups: ["aggregate"],
      level: 1,
      lane: i,
      tasks: [shardTasks[i]],
    });
  }

  // Aggregate - waiting
  groups.push({
    id: "aggregate",
    name: "aggregate",
    status: TaskGroupStatus.WAITING,
    upstreamGroups: Array.from({ length: numShards }, (_, i) => `train-${i}`),
    downstreamGroups: [],
    level: 2,
    lane: Math.floor(numShards / 2),
    tasks: [
      generateTask("aggregate-0", "aggregate", TaskGroupStatus.WAITING, submitTime, null, null, null),
    ],
  });

  return groups;
}

function generateComplexDAG(
  workflowName: string,
  submitTime: Date,
  startTime: Date
): MockGroupNode[] {
  /**
   * Complex DAG pattern:
   *
   *                    ┌──────────┐
   *                    │  fetch   │
   *                    └────┬─────┘
   *            ┌────────────┼────────────┐
   *            ▼            ▼            ▼
   *      ┌──────────┐ ┌──────────┐ ┌──────────┐
   *      │ validate │ │preproc-a │ │preproc-b │
   *      └────┬─────┘ └────┬─────┘ └────┬─────┘
   *            └────────────┼────────────┘
   *                         ▼
   *                    ┌──────────┐
   *                    │  train   │  (4 parallel tasks)
   *                    └────┬─────┘
   *                         ▼
   *                    ┌──────────┐
   *                    │ evaluate │
   *                    └────┬─────┘
   *            ┌────────────┴────────────┐
   *            ▼                         ▼
   *      ┌──────────┐              ┌──────────┐
   *      │  export  │              │  report  │
   *      └────┬─────┘              └────┬─────┘
   *            └────────────┬────────────┘
   *                         ▼
   *                    ┌──────────┐
   *                    │  deploy  │
   *                    └──────────┘
   */

  const groups: MockGroupNode[] = [];
  let currentTime = startTime;

  // Level 0: fetch (completed)
  const fetchDuration = 180;
  const fetchEnd = new Date(currentTime.getTime() + fetchDuration * 1000);
  groups.push({
    id: "fetch",
    name: "fetch-data",
    status: TaskGroupStatus.COMPLETED,
    upstreamGroups: [],
    downstreamGroups: ["validate", "preproc-a", "preproc-b"],
    level: 0,
    lane: 1,
    tasks: [
      generateTask("fetch-0", "fetch-dataset", TaskGroupStatus.COMPLETED, submitTime, currentTime, fetchEnd, fetchDuration),
    ],
  });
  currentTime = fetchEnd;

  // Level 1: validate, preproc-a, preproc-b (completed)
  groups.push({
    id: "validate",
    name: "validate",
    status: TaskGroupStatus.COMPLETED,
    upstreamGroups: ["fetch"],
    downstreamGroups: ["train"],
    level: 1,
    lane: 0,
    tasks: [
      generateTask("validate-0", "validate-schema", TaskGroupStatus.COMPLETED, submitTime, currentTime, new Date(currentTime.getTime() + 120000), 120),
    ],
  });

  groups.push({
    id: "preproc-a",
    name: "preprocess-images",
    status: TaskGroupStatus.COMPLETED,
    upstreamGroups: ["fetch"],
    downstreamGroups: ["train"],
    level: 1,
    lane: 1,
    tasks: [
      generateTask("preproc-a-0", "preprocess-images", TaskGroupStatus.COMPLETED, submitTime, currentTime, new Date(currentTime.getTime() + 600000), 600),
    ],
  });

  groups.push({
    id: "preproc-b",
    name: "preprocess-labels",
    status: TaskGroupStatus.COMPLETED,
    upstreamGroups: ["fetch"],
    downstreamGroups: ["train"],
    level: 1,
    lane: 2,
    tasks: [
      generateTask("preproc-b-0", "preprocess-labels", TaskGroupStatus.COMPLETED, submitTime, currentTime, new Date(currentTime.getTime() + 480000), 480),
    ],
  });

  currentTime = new Date(currentTime.getTime() + 600000); // Longest branch

  // Level 2: train (4 parallel tasks, mix of completed and running)
  const trainTasks: MockTaskNode[] = [];
  for (let i = 0; i < 4; i++) {
    const taskStartTime = new Date(currentTime.getTime() + i * 5000);
    const status = i < 1
      ? TaskGroupStatus.COMPLETED
      : i < 3
        ? TaskGroupStatus.RUNNING
        : TaskGroupStatus.INITIALIZING;
    const taskDuration = status === TaskGroupStatus.COMPLETED ? 3600 : null;
    const taskEndTime = status === TaskGroupStatus.COMPLETED
      ? new Date(taskStartTime.getTime() + 3600000)
      : null;

    trainTasks.push(
      generateTask(`train-${i}`, `train-shard-${i}`, status, submitTime, taskStartTime, taskEndTime, taskDuration)
    );
  }

  groups.push({
    id: "train",
    name: "train",
    status: TaskGroupStatus.RUNNING,
    upstreamGroups: ["validate", "preproc-a", "preproc-b"],
    downstreamGroups: ["evaluate"],
    level: 2,
    lane: 1,
    tasks: trainTasks,
  });

  // Level 3: evaluate (waiting)
  groups.push({
    id: "evaluate",
    name: "evaluate",
    status: TaskGroupStatus.WAITING,
    upstreamGroups: ["train"],
    downstreamGroups: ["export", "report"],
    level: 3,
    lane: 1,
    tasks: [
      generateTask("evaluate-0", "run-benchmarks", TaskGroupStatus.WAITING, submitTime, null, null, null),
    ],
  });

  // Level 4: export, report (waiting)
  groups.push({
    id: "export",
    name: "export-model",
    status: TaskGroupStatus.WAITING,
    upstreamGroups: ["evaluate"],
    downstreamGroups: ["deploy"],
    level: 4,
    lane: 0,
    tasks: [
      generateTask("export-0", "export-onnx", TaskGroupStatus.WAITING, submitTime, null, null, null),
    ],
  });

  groups.push({
    id: "report",
    name: "generate-report",
    status: TaskGroupStatus.WAITING,
    upstreamGroups: ["evaluate"],
    downstreamGroups: ["deploy"],
    level: 4,
    lane: 2,
    tasks: [
      generateTask("report-0", "generate-report", TaskGroupStatus.WAITING, submitTime, null, null, null),
    ],
  });

  // Level 5: deploy (waiting)
  groups.push({
    id: "deploy",
    name: "deploy",
    status: TaskGroupStatus.WAITING,
    upstreamGroups: ["export", "report"],
    downstreamGroups: [],
    level: 5,
    lane: 1,
    tasks: [
      generateTask("deploy-0", "deploy-model", TaskGroupStatus.WAITING, submitTime, null, null, null),
    ],
  });

  return groups;
}

// ============================================================================
// Task Generator Helper
// ============================================================================

function generateTask(
  id: string,
  name: string,
  status: TaskGroupStatus,
  submitTime: Date,
  startTime: Date | null,
  endTime: Date | null,
  duration: number | null
): MockTaskNode {
  const category = getStatusCategory(status);
  const hasGpu = faker.datatype.boolean({ probability: 0.7 });
  const gpu = hasGpu ? faker.helpers.arrayElement([1, 2, 4, 8]) : 0;
  const cpu = gpu > 0 ? gpu * faker.number.int({ min: 8, max: 16 }) : faker.number.int({ min: 2, max: 8 });

  // Generate lifecycle phases
  const phases: MockTaskNode["phases"] = [];
  if (startTime) {
    // Processing phase
    const processingDuration = faker.number.int({ min: 1, max: 10 });
    const processingEnd = new Date(startTime.getTime() + processingDuration * 1000);
    phases.push({
      name: "Processing",
      startTime: startTime,
      endTime: processingEnd,
      duration: processingDuration,
    });

    // Scheduling phase
    const schedulingDuration = faker.number.int({ min: 5, max: 60 });
    const schedulingEnd = new Date(processingEnd.getTime() + schedulingDuration * 1000);
    phases.push({
      name: "Scheduling",
      startTime: processingEnd,
      endTime: schedulingEnd,
      duration: schedulingDuration,
    });

    // Initializing phase
    const initDuration = faker.number.int({ min: 10, max: 120 });
    const initEnd = new Date(schedulingEnd.getTime() + initDuration * 1000);
    phases.push({
      name: "Initializing",
      startTime: schedulingEnd,
      endTime: category === "running" || category === "completed" ? initEnd : null,
      duration: category === "running" || category === "completed" ? initDuration : null,
    });

    // Running phase
    if (category === "running" || category === "completed") {
      phases.push({
        name: "Running",
        startTime: initEnd,
        endTime: endTime,
        duration: endTime ? (endTime.getTime() - initEnd.getTime()) / 1000 : null,
      });
    }
  }

  return {
    id,
    name,
    groupId: id.split("-").slice(0, -1).join("-") || id,
    groupName: name,
    status,
    submitTime,
    startTime,
    endTime,
    duration,
    gpu,
    cpu,
    memory: cpu * 4,
    node: startTime
      ? `${faker.helpers.arrayElement(["dgx", "gpu", "node"])}-${faker.helpers.arrayElement(["a100", "h100", "l40s"])}-${faker.number.int({ min: 1, max: 999 }).toString().padStart(3, "0")}`
      : null,
    phases,
    failureMessage: category === "failed"
      ? faker.helpers.arrayElement([
          "Process exited with code 1",
          "CUDA error: out of memory",
          "RuntimeError: NCCL error",
        ])
      : undefined,
    exitCode: category === "completed" ? 0 : category === "failed" ? 1 : undefined,
  };
}

// ============================================================================
// Large-Scale Pattern Generators
// ============================================================================

/**
 * Massive Parallel: 1 group with 200 tasks
 * Tests rendering of many tasks within a single collapsible group
 */
function generateMassiveParallelDAG(
  workflowName: string,
  submitTime: Date,
  startTime: Date
): MockGroupNode[] {
  const groups: MockGroupNode[] = [];
  const numTasks = 200;

  // Preprocess (completed)
  groups.push({
    id: "preprocess",
    name: "preprocess",
    status: TaskGroupStatus.COMPLETED,
    upstreamGroups: [],
    downstreamGroups: ["train"],
    level: 0,
    lane: 0,
    tasks: [
      generateTask("preprocess-0", "preprocess", TaskGroupStatus.COMPLETED, submitTime, startTime, new Date(startTime.getTime() + 300000), 300),
    ],
  });

  // Train group with 200 parallel shards
  const trainTasks: MockTaskNode[] = [];
  const trainStartTime = new Date(startTime.getTime() + 300000);

  for (let i = 0; i < numTasks; i++) {
    // Mix of statuses: 40% completed, 35% running, 15% initializing, 10% waiting
    let status: TaskGroupStatus;
    let taskStartTime: Date | null = null;
    let taskEndTime: Date | null = null;
    let taskDuration: number | null = null;

    if (i < numTasks * 0.4) {
      status = TaskGroupStatus.COMPLETED;
      taskStartTime = new Date(trainStartTime.getTime() + i * 1000);
      taskDuration = faker.number.int({ min: 1800, max: 3600 });
      taskEndTime = new Date(taskStartTime.getTime() + taskDuration * 1000);
    } else if (i < numTasks * 0.75) {
      status = TaskGroupStatus.RUNNING;
      taskStartTime = new Date(trainStartTime.getTime() + i * 1000);
      taskDuration = (Date.now() - taskStartTime.getTime()) / 1000;
    } else if (i < numTasks * 0.9) {
      status = TaskGroupStatus.INITIALIZING;
      taskStartTime = new Date(Date.now() - faker.number.int({ min: 10000, max: 60000 }));
    } else {
      status = TaskGroupStatus.SCHEDULING;
    }

    trainTasks.push(
      generateTask(
        `train-shard-${i}`,
        `train-shard-${i.toString().padStart(3, "0")}`,
        status,
        submitTime,
        taskStartTime,
        taskEndTime,
        taskDuration
      )
    );
  }

  groups.push({
    id: "train",
    name: "distributed-training",
    status: TaskGroupStatus.RUNNING,
    upstreamGroups: ["preprocess"],
    downstreamGroups: ["aggregate"],
    level: 1,
    lane: 0,
    tasks: trainTasks,
  });

  // Aggregate (waiting)
  groups.push({
    id: "aggregate",
    name: "aggregate",
    status: TaskGroupStatus.WAITING,
    upstreamGroups: ["train"],
    downstreamGroups: [],
    level: 2,
    lane: 0,
    tasks: [
      generateTask("aggregate-0", "aggregate-checkpoints", TaskGroupStatus.WAITING, submitTime, null, null, null),
    ],
  });

  return groups;
}

/**
 * Many Groups: 100 groups with 5 tasks each
 * Tests rendering of many collapsible groups
 */
function generateManyGroupsDAG(
  workflowName: string,
  submitTime: Date,
  startTime: Date
): MockGroupNode[] {
  const groups: MockGroupNode[] = [];
  const numGroups = 100;
  const tasksPerGroup = 5;
  const groupsPerLevel = 10;
  const numLevels = Math.ceil(numGroups / groupsPerLevel);

  let currentTime = startTime;

  for (let level = 0; level < numLevels; level++) {
    const groupsInThisLevel = Math.min(groupsPerLevel, numGroups - level * groupsPerLevel);

    for (let lane = 0; lane < groupsInThisLevel; lane++) {
      const groupIndex = level * groupsPerLevel + lane;
      const groupId = `group-${groupIndex.toString().padStart(3, "0")}`;
      const groupName = faker.helpers.arrayElement([
        "train", "eval", "preprocess", "export", "validate", "transform", "inference"
      ]) + `-${groupIndex}`;

      // Determine group status based on level
      let groupStatus: TaskGroupStatus;
      if (level < numLevels * 0.3) {
        groupStatus = TaskGroupStatus.COMPLETED;
      } else if (level < numLevels * 0.5) {
        groupStatus = TaskGroupStatus.RUNNING;
      } else {
        groupStatus = TaskGroupStatus.WAITING;
      }

      // Generate tasks for this group
      const tasks: MockTaskNode[] = [];
      for (let t = 0; t < tasksPerGroup; t++) {
        const taskStatus = groupStatus === TaskGroupStatus.COMPLETED
          ? TaskGroupStatus.COMPLETED
          : groupStatus === TaskGroupStatus.RUNNING
            ? faker.helpers.arrayElement([TaskGroupStatus.COMPLETED, TaskGroupStatus.RUNNING, TaskGroupStatus.RUNNING])
            : TaskGroupStatus.WAITING;

        const taskStartTime = taskStatus !== TaskGroupStatus.WAITING ? currentTime : null;
        const taskDuration = taskStatus === TaskGroupStatus.COMPLETED ? faker.number.int({ min: 300, max: 1200 }) : null;
        const taskEndTime = taskDuration ? new Date(currentTime.getTime() + taskDuration * 1000) : null;

        tasks.push(
          generateTask(
            `${groupId}-task-${t}`,
            `${groupName}-task-${t}`,
            taskStatus,
            submitTime,
            taskStartTime,
            taskEndTime,
            taskDuration
          )
        );
      }

      // Dependencies: connect to all groups in the previous level
      const upstreamGroups = level > 0
        ? Array.from({ length: Math.min(2, groupsPerLevel) }, (_, i) => {
            const prevIndex = (level - 1) * groupsPerLevel + ((lane + i) % groupsPerLevel);
            return `group-${prevIndex.toString().padStart(3, "0")}`;
          })
        : [];

      groups.push({
        id: groupId,
        name: groupName,
        status: groupStatus,
        upstreamGroups,
        downstreamGroups: [], // Will be filled by reverse lookup
        level,
        lane,
        tasks,
      });
    }

    currentTime = new Date(currentTime.getTime() + 600000); // 10 min between levels
  }

  // Fill in downstream groups
  groups.forEach((group) => {
    group.upstreamGroups.forEach((upstreamId) => {
      const upstream = groups.find((g) => g.id === upstreamId);
      if (upstream && !upstream.downstreamGroups.includes(group.id)) {
        upstream.downstreamGroups.push(group.id);
      }
    });
  });

  return groups;
}

/**
 * Multi-Root DAG: Multiple independent starting points that converge
 * Tests non-tree DAG structures
 */
function generateMultiRootDAG(
  workflowName: string,
  submitTime: Date,
  startTime: Date
): MockGroupNode[] {
  /**
   * Multi-root pattern:
   *
   *   ┌──────────┐  ┌──────────┐  ┌──────────┐
   *   │ download │  │ generate │  │  fetch   │
   *   │  images  │  │  labels  │  │  config  │
   *   └────┬─────┘  └────┬─────┘  └────┬─────┘
   *        │             │             │
   *        └──────┬──────┴─────────────┘
   *               ▼
   *         ┌──────────┐
   *         │ validate │
   *         └────┬─────┘
   *               │
   *        ┌──────┴──────┐
   *        ▼             ▼
   *   ┌──────────┐ ┌──────────┐
   *   │ train-a  │ │ train-b  │
   *   └────┬─────┘ └────┬─────┘
   *        │             │
   *        └──────┬──────┘
   *               ▼
   *         ┌──────────┐
   *         │  merge   │
   *         └────┬─────┘
   *               │
   *        ┌──────┼──────┐
   *        ▼      ▼      ▼
   *   ┌────────┐┌────────┐┌────────┐
   *   │evaluate││ export ││ report │
   *   └────┬───┘└────┬───┘└────┬───┘
   *        │         │         │
   *        └─────────┴─────────┘
   *                  ▼
   *            ┌──────────┐
   *            │  deploy  │
   *            └──────────┘
   */

  const groups: MockGroupNode[] = [];
  let currentTime = startTime;

  // Level 0: Three root nodes (completed)
  groups.push({
    id: "download-images",
    name: "download-images",
    status: TaskGroupStatus.COMPLETED,
    upstreamGroups: [],
    downstreamGroups: ["validate"],
    level: 0,
    lane: 0,
    tasks: [
      generateTask("download-images-0", "download-images", TaskGroupStatus.COMPLETED, submitTime, currentTime, new Date(currentTime.getTime() + 180000), 180),
    ],
  });

  groups.push({
    id: "generate-labels",
    name: "generate-labels",
    status: TaskGroupStatus.COMPLETED,
    upstreamGroups: [],
    downstreamGroups: ["validate"],
    level: 0,
    lane: 1,
    tasks: [
      generateTask("generate-labels-0", "generate-labels", TaskGroupStatus.COMPLETED, submitTime, currentTime, new Date(currentTime.getTime() + 240000), 240),
    ],
  });

  groups.push({
    id: "fetch-config",
    name: "fetch-config",
    status: TaskGroupStatus.COMPLETED,
    upstreamGroups: [],
    downstreamGroups: ["validate"],
    level: 0,
    lane: 2,
    tasks: [
      generateTask("fetch-config-0", "fetch-config", TaskGroupStatus.COMPLETED, submitTime, currentTime, new Date(currentTime.getTime() + 60000), 60),
    ],
  });

  currentTime = new Date(currentTime.getTime() + 240000);

  // Level 1: Validate (completed, converges from 3 roots)
  groups.push({
    id: "validate",
    name: "validate",
    status: TaskGroupStatus.COMPLETED,
    upstreamGroups: ["download-images", "generate-labels", "fetch-config"],
    downstreamGroups: ["train-a", "train-b"],
    level: 1,
    lane: 1,
    tasks: [
      generateTask("validate-0", "validate-inputs", TaskGroupStatus.COMPLETED, submitTime, currentTime, new Date(currentTime.getTime() + 120000), 120),
    ],
  });

  currentTime = new Date(currentTime.getTime() + 120000);

  // Level 2: Two parallel training branches (one completed, one running)
  const trainATasks: MockTaskNode[] = [];
  for (let i = 0; i < 4; i++) {
    trainATasks.push(
      generateTask(`train-a-${i}`, `train-a-shard-${i}`, TaskGroupStatus.COMPLETED, submitTime, currentTime, new Date(currentTime.getTime() + 1800000), 1800)
    );
  }
  groups.push({
    id: "train-a",
    name: "train-model-a",
    status: TaskGroupStatus.COMPLETED,
    upstreamGroups: ["validate"],
    downstreamGroups: ["merge"],
    level: 2,
    lane: 0,
    tasks: trainATasks,
  });

  const trainBTasks: MockTaskNode[] = [];
  for (let i = 0; i < 4; i++) {
    const status = i < 2 ? TaskGroupStatus.COMPLETED : TaskGroupStatus.RUNNING;
    trainBTasks.push(
      generateTask(
        `train-b-${i}`,
        `train-b-shard-${i}`,
        status,
        submitTime,
        currentTime,
        status === TaskGroupStatus.COMPLETED ? new Date(currentTime.getTime() + 2400000) : null,
        status === TaskGroupStatus.COMPLETED ? 2400 : null
      )
    );
  }
  groups.push({
    id: "train-b",
    name: "train-model-b",
    status: TaskGroupStatus.RUNNING,
    upstreamGroups: ["validate"],
    downstreamGroups: ["merge"],
    level: 2,
    lane: 2,
    tasks: trainBTasks,
  });

  // Level 3: Merge (waiting)
  groups.push({
    id: "merge",
    name: "merge-models",
    status: TaskGroupStatus.WAITING,
    upstreamGroups: ["train-a", "train-b"],
    downstreamGroups: ["evaluate", "export", "report"],
    level: 3,
    lane: 1,
    tasks: [
      generateTask("merge-0", "merge-checkpoints", TaskGroupStatus.WAITING, submitTime, null, null, null),
    ],
  });

  // Level 4: Three parallel outputs (waiting)
  groups.push({
    id: "evaluate",
    name: "evaluate",
    status: TaskGroupStatus.WAITING,
    upstreamGroups: ["merge"],
    downstreamGroups: ["deploy"],
    level: 4,
    lane: 0,
    tasks: [
      generateTask("evaluate-0", "run-benchmarks", TaskGroupStatus.WAITING, submitTime, null, null, null),
    ],
  });

  groups.push({
    id: "export",
    name: "export-model",
    status: TaskGroupStatus.WAITING,
    upstreamGroups: ["merge"],
    downstreamGroups: ["deploy"],
    level: 4,
    lane: 1,
    tasks: [
      generateTask("export-0", "export-onnx", TaskGroupStatus.WAITING, submitTime, null, null, null),
    ],
  });

  groups.push({
    id: "report",
    name: "generate-report",
    status: TaskGroupStatus.WAITING,
    upstreamGroups: ["merge"],
    downstreamGroups: ["deploy"],
    level: 4,
    lane: 2,
    tasks: [
      generateTask("report-0", "generate-report", TaskGroupStatus.WAITING, submitTime, null, null, null),
    ],
  });

  // Level 5: Deploy (converges from 3 branches)
  groups.push({
    id: "deploy",
    name: "deploy",
    status: TaskGroupStatus.WAITING,
    upstreamGroups: ["evaluate", "export", "report"],
    downstreamGroups: [],
    level: 5,
    lane: 1,
    tasks: [
      generateTask("deploy-0", "deploy-model", TaskGroupStatus.WAITING, submitTime, null, null, null),
    ],
  });

  return groups;
}

// ============================================================================
// Pre-built Workflow Examples
// ============================================================================

export type WorkflowPattern =
  | "linear"
  | "diamond"
  | "parallel"
  | "complex"
  | "massiveParallel"
  | "manyGroups"
  | "multiRoot";

export const EXAMPLE_WORKFLOWS: Record<WorkflowPattern, () => MockComplexWorkflow> = {
  linear: () => generateComplexWorkflow(100, { pattern: "linear" }),
  diamond: () => generateComplexWorkflow(200, { pattern: "diamond" }),
  parallel: () => generateComplexWorkflow(300, { pattern: "parallel" }),
  complex: () => generateComplexWorkflow(400, { pattern: "complex" }),
  massiveParallel: () => generateComplexWorkflow(500, { pattern: "massiveParallel" }),
  manyGroups: () => generateComplexWorkflow(600, { pattern: "manyGroups" }),
  multiRoot: () => generateComplexWorkflow(700, { pattern: "multiRoot" }),
};
