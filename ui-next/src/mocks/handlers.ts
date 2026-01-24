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

import { http, HttpResponse, delay } from "msw";
import {
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
  type PTYScenario,
  getLogScenario,
} from "./generators";
import { parsePagination, parseWorkflowFilters, hasActiveFilters, getMockDelay } from "./utils";

// Simulate network delay (ms) - minimal in dev for fast iteration
const MOCK_DELAY = getMockDelay();

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

// =============================================================================
// Log Generation Cache (HMR-Survivable)
// =============================================================================
// Cache for generated logs to avoid expensive regeneration during hot reload.
// Key format: "workflowName:scenarioName:taskFilter:retryId"
// Since generation is deterministic (seeded), caching is safe and improves dev experience.
// This maintains high-fidelity mocks while providing instant hot reload performance.
//
// HMR SURVIVAL: We store the cache on globalThis to survive module reloads.
// During HMR, the module is re-executed but globalThis persists, so cached
// raw log text remains available. This prevents expensive log re-generation.
const MSW_LOG_CACHE_KEY = "__osmoMswLogCache__";

function getGeneratedLogsCache(): Map<string, string> {
  if (typeof globalThis !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (!g[MSW_LOG_CACHE_KEY]) {
      g[MSW_LOG_CACHE_KEY] = new Map<string, string>();
    }
    return g[MSW_LOG_CACHE_KEY] as Map<string, string>;
  }
  // Fallback for non-globalThis environments (shouldn't happen in practice)
  return new Map<string, string>();
}

// Dev utility: Clear log cache when needed (e.g., when testing different scenarios)
// Usage in browser console: window.__clearLogCache()
if (typeof globalThis !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__clearLogCache = () => {
    const cache = getGeneratedLogsCache();
    const size = cache.size;
    cache.clear();
    console.log(`[MSW] Log cache cleared (${size} entries)`);
    return size;
  };
}

// ============================================================================
// Handlers
// ============================================================================

export const handlers = [
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
      template_spec: workflow.spec_url,
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

  // Workflow logs (with scenario and streaming support)
  // Matches real backend: /api/workflow/{name}/logs from workflow_service.py:711-749
  //
  // Real backend params:
  //   - last_n_lines: int - limit to last N lines
  //   - task_name: str - filter to specific task
  //   - retry_id: int - filter to specific retry
  //   - query: str - regex filter pattern
  //
  // Dev-only params (for testing):
  //   - log_scenario: Scenario name (normal, error-heavy, high-volume, etc.)
  //   - log_delay: Override streaming delay (ms)
  //
  // Uses RegExp for reliable matching of both relative paths and absolute URLs
  // This ensures server-side fetch (Next.js API routes) is properly intercepted
  http.get(WORKFLOW_LOGS_PATTERN, async ({ request }) => {
    // Extract workflow name from URL using pathname
    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/api\/workflow\/([^/]+)\/logs$/);
    const name = pathMatch ? decodeURIComponent(pathMatch[1]) : "unknown";

    // Real backend params
    const lastNLines = url.searchParams.get("last_n_lines");
    const taskFilter = url.searchParams.get("task_name");
    const retryId = url.searchParams.get("retry_id");
    const queryPattern = url.searchParams.get("query");

    // Dev-only params
    const scenarioName = url.searchParams.get("log_scenario") ?? "normal";
    const delayOverride = url.searchParams.get("log_delay");
    // tail=true means the client wants to stream continuously (useLogTail)
    // Without tail=true, return finite data even for streaming scenario
    const isTailing = url.searchParams.get("tail") === "true";

    const scenario = getLogScenario(scenarioName);
    const workflow = workflowGenerator.getByName(name);
    const taskNames = taskFilter
      ? [taskFilter]
      : (workflow?.groups.flatMap((g) => g.tasks.map((t) => t.name)) ?? ["main"]);

    // Helper function to filter logs (matches backend filter_log behavior)
    const filterLogs = (logs: string): string => {
      let lines = logs.split("\n");

      // Apply task_name + retry_id filtering (regex-based like backend fallback)
      if (taskFilter) {
        const retryNum = retryId ? parseInt(retryId, 10) : 0;
        const taskRegex =
          retryNum > 0
            ? new RegExp(`^[^ ]+ [^ ]+ \\[${taskFilter} retry-${retryNum}\\]`)
            : new RegExp(`^[^ ]+ [^ ]+ \\[${taskFilter}\\]`);
        lines = lines.filter((line) => taskRegex.test(line));
      }

      // Apply query regex filter
      if (queryPattern) {
        try {
          const regex = new RegExp(queryPattern);
          lines = lines.filter((line) => regex.test(line));
        } catch {
          // Invalid regex, skip filtering
        }
      }

      // Apply last_n_lines limit
      if (lastNLines) {
        const limit = parseInt(lastNLines, 10);
        if (!isNaN(limit) && limit > 0) {
          lines = lines.slice(-limit);
        }
      }

      return lines.join("\n");
    };

    // For streaming scenario with tail=true, return infinite ReadableStream
    // Uses HttpResponse from MSW for proper lifecycle management
    // @see https://mswjs.io/docs/http/mocking-responses/streaming/
    //
    // Only stream infinitely when:
    // 1. scenario.features.streaming is true (streaming scenario)
    // 2. isTailing is true (client explicitly requested streaming via tail=true)
    //
    // Uses setInterval instead of async loop - each tick is independent,
    // no promise chain is created, avoiding MSW's listener accumulation issue.
    if (scenario.features.streaming && isTailing) {
      const streamDelay = delayOverride ? parseInt(delayOverride, 10) : (scenario.features.streamDelayMs ?? 200);
      const encoder = new TextEncoder();

      // Pre-generate some log data to queue (simpler than async generator for MSW)
      const tasks = taskNames.length > 0 ? taskNames : ["main"];
      const levels = ["INFO", "DEBUG", "WARN", "ERROR"];
      const messages = [
        "Processing batch",
        "Loading data from storage",
        "Checkpoint saved",
        "GPU memory: 85%",
        "Epoch completed",
        "Validating output",
        "Syncing gradients",
        "LR adjusted: 0.001",
        "Cache hit: 94%",
        "Connection established",
      ];

      let intervalId: ReturnType<typeof setInterval> | null = null;
      let lineNum = 0;

      const generateLine = (): string => {
        const now = new Date();
        const ts = now.toISOString().replace("T", " ").slice(0, 19);
        const task = tasks[lineNum % tasks.length];
        const level = lineNum % 20 === 0 ? "ERROR" : lineNum % 5 === 0 ? "WARN" : levels[lineNum % 2];
        const msg = messages[lineNum % messages.length];
        lineNum++;
        return `${ts} [${task}] ${level}: ${msg} (line ${lineNum})\n`;
      };

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // setInterval is truly fire-and-forget - no promise chain
          intervalId = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(generateLine()));
            } catch {
              // Stream was closed, clean up
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
          "Content-Type": "text/plain; charset=us-ascii",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-cache",
          "X-Log-Scenario": scenarioName,
        },
      });
    }

    // For non-streaming scenarios, apply minimal delay and return all at once
    await delay(MOCK_DELAY);

    // Build cache key from workflow name, scenario, and task filter
    // Since generation is deterministic (seeded), caching is safe
    const cacheKey = `${name}:${scenarioName}:${taskFilter ?? "all"}:${retryId ?? "0"}`;

    // Check cache first - avoids expensive regeneration during hot reload
    // Uses globalThis-based cache that survives HMR
    const logCache = getGeneratedLogsCache();
    let logs = logCache.get(cacheKey);

    if (!logs) {
      // Generate logs (expensive operation - only happens once per cache key)
      logs = logGenerator.generateForScenario(name, scenarioName, taskNames);
      // Cache for future requests
      logCache.set(cacheKey, logs);
    }

    // Apply filters (matches real backend behavior)
    // Note: We cache before filtering because filters are cheap to apply
    logs = filterLogs(logs);

    // Use HttpResponse.text() from MSW for proper lifecycle management
    // Response headers match real backend from workflow_service.py:706-707
    return HttpResponse.text(logs, {
      headers: {
        "Content-Type": "text/plain; charset=us-ascii",
        "X-Content-Type-Options": "nosniff",
        "X-Log-Scenario": scenarioName, // Dev-only header for testing
        "X-Log-Count": logs.split("\n").filter(Boolean).length.toString(),
      },
    });
  }),

  // NOTE: /api/workflow/:name/logs/stream was removed - not a real backend endpoint
  // Streaming is handled via the regular /logs endpoint with Transfer-Encoding: chunked

  // Workflow events
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.get("*/api/workflow/:name/events", async ({ params }) => {
    await delay(MOCK_DELAY);

    const name = params.name as string;
    const workflow = workflowGenerator.getByName(name);

    const events = eventGenerator.generateWorkflowEvents(
      name,
      workflow?.status || "RUNNING",
      workflow?.submit_time || new Date().toISOString(),
      workflow?.start_time || undefined,
      workflow?.end_time || undefined,
    );

    return HttpResponse.json({ events });
  }),

  // Workflow spec
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.get("*/api/workflow/:name/spec", async ({ params }) => {
    await delay(MOCK_DELAY);

    const name = params.name as string;
    const workflow = workflowGenerator.getByName(name);

    const groups = workflow?.groups || [];
    const taskSpecs = groups.flatMap((g) =>
      g.tasks.map((t) => {
        return `  - name: ${t.name}
    image: ${t.image || workflow?.image || "nvcr.io/nvidia/pytorch:24.08-py3"}
    resources:
      gpu: ${t.gpu}
      cpu: ${t.cpu}
      memory: ${t.memory}Gi`;
      }),
    );

    const spec = `workflow:
  name: ${name}
  priority: ${workflow?.priority || "NORMAL"}
  pool: ${workflow?.pool || "default-pool"}
  tasks:
${taskSpecs.length > 0 ? taskSpecs.join("\n") : "  - name: main\n    image: nvcr.io/nvidia/pytorch:24.08-py3\n    resources:\n      gpu: 1\n      cpu: 8\n      memory: 32Gi"}
`;

    return HttpResponse.text(spec);
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

    // Parse scenario from URL params (for dev testing)
    const scenarioName = url.searchParams.get("log_scenario") ?? "normal";
    const delayOverride = url.searchParams.get("log_delay");
    const isTailing = url.searchParams.get("tail") === "true";

    const scenario = getLogScenario(scenarioName);
    const workflow = workflowGenerator.getByName(workflowName);
    const task = workflow?.groups.flatMap((g) => g.tasks).find((t) => t.name === taskName);

    // For streaming scenario with tail=true, use setInterval pattern (same as workflow logs)
    if (scenario.features.streaming && isTailing) {
      const streamDelay = delayOverride ? parseInt(delayOverride, 10) : (scenario.features.streamDelayMs ?? 200);
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
          "X-Log-Scenario": scenarioName,
        },
      });
    }

    // For non-streaming scenarios, use legacy task log generation or scenario-based
    await delay(MOCK_DELAY);

    // Build cache key for task logs
    const cacheKey = `task:${workflowName}:${taskName}:${scenarioName}`;

    // Check cache first - uses globalThis-based cache that survives HMR
    const taskLogCache = getGeneratedLogsCache();
    let logs = taskLogCache.get(cacheKey);

    if (!logs) {
      // If using a specific scenario, use scenario-based generation
      if (scenarioName !== "normal") {
        logs = logGenerator.generateForScenario(workflowName, scenarioName, [taskName]);
      } else {
        // Use legacy method for backward compatibility in normal case
        const status = task?.status ?? "RUNNING";
        const duration =
          task?.end_time && task?.start_time
            ? new Date(task.end_time).getTime() - new Date(task.start_time).getTime()
            : undefined;

        logs = logGenerator.generateTaskLogs(workflowName, taskName, status, duration);
      }

      // Cache the generated logs
      taskLogCache.set(cacheKey, logs);
    }

    return HttpResponse.text(logs, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...(scenarioName !== "normal" && { "X-Log-Scenario": scenarioName }),
      },
    });
  }),

  // Task events
  // SINGLE SOURCE OF TRUTH: Get task data from workflow
  http.get("*/api/workflow/:name/task/:taskName/events", async ({ params }) => {
    await delay(MOCK_DELAY);

    const workflowName = params.name as string;
    const taskName = params.taskName as string;

    const workflow = workflowGenerator.getByName(workflowName);
    const task = workflow?.groups.flatMap((g) => g.tasks).find((t) => t.name === taskName);

    const events = eventGenerator.generateTaskEvents(
      workflowName,
      taskName,
      task?.status || "RUNNING",
      task?.start_time,
      task?.end_time,
    );

    return HttpResponse.json({ events });
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
  // /api/me is NOT intercepted by MSW - it bypasses to the Next.js route handler.
  //
  // This keeps mock mode high-fidelity with production:
  // - Production: Envoy sets JWT in Authorization header → /api/me decodes it
  // - Mock: MockProvider sets JWT in cookie → /api/me decodes it (cookie fallback)
  //
  // Both use the same Next.js route handler (/api/me/route.ts) and JWT decoding.
  // No handler needed here - MSW's onUnhandledRequest: "bypass" lets it through.

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
  http.get("/api/bucket", async ({ request }) => {
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
  http.get("*/api/bucket/list_dataset", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    const { offset, limit } = parsePagination(url, { limit: 50 });

    const { entries, total } = datasetGenerator.generatePage(offset, limit);

    return HttpResponse.json({
      entries,
      total,
    });
  }),

  // Get dataset info
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.get("*/api/bucket/:bucket/dataset/:name/info", async ({ params }) => {
    await delay(MOCK_DELAY);

    const name = params.name as string;
    const dataset = datasetGenerator.getByName(name);

    if (!dataset) {
      return new HttpResponse(null, { status: 404 });
    }

    const versions = datasetGenerator.generateVersions(name);

    return HttpResponse.json({
      ...dataset,
      versions,
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

    const settings = profileGenerator.generateSettings("current.user");
    return HttpResponse.json(settings);
  }),

  // Update profile settings (POST, not PUT - matching backend)
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.post("*/api/profile/settings", async ({ request }) => {
    await delay(MOCK_DELAY);

    const body = (await request.json()) as Record<string, unknown>;
    // In a real implementation, this would persist the settings
    return HttpResponse.json({ ...body, updated_at: new Date().toISOString() });
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
  // - User info: Envoy injects x-osmo-user header and forwards Bearer token
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
];
