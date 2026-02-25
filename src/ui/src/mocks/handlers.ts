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
 * MSW Request Handlers
 *
 * Intercepts API requests and returns synthetic mock data.
 * Uses deterministic generation for infinite, memory-efficient pagination.
 *
 * Enable: NEXT_PUBLIC_MOCK_API=true or set mockApi in localStorage
 */

import { http, HttpResponse, delay, passthrough } from "msw";
import { faker } from "@faker-js/faker";
import { workflowGenerator } from "@/mocks/generators/workflow-generator";
import { poolGenerator } from "@/mocks/generators/pool-generator";
import { resourceGenerator } from "@/mocks/generators/resource-generator";
import { generateYamlSpec, generateTemplateSpec } from "@/mocks/generators/spec-generator";
import { logGenerator } from "@/mocks/generators/log-generator";
import { eventGenerator } from "@/mocks/generators/event-generator";
import { bucketGenerator } from "@/mocks/generators/bucket-generator";
import { datasetGenerator } from "@/mocks/generators/dataset-generator";
import { profileGenerator } from "@/mocks/generators/profile-generator";
import { portForwardGenerator } from "@/mocks/generators/portforward-generator";
import { ptySimulator, type PTYScenario } from "@/mocks/generators/pty-simulator";
import { parsePagination, parseWorkflowFilters, hasActiveFilters, getMockDelay, hashString } from "@/mocks/utils";
import { getMockWorkflow, getWorkflowLogConfig } from "@/mocks/mock-workflows";
import { MOCK_CONFIG } from "@/mocks/seed/types";

// Simulate network delay (ms) - minimal in dev for fast iteration
const MOCK_DELAY = getMockDelay();

// =============================================================================
// Stateful Mock Data (persists changes during session)
// =============================================================================

// Store profile settings that can be updated via POST
const mockProfileSettings: {
  email_notification?: boolean;
  slack_notification?: boolean;
  bucket?: string;
  pool?: string;
} = {};

// Store credentials that can be created/updated/deleted
// Maps credential name -> credential object
const mockCredentials: Map<string, unknown> = new Map();

// =============================================================================
// URL Matching Patterns
// =============================================================================
// MSW v2's `*` wildcard should match any origin, but in Next.js + Turbopack,
// server-side fetch interception can be unreliable with wildcard patterns.
// Using RegExp ensures we match both:
//   - Relative paths: /api/workflow/test/logs
//   - Absolute URLs: https://any-host.com/api/workflow/test/logs
//   - BasePath-prefixed paths: /v2/api/workflow/test/logs
//
// Pattern format: matches anything ending with /api/workflow/{name}/logs
// The `.*` prefix ensures basePath-agnostic matching (works with /v2, /v3, etc.)
const WORKFLOW_LOGS_PATTERN = /.*\/api\/workflow\/([^/]+)\/logs$/;
const TASK_LOGS_PATTERN = /.*\/api\/workflow\/([^/]+)\/task\/([^/]+)\/logs$/;

// ============================================================================
// Stream Management
// ============================================================================

// Track active streams to prevent concurrent streams for the same workflow
// (Prevents MaxListenersExceededWarning during HMR or rapid navigation)
const activeStreams = new Map<string, AbortController>();

// ============================================================================
// Handlers
// ============================================================================

export const handlers = [
  // ==========================================================================
  // Users
  // ==========================================================================

  // Get all users who have submitted workflows
  // Returns string[] of usernames (matches backend /api/users endpoint)
  http.get("*/api/users", async () => {
    await delay(MOCK_DELAY);

    // Return the list of users from mock config (workflow patterns)
    const users = MOCK_CONFIG.workflows.users;

    // Backend returns JSON string of string array (see BACKEND_TODOS.md #1)
    return HttpResponse.json(users);
  }),

  // ==========================================================================
  // Workflows
  // ==========================================================================

  // List workflows (paginated)
  // Returns SrcServiceCoreWorkflowObjectsListResponse format
  http.get("*/api/workflow", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    const { offset, limit } = parsePagination(url, { limit: 20 });
    const filters = parseWorkflowFilters(url);

    const { entries, total } = workflowGenerator.generatePage(offset, limit);

    // Apply filters if provided
    let filtered = entries;
    if (filters.statuses.length > 0) {
      filtered = filtered.filter((w) => filters.statuses.includes(w.status));
    }
    if (filters.pools.length > 0) {
      filtered = filtered.filter((w) => w.pool && filters.pools.includes(w.pool));
    }
    if (filters.users.length > 0) {
      filtered = filtered.filter((w) => filters.users.includes(w.submitted_by));
    }

    // Transform to API response format (SrcServiceCoreWorkflowObjectsListEntry)
    const workflows = filtered.map((w) => ({
      user: w.submitted_by,
      name: w.name,
      workflow_uuid: w.uuid,
      submit_time: w.submit_time,
      start_time: w.start_time,
      end_time: w.end_time,
      queued_time: w.queued_time,
      duration: w.duration,
      status: w.status,
      overview: `${w.groups.length} groups, ${w.groups.reduce((sum, g) => sum + g.tasks.length, 0)} tasks`,
      logs: w.logs_url,
      error_logs: w.status.toString().startsWith("FAILED") ? `/api/workflow/${w.name}/logs?type=error` : undefined,
      grafana_url: `https://grafana.example.com/d/workflow/${w.name}`,
      dashboard_url: `https://dashboard.example.com/workflow/${w.name}`,
      pool: w.pool,
      app_owner: undefined,
      app_name: undefined,
      app_version: undefined,
      priority: w.priority,
    }));

    // When filters are active, don't report more entries (we've filtered the full set)
    const moreEntries = hasActiveFilters(filters) ? false : offset + limit < total;

    return HttpResponse.json({
      workflows,
      more_entries: moreEntries,
    });
  }),

  // Get single workflow
  // Returns WorkflowQueryResponse format
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.get("*/api/workflow/:name", async ({ params }) => {
    await delay(MOCK_DELAY);

    const name = params.name as string;

    // Check for mock workflows first (for log-viewer experimental page)
    const mockWorkflow = getMockWorkflow(name);
    if (mockWorkflow) {
      return HttpResponse.json(mockWorkflow);
    }

    const workflow = workflowGenerator.getByName(name);

    if (!workflow) {
      return new HttpResponse(null, { status: 404 });
    }

    // Transform groups to API format (GroupQueryResponse)
    const groups = workflow.groups.map((g) => ({
      name: g.name,
      status: g.status,
      start_time: g.tasks[0]?.start_time,
      end_time: g.tasks[g.tasks.length - 1]?.end_time,
      remaining_upstream_groups: g.upstream_groups.length > 0 ? g.upstream_groups : undefined,
      downstream_groups: g.downstream_groups.length > 0 ? g.downstream_groups : undefined,
      failure_message: g.failure_message,
      // Tasks: include all fields matching TaskQueryResponse
      tasks: g.tasks.map((t) => ({
        name: t.name,
        retry_id: t.retry_id,
        status: t.status,
        lead: t.lead,
        // Identifiers
        task_uuid: t.task_uuid,
        pod_name: t.pod_name,
        pod_ip: t.pod_ip,
        node_name: t.node_name,
        // Timeline timestamps
        scheduling_start_time: t.scheduling_start_time,
        initializing_start_time: t.initializing_start_time,
        input_download_start_time: t.input_download_start_time,
        input_download_end_time: t.input_download_end_time,
        processing_start_time: t.processing_start_time,
        start_time: t.start_time,
        output_upload_start_time: t.output_upload_start_time,
        end_time: t.end_time,
        // Status
        exit_code: t.exit_code,
        failure_message: t.failure_message,
        // URLs
        logs: t.logs,
        error_logs: t.error_logs,
        events: t.events,
        dashboard_url: t.dashboard_url,
        grafana_url: t.grafana_url,
      })),
    }));

    // Transform to WorkflowQueryResponse format
    const response = {
      name: workflow.name,
      uuid: workflow.uuid,
      submitted_by: workflow.submitted_by,
      cancelled_by: workflow.cancelled_by,
      spec: workflow.spec_url,
      template_spec: workflow.template_spec_url,
      logs: workflow.logs_url,
      events: workflow.events_url,
      overview: `${workflow.groups.length} groups, ${workflow.groups.reduce((sum, g) => sum + g.tasks.length, 0)} tasks`,
      dashboard_url: `https://dashboard.example.com/workflow/${workflow.name}`,
      grafana_url: `https://grafana.example.com/d/workflow/${workflow.name}`,
      tags: workflow.tags,
      submit_time: workflow.submit_time,
      start_time: workflow.start_time,
      end_time: workflow.end_time,
      duration: workflow.duration,
      queued_time: workflow.queued_time,
      status: workflow.status,
      groups,
      pool: workflow.pool,
      backend: workflow.backend,
      plugins: {},
      priority: workflow.priority,
    };

    return HttpResponse.json(response);
  }),

  // ==========================================================================
  // Workflow Actions (cancel, retry, delete)
  // ==========================================================================

  // Cancel workflow
  http.post("*/api/workflow/:name/cancel", async ({ params }) => {
    await delay(MOCK_DELAY);
    const name = params.name as string;
    const workflow = workflowGenerator.getByName(name);

    if (!workflow) {
      return new HttpResponse(null, { status: 404 });
    }

    // In mock mode, just return success (no actual state change persisted)
    return HttpResponse.json({ message: `Workflow ${name} cancelled` });
  }),

  // Retry workflow
  http.post("*/api/workflow/:name/retry", async ({ params }) => {
    await delay(MOCK_DELAY);
    const name = params.name as string;
    const workflow = workflowGenerator.getByName(name);

    if (!workflow) {
      return new HttpResponse(null, { status: 404 });
    }

    return HttpResponse.json({ message: `Workflow ${name} retry initiated` });
  }),

  // Delete workflow
  http.delete("*/api/workflow/:name", async ({ params }) => {
    await delay(MOCK_DELAY);
    const name = params.name as string;
    const workflow = workflowGenerator.getByName(name);

    if (!workflow) {
      return new HttpResponse(null, { status: 404 });
    }

    return HttpResponse.json({ message: `Workflow ${name} deleted` });
  }),

  // Cancel task group
  http.post("*/api/workflow/:name/groups/:groupName/cancel", async ({ params }) => {
    await delay(MOCK_DELAY);
    const name = params.name as string;
    const groupName = params.groupName as string;
    const workflow = workflowGenerator.getByName(name);

    if (!workflow) {
      return new HttpResponse(null, { status: 404 });
    }

    const group = workflow.groups.find((g) => g.name === groupName);
    if (!group) {
      return new HttpResponse(null, { status: 404 });
    }

    return HttpResponse.json({ message: `Group ${groupName} in workflow ${name} cancelled` });
  }),

  // Retry task group
  http.post("*/api/workflow/:name/groups/:groupName/retry", async ({ params }) => {
    await delay(MOCK_DELAY);
    const name = params.name as string;
    const groupName = params.groupName as string;
    const workflow = workflowGenerator.getByName(name);

    if (!workflow) {
      return new HttpResponse(null, { status: 404 });
    }

    const group = workflow.groups.find((g) => g.name === groupName);
    if (!group) {
      return new HttpResponse(null, { status: 404 });
    }

    return HttpResponse.json({ message: `Group ${groupName} in workflow ${name} retry initiated` });
  }),

  // ==========================================================================
  // Workflow Submission / Resubmit
  // ==========================================================================

  // Submit/Resubmit workflow to pool
  // POST /api/pool/{pool_name}/workflow?workflow_id={id}&priority={priority}
  // Body: TemplateSpec with { file, set_variables, ... }
  // Returns: SubmitResponse with new workflow name
  http.post("*/api/pool/:poolName/workflow", async ({ params, request }) => {
    await delay(MOCK_DELAY);

    const poolName = params.poolName as string;
    const url = new URL(request.url);
    const workflowId = url.searchParams.get("workflow_id");

    // Validate pool exists
    const pool = poolGenerator.getByName(poolName);
    if (!pool) {
      return HttpResponse.json({ detail: `Pool ${poolName} not found` }, { status: 404 });
    }

    // Generate a new workflow name for the resubmitted workflow
    // Use deterministic seeding based on workflow_id + timestamp for uniqueness
    const seed = workflowId ? hashString(workflowId + Date.now()) : Math.floor(Math.random() * 1000000);
    faker.seed(seed);

    const prefix = faker.helpers.arrayElement(MOCK_CONFIG.workflows.namePatterns.prefixes);
    const suffix = faker.helpers.arrayElement(MOCK_CONFIG.workflows.namePatterns.suffixes);
    const id = faker.string.alphanumeric(8).toLowerCase();
    const newWorkflowName = `${prefix}-${suffix}-${id}`;

    // Return SubmitResponse format (matching generated API types)
    return HttpResponse.json({
      name: newWorkflowName,
      overview: `/api/workflow/${newWorkflowName}`,
      logs: `/api/workflow/${newWorkflowName}/logs`,
      spec: `/api/workflow/${newWorkflowName}/spec`,
      dashboard_url: `/workflows/${newWorkflowName}`,
    });
  }),

  // ==========================================================================
  // Workflow Logs
  // ==========================================================================

  // Workflow logs (with streaming support)
  // Matches real backend: /api/workflow/{name}/logs from workflow_service.py:711-749
  //
  // Real backend params:
  //   - last_n_lines: int - limit to last N lines
  //   - task_name: str - filter to specific task
  //   - retry_id: int - filter to specific retry
  //   - query: str - regex filter pattern
  //   - tail: bool - enable streaming mode
  //
  // Scenario detection: Based on workflow ID pattern
  //   - Embedded in mock-workflows.ts _logConfig
  //   - getWorkflowLogConfig(workflowName) returns scenario config
  //
  // Uses RegExp for reliable matching of both relative paths and absolute URLs
  // This ensures server-side fetch (Next.js API routes) is properly intercepted
  http.get(WORKFLOW_LOGS_PATTERN, async ({ request }) => {
    // Extract workflow name from URL using pathname
    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/api\/workflow\/([^/]+)\/logs$/);
    const name = pathMatch ? decodeURIComponent(pathMatch[1]) : "unknown";

    // Abort any existing stream for this workflow to prevent concurrent streams
    // This prevents MaxListenersExceededWarning during HMR or rapid navigation
    const streamKey = `workflow:${name}`;
    const existingController = activeStreams.get(streamKey);
    if (existingController) {
      existingController.abort();
      activeStreams.delete(streamKey);
    }

    // Real backend params
    const taskFilter = url.searchParams.get("task_name");
    const taskId = url.searchParams.get("task_id");
    const groupId = url.searchParams.get("group_id");

    // Get workflow metadata (check mock workflows first, then generated workflows)
    const mockWorkflow = getMockWorkflow(name);
    const workflow = mockWorkflow ?? workflowGenerator.getByName(name);

    // Determine which tasks to include in logs
    let taskNames: string[];
    if (taskId) {
      // Task-scoped: find task by UUID and use its name
      const task = workflow?.groups.flatMap((g) => g.tasks ?? []).find((t) => t.task_uuid === taskId);
      taskNames = task ? [task.name] : [];
    } else if (groupId) {
      // Group-scoped: include all tasks in the group
      const group = workflow?.groups.find((g) => g.name === groupId);
      taskNames = group?.tasks?.map((t) => t.name) ?? [];
    } else if (taskFilter) {
      // Legacy task_name filter
      taskNames = [taskFilter];
    } else {
      // Workflow-scoped: include all tasks
      taskNames = workflow?.groups.flatMap((g) => g.tasks?.map((t) => t.name) ?? []) ?? ["main"];
    }

    // Extract time range from workflow metadata for realistic log timestamps
    const workflowStartTime = workflow?.start_time ? new Date(workflow.start_time) : undefined;

    // ALL workflows now stream (matches new unified architecture)
    // - Completed workflows (end_time exists): Generate all logs upfront, stream in chunks (object storage)
    // - Running workflows (end_time undefined): Stream infinitely with realistic delays (real-time)
    const encoder = new TextEncoder();
    const isCompleted = workflow?.end_time !== undefined;

    let stream: ReadableStream<Uint8Array>;

    if (isCompleted) {
      // Completed workflows: Generate all logs synchronously and stream in chunks
      // This simulates reading from object storage (fast, no line-by-line delays)
      const allLogs = logGenerator.generateForWorkflow({
        workflowName: name,
        taskNames,
        startTime: workflowStartTime,
        endTime: workflow?.end_time ? new Date(workflow.end_time) : undefined,
      });

      // Stream in chunks (~64KB each) to simulate network transfer
      const CHUNK_SIZE = 64 * 1024; // 64KB chunks
      const chunks: string[] = [];
      for (let i = 0; i < allLogs.length; i += CHUNK_SIZE) {
        chunks.push(allLogs.slice(i, i + CHUNK_SIZE));
      }

      stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });
    } else {
      // Running workflows: Stream with delays to simulate real-time log generation
      const abortController = new AbortController();

      // Register this controller so concurrent requests can abort it
      activeStreams.set(streamKey, abortController);

      const streamGen = logGenerator.createStream({
        workflowName: name,
        taskNames,
        continueFrom: workflowStartTime,
        signal: abortController.signal,
      });

      stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const line of streamGen) {
              controller.enqueue(encoder.encode(line));
            }
          } catch {
            // Stream closed, aborted, or error occurred
          } finally {
            // Clean up the active stream tracker
            activeStreams.delete(streamKey);
            try {
              controller.close();
            } catch {
              // Already closed
            }
          }
        },
        cancel() {
          // Signal the async generator to stop yielding immediately
          abortController.abort();
          // Clean up immediately on cancel
          activeStreams.delete(streamKey);
        },
      });
    }

    return new HttpResponse(stream, {
      headers: {
        "Content-Type": "text/plain; charset=us-ascii",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      },
    });
  }),

  // NOTE: /api/workflow/:name/logs/stream was removed - not a real backend endpoint
  // Streaming is handled via the regular /logs endpoint with Transfer-Encoding: chunked

  // Workflow events
  // Backend returns PlainTextResponse (streaming text via Redis Streams), not JSON
  // Query params: task_name, retry_id (optional - for task-specific filtering)
  // Format: {ISO timestamp} [{entity}] {reason}: {message}
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  //
  // Streaming behavior (mirrors log endpoint):
  // - Terminal workflows (end_time exists): Generate all events upfront, stream as ~64KB chunks
  // - Active workflows (end_time undefined): Stream existing events, then yield new events with delays
  http.get("*/api/workflow/:name/events", async ({ params, request }) => {
    await delay(MOCK_DELAY);

    const name = params.name as string;
    const url = new URL(request.url);
    const taskName = url.searchParams.get("task_name");
    // retryId unused for now - could be used to filter specific retry attempts
    // const retryId = url.searchParams.get("retry_id");

    // Check mock workflows first (e.g. mock-streaming-running), then generated workflows
    const mockWorkflow = getMockWorkflow(name);
    const workflow = mockWorkflow ?? workflowGenerator.getByName(name);
    if (!workflow) {
      return HttpResponse.text("", { status: 404 });
    }

    // Abort any existing event stream for this workflow to prevent concurrent streams
    // (Prevents MaxListenersExceededWarning during HMR or rapid navigation)
    const streamKey = `events:${name}`;
    const existingController = activeStreams.get(streamKey);
    if (existingController) {
      existingController.abort();
      activeStreams.delete(streamKey);
    }

    // ✅ Delegate event generation to generator (single source of truth)
    const events = eventGenerator.generateEventsForWorkflow(workflow, taskName ?? undefined);

    // Format to plain text lines (backend format)
    // Backend format: "2026-02-09 05:15:08+00:00" (space-separated, +00:00 timezone)
    const lines = events.map((event) => {
      const timestamp = new Date(event.first_timestamp)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, "+00:00");
      return `${timestamp} [${event.involved_object.name}] ${event.reason}: ${event.message}`;
    });

    const encoder = new TextEncoder();
    const isCompleted = workflow.end_time !== undefined;

    let stream: ReadableStream<Uint8Array>;

    if (isCompleted) {
      // Completed workflows: Generate all events synchronously and stream in chunks
      // This simulates reading from object storage (fast, no line-by-line delays)
      const allText = lines.join("\n");
      const CHUNK_SIZE = 64 * 1024; // 64KB chunks
      const chunks: string[] = [];
      for (let i = 0; i < allText.length; i += CHUNK_SIZE) {
        chunks.push(allText.slice(i, i + CHUNK_SIZE));
      }

      stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });
    } else {
      // Running workflows: Stream existing events first (catch-up), then yield new events with delays
      const abortController = new AbortController();

      // Register this controller so concurrent requests can abort it
      activeStreams.set(streamKey, abortController);

      const streamGen = eventGenerator.createStream({
        workflow,
        taskNameFilter: taskName ?? undefined,
        signal: abortController.signal,
      });

      stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            // Phase 1: Catch-up — yield all existing events immediately
            for (const line of lines) {
              controller.enqueue(encoder.encode(line + "\n"));
            }

            // Phase 2: Live — yield new events from async generator with delays
            for await (const line of streamGen) {
              controller.enqueue(encoder.encode(line));
            }
          } catch {
            // Stream closed, aborted, or error occurred
          } finally {
            // Clean up the active stream tracker
            activeStreams.delete(streamKey);
            try {
              controller.close();
            } catch {
              // Already closed
            }
          }
        },
        cancel() {
          // Signal the async generator to stop yielding immediately
          abortController.abort();
          // Clean up immediately on cancel
          activeStreams.delete(streamKey);
        },
      });
    }

    return new HttpResponse(stream, {
      headers: {
        "Content-Type": "text/plain; charset=us-ascii",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      },
    });
  }),

  // Workflow spec (resolved YAML)
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.get("*/api/workflow/:name/spec", async ({ params }) => {
    await delay(MOCK_DELAY);

    const name = params.name as string;
    const workflow = workflowGenerator.getByName(name);

    if (!workflow) {
      return new HttpResponse(null, { status: 404 });
    }

    return HttpResponse.text(generateYamlSpec(workflow));
  }),

  // Workflow template spec (Jinja template)
  // Separate endpoint for template_spec URL
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.get("*/api/workflow/:name/template-spec", async ({ params }) => {
    await delay(MOCK_DELAY);

    const name = params.name as string;
    const workflow = workflowGenerator.getByName(name);

    if (!workflow) {
      return new HttpResponse(null, { status: 404 });
    }

    return HttpResponse.text(generateTemplateSpec(workflow));
  }),

  // NOTE: /api/workflow/:name/artifacts was removed - not a real backend endpoint
  // Artifacts are accessed via bucket APIs: /api/bucket/${bucket}/query

  // ==========================================================================
  // Tasks
  // ==========================================================================

  // Get task details
  // SINGLE SOURCE OF TRUTH: Task data comes from the workflow, not a separate generator
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.get("*/api/workflow/:name/task/:taskName", async ({ params }) => {
    await delay(MOCK_DELAY);

    const workflowName = params.name as string;
    const taskName = params.taskName as string;

    const workflow = workflowGenerator.getByName(workflowName);
    if (!workflow) {
      return new HttpResponse(null, { status: 404 });
    }

    // Find the task in the workflow's groups
    for (const group of workflow.groups) {
      const task = group.tasks.find((t) => t.name === taskName);
      if (task) {
        return HttpResponse.json({
          name: task.name,
          workflow_name: workflowName,
          group_name: group.name,
          status: task.status,
          retry_id: task.retry_id,
          lead: task.lead,
          task_uuid: task.task_uuid,
          pod_name: task.pod_name,
          pod_ip: task.pod_ip,
          node_name: task.node_name,
          scheduling_start_time: task.scheduling_start_time,
          initializing_start_time: task.initializing_start_time,
          input_download_start_time: task.input_download_start_time,
          input_download_end_time: task.input_download_end_time,
          processing_start_time: task.processing_start_time,
          start_time: task.start_time,
          output_upload_start_time: task.output_upload_start_time,
          end_time: task.end_time,
          exit_code: task.exit_code,
          failure_message: task.failure_message,
          logs: task.logs,
          error_logs: task.error_logs,
          events: task.events,
          dashboard_url: task.dashboard_url,
          grafana_url: task.grafana_url,
          gpu: task.gpu,
          cpu: task.cpu,
          memory: task.memory,
          storage: task.storage,
          image: task.image,
        });
      }
    }

    return new HttpResponse(null, { status: 404 });
  }),

  // Task logs (with scenario support)
  // Query params:
  //   - log_scenario: Scenario name (normal, error-heavy, high-volume, etc.)
  //   - log_delay: Override streaming delay (ms)
  // Uses RegExp for reliable matching of both relative paths and absolute URLs
  http.get(TASK_LOGS_PATTERN, async ({ request }) => {
    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/api\/workflow\/([^/]+)\/task\/([^/]+)\/logs$/);
    const workflowName = pathMatch ? decodeURIComponent(pathMatch[1]) : "unknown";
    const taskName = pathMatch ? decodeURIComponent(pathMatch[2]) : "unknown";

    // Parse params from URL (for dev testing)
    const delayOverride = url.searchParams.get("log_delay");
    const isTailing = url.searchParams.get("tail") === "true";

    // Get workflow and task metadata (check mock workflows first)
    const mockWorkflow = getMockWorkflow(workflowName);
    const workflow = mockWorkflow ?? workflowGenerator.getByName(workflowName);
    const task = workflow?.groups.flatMap((g) => g.tasks ?? []).find((t) => t.name === taskName);

    // Extract time range from task metadata for realistic log timestamps
    const taskStartTime = task?.start_time ? new Date(task.start_time) : undefined;
    const taskEndTime = task?.end_time ? new Date(task.end_time) : undefined;

    // Task logs always stream (matches workflow logs unified architecture)
    // - Completed tasks (end_time exists): stream to EOF (finite)
    // - Running tasks (end_time undefined): stream infinitely
    if (isTailing) {
      const logConfig = getWorkflowLogConfig(workflowName);
      const streamDelay = delayOverride ? parseInt(delayOverride, 10) : (logConfig.features.streamDelayMs ?? 200);
      const encoder = new TextEncoder();

      const levels = ["INFO", "DEBUG", "WARN", "ERROR"];
      const messages = [
        "Processing batch",
        "Loading data",
        "Checkpoint saved",
        "GPU memory: 85%",
        "Epoch completed",
        "Validating output",
      ];

      let intervalId: ReturnType<typeof setInterval> | null = null;
      let lineNum = 0;

      const generateLine = (): string => {
        const now = new Date();
        const ts = now.toISOString().replace("T", " ").slice(0, 19);
        const level = lineNum % 20 === 0 ? "ERROR" : lineNum % 5 === 0 ? "WARN" : levels[lineNum % 2];
        const msg = messages[lineNum % messages.length];
        lineNum++;
        return `${ts} [${taskName}] ${level}: ${msg} (line ${lineNum})\n`;
      };

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          intervalId = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(generateLine()));
            } catch {
              if (intervalId) clearInterval(intervalId);
            }
          }, streamDelay);
        },
        cancel() {
          if (intervalId) clearInterval(intervalId);
        },
      });

      return new HttpResponse(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    // For non-streaming workflows, generate logs using workflow config
    await delay(MOCK_DELAY);

    // Generate logs using workflow's embedded configuration
    // Use task's actual time range for realistic timestamps
    const logs = logGenerator.generateForWorkflow({
      workflowName,
      taskNames: [taskName],
      startTime: taskStartTime,
      endTime: taskEndTime,
    });

    return HttpResponse.text(logs, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }),

  // Task events (DEPRECATED - use /api/workflow/:name/events?task_name=X&retry_id=Y instead)
  // Keeping for backward compatibility if any direct calls exist
  http.get("*/api/workflow/:name/task/:taskName/events", async ({ params }) => {
    await delay(MOCK_DELAY);

    const workflowName = params.name as string;
    const taskName = params.taskName as string;

    // Check mock workflows first, then generated workflows
    const mockWorkflow = getMockWorkflow(workflowName);
    const workflow = mockWorkflow ?? workflowGenerator.getByName(workflowName);
    if (!workflow) {
      return HttpResponse.text("", { status: 404 });
    }

    // Generate events for the specific task
    const events = eventGenerator.generateEventsForWorkflow(workflow, taskName);

    // Format to plain text (backend format)
    const lines = events.map((event) => {
      const timestamp = new Date(event.first_timestamp)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, "+00:00");
      return `${timestamp} [${event.involved_object.name}] ${event.reason}: ${event.message}`;
    });

    return HttpResponse.text(lines.join("\n"), {
      headers: { "Content-Type": "text/plain" },
    });
  }),

  // ==========================================================================
  // Terminal / Exec (PTY Sessions)
  // ==========================================================================

  // Create exec session - returns RouterResponse format
  // Query params: ?scenario=training|fast-output|nvidia-smi|colors|top|disconnect|normal
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.post("*/api/workflow/:name/exec/task/:taskName", async ({ params, request }) => {
    await delay(MOCK_DELAY);

    const workflowName = params.name as string;
    const taskName = params.taskName as string;

    // Check if task is running (mock: some tasks are not running)
    if (taskName.includes("completed") || taskName.includes("failed")) {
      return HttpResponse.json({ detail: "Task is not running" }, { status: 400 });
    }

    // Check for permission denied scenario
    if (taskName.includes("forbidden") || taskName.includes("private")) {
      return HttpResponse.json({ detail: "You don't have permission to exec into this task" }, { status: 403 });
    }

    // Parse scenario from request body or query
    const url = new URL(request.url);
    const scenario = (url.searchParams.get("scenario") || "normal") as PTYScenario;

    // Get shell from request body
    let shell = "/bin/bash";
    try {
      const body = (await request.json()) as { entry_command?: string };
      shell = body.entry_command || "/bin/bash";
    } catch {
      // No body, use default
    }

    // Create PTY session
    const session = ptySimulator.createSession(workflowName, taskName, shell, scenario);

    // Mock WebSocket server URL
    // In development, the mock WS server runs on port 3001 (via pnpm dev:mock-ws)
    // The shell connects to this URL for PTY simulation
    const mockWsServerUrl = "http://localhost:3001";

    // Return RouterResponse format (matches backend)
    return HttpResponse.json({
      router_address: mockWsServerUrl,
      key: session.id,
      cookie: `mock_session_${session.id}`,
      // Additional fields for mock convenience
      session_id: session.id,
      websocket_url: `/api/router/exec/${workflowName}/client/${session.id}`,
    });
  }),

  // ==========================================================================
  // Auth / User
  // ==========================================================================
  // User identity is resolved server-side from OAuth2 Proxy / Envoy headers
  // (x-auth-request-preferred-username, x-auth-request-email, x-auth-request-name,
  // x-osmo-roles) and passed to the client via React context. No /api/me endpoint needed.

  // NOTE: The following PTY session management endpoints were removed - not real backend endpoints:
  // - GET /api/workflow/:name/exec/task/:taskName/session/:sessionId
  // - GET /api/workflow/:name/exec/sessions
  // - DELETE /api/workflow/:name/exec/task/:taskName/session/:sessionId
  // The backend only provides POST /api/workflow/:name/exec/task/:taskName which returns
  // WebSocket connection info. Session management is handled client-side.

  // ==========================================================================
  // Port Forward
  // ==========================================================================

  // Create port forward
  http.post("*/api/workflow/:name/webserver/:taskName", async ({ params, request }) => {
    await delay(MOCK_DELAY);

    const workflowName = params.name as string;
    const taskName = params.taskName as string;
    const body = (await request.json()) as { port?: number };

    const response = portForwardGenerator.createSession(workflowName, taskName, body.port || 8080);

    if (!response.success) {
      return HttpResponse.json({ error: response.error }, { status: 400 });
    }

    return HttpResponse.json({
      router_address: response.router_address,
      session_key: response.session_id,
      access_url: response.access_url,
    });
  }),

  // NOTE: GET /api/workflow/:name/portforward was removed - not a real backend endpoint
  // Port forwards are created via POST /api/workflow/:name/webserver/:taskName
  // or POST /api/workflow/:name/portforward/:taskName

  // ==========================================================================
  // Pools (matches PoolResponse format for /api/pool_quota)
  // ==========================================================================

  // Get pool quotas (main endpoint for pools)
  // Returns PoolResponse: { node_sets: [{ pools: PoolResourceUsage[] }], resource_sum }
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.get("*/api/pool_quota", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    const poolsParam = url.searchParams.get("pools");
    const allPools = url.searchParams.get("all_pools") === "true";

    if (allPools) {
      return HttpResponse.json(poolGenerator.generatePoolResponse());
    }

    if (poolsParam) {
      const pools = poolsParam.split(",").map((p) => p.trim());
      return HttpResponse.json(poolGenerator.generatePoolResponse(pools));
    }

    // Default: return all pools
    return HttpResponse.json(poolGenerator.generatePoolResponse());
  }),

  // List pools - returns pool names as plain text (matches backend behavior)
  // The UI uses /api/pool_quota instead for detailed pool info
  http.get("*/api/pool", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    const allPools = url.searchParams.get("all_pools") === "true";
    const poolsParam = url.searchParams.get("pools");

    let poolNames: string[];
    if (poolsParam) {
      poolNames = poolsParam.split(",").map((p) => p.trim());
    } else if (allPools) {
      poolNames = poolGenerator.getPoolNames();
    } else {
      poolNames = poolGenerator.getPoolNames().slice(0, 10); // Default subset
    }

    // Backend returns plain text list of pool names
    return new Response(poolNames.join("\n"), {
      headers: { "Content-Type": "text/plain" },
    });
  }),

  // NOTE: /api/pool/:name was removed - not a real backend endpoint
  // Use /api/pool_quota?pools=X instead

  // NOTE: /api/pool/:name/resources was removed - not a real backend endpoint
  // Use /api/resources?pools=X instead

  // ==========================================================================
  // Resources (matches ResourcesResponse: { resources: ResourcesEntry[] })
  // ==========================================================================

  // List all resources
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.get("*/api/resources", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    const poolsParam = url.searchParams.get("pools");
    const allPools = url.searchParams.get("all_pools") === "true";

    const poolNames = poolGenerator.getPoolNames();

    if (allPools) {
      // Return all resources across all pools (uses configured totalGlobal)
      const { resources } = resourceGenerator.generateGlobalPage(poolNames, 0, resourceGenerator.totalGlobal);
      return HttpResponse.json({ resources });
    }

    if (poolsParam) {
      // Filter to specific pools
      const requestedPools = poolsParam.split(",");
      const allResources: import("@/lib/api/generated").ResourcesEntry[] = [];
      for (const pool of requestedPools) {
        const { resources } = resourceGenerator.generatePage(pool.trim(), 0, 100);
        allResources.push(...resources);
      }
      return HttpResponse.json({ resources: allResources });
    }

    // Default: return first 100 resources from first pool
    const { resources } = resourceGenerator.generatePage(poolNames[0] || "default-pool", 0, 100);
    return HttpResponse.json({ resources });
  }),

  // ==========================================================================
  // Buckets
  // ==========================================================================

  // List buckets - returns BucketInfoResponse format
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.get("*/api/bucket", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    const { offset, limit } = parsePagination(url, { limit: 50 });

    const { entries } = bucketGenerator.generateBucketPage(offset, limit);

    // Convert to BucketInfoResponse format: { buckets: { [name]: BucketInfoEntry } }
    const buckets: Record<string, { path: string; description: string; mode: string; default_cred: boolean }> = {};
    for (const entry of entries) {
      buckets[entry.name] = {
        // Map mock fields to BucketInfoEntry fields
        path: entry.endpoint || `s3://${entry.name}`,
        description: `${entry.provider} bucket in ${entry.region}`,
        mode: "rw",
        default_cred: true,
      };
    }

    return HttpResponse.json({ buckets });
  }),

  // Query bucket contents - matches /api/bucket/${bucket}/query
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.get("*/api/bucket/:bucket/query", async ({ params, request }) => {
    await delay(MOCK_DELAY);

    const bucketName = params.bucket as string;
    const url = new URL(request.url);
    const prefix = url.searchParams.get("prefix") || "";
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);

    // Generate some artifacts for the prefix
    const artifacts = bucketGenerator.generateWorkflowArtifacts(
      bucketName,
      prefix.replace("workflows/", "").replace("/", "") || "example-workflow",
      limit,
    );

    return HttpResponse.json(artifacts);
  }),

  // NOTE: /api/bucket/:name and /api/bucket/:name/list were removed - not real backend endpoints
  // Use /api/bucket for list and /api/bucket/${bucket}/query for contents

  // ==========================================================================
  // Datasets (infinite pagination)
  // ==========================================================================

  // List datasets
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  // NOTE: Client-side filtering approach - mock just returns requested count
  // The adapter handles all filtering and pagination client-side
  http.get("*/api/bucket/list_dataset", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    // Cap count at total to prevent generating 10,000 entries for the "fetch all" path
    const requestedCount = parseInt(url.searchParams.get("count") || "50", 10);
    const count = Math.min(requestedCount, datasetGenerator.totalDatasets);
    const allUsers = url.searchParams.get("all_users") !== "false";
    // dataset_type filter: mock always returns DATASET entries, so this is a no-op pass-through
    // (included for parity with backend behavior)
    // dataset_type filter: all mock entries are "DATASET", so DATASET filter is a no-op.
    // If COLLECTION is requested, return empty (mock has no collections).
    const datasetType = url.searchParams.get("dataset_type");
    if (datasetType === "COLLECTION") {
      return HttpResponse.json({ datasets: [] });
    }

    // Generate requested number of datasets
    const { entries } = datasetGenerator.generatePage(0, count);

    // Filter by user if all_users=false
    let filtered = entries;
    if (!allUsers) {
      // For mock: use first user from config as the "current user"
      const mockCurrentUser = MOCK_CONFIG.workflows.users[0];
      filtered = filtered.filter((d) => d.user === mockCurrentUser);
    }

    // Transform to backend API shape (DataListEntry)
    const datasets = filtered.map((d) => ({
      name: d.name,
      id: d.name, // Use name as id for mock
      bucket: d.bucket,
      create_time: d.created_at,
      last_created: d.updated_at,
      hash_location: d.path,
      hash_location_size: d.size_bytes,
      version_id: `v${d.version}`, // Format version as "v1", "v2", etc.
      type: "DATASET", // Backend type is either DATASET or COLLECTION
    }));

    // DataListResponse expects 'datasets' array
    return HttpResponse.json({
      datasets,
    });
  }),

  // Get dataset info
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.get("*/api/bucket/:bucket/dataset/:name/info", async ({ params, request }) => {
    await delay(MOCK_DELAY);

    const name = params.name as string;
    const dataset = datasetGenerator.getByName(name);

    if (!dataset) {
      return new HttpResponse(null, { status: 404 });
    }

    const versions = datasetGenerator.generateVersions(name);

    // Transform to backend API shape (DataInfoResponse)
    const response = {
      id: dataset.name, // Use name as id for mock
      name: dataset.name,
      bucket: dataset.bucket,
      created_by: dataset.user,
      created_date: dataset.created_at,
      hash_location: dataset.path,
      hash_location_size: dataset.size_bytes,
      labels: dataset.labels || {},
      type: "DATASET",
      versions,
    };

    // Check if path parameter is provided for file listing
    const url = new URL(request.url);
    const path = url.searchParams.get("path");
    // version param is accepted but ignored in mock — same file tree regardless of version
    // (real backend would serve version-appropriate files)

    // If path is provided, include files array in response
    if (path !== null) {
      const files = datasetGenerator.generateFileTree(name, path, dataset.bucket);
      return HttpResponse.json({
        ...response,
        files,
      });
    }

    // Default response without files
    return HttpResponse.json(response);
  }),

  // HEAD and GET preview handler for dataset files
  // Used by FilePreviewPanel to check content-type before rendering
  // Returns 200 with Content-Type based on file extension for mock public buckets
  http.head("*/api/bucket/:bucket/dataset/:name/preview", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    const filePath = url.searchParams.get("path") ?? "";
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";

    const contentTypeMap: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      mp4: "video/mp4",
      webm: "video/webm",
      pdf: "application/pdf",
      json: "application/json",
      md: "text/markdown",
      txt: "text/plain",
      parquet: "application/octet-stream",
      tfrecord: "application/octet-stream",
    };

    const contentType = contentTypeMap[ext] ?? "application/octet-stream";

    return new HttpResponse(null, {
      status: 200,
      headers: { "Content-Type": contentType },
    });
  }),

  // GET preview - returns a simple placeholder for images/text in mock
  http.get("*/api/bucket/:bucket/dataset/:name/preview", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    const filePath = url.searchParams.get("path") ?? "";
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";

    // For images: return a 1x1 placeholder pixel
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
      // 1x1 transparent PNG
      const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      return new HttpResponse(bytes, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }

    // For text/json/markdown: return sample text
    if (["txt", "md", "json"].includes(ext)) {
      return HttpResponse.text(`Mock preview for: ${filePath}`, {
        headers: { "Content-Type": ext === "json" ? "application/json" : "text/plain" },
      });
    }

    // For everything else: 200 with binary placeholder
    return new HttpResponse(new Uint8Array(8), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    });
  }),

  // NOTE: /api/bucket/collections was removed - not a real backend endpoint
  // Collections are accessed via /api/bucket/list_dataset with type filter

  // ==========================================================================
  // Profile
  // ==========================================================================

  // NOTE: /api/profile was removed - not a real backend endpoint
  // Only /api/profile/settings exists in the backend

  // Get profile settings
  http.get("*/api/profile/settings", async () => {
    await delay(MOCK_DELAY);

    const userProfile = profileGenerator.generateProfile("current.user");
    const settings = profileGenerator.generateSettings("current.user");
    // Use all pool names from patterns, not limited by volume config
    const pools = MOCK_CONFIG.pools.names;

    // Merge stored settings with generated defaults
    const emailNotification = mockProfileSettings.email_notification ?? settings.notifications.email;
    const slackNotification = mockProfileSettings.slack_notification ?? settings.notifications.slack;
    const defaultBucket = mockProfileSettings.bucket ?? settings.default_bucket;
    const defaultPool = mockProfileSettings.pool ?? settings.default_pool;

    // Ensure default pool is in accessible pools list
    const accessiblePools =
      defaultPool !== null && pools.includes(defaultPool)
        ? pools
        : defaultPool !== null
          ? [defaultPool, ...pools]
          : pools;

    // Backend returns flat structure: { profile: { username, email_notification, slack_notification, bucket, pool }, pools: string[] }
    // Adapter transforms to nested structure for UI
    // Note: Accessible buckets come from separate /api/bucket endpoint
    return HttpResponse.json({
      profile: {
        username: userProfile.email, // Backend uses email as username
        email_notification: emailNotification,
        slack_notification: slackNotification,
        bucket: defaultBucket,
        pool: defaultPool,
      },
      pools: accessiblePools,
    });
  }),

  // Update profile settings (POST, not PUT - matching backend)
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.post("*/api/profile/settings", async ({ request }) => {
    await delay(MOCK_DELAY);

    const body = (await request.json()) as Record<string, unknown>;

    // Persist settings to mock storage
    if ("email_notification" in body) {
      mockProfileSettings.email_notification = body.email_notification as boolean;
    }
    if ("slack_notification" in body) {
      mockProfileSettings.slack_notification = body.slack_notification as boolean;
    }
    if ("bucket" in body) {
      mockProfileSettings.bucket = body.bucket as string;
    }
    if ("pool" in body) {
      mockProfileSettings.pool = body.pool as string;
    }

    return HttpResponse.json({ ...body, updated_at: new Date().toISOString() });
  }),

  // ==========================================================================
  // Credentials
  // ==========================================================================

  // Get credentials list (production format: { json: [...] })
  http.get("*/api/credentials", async () => {
    await delay(MOCK_DELAY);

    // If we have stored credentials, return those; otherwise return generated defaults
    if (mockCredentials.size > 0) {
      const credentials = Array.from(mockCredentials.values());
      return HttpResponse.json({ json: credentials });
    }

    // First time: generate defaults and store them
    const credentials = profileGenerator.generateCredentials(5);
    for (const cred of credentials) {
      if (cred && typeof cred === "object" && "cred_name" in cred) {
        mockCredentials.set(cred.cred_name as string, cred);
      }
    }
    return HttpResponse.json({ json: credentials });
  }),

  // Create credential (POST /api/credentials/{name})
  // Note: Updates are not supported - credentials must be deleted and recreated
  http.post("*/api/credentials/:name", async ({ params, request }) => {
    await delay(MOCK_DELAY);

    const name = params.name as string;
    const body = (await request.json()) as Record<string, unknown>;

    // Determine credential type and extract profile value
    let cred_type: "REGISTRY" | "DATA" | "GENERIC" = "GENERIC";
    let profile: string | null = null;

    if (body.registry_credential && typeof body.registry_credential === "object") {
      cred_type = "REGISTRY";
      const reg = body.registry_credential as Record<string, unknown>;
      profile = String(reg.registry || "");
    } else if (body.data_credential && typeof body.data_credential === "object") {
      cred_type = "DATA";
      const data = body.data_credential as Record<string, unknown>;
      profile = String(data.endpoint || "");
    } else if (body.generic_credential && typeof body.generic_credential === "object") {
      cred_type = "GENERIC";
      profile = null; // Generic credentials don't have a profile
    }

    // Create credential in production format
    const credential = {
      cred_name: name,
      cred_type,
      profile,
    };

    // Store the credential
    mockCredentials.set(name, credential);

    return HttpResponse.json(credential);
  }),

  // Delete credential
  http.delete("*/api/credentials/:name", async ({ params }) => {
    await delay(MOCK_DELAY);

    const name = params.name as string;
    // Remove from storage
    mockCredentials.delete(name);
    return HttpResponse.json({ message: `Credential ${name} deleted` });
  }),

  // ==========================================================================
  // Auth
  // ==========================================================================
  //
  // In production, authentication is handled by Envoy sidecar:
  // - Login: Envoy redirects to OAuth provider (Keycloak)
  // - Callback: Envoy handles at /v2/getAToken
  // - Token refresh: Envoy manages automatically
  // - Logout: Envoy handles at /v2/logout
  // - User info: OAuth2 Proxy injects x-auth-request-* headers and Envoy forwards Bearer token
  //
  // In mock mode (local dev), auth is disabled for simplicity.
  // Custom OAuth routes (/auth/callback, /auth/initiate, /auth/refresh_token)
  // have been removed - they are not needed with Envoy.
  //
  // See: src/lib/auth/README.md for details on Envoy auth integration
  // ==========================================================================

  // Backend auth endpoint - returns login configuration
  // Called by getLoginInfo() in lib/auth/login-info.ts
  http.get("*/api/auth/login", async () => {
    await delay(MOCK_DELAY);

    return HttpResponse.json({
      auth_enabled: false, // Disabled in mock mode
      device_endpoint: "",
      device_client_id: "",
      browser_endpoint: "",
      browser_client_id: "mock-client",
      token_endpoint: "",
      logout_endpoint: "",
    });
  }),

  // Next.js auth config endpoint
  // Used by AuthBackend.getConfig() to check if auth is enabled
  http.get("*/auth/login_info", async () => {
    await delay(MOCK_DELAY);

    return HttpResponse.json({
      auth_enabled: false, // Disabled in mock mode
      device_endpoint: "",
      device_client_id: "",
      browser_endpoint: "",
      browser_client_id: "mock-client",
      token_endpoint: "",
      logout_endpoint: "",
    });
  }),

  // ==========================================================================
  // Version
  // ==========================================================================

  // Uses wildcard to match both relative and absolute URLs (for server-side proxy requests)
  http.get("*/api/version", async () => {
    await delay(MOCK_DELAY);

    return HttpResponse.json({
      major: "1",
      minor: "0",
      revision: "0",
      hash: "mock-abc123",
    });
  }),

  // ==========================================================================
  // Catch-All Handler (HMR Recursion Guard)
  // ==========================================================================
  // MUST be the last handler. During HMR, there's a brief window where
  // requests may not match any handler. If passed through, they hit
  // localhost:3000 (same server) creating an infinite loop. This catch-all
  // detects recursion via a global Set and returns 503 to break the loop.
  http.all("*/api/*", async ({ request }) => {
    const url = new URL(request.url);
    const requestKey = `${request.method} ${url.pathname}`;

    if (!globalThis.__mswRecursionTracker) {
      globalThis.__mswRecursionTracker = new Set<string>();
    }

    const tracker = globalThis.__mswRecursionTracker;

    if (tracker.has(requestKey)) {
      tracker.delete(requestKey);
      return HttpResponse.json(
        { error: "Mock handler temporarily unavailable (HMR reset)", retryable: true },
        { status: 503, headers: { "Retry-After": "1" } },
      );
    }

    tracker.add(requestKey);
    setTimeout(() => tracker.delete(requestKey), 100);

    return passthrough();
  }),
];

declare global {
  var __mswRecursionTracker: Set<string> | undefined;
}

// HMR Handler Refresh: When Turbopack re-evaluates this module, push fresh
// handler instances onto the running MSW server singleton. On first load,
// __mswServer may not exist yet (instrumentation.ts creates it later).
if (globalThis.__mswServer) {
  try {
    globalThis.__mswServer.resetHandlers(...handlers);
  } catch (error) {
    console.error("[MSW] HMR: Failed to reset handlers:", error);
  }
}

// Export generator singletons so server actions can modify the same instances
export {
  workflowGenerator,
  poolGenerator,
  resourceGenerator,
  logGenerator,
  eventGenerator,
  bucketGenerator,
  datasetGenerator,
  profileGenerator,
  portForwardGenerator,
  ptySimulator,
};
