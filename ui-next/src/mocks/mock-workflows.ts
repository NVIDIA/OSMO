import type { WorkflowQueryResponse } from "@/lib/api/adapter";
import { WorkflowStatus, TaskGroupStatus, WorkflowPriority } from "@/lib/api/generated";

/**
 * Mock workflows for log-viewer experimental page.
 * These are independent of log scenarios and represent different workflow states.
 */

const BASE_SUBMIT_TIME = new Date("2026-01-24T10:00:00Z");

export const MOCK_WORKFLOWS: Record<string, WorkflowQueryResponse> = {
  "mock-workflow-1": {
    name: "mock-workflow-1",
    uuid: "550e8400-e29b-41d4-a716-446655440001",
    submitted_by: "user@example.com",
    status: WorkflowStatus.COMPLETED,
    priority: WorkflowPriority.NORMAL,
    pool: "default",
    backend: "kubernetes",
    tags: ["training", "llama-3", "production"],
    submit_time: BASE_SUBMIT_TIME.toISOString(),
    start_time: new Date(BASE_SUBMIT_TIME.getTime() + 30_000).toISOString(), // +30s
    end_time: new Date(BASE_SUBMIT_TIME.getTime() + 2_700_000).toISOString(), // +45m
    queued_time: 30,
    duration: 2640,
    groups: [
      {
        name: "preprocess",
        status: TaskGroupStatus.COMPLETED,
        remaining_upstream_groups: [],
        downstream_groups: ["train"],
        tasks: [
          {
            name: "preprocess",
            retry_id: 0,
            status: TaskGroupStatus.COMPLETED,
            lead: true,
            task_uuid: "task-001",
            pod_name: "preprocess-0-abc123",
            node_name: "node-1",
            start_time: new Date(BASE_SUBMIT_TIME.getTime() + 60_000).toISOString(),
            end_time: new Date(BASE_SUBMIT_TIME.getTime() + 360_000).toISOString(),
            logs: "/api/workflow/mock-workflow-1/logs?task_id=preprocess&retry_id=0",
            events: "/api/workflow/mock-workflow-1/events?task_id=preprocess&retry_id=0",
          },
        ],
      },
      {
        name: "train",
        status: TaskGroupStatus.COMPLETED,
        remaining_upstream_groups: ["preprocess"],
        downstream_groups: ["evaluate"],
        tasks: [
          {
            name: "train",
            retry_id: 0,
            status: TaskGroupStatus.COMPLETED,
            lead: true,
            task_uuid: "task-002",
            pod_name: "train-0-def456",
            node_name: "node-2",
            start_time: new Date(BASE_SUBMIT_TIME.getTime() + 420_000).toISOString(),
            end_time: new Date(BASE_SUBMIT_TIME.getTime() + 2_400_000).toISOString(),
            logs: "/api/workflow/mock-workflow-1/logs?task_id=train&retry_id=0",
            events: "/api/workflow/mock-workflow-1/events?task_id=train&retry_id=0",
          },
        ],
      },
      {
        name: "evaluate",
        status: TaskGroupStatus.COMPLETED,
        remaining_upstream_groups: ["train"],
        downstream_groups: [],
        tasks: [
          {
            name: "evaluate",
            retry_id: 0,
            status: TaskGroupStatus.COMPLETED,
            lead: true,
            task_uuid: "task-003",
            pod_name: "evaluate-0-ghi789",
            node_name: "node-3",
            start_time: new Date(BASE_SUBMIT_TIME.getTime() + 2_460_000).toISOString(),
            end_time: new Date(BASE_SUBMIT_TIME.getTime() + 2_700_000).toISOString(),
            logs: "/api/workflow/mock-workflow-1/logs?task_id=evaluate&retry_id=0",
            events: "/api/workflow/mock-workflow-1/events?task_id=evaluate&retry_id=0",
          },
        ],
      },
    ],
    spec: "/api/workflow/mock-workflow-1/spec",
    template_spec: "/api/workflow/mock-workflow-1/template-spec",
    logs: "/api/workflow/mock-workflow-1/logs",
    events: "/api/workflow/mock-workflow-1/events",
    overview: "/api/workflow/mock-workflow-1/overview",
    outputs: undefined,
    plugins: {},
  },

  "mock-workflow-2": {
    name: "mock-workflow-2",
    uuid: "550e8400-e29b-41d4-a716-446655440002",
    submitted_by: "user@example.com",
    status: WorkflowStatus.RUNNING,
    priority: WorkflowPriority.HIGH,
    pool: "default",
    backend: "kubernetes",
    tags: ["training", "gpt-4", "experiment"],
    submit_time: new Date(Date.now() - 600_000).toISOString(), // 10 minutes ago
    start_time: new Date(Date.now() - 570_000).toISOString(), // 9.5 minutes ago
    queued_time: 30,
    groups: [
      {
        name: "setup",
        status: TaskGroupStatus.COMPLETED,
        remaining_upstream_groups: [],
        downstream_groups: ["train"],
        tasks: [
          {
            name: "setup",
            retry_id: 0,
            status: TaskGroupStatus.COMPLETED,
            lead: true,
            task_uuid: "task-004",
            pod_name: "setup-0-xyz123",
            node_name: "node-1",
            start_time: new Date(Date.now() - 540_000).toISOString(),
            end_time: new Date(Date.now() - 480_000).toISOString(),
            logs: "/api/workflow/mock-workflow-2/logs?task_id=setup&retry_id=0",
            events: "/api/workflow/mock-workflow-2/events?task_id=setup&retry_id=0",
          },
        ],
      },
      {
        name: "train",
        status: TaskGroupStatus.RUNNING,
        remaining_upstream_groups: ["setup"],
        downstream_groups: [],
        tasks: [
          {
            name: "train",
            retry_id: 0,
            status: TaskGroupStatus.RUNNING,
            lead: true,
            task_uuid: "task-005",
            pod_name: "train-0-abc789",
            node_name: "node-2",
            start_time: new Date(Date.now() - 450_000).toISOString(),
            logs: "/api/workflow/mock-workflow-2/logs?task_id=train&retry_id=0",
            events: "/api/workflow/mock-workflow-2/events?task_id=train&retry_id=0",
          },
        ],
      },
    ],
    spec: "/api/workflow/mock-workflow-2/spec",
    template_spec: "/api/workflow/mock-workflow-2/template-spec",
    logs: "/api/workflow/mock-workflow-2/logs",
    events: "/api/workflow/mock-workflow-2/events",
    overview: "/api/workflow/mock-workflow-2/overview",
    outputs: undefined,
    plugins: {},
  },

  "mock-workflow-3": {
    name: "mock-workflow-3",
    uuid: "550e8400-e29b-41d4-a716-446655440003",
    submitted_by: "user@example.com",
    status: WorkflowStatus.FAILED,
    priority: WorkflowPriority.NORMAL,
    pool: "default",
    backend: "kubernetes",
    tags: ["training", "bert", "debug"],
    submit_time: BASE_SUBMIT_TIME.toISOString(),
    start_time: new Date(BASE_SUBMIT_TIME.getTime() + 15_000).toISOString(),
    end_time: new Date(BASE_SUBMIT_TIME.getTime() + 900_000).toISOString(), // +15m
    queued_time: 15,
    duration: 885,
    groups: [
      {
        name: "data_load",
        status: TaskGroupStatus.COMPLETED,
        remaining_upstream_groups: [],
        downstream_groups: ["train"],
        tasks: [
          {
            name: "data_load",
            retry_id: 0,
            status: TaskGroupStatus.COMPLETED,
            lead: true,
            task_uuid: "task-006",
            pod_name: "data-load-0-qwe123",
            node_name: "node-1",
            start_time: new Date(BASE_SUBMIT_TIME.getTime() + 30_000).toISOString(),
            end_time: new Date(BASE_SUBMIT_TIME.getTime() + 180_000).toISOString(),
            logs: "/api/workflow/mock-workflow-3/logs?task_id=data_load&retry_id=0",
            events: "/api/workflow/mock-workflow-3/events?task_id=data_load&retry_id=0",
          },
        ],
      },
      {
        name: "train",
        status: TaskGroupStatus.FAILED,
        remaining_upstream_groups: ["data_load"],
        downstream_groups: [],
        failure_message: "Training failed after 3 retries: CUDA out of memory",
        tasks: [
          {
            name: "train",
            retry_id: 0,
            status: TaskGroupStatus.FAILED,
            lead: true,
            task_uuid: "task-007-r0",
            pod_name: "train-0-aaa111",
            node_name: "node-2",
            start_time: new Date(BASE_SUBMIT_TIME.getTime() + 200_000).toISOString(),
            end_time: new Date(BASE_SUBMIT_TIME.getTime() + 320_000).toISOString(),
            failure_message: "CUDA out of memory",
            exit_code: 1,
            logs: "/api/workflow/mock-workflow-3/logs?task_id=train&retry_id=0",
            events: "/api/workflow/mock-workflow-3/events?task_id=train&retry_id=0",
          },
          {
            name: "train",
            retry_id: 1,
            status: TaskGroupStatus.FAILED,
            task_uuid: "task-007-r1",
            pod_name: "train-1-bbb222",
            node_name: "node-3",
            start_time: new Date(BASE_SUBMIT_TIME.getTime() + 400_000).toISOString(),
            end_time: new Date(BASE_SUBMIT_TIME.getTime() + 520_000).toISOString(),
            failure_message: "CUDA out of memory",
            exit_code: 1,
            logs: "/api/workflow/mock-workflow-3/logs?task_id=train&retry_id=1",
            events: "/api/workflow/mock-workflow-3/events?task_id=train&retry_id=1",
          },
          {
            name: "train",
            retry_id: 2,
            status: TaskGroupStatus.FAILED,
            task_uuid: "task-007-r2",
            pod_name: "train-2-ccc333",
            node_name: "node-2",
            start_time: new Date(BASE_SUBMIT_TIME.getTime() + 600_000).toISOString(),
            end_time: new Date(BASE_SUBMIT_TIME.getTime() + 900_000).toISOString(),
            failure_message: "CUDA out of memory",
            exit_code: 1,
            logs: "/api/workflow/mock-workflow-3/logs?task_id=train&retry_id=2",
            events: "/api/workflow/mock-workflow-3/events?task_id=train&retry_id=2",
          },
        ],
      },
    ],
    spec: "/api/workflow/mock-workflow-3/spec",
    template_spec: "/api/workflow/mock-workflow-3/template-spec",
    logs: "/api/workflow/mock-workflow-3/logs",
    events: "/api/workflow/mock-workflow-3/events",
    overview: "/api/workflow/mock-workflow-3/overview",
    outputs: undefined,
    plugins: {},
  },
};

export function getMockWorkflow(name: string): WorkflowQueryResponse | null {
  return MOCK_WORKFLOWS[name] ?? null;
}

export const MOCK_WORKFLOW_IDS = Object.keys(MOCK_WORKFLOWS);
