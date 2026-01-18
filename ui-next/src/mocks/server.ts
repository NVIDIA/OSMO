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
 * Server-side MSW setup for Next.js Server Components.
 *
 * This intercepts fetch calls made by server-side code (Server Components, API routes)
 * so that mock mode works seamlessly with our Streaming SSR architecture.
 *
 * Key features:
 * - Uses the SAME handlers as browser.ts for consistency
 * - Matches both relative (/api/*) and absolute (http://localhost:8080/api/*) URLs
 * - Enables mock mode to work with server prefetching (no double-fetch!)
 *
 * @see instrumentation.ts - where this server is started
 */
import { setupServer } from "msw/node";
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
} from "./generators";

// Simulate network delay (ms) - minimal for fast server-side rendering
const MOCK_DELAY = 0; // No delay on server - we want fast SSR!

// Backend base URL - MUST match what server-side fetch uses
// Read from env vars to match getServerApiBaseUrl() in config.ts
function getBackendUrl(): string {
  const hostname = process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME || "localhost:8080";
  const sslEnabled = process.env.NEXT_PUBLIC_OSMO_SSL_ENABLED !== "false";
  const isLocalhost = hostname.startsWith("localhost") || hostname.startsWith("127.0.0.1");
  const useSSL = sslEnabled && !isLocalhost;
  const scheme = useSSL ? "https" : "http";
  return `${scheme}://${hostname}`;
}

const BACKEND_URL = getBackendUrl();

// Next.js dev server URL - SSR/client requests may go here
const NEXTJS_URL = "http://localhost:3000";

// =============================================================================
// Helper to create handlers for relative, backend, and Next.js URLs
// =============================================================================

type HandlerFn = Parameters<typeof http.get>[1];

// Log the URLs once at startup
console.log(`[MSW Server] Backend URL: ${BACKEND_URL}`);
console.log(`[MSW Server] Next.js URL: ${NEXTJS_URL}`);

function createDualHandler(method: "get" | "post" | "put" | "delete", path: string, handler: HandlerFn) {
  const backendPath = `${BACKEND_URL}${path}`;
  const nextjsPath = `${NEXTJS_URL}${path}`;
  console.log(`[MSW Server] Registering: ${method.toUpperCase()} ${path}, ${backendPath}, ${nextjsPath}`);
  return [
    http[method](path, handler), // Relative path
    http[method](backendPath, handler), // Backend URL (production/staging)
    http[method](nextjsPath, handler), // Next.js dev server URL
  ];
}

// =============================================================================
// Server Handlers - Duplicate of browser handlers but matching absolute URLs
// =============================================================================

export const server = setupServer(
  // ===========================================================================
  // Version - Critical for app startup
  // ===========================================================================
  ...createDualHandler("get", "/api/version", async () => {
    await delay(MOCK_DELAY);
    return HttpResponse.json({
      major: "1",
      minor: "0",
      revision: "0",
      hash: "mock-abc123",
    });
  }),

  // ===========================================================================
  // Auth endpoints
  // ===========================================================================
  ...createDualHandler("get", "/api/auth/login", async () => {
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

  // Next.js API routes for auth
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
    return HttpResponse.json({ redirectTo: null });
  }),

  // ===========================================================================
  // Workflows
  // ===========================================================================
  ...createDualHandler("get", "/api/workflow", async ({ request }) => {
    await delay(MOCK_DELAY);
    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const statusFilter = url.searchParams.getAll("statuses");
    const poolFilter = url.searchParams.getAll("pools");
    const userFilter = url.searchParams.getAll("users");

    const { entries, total } = workflowGenerator.generatePage(offset, limit);

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
      priority: w.priority,
    }));

    const hasFilters = statusFilter.length > 0 || poolFilter.length > 0 || userFilter.length > 0;
    const moreEntries = hasFilters ? false : offset + limit < total;

    return HttpResponse.json({ workflows, more_entries: moreEntries });
  }),

  // Get single workflow (with path parameter)
  http.get(`${BACKEND_URL}/api/workflow/:name`, async ({ params }) => {
    await delay(MOCK_DELAY);
    const name = params.name as string;
    const workflow = workflowGenerator.getByName(name);
    if (!workflow) return new HttpResponse(null, { status: 404 });

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
        lead: t.lead,
        task_uuid: t.task_uuid,
        pod_name: t.pod_name,
        pod_ip: t.pod_ip,
        node_name: t.node_name,
        scheduling_start_time: t.scheduling_start_time,
        initializing_start_time: t.initializing_start_time,
        input_download_start_time: t.input_download_start_time,
        input_download_end_time: t.input_download_end_time,
        processing_start_time: t.processing_start_time,
        start_time: t.start_time,
        output_upload_start_time: t.output_upload_start_time,
        end_time: t.end_time,
        exit_code: t.exit_code,
        failure_message: t.failure_message,
        logs: t.logs,
        error_logs: t.error_logs,
        events: t.events,
        dashboard_url: t.dashboard_url,
        grafana_url: t.grafana_url,
      })),
    }));

    return HttpResponse.json({
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
    });
  }),
  // Also match relative path
  http.get("/api/workflow/:name", async ({ params }) => {
    await delay(MOCK_DELAY);
    const name = params.name as string;
    const workflow = workflowGenerator.getByName(name);
    if (!workflow) return new HttpResponse(null, { status: 404 });

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
        lead: t.lead,
        task_uuid: t.task_uuid,
        pod_name: t.pod_name,
        pod_ip: t.pod_ip,
        node_name: t.node_name,
        scheduling_start_time: t.scheduling_start_time,
        initializing_start_time: t.initializing_start_time,
        input_download_start_time: t.input_download_start_time,
        input_download_end_time: t.input_download_end_time,
        processing_start_time: t.processing_start_time,
        start_time: t.start_time,
        output_upload_start_time: t.output_upload_start_time,
        end_time: t.end_time,
        exit_code: t.exit_code,
        failure_message: t.failure_message,
        logs: t.logs,
        error_logs: t.error_logs,
        events: t.events,
        dashboard_url: t.dashboard_url,
        grafana_url: t.grafana_url,
      })),
    }));

    return HttpResponse.json({
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
    });
  }),

  // Workflow logs
  ...createDualHandler("get", "/api/workflow/:name/logs", async ({ params }) => {
    await delay(MOCK_DELAY);
    const name = params.name as string;
    const workflow = workflowGenerator.getByName(name);
    const taskNames = workflow?.groups.flatMap((g) => g.tasks.map((t) => t.name)) || ["main"];
    const logs = logGenerator.generateWorkflowLogs(name, taskNames, workflow?.status || "RUNNING");
    return HttpResponse.text(logs);
  }),

  // Workflow events
  ...createDualHandler("get", "/api/workflow/:name/events", async ({ params }) => {
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

  // ===========================================================================
  // Pools
  // ===========================================================================
  ...createDualHandler("get", "/api/pool_quota", async ({ request }) => {
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

    return HttpResponse.json(poolGenerator.generatePoolResponse());
  }),

  ...createDualHandler("get", "/api/pool", async ({ request }) => {
    await delay(MOCK_DELAY);
    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const { entries, total } = poolGenerator.generatePage(offset, limit);
    return HttpResponse.json({ entries, total });
  }),

  ...createDualHandler("get", "/api/pool/:name", async ({ params }) => {
    await delay(MOCK_DELAY);
    const name = params.name as string;
    const pool = poolGenerator.getByName(name);
    if (!pool) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(pool);
  }),

  ...createDualHandler("get", "/api/pool/:name/resources", async ({ params }) => {
    await delay(MOCK_DELAY);
    const poolName = params.name as string;
    const { resources } = resourceGenerator.generatePage(poolName, 0, 100);
    return HttpResponse.json({ resources });
  }),

  // ===========================================================================
  // Resources
  // ===========================================================================
  ...createDualHandler("get", "/api/resources", async ({ request }) => {
    await delay(MOCK_DELAY);
    const url = new URL(request.url);
    const poolsParam = url.searchParams.get("pools");
    const allPools = url.searchParams.get("all_pools") === "true";
    const poolNames = poolGenerator.getPoolNames();

    if (allPools) {
      const { resources } = resourceGenerator.generateGlobalPage(poolNames, 0, resourceGenerator.totalGlobal);
      return HttpResponse.json({ resources });
    }

    if (poolsParam) {
      const requestedPools = poolsParam.split(",");
      const allResources: import("@/lib/api/generated").ResourcesEntry[] = [];
      for (const pool of requestedPools) {
        const { resources } = resourceGenerator.generatePage(pool.trim(), 0, 100);
        allResources.push(...resources);
      }
      return HttpResponse.json({ resources: allResources });
    }

    const { resources } = resourceGenerator.generatePage(poolNames[0] || "default-pool", 0, 100);
    return HttpResponse.json({ resources });
  }),

  // ===========================================================================
  // Buckets
  // ===========================================================================
  ...createDualHandler("get", "/api/bucket", async ({ request }) => {
    await delay(MOCK_DELAY);
    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const { entries, total } = bucketGenerator.generateBucketPage(offset, limit);
    return HttpResponse.json({ entries, total });
  }),

  ...createDualHandler("get", "/api/bucket/:name", async ({ params }) => {
    await delay(MOCK_DELAY);
    const name = params.name as string;
    const bucket = bucketGenerator.getBucketByName(name);
    if (!bucket) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(bucket);
  }),

  // ===========================================================================
  // Datasets
  // ===========================================================================
  ...createDualHandler("get", "/api/bucket/list_dataset", async ({ request }) => {
    await delay(MOCK_DELAY);
    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const { entries, total } = datasetGenerator.generatePage(offset, limit);
    return HttpResponse.json({ entries, total });
  }),

  // ===========================================================================
  // Profile
  // ===========================================================================
  ...createDualHandler("get", "/api/profile", async () => {
    await delay(MOCK_DELAY);
    const profile = profileGenerator.generateProfile("current.user");
    return HttpResponse.json(profile);
  }),

  ...createDualHandler("get", "/api/profile/settings", async () => {
    await delay(MOCK_DELAY);
    const settings = profileGenerator.generateSettings("current.user");
    return HttpResponse.json(settings);
  }),
);
