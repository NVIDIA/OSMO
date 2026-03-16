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
import {
  getFastAPIMock,
  getCancelWorkflowApiWorkflowNameCancelPostMockHandler,
  getListWorkflowApiWorkflowGetMockHandler,
  getGetWorkflowApiWorkflowNameGetMockHandler,
  getSubmitWorkflowApiPoolPoolNameWorkflowPostMockHandler,
  getGetBucketInfoApiBucketGetMockHandler,
  getListDatasetFromBucketApiBucketListDatasetGetMockHandler,
  getGetInfoApiBucketBucketDatasetNameInfoGetMockHandler,
  getGetPoolQuotasApiPoolQuotaGetMockHandler,
  getGetResourcesApiResourcesGetMockHandler,
  getGetNotificationSettingsApiProfileSettingsGetMockHandler,
  getGetUserCredentialApiCredentialsGetMockHandler,
  getDeleteUsersCredentialApiCredentialsCredNameDeleteMockHandler,
  getGetVersionApiVersionGetMockHandler,
} from "@/mocks/generated-mocks";
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
import { taskSummaryGenerator } from "@/mocks/generators/task-summary-generator";
import { getMockDelay } from "@/mocks/utils";
import { getMockWorkflow } from "@/mocks/mock-workflows";

// Simulate network delay (ms) - minimal in dev for fast iteration
const MOCK_DELAY = getMockDelay();

// =============================================================================
// Stateful Mock Data (persists changes during session)
// =============================================================================


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
// Handlers
// ============================================================================

export const handlers = [
  // ==========================================================================
  // Users
  // ==========================================================================

  // Get all users who have submitted workflows
  // Backend returns JSON string of string array (see BACKEND_TODOS.md #1)
  http.get("*/api/users", workflowGenerator.handleGetUsers),

  // ==========================================================================
  // Workflows
  // ==========================================================================

  // List workflows — generated factory with generator callback
  getListWorkflowApiWorkflowGetMockHandler(workflowGenerator.handleListWorkflows),

  // Get single workflow — generated factory; checks mock-workflows first for log-viewer fixtures
  getGetWorkflowApiWorkflowNameGetMockHandler(async ({ params }) => {
    await delay(MOCK_DELAY);
    const name = params.name as string;
    const mockWorkflow = getMockWorkflow(name);
    if (mockWorkflow) return mockWorkflow as unknown as import("@/lib/api/generated").WorkflowQueryResponse;
    return workflowGenerator.toWorkflowQueryResponse(workflowGenerator.getByName(name));
  }),

  // ==========================================================================
  // Workflow Actions (cancel, retry, delete)
  // ==========================================================================

  // Cancel workflow — generated factory (getByName never returns null in mock mode)
  getCancelWorkflowApiWorkflowNameCancelPostMockHandler(),

  // Retry workflow
  http.post("*/api/workflow/:name/retry", async ({ params }) => {
    await delay(MOCK_DELAY);
    return HttpResponse.json({ message: `Workflow ${params.name as string} retry initiated` });
  }),

  // Delete workflow
  http.delete("*/api/workflow/:name", async ({ params }) => {
    await delay(MOCK_DELAY);
    return HttpResponse.json({ message: `Workflow ${params.name as string} deleted` });
  }),

  // Cancel task group
  http.post("*/api/workflow/:name/groups/:groupName/cancel", async ({ params }) => {
    await delay(MOCK_DELAY);
    return HttpResponse.json({ message: `Group ${params.groupName as string} in workflow ${params.name as string} cancelled` });
  }),

  // Retry task group
  http.post("*/api/workflow/:name/groups/:groupName/retry", async ({ params }) => {
    await delay(MOCK_DELAY);
    return HttpResponse.json({ message: `Group ${params.groupName as string} in workflow ${params.name as string} retry initiated` });
  }),

  // ==========================================================================
  // Workflow Submission / Resubmit
  // ==========================================================================

  // Submit/Resubmit workflow to pool — generated factory with generator callback
  getSubmitWorkflowApiPoolPoolNameWorkflowPostMockHandler(workflowGenerator.handleSubmitWorkflow),

  // ==========================================================================
  // Workflow Logs
  // ==========================================================================

  // Workflow logs (with streaming support)
  // Uses RegExp for reliable matching of both relative paths and absolute URLs
  http.get(WORKFLOW_LOGS_PATTERN, async ({ request }) => {
    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/api\/workflow\/([^/]+)\/logs$/);
    const name = pathMatch ? decodeURIComponent(pathMatch[1]) : "unknown";
    const workflow = getMockWorkflow(name) ?? workflowGenerator.getByName(name);
    return logGenerator.handleWorkflowLogs(request, name, workflow);
  }),

  // NOTE: /api/workflow/:name/logs/stream was removed - not a real backend endpoint
  // Streaming is handled via the regular /logs endpoint with Transfer-Encoding: chunked

  // Workflow events
  http.get("*/api/workflow/:name/events", async ({ params, request }) => {
    const name = params.name as string;
    const workflow = getMockWorkflow(name) ?? workflowGenerator.getByName(name);
    return eventGenerator.handleWorkflowEvents(request, name, workflow);
  }),

  // Task-scoped events (task name comes from path, not query param)
  http.get("*/api/workflow/:name/task/:taskName/events", async ({ params, request }) => {
    const name = params.name as string;
    const taskName = params.taskName as string;
    const workflow = getMockWorkflow(name) ?? workflowGenerator.getByName(name);
    return eventGenerator.handleWorkflowEvents(request, name, workflow, taskName);
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

  // Get task details — SINGLE SOURCE OF TRUTH: task data comes from the workflow generator
  http.get("*/api/workflow/:name/task/:taskName", workflowGenerator.handleGetTask),

  // Task logs (with streaming support)
  // Uses RegExp for reliable matching of both relative paths and absolute URLs
  http.get(TASK_LOGS_PATTERN, async ({ request }) => {
    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/api\/workflow\/([^/]+)\/task\/([^/]+)\/logs$/);
    const workflowName = pathMatch ? decodeURIComponent(pathMatch[1]) : "unknown";
    const taskName = pathMatch ? decodeURIComponent(pathMatch[2]) : "unknown";
    const workflow = getMockWorkflow(workflowName) ?? workflowGenerator.getByName(workflowName);
    const task = workflow.groups.flatMap((g) => g.tasks ?? []).find((t) => t.name === taskName);
    return logGenerator.handleTaskLogs(request, workflowName, taskName, task);
  }),

  // ==========================================================================
  // Terminal / Exec (PTY Sessions)
  // ==========================================================================

  // Create exec session - returns RouterResponse format
  // Query params: ?scenario=training|fast-output|nvidia-smi|colors|top|disconnect|normal
  // Uses wildcard to ensure basePath-agnostic matching (works with /v2, /v3, etc.)
  http.post("*/api/workflow/:name/exec/task/:taskName", async ({ params }) => {
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

    const sessionId = faker.string.uuid();

    // Return RouterResponse format (matches backend).
    // In mock mode the WS server runs on port 3001 (pnpm dev:mock-ws).
    return HttpResponse.json({
      router_address: "http://localhost:3001",
      key: session.id,
      cookie: `mock_session_${session.id}`,
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

  // Get pool quotas — returns PoolResponse: { node_sets: [{ pools: PoolResourceUsage[] }], resource_sum }
  getGetPoolQuotasApiPoolQuotaGetMockHandler(poolGenerator.handleGetPoolQuota),

  // List pools — returns pool names as plain text (matches backend behavior)
  http.get("*/api/pool", poolGenerator.handleListPools),

  // ==========================================================================
  // Resources (matches ResourcesResponse: { resources: ResourcesEntry[] })
  // ==========================================================================

  // List all resources — generated factory with generator callback
  getGetResourcesApiResourcesGetMockHandler(async ({ request }) =>
    resourceGenerator.handleListResources(request, poolGenerator.getPoolNames()),
  ),

  // ==========================================================================
  // Buckets
  // ==========================================================================

  // List buckets - generated factory with generator callback
  getGetBucketInfoApiBucketGetMockHandler(bucketGenerator.handleListBuckets),

  // List datasets - generated factory with generator callback
  getListDatasetFromBucketApiBucketListDatasetGetMockHandler(datasetGenerator.handleListDatasets),

  // Get dataset or collection info - generated factory with generator callback
  getGetInfoApiBucketBucketDatasetNameInfoGetMockHandler(datasetGenerator.handleGetDatasetInfo),

  // Dataset location files — returns a flat file manifest for a dataset version's location URL
  http.get("*/api/datasets/location-files", datasetGenerator.handleGetLocationFiles),

  // HEAD + GET /proxy/dataset/file — preflight + content for file preview panel
  // Uses http.all because http.head() does not reliably intercept HEAD requests via mock tunnel
  http.all("*/proxy/dataset/file", datasetGenerator.handleFileProxy),

  // HEAD + GET /api/bucket/:bucket/dataset/:name/preview — file preview panel
  http.head("*/api/bucket/:bucket/dataset/:name/preview", datasetGenerator.handleFilePreviewHead),
  http.get("*/api/bucket/:bucket/dataset/:name/preview", datasetGenerator.handleFilePreviewGet),

  // NOTE: /api/bucket/collections was removed - not a real backend endpoint
  // Collections are accessed via /api/bucket/list_dataset with type filter

  // ==========================================================================
  // Profile + Credentials
  // ==========================================================================

  // GET /api/profile/settings - mock: returns notification/profile settings
  getGetNotificationSettingsApiProfileSettingsGetMockHandler(profileGenerator.handleGetSettings),

  // POST /api/profile/settings - mock: updates notification/profile settings
  http.post("*/api/profile/settings", profileGenerator.handlePostSettings),

  // GET /api/credentials - mock: returns user credentials
  getGetUserCredentialApiCredentialsGetMockHandler(profileGenerator.handleGetCredentials),

  // POST /api/credentials/:name - mock: sets or updates a user credential
  http.post("*/api/credentials/:name", profileGenerator.handlePostCredential),

  // DELETE /api/credentials/:credName - mock: deletes a user credential
  getDeleteUsersCredentialApiCredentialsCredNameDeleteMockHandler(profileGenerator.handleDeleteCredential),

  // ==========================================================================
  // Version
  // ==========================================================================

  getGetVersionApiVersionGetMockHandler({ major: "1", minor: "0", revision: "0", hash: "mock-abc123" }),

  // ==========================================================================
  // Task Summary — GET /api/task?summary=true
  // ==========================================================================
  // Handles the occupancy page data source. When summary=true the endpoint
  // returns aggregated (user, pool, priority) resource-usage rows rather than
  // individual task records. Non-summary requests are passed through.
  http.get("*/api/task", taskSummaryGenerator.handleGetTaskSummary),

  // ==========================================================================
  // Generated Handlers (fallback for all other API endpoints)
  // ==========================================================================
  // Orval-generated faker handlers cover every endpoint in the OpenAPI spec.
  // Custom handlers above take priority (MSW first-match wins); these fire
  // only for endpoints not explicitly handled above (e.g. config, users,
  // access tokens, apps, health).
  ...getFastAPIMock(),

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
  taskSummaryGenerator,
};
