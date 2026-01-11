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
  taskGenerator,
  poolGenerator,
  resourceGenerator,
  logGenerator,
  eventGenerator,
  bucketGenerator,
  datasetGenerator,
  profileGenerator,
  portForwardGenerator,
  terminalSimulator,
} from "./generators";

// Simulate network delay (ms) - realistic latency
const MOCK_DELAY = 50;

// ============================================================================
// Handlers
// ============================================================================

export const handlers = [
  // ==========================================================================
  // Workflows
  // ==========================================================================

  // List workflows (paginated)
  // Returns SrcServiceCoreWorkflowObjectsListResponse format
  http.get("/api/workflow", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);

    // Optional filters
    const statusFilter = url.searchParams.getAll("statuses");
    const poolFilter = url.searchParams.getAll("pools");
    const userFilter = url.searchParams.getAll("users");

    const { entries, total } = workflowGenerator.generatePage(offset, limit);

    // Apply filters if provided
    let filtered = entries;
    if (statusFilter.length > 0) {
      filtered = filtered.filter((w) => statusFilter.includes(w.status));
    }
    if (poolFilter.length > 0) {
      filtered = filtered.filter((w) => w.pool && poolFilter.includes(w.pool));
    }
    if (userFilter.length > 0) {
      filtered = filtered.filter((w) => userFilter.includes(w.submitted_by));
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

    const hasFilters = statusFilter.length > 0 || poolFilter.length > 0 || userFilter.length > 0;
    const moreEntries = hasFilters ? false : offset + limit < total;

    return HttpResponse.json({
      workflows,
      more_entries: moreEntries,
    });
  }),

  // Get single workflow
  // Returns WorkflowQueryResponse format
  http.get("/api/workflow/:name", async ({ params }) => {
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
      tasks: g.tasks.map((t) => ({
        name: t.name,
        retry_id: t.retry_id,
        status: t.status,
        node: t.node,
        start_time: t.start_time,
        end_time: t.end_time,
        exit_code: t.exit_code,
        failure_message: t.failure_message,
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

  // Workflow logs
  http.get("/api/workflow/:name/logs", async ({ params }) => {
    await delay(MOCK_DELAY);

    const name = params.name as string;
    const workflow = workflowGenerator.getByName(name);
    const taskNames = workflow?.groups.flatMap((g) => g.tasks.map((t) => t.name)) || ["main"];

    const logs = logGenerator.generateWorkflowLogs(name, taskNames, workflow?.status || "RUNNING");

    return HttpResponse.text(logs);
  }),

  // Workflow events
  http.get("/api/workflow/:name/events", async ({ params }) => {
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
  http.get("/api/workflow/:name/spec", async ({ params }) => {
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

  // Workflow artifacts
  http.get("/api/workflow/:name/artifacts", async ({ params }) => {
    await delay(MOCK_DELAY);

    const name = params.name as string;
    const artifacts = bucketGenerator.generateWorkflowArtifacts("osmo-artifacts", name, 20);

    return HttpResponse.json(artifacts);
  }),

  // ==========================================================================
  // Tasks
  // ==========================================================================

  // Get task details
  http.get("/api/workflow/:name/task/:taskName", async ({ params }) => {
    await delay(MOCK_DELAY);

    const workflowName = params.name as string;
    const taskName = params.taskName as string;

    const task = taskGenerator.generate(workflowName, taskName);
    return HttpResponse.json(task);
  }),

  // Task logs
  http.get("/api/workflow/:name/task/:taskName/logs", async ({ params }) => {
    await delay(MOCK_DELAY);

    const workflowName = params.name as string;
    const taskName = params.taskName as string;
    const task = taskGenerator.generate(workflowName, taskName);

    const logs = logGenerator.generateTaskLogs(workflowName, taskName, task.status, task.duration);

    return HttpResponse.text(logs);
  }),

  // Task events
  http.get("/api/workflow/:name/task/:taskName/events", async ({ params }) => {
    await delay(MOCK_DELAY);

    const workflowName = params.name as string;
    const taskName = params.taskName as string;
    const task = taskGenerator.generate(workflowName, taskName);

    const events = eventGenerator.generateTaskEvents(
      workflowName,
      taskName,
      task.status,
      task.start_time,
      task.end_time,
    );

    return HttpResponse.json({ events });
  }),

  // ==========================================================================
  // Terminal / Exec
  // ==========================================================================

  // Create exec session
  http.post("/api/workflow/:name/exec/task/:taskName", async ({ params }) => {
    await delay(MOCK_DELAY);

    const workflowName = params.name as string;
    const taskName = params.taskName as string;

    const session = terminalSimulator.createSession(workflowName, taskName);

    return HttpResponse.json({
      session_id: session.session_id,
      websocket_url: `/api/workflow/${workflowName}/task/${taskName}/exec/${session.session_id}`,
    });
  }),

  // Get exec session (for polling-based terminal)
  http.get("/api/workflow/:name/task/:taskName/exec/session", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session_id");

    if (!sessionId) {
      return new HttpResponse(null, { status: 400 });
    }

    const session = terminalSimulator.getSession(sessionId);
    if (!session) {
      return new HttpResponse(null, { status: 404 });
    }

    return HttpResponse.json({
      ...session,
      prompt: terminalSimulator.getPrompt(session),
    });
  }),

  // Execute command in session
  http.post("/api/workflow/:name/task/:taskName/exec/:sessionId", async ({ params, request }) => {
    await delay(MOCK_DELAY);

    const sessionId = params.sessionId as string;
    const body = (await request.json()) as { command: string };

    const result = terminalSimulator.executeCommand(sessionId, body.command);

    return HttpResponse.json(result);
  }),

  // ==========================================================================
  // Port Forward
  // ==========================================================================

  // Create port forward
  http.post("/api/workflow/:name/webserver/:taskName", async ({ params, request }) => {
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

  // Get active port forwards for workflow
  http.get("/api/workflow/:name/portforward", async ({ params }) => {
    await delay(MOCK_DELAY);

    const workflowName = params.name as string;
    const sessions = portForwardGenerator.getWorkflowSessions(workflowName);

    return HttpResponse.json({ sessions });
  }),

  // ==========================================================================
  // Pools (matches PoolResponse format for /api/pool_quota)
  // ==========================================================================

  // Get pool quotas (main endpoint for pools)
  // Returns PoolResponse: { node_sets: [{ pools: PoolResourceUsage[] }], resource_sum }
  http.get("/api/pool_quota", async ({ request }) => {
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

  // List pools (legacy endpoint)
  http.get("/api/pool", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);

    const { entries, total } = poolGenerator.generatePage(offset, limit);

    return HttpResponse.json({
      entries,
      total,
    });
  }),

  // Get single pool
  http.get("/api/pool/:name", async ({ params }) => {
    await delay(MOCK_DELAY);

    const name = params.name as string;
    const pool = poolGenerator.getByName(name);

    if (!pool) {
      return new HttpResponse(null, { status: 404 });
    }

    return HttpResponse.json(pool);
  }),

  // Pool resources (matches ResourcesResponse: { resources: ResourcesEntry[] })
  http.get("/api/pool/:name/resources", async ({ params }) => {
    await delay(MOCK_DELAY);

    const poolName = params.name as string;
    const { resources } = resourceGenerator.generatePage(poolName, 0, 100);

    return HttpResponse.json({ resources });
  }),

  // ==========================================================================
  // Resources (matches ResourcesResponse: { resources: ResourcesEntry[] })
  // ==========================================================================

  // List all resources
  http.get("/api/resources", async ({ request }) => {
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
  // Buckets (infinite pagination)
  // ==========================================================================

  // List buckets
  http.get("/api/bucket", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);

    const { entries, total } = bucketGenerator.generateBucketPage(offset, limit);

    return HttpResponse.json({
      entries,
      total,
    });
  }),

  // Get bucket
  http.get("/api/bucket/:name", async ({ params }) => {
    await delay(MOCK_DELAY);

    const name = params.name as string;
    const bucket = bucketGenerator.getBucketByName(name);

    if (!bucket) {
      return new HttpResponse(null, { status: 404 });
    }

    return HttpResponse.json(bucket);
  }),

  // List bucket contents
  http.get("/api/bucket/:name/list", async ({ params, request }) => {
    await delay(MOCK_DELAY);

    const bucketName = params.name as string;
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

  // ==========================================================================
  // Datasets (infinite pagination)
  // ==========================================================================

  // List datasets
  http.get("/api/bucket/list_dataset", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);

    const { entries, total } = datasetGenerator.generatePage(offset, limit);

    return HttpResponse.json({
      entries,
      total,
    });
  }),

  // Get dataset info
  http.get("/api/bucket/:bucket/dataset/:name/info", async ({ params }) => {
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

  // List dataset collections
  http.get("/api/bucket/collections", async ({ request }) => {
    await delay(MOCK_DELAY);

    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);

    const { entries, total } = datasetGenerator.generateCollectionPage(offset, limit);

    return HttpResponse.json({
      entries,
      total,
    });
  }),

  // ==========================================================================
  // Profile
  // ==========================================================================

  // Get current user profile
  http.get("/api/profile", async () => {
    await delay(MOCK_DELAY);

    const profile = profileGenerator.generateProfile("current.user");
    return HttpResponse.json(profile);
  }),

  // Get profile settings
  http.get("/api/profile/settings", async () => {
    await delay(MOCK_DELAY);

    const settings = profileGenerator.generateSettings("current.user");
    return HttpResponse.json(settings);
  }),

  // Update profile settings
  http.put("/api/profile/settings", async ({ request }) => {
    await delay(MOCK_DELAY);

    const body = (await request.json()) as Record<string, unknown>;
    // In a real implementation, this would persist the settings
    return HttpResponse.json({ ...body, updated_at: new Date().toISOString() });
  }),

  // ==========================================================================
  // Auth
  // ==========================================================================

  http.get("/api/auth/login", async () => {
    await delay(MOCK_DELAY);

    return HttpResponse.json({
      auth_enabled: true,
      browser_client_id: "mock-client",
      token_endpoint: "https://mock.auth/token",
    });
  }),

  // Next.js API routes for auth (these intercept client requests before they reach the server)
  http.get("/auth/login_info", async () => {
    await delay(MOCK_DELAY);

    return HttpResponse.json({
      auth_enabled: false,
      device_endpoint: "",
      device_client_id: "",
      browser_endpoint: "",
      browser_client_id: "mock-client",
      token_endpoint: "",
      logout_endpoint: "",
    });
  }),

  http.get("/auth/refresh_token", async () => {
    await delay(MOCK_DELAY);

    return HttpResponse.json({
      isFailure: false,
      id_token: "mock-id-token-refreshed",
      refresh_token: "mock-refresh-token-refreshed",
    });
  }),

  http.get("/auth/logout", async () => {
    await delay(MOCK_DELAY);

    return HttpResponse.json({
      redirectTo: null,
    });
  }),

  // ==========================================================================
  // Version
  // ==========================================================================

  http.get("/api/version", async () => {
    await delay(MOCK_DELAY);

    return HttpResponse.json({
      major: "1",
      minor: "0",
      revision: "0",
      hash: "mock-abc123",
    });
  }),
];
