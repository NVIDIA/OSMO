import type { WorkflowQueryResponse } from "@/lib/api/adapter";
import { WorkflowStatus, TaskGroupStatus, WorkflowPriority } from "@/lib/api/generated";
import type { LogLevel, LogIOType } from "@/lib/api/log-adapter/types";

/**
 * Mock Workflows for Log Viewer
 *
 * Each workflow embeds its log generation configuration via _logConfig.
 * This eliminates separate scenario selection - just use the workflow ID.
 *
 * WORKFLOW NAMING CONVENTION: mock-{scenario}-{status}
 *
 * Available Mock Workflows:
 * - mock-typical-completed: Standard 3-stage training (500-2000 lines)
 * - mock-typical-running: Standard 2-stage job in progress
 * - mock-typical-failed: CUDA OOM with 3 retries
 * - mock-streaming-running: Infinite log stream (100ms delay)
 * - mock-high-error-failed: 30% error rate for error handling testing
 * - mock-large-running: 50k-75k lines for performance testing
 * - mock-empty-completed: No logs (edge case testing)
 * - mock-multi-task: Complex 8-task DAG
 *
 * HOW TO ADD A NEW SCENARIO:
 * 1. Add entry to MOCK_WORKFLOWS with descriptive ID
 * 2. Embed _logConfig with desired characteristics
 * 3. MSW handler automatically uses it via getWorkflowLogConfig()
 * 4. Production code just passes workflow ID - zero scenario awareness!
 *
 * EXAMPLE USAGE:
 * ```typescript
 * // In test or dev:
 * <LogViewerContainer workflowId="mock-high-error-failed" />
 *
 * // URL:
 * /log-viewer?workflow=mock-high-error-failed
 *
 * // MSW automatically generates 28% error logs!
 * ```
 */

// =============================================================================
// Log Configuration Types
// =============================================================================

/**
 * Log generation configuration embedded in workflow metadata.
 */
export interface WorkflowLogConfig {
  /** Log volume range */
  volume: { min: number; max: number };
  /** Distribution of log levels (must sum to 1.0) */
  levelDistribution: Record<LogLevel, number>;
  /** Distribution of IO types (must sum to 1.0) */
  ioTypeDistribution: Record<LogIOType, number>;
  /** Feature flags */
  features: {
    retries: boolean;
    multiLine: boolean;
    ansiCodes: boolean;
    streaming: boolean;
    streamDelayMs?: number;
    taskCount?: number;
    maxRetryAttempt?: number;
    infinite?: boolean;
  };
}

/**
 * Extended workflow response with log configuration.
 */
export interface MockWorkflowResponse extends WorkflowQueryResponse {
  _logConfig: WorkflowLogConfig;
}

// =============================================================================
// Default Configurations
// =============================================================================

const DEFAULT_LEVEL_DISTRIBUTION: Record<LogLevel, number> = {
  debug: 0.01,
  info: 0.85,
  warn: 0.1,
  error: 0.035,
  fatal: 0.005,
};

const DEFAULT_IO_DISTRIBUTION: Record<LogIOType, number> = {
  stdout: 0.62,
  osmo_ctrl: 0.28,
  stderr: 0.05,
  download: 0.025,
  upload: 0.025,
  dump: 0,
};

const BASE_SUBMIT_TIME = new Date("2026-01-24T10:00:00Z");

// =============================================================================
// Mock Workflows
// =============================================================================

export const MOCK_WORKFLOWS: Record<string, MockWorkflowResponse> = {
  /**
   * Standard completed workflow - typical 3-stage training job.
   * Default scenario for testing completed workflows.
   */
  "mock-typical-completed": {
    name: "mock-typical-completed",
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
            logs: "/api/workflow/mock-typical-completed/logs?task_id=preprocess&retry_id=0",
            events: "/api/workflow/mock-typical-completed/events?task_id=preprocess&retry_id=0",
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
            logs: "/api/workflow/mock-typical-completed/logs?task_id=train&retry_id=0",
            events: "/api/workflow/mock-typical-completed/events?task_id=train&retry_id=0",
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
            logs: "/api/workflow/mock-typical-completed/logs?task_id=evaluate&retry_id=0",
            events: "/api/workflow/mock-typical-completed/events?task_id=evaluate&retry_id=0",
          },
        ],
      },
    ],
    spec: "/api/workflow/mock-typical-completed/spec",
    template_spec: "/api/workflow/mock-typical-completed/template-spec",
    logs: "/api/workflow/mock-typical-completed/logs",
    events: "/api/workflow/mock-typical-completed/events",
    overview: "/api/workflow/mock-typical-completed/overview",
    outputs: undefined,
    plugins: {},
    _logConfig: {
      volume: { min: 500, max: 2000 },
      levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
      ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
      features: {
        retries: false,
        multiLine: true,
        ansiCodes: false,
        streaming: false,
        taskCount: 4,
      },
    },
  },

  /**
   * Standard running workflow - typical 2-stage job in progress.
   * Default scenario for testing running workflows.
   */
  "mock-typical-running": {
    name: "mock-typical-running",
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
            logs: "/api/workflow/mock-typical-running/logs?task_id=setup&retry_id=0",
            events: "/api/workflow/mock-typical-running/events?task_id=setup&retry_id=0",
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
            logs: "/api/workflow/mock-typical-running/logs?task_id=train&retry_id=0",
            events: "/api/workflow/mock-typical-running/events?task_id=train&retry_id=0",
          },
        ],
      },
    ],
    spec: "/api/workflow/mock-typical-running/spec",
    template_spec: "/api/workflow/mock-typical-running/template-spec",
    logs: "/api/workflow/mock-typical-running/logs",
    events: "/api/workflow/mock-typical-running/events",
    overview: "/api/workflow/mock-typical-running/overview",
    outputs: undefined,
    plugins: {},
    _logConfig: {
      volume: { min: 500, max: 2000 },
      levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
      ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
      features: {
        retries: false,
        multiLine: true,
        ansiCodes: false,
        streaming: false,
        taskCount: 4,
      },
    },
  },

  /**
   * Failed workflow with retries - CUDA OOM after 3 attempts.
   * Good for testing retry UI and failure messages.
   */
  "mock-typical-failed": {
    name: "mock-typical-failed",
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
            logs: "/api/workflow/mock-typical-failed/logs?task_id=data_load&retry_id=0",
            events: "/api/workflow/mock-typical-failed/events?task_id=data_load&retry_id=0",
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
            logs: "/api/workflow/mock-typical-failed/logs?task_id=train&retry_id=0",
            events: "/api/workflow/mock-typical-failed/events?task_id=train&retry_id=0",
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
            logs: "/api/workflow/mock-typical-failed/logs?task_id=train&retry_id=1",
            events: "/api/workflow/mock-typical-failed/events?task_id=train&retry_id=1",
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
            logs: "/api/workflow/mock-typical-failed/logs?task_id=train&retry_id=2",
            events: "/api/workflow/mock-typical-failed/events?task_id=train&retry_id=2",
          },
        ],
      },
    ],
    spec: "/api/workflow/mock-typical-failed/spec",
    template_spec: "/api/workflow/mock-typical-failed/template-spec",
    logs: "/api/workflow/mock-typical-failed/logs",
    events: "/api/workflow/mock-typical-failed/events",
    overview: "/api/workflow/mock-typical-failed/overview",
    outputs: undefined,
    plugins: {},
    _logConfig: {
      volume: { min: 500, max: 2000 },
      levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
      ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
      features: {
        retries: false,
        multiLine: true,
        ansiCodes: false,
        streaming: false,
        taskCount: 4,
      },
    },
  },

  /**
   * Streaming running workflow - live tailing simulation.
   * Infinite log stream for testing real-time updates and auto-scroll.
   */
  "mock-streaming-running": {
    name: "mock-streaming-running",
    uuid: "550e8400-e29b-41d4-a716-446655440004",
    submitted_by: "user@example.com",
    status: WorkflowStatus.RUNNING,
    priority: WorkflowPriority.NORMAL,
    pool: "default",
    backend: "kubernetes",
    tags: ["training", "streaming", "live"],
    submit_time: new Date(Date.now() - 300_000).toISOString(), // 5 minutes ago
    start_time: new Date(Date.now() - 270_000).toISOString(), // 4.5 minutes ago
    queued_time: 30,
    groups: [
      {
        name: "train",
        status: TaskGroupStatus.RUNNING,
        remaining_upstream_groups: [],
        downstream_groups: [],
        tasks: [
          {
            name: "train",
            retry_id: 0,
            status: TaskGroupStatus.RUNNING,
            lead: true,
            task_uuid: "task-streaming-001",
            pod_name: "train-streaming-abc",
            node_name: "node-1",
            start_time: new Date(Date.now() - 240_000).toISOString(),
            logs: "/api/workflow/mock-streaming-running/logs?task_id=train&retry_id=0",
            events: "/api/workflow/mock-streaming-running/events?task_id=train&retry_id=0",
          },
        ],
      },
    ],
    spec: "/api/workflow/mock-streaming-running/spec",
    template_spec: "/api/workflow/mock-streaming-running/template-spec",
    logs: "/api/workflow/mock-streaming-running/logs",
    events: "/api/workflow/mock-streaming-running/events",
    overview: "/api/workflow/mock-streaming-running/overview",
    outputs: undefined,
    plugins: {},
    _logConfig: {
      volume: { min: 500, max: 1000 },
      levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
      ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
      features: {
        retries: false,
        multiLine: false,
        ansiCodes: false,
        streaming: true,
        infinite: true,
        streamDelayMs: 100,
        taskCount: 2,
      },
    },
  },

  /**
   * High-error failed workflow - extreme error rate for UI stress testing.
   * 30% errors, 20% warnings - tests error highlighting and filtering.
   */
  "mock-high-error-failed": {
    name: "mock-high-error-failed",
    uuid: "550e8400-e29b-41d4-a716-446655440005",
    submitted_by: "user@example.com",
    status: WorkflowStatus.FAILED,
    priority: WorkflowPriority.HIGH,
    pool: "default",
    backend: "kubernetes",
    tags: ["training", "error-test", "debug"],
    submit_time: BASE_SUBMIT_TIME.toISOString(),
    start_time: new Date(BASE_SUBMIT_TIME.getTime() + 20_000).toISOString(),
    end_time: new Date(BASE_SUBMIT_TIME.getTime() + 600_000).toISOString(), // +10m
    queued_time: 20,
    duration: 580,
    groups: [
      {
        name: "train",
        status: TaskGroupStatus.FAILED,
        remaining_upstream_groups: [],
        downstream_groups: [],
        failure_message: "Training failed with excessive errors",
        tasks: [
          {
            name: "train",
            retry_id: 0,
            status: TaskGroupStatus.FAILED,
            lead: true,
            task_uuid: "task-error-001",
            pod_name: "train-error-abc",
            node_name: "node-1",
            start_time: new Date(BASE_SUBMIT_TIME.getTime() + 30_000).toISOString(),
            end_time: new Date(BASE_SUBMIT_TIME.getTime() + 600_000).toISOString(),
            failure_message: "Excessive errors during training",
            exit_code: 1,
            logs: "/api/workflow/mock-high-error-failed/logs?task_id=train&retry_id=0",
            events: "/api/workflow/mock-high-error-failed/events?task_id=train&retry_id=0",
          },
        ],
      },
    ],
    spec: "/api/workflow/mock-high-error-failed/spec",
    template_spec: "/api/workflow/mock-high-error-failed/template-spec",
    logs: "/api/workflow/mock-high-error-failed/logs",
    events: "/api/workflow/mock-high-error-failed/events",
    overview: "/api/workflow/mock-high-error-failed/overview",
    outputs: undefined,
    plugins: {},
    _logConfig: {
      volume: { min: 500, max: 1000 },
      levelDistribution: {
        debug: 0.02,
        info: 0.45,
        warn: 0.2,
        error: 0.28,
        fatal: 0.05,
      },
      ioTypeDistribution: {
        stdout: 0.31,
        osmo_ctrl: 0.14,
        stderr: 0.5,
        download: 0.025,
        upload: 0.025,
        dump: 0,
      },
      features: {
        retries: false,
        multiLine: true,
        ansiCodes: false,
        streaming: false,
        taskCount: 4,
      },
    },
  },

  /**
   * Large running workflow - performance testing with 50k+ lines.
   * Tests virtualization, memory usage, and scroll performance.
   */
  "mock-large-running": {
    name: "mock-large-running",
    uuid: "550e8400-e29b-41d4-a716-446655440006",
    submitted_by: "user@example.com",
    status: WorkflowStatus.RUNNING,
    priority: WorkflowPriority.NORMAL,
    pool: "default",
    backend: "kubernetes",
    tags: ["training", "performance-test", "large"],
    submit_time: new Date(Date.now() - 3_600_000).toISOString(), // 1 hour ago
    start_time: new Date(Date.now() - 3_570_000).toISOString(), // 59.5 minutes ago
    queued_time: 30,
    groups: [
      {
        name: "train",
        status: TaskGroupStatus.RUNNING,
        remaining_upstream_groups: [],
        downstream_groups: [],
        tasks: [
          {
            name: "train",
            retry_id: 0,
            status: TaskGroupStatus.RUNNING,
            lead: true,
            task_uuid: "task-large-001",
            pod_name: "train-large-abc",
            node_name: "node-1",
            start_time: new Date(Date.now() - 3_540_000).toISOString(),
            logs: "/api/workflow/mock-large-running/logs?task_id=train&retry_id=0",
            events: "/api/workflow/mock-large-running/events?task_id=train&retry_id=0",
          },
        ],
      },
    ],
    spec: "/api/workflow/mock-large-running/spec",
    template_spec: "/api/workflow/mock-large-running/template-spec",
    logs: "/api/workflow/mock-large-running/logs",
    events: "/api/workflow/mock-large-running/events",
    overview: "/api/workflow/mock-large-running/overview",
    outputs: undefined,
    plugins: {},
    _logConfig: {
      volume: { min: 50000, max: 75000 },
      levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
      ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
      features: {
        retries: false,
        multiLine: false,
        ansiCodes: false,
        streaming: false,
        taskCount: 8,
      },
    },
  },

  /**
   * Empty completed workflow - instant completion with no logs.
   * Tests empty state UI and edge cases.
   */
  "mock-empty-completed": {
    name: "mock-empty-completed",
    uuid: "550e8400-e29b-41d4-a716-446655440007",
    submitted_by: "user@example.com",
    status: WorkflowStatus.COMPLETED,
    priority: WorkflowPriority.LOW,
    pool: "default",
    backend: "kubernetes",
    tags: ["test", "empty"],
    submit_time: BASE_SUBMIT_TIME.toISOString(),
    start_time: new Date(BASE_SUBMIT_TIME.getTime() + 5_000).toISOString(),
    end_time: new Date(BASE_SUBMIT_TIME.getTime() + 10_000).toISOString(), // +5s
    queued_time: 5,
    duration: 5,
    groups: [
      {
        name: "noop",
        status: TaskGroupStatus.COMPLETED,
        remaining_upstream_groups: [],
        downstream_groups: [],
        tasks: [
          {
            name: "noop",
            retry_id: 0,
            status: TaskGroupStatus.COMPLETED,
            lead: true,
            task_uuid: "task-empty-001",
            pod_name: "noop-empty-abc",
            node_name: "node-1",
            start_time: new Date(BASE_SUBMIT_TIME.getTime() + 6_000).toISOString(),
            end_time: new Date(BASE_SUBMIT_TIME.getTime() + 10_000).toISOString(),
            logs: "/api/workflow/mock-empty-completed/logs?task_id=noop&retry_id=0",
            events: "/api/workflow/mock-empty-completed/events?task_id=noop&retry_id=0",
          },
        ],
      },
    ],
    spec: "/api/workflow/mock-empty-completed/spec",
    template_spec: "/api/workflow/mock-empty-completed/template-spec",
    logs: "/api/workflow/mock-empty-completed/logs",
    events: "/api/workflow/mock-empty-completed/events",
    overview: "/api/workflow/mock-empty-completed/overview",
    outputs: undefined,
    plugins: {},
    _logConfig: {
      volume: { min: 0, max: 0 },
      levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
      ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
      features: {
        retries: false,
        multiLine: false,
        ansiCodes: false,
        streaming: false,
        taskCount: 1,
      },
    },
  },

  /**
   * Multi-task workflow - complex DAG with many groups and tasks.
   * Tests UI with large task counts and complex dependencies.
   */
  "mock-multi-task": {
    name: "mock-multi-task",
    uuid: "550e8400-e29b-41d4-a716-446655440008",
    submitted_by: "user@example.com",
    status: WorkflowStatus.RUNNING,
    priority: WorkflowPriority.NORMAL,
    pool: "default",
    backend: "kubernetes",
    tags: ["training", "complex", "multi-stage"],
    submit_time: new Date(Date.now() - 1_800_000).toISOString(), // 30 minutes ago
    start_time: new Date(Date.now() - 1_770_000).toISOString(),
    queued_time: 30,
    groups: [
      // Stage 1: Data preparation (3 tasks)
      {
        name: "data_prep",
        status: TaskGroupStatus.COMPLETED,
        remaining_upstream_groups: [],
        downstream_groups: ["feature_eng"],
        tasks: [
          {
            name: "download",
            retry_id: 0,
            status: TaskGroupStatus.COMPLETED,
            lead: true,
            task_uuid: "task-multi-001",
            pod_name: "download-abc",
            node_name: "node-1",
            start_time: new Date(Date.now() - 1_740_000).toISOString(),
            end_time: new Date(Date.now() - 1_620_000).toISOString(),
            logs: "/api/workflow/mock-multi-task/logs?task_id=download&retry_id=0",
            events: "/api/workflow/mock-multi-task/events?task_id=download&retry_id=0",
          },
          {
            name: "validate",
            retry_id: 0,
            status: TaskGroupStatus.COMPLETED,
            task_uuid: "task-multi-002",
            pod_name: "validate-def",
            node_name: "node-2",
            start_time: new Date(Date.now() - 1_740_000).toISOString(),
            end_time: new Date(Date.now() - 1_620_000).toISOString(),
            logs: "/api/workflow/mock-multi-task/logs?task_id=validate&retry_id=0",
            events: "/api/workflow/mock-multi-task/events?task_id=validate&retry_id=0",
          },
          {
            name: "clean",
            retry_id: 0,
            status: TaskGroupStatus.COMPLETED,
            task_uuid: "task-multi-003",
            pod_name: "clean-ghi",
            node_name: "node-3",
            start_time: new Date(Date.now() - 1_740_000).toISOString(),
            end_time: new Date(Date.now() - 1_620_000).toISOString(),
            logs: "/api/workflow/mock-multi-task/logs?task_id=clean&retry_id=0",
            events: "/api/workflow/mock-multi-task/events?task_id=clean&retry_id=0",
          },
        ],
      },
      // Stage 2: Feature engineering (2 tasks)
      {
        name: "feature_eng",
        status: TaskGroupStatus.COMPLETED,
        remaining_upstream_groups: ["data_prep"],
        downstream_groups: ["train"],
        tasks: [
          {
            name: "extract",
            retry_id: 0,
            status: TaskGroupStatus.COMPLETED,
            lead: true,
            task_uuid: "task-multi-004",
            pod_name: "extract-jkl",
            node_name: "node-1",
            start_time: new Date(Date.now() - 1_560_000).toISOString(),
            end_time: new Date(Date.now() - 1_320_000).toISOString(),
            logs: "/api/workflow/mock-multi-task/logs?task_id=extract&retry_id=0",
            events: "/api/workflow/mock-multi-task/events?task_id=extract&retry_id=0",
          },
          {
            name: "transform",
            retry_id: 0,
            status: TaskGroupStatus.COMPLETED,
            task_uuid: "task-multi-005",
            pod_name: "transform-mno",
            node_name: "node-2",
            start_time: new Date(Date.now() - 1_560_000).toISOString(),
            end_time: new Date(Date.now() - 1_320_000).toISOString(),
            logs: "/api/workflow/mock-multi-task/logs?task_id=transform&retry_id=0",
            events: "/api/workflow/mock-multi-task/events?task_id=transform&retry_id=0",
          },
        ],
      },
      // Stage 3: Training (currently running)
      {
        name: "train",
        status: TaskGroupStatus.RUNNING,
        remaining_upstream_groups: ["feature_eng"],
        downstream_groups: ["evaluate"],
        tasks: [
          {
            name: "train",
            retry_id: 0,
            status: TaskGroupStatus.RUNNING,
            lead: true,
            task_uuid: "task-multi-006",
            pod_name: "train-pqr",
            node_name: "node-3",
            start_time: new Date(Date.now() - 1_200_000).toISOString(),
            logs: "/api/workflow/mock-multi-task/logs?task_id=train&retry_id=0",
            events: "/api/workflow/mock-multi-task/events?task_id=train&retry_id=0",
          },
        ],
      },
      // Stage 4: Evaluation (waiting)
      {
        name: "evaluate",
        status: TaskGroupStatus.WAITING,
        remaining_upstream_groups: ["train"],
        downstream_groups: [],
        tasks: [
          {
            name: "metrics",
            retry_id: 0,
            status: TaskGroupStatus.WAITING,
            lead: true,
            task_uuid: "task-multi-007",
            pod_name: "",
            logs: "/api/workflow/mock-multi-task/logs?task_id=metrics&retry_id=0",
            events: "/api/workflow/mock-multi-task/events?task_id=metrics&retry_id=0",
          },
          {
            name: "report",
            retry_id: 0,
            status: TaskGroupStatus.WAITING,
            task_uuid: "task-multi-008",
            pod_name: "",
            logs: "/api/workflow/mock-multi-task/logs?task_id=report&retry_id=0",
            events: "/api/workflow/mock-multi-task/events?task_id=report&retry_id=0",
          },
        ],
      },
    ],
    spec: "/api/workflow/mock-multi-task/spec",
    template_spec: "/api/workflow/mock-multi-task/template-spec",
    logs: "/api/workflow/mock-multi-task/logs",
    events: "/api/workflow/mock-multi-task/events",
    overview: "/api/workflow/mock-multi-task/overview",
    outputs: undefined,
    plugins: {},
    _logConfig: {
      volume: { min: 2000, max: 5000 },
      levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
      ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
      features: {
        retries: false,
        multiLine: true,
        ansiCodes: false,
        streaming: false,
        taskCount: 8,
      },
    },
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

export function getMockWorkflow(name: string): MockWorkflowResponse | null {
  return MOCK_WORKFLOWS[name] ?? null;
}

export const MOCK_WORKFLOW_IDS = Object.keys(MOCK_WORKFLOWS);

/**
 * Get log configuration for a workflow.
 * Returns default config if workflow not found or no config embedded.
 */
export function getWorkflowLogConfig(workflowName: string): WorkflowLogConfig {
  const workflow = getMockWorkflow(workflowName);
  if (workflow?._logConfig) {
    return workflow._logConfig;
  }

  // Default fallback config
  return {
    volume: { min: 500, max: 2000 },
    levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
    ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
    features: {
      retries: false,
      multiLine: true,
      ansiCodes: false,
      streaming: false,
      taskCount: 3,
    },
  };
}
