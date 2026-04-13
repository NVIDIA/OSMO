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

const MOCK_DELAY = getMockDelay();

// RegExp for log endpoints — MSW wildcards are unreliable with Next.js + Turbopack
// server-side fetch. RegExp ensures matching for relative paths, absolute URLs, and
// basePath-prefixed paths (e.g. /v2/api/...).
const WORKFLOW_LOGS_PATTERN = /.*\/api\/workflow\/([^/]+)\/logs$/;
const TASK_LOGS_PATTERN = /.*\/api\/workflow\/([^/]+)\/task\/([^/]+)\/logs$/;

export const handlers = [
  // Users — backend returns JSON string of string array (BACKEND_TODOS.md #1)
  http.get("*/api/users", workflowGenerator.handleGetUsers),

  // Workflows
  getListWorkflowApiWorkflowGetMockHandler(workflowGenerator.handleListWorkflows),

  // Get single workflow — checks mock-workflows first for log-viewer fixtures
  getGetWorkflowApiWorkflowNameGetMockHandler(async ({ params }) => {
    await delay(MOCK_DELAY);
    const name = params.name as string;
    const mockWorkflow = getMockWorkflow(name);
    if (mockWorkflow) {
      // Strip _logConfig (internal to mock system) before returning
      const { _logConfig: _, ...response } = mockWorkflow;
      return response;
    }
    return workflowGenerator.toWorkflowQueryResponse(workflowGenerator.getByName(name));
  }),

  // Workflow actions
  getCancelWorkflowApiWorkflowNameCancelPostMockHandler(),

  http.post("*/api/workflow/:name/retry", async ({ params }) => {
    await delay(MOCK_DELAY);
    return HttpResponse.json({ message: `Workflow ${params.name as string} retry initiated` });
  }),

  http.delete("*/api/workflow/:name", async ({ params }) => {
    await delay(MOCK_DELAY);
    return HttpResponse.json({ message: `Workflow ${params.name as string} deleted` });
  }),

  http.post("*/api/workflow/:name/groups/:groupName/cancel", async ({ params }) => {
    await delay(MOCK_DELAY);
    return HttpResponse.json({
      message: `Group ${params.groupName as string} in workflow ${params.name as string} cancelled`,
    });
  }),

  http.post("*/api/workflow/:name/groups/:groupName/retry", async ({ params }) => {
    await delay(MOCK_DELAY);
    return HttpResponse.json({
      message: `Group ${params.groupName as string} in workflow ${params.name as string} retry initiated`,
    });
  }),

  // Workflow submission
  getSubmitWorkflowApiPoolPoolNameWorkflowPostMockHandler(workflowGenerator.handleSubmitWorkflow),

  // Workflow logs (streaming)
  http.get(WORKFLOW_LOGS_PATTERN, async ({ request }) => {
    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/api\/workflow\/([^/]+)\/logs$/);
    const name = pathMatch ? decodeURIComponent(pathMatch[1]) : "unknown";
    const workflow = getMockWorkflow(name) ?? workflowGenerator.getByName(name);
    return logGenerator.handleWorkflowLogs(request, name, workflow);
  }),

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
  http.get("*/api/workflow/:name/spec", async ({ params }) => {
    await delay(MOCK_DELAY);
    const name = params.name as string;
    return HttpResponse.text(generateYamlSpec(workflowGenerator.getByName(name)));
  }),

  // Workflow template spec (Jinja template)
  http.get("*/api/workflow/:name/template-spec", async ({ params }) => {
    await delay(MOCK_DELAY);
    const name = params.name as string;
    return HttpResponse.text(generateTemplateSpec(workflowGenerator.getByName(name)));
  }),

  // Tasks
  http.get("*/api/workflow/:name/task/:taskName", workflowGenerator.handleGetTask),

  // Task logs (streaming)
  http.get(TASK_LOGS_PATTERN, async ({ request }) => {
    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/api\/workflow\/([^/]+)\/task\/([^/]+)\/logs$/);
    const workflowName = pathMatch ? decodeURIComponent(pathMatch[1]) : "unknown";
    const taskName = pathMatch ? decodeURIComponent(pathMatch[2]) : "unknown";
    const workflow = getMockWorkflow(workflowName) ?? workflowGenerator.getByName(workflowName);
    const task = workflow.groups.flatMap((g) => g.tasks ?? []).find((t) => t.name === taskName);
    return logGenerator.handleTaskLogs(request, workflowName, taskName, task);
  }),

  // Exec session creation
  http.post("*/api/workflow/:name/exec/task/:taskName", async ({ params }) => {
    await delay(MOCK_DELAY);

    const taskName = params.taskName as string;

    if (taskName.includes("completed") || taskName.includes("failed")) {
      return HttpResponse.json({ detail: "Task is not running" }, { status: 400 });
    }

    if (taskName.includes("forbidden") || taskName.includes("private")) {
      return HttpResponse.json({ detail: "You don't have permission to exec into this task" }, { status: 403 });
    }

    const sessionId = faker.string.uuid();

    // Return RouterResponse format (matches backend).
    // In mock mode the WS server runs on port 3001 (pnpm dev:mock-exec).
    return HttpResponse.json({
      router_address: "http://localhost:3001",
      key: sessionId,
      cookie: `mock_session_${sessionId}`,
    });
  }),

  // Port forward
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

  // Pools
  getGetPoolQuotasApiPoolQuotaGetMockHandler(poolGenerator.handleGetPoolQuota),
  http.get("*/api/pool", poolGenerator.handleListPools),

  // Resources
  getGetResourcesApiResourcesGetMockHandler(async ({ request }) =>
    resourceGenerator.handleListResources(request, poolGenerator.getPoolNames()),
  ),

  // Buckets and datasets
  getGetBucketInfoApiBucketGetMockHandler(bucketGenerator.handleListBuckets),
  getListDatasetFromBucketApiBucketListDatasetGetMockHandler(datasetGenerator.handleListDatasets),
  getGetInfoApiBucketBucketDatasetNameInfoGetMockHandler(datasetGenerator.handleGetDatasetInfo),
  http.get("*/api/datasets/location-files", datasetGenerator.handleGetLocationFiles),
  // http.all needed because http.head() doesn't reliably intercept HEAD via mock tunnel
  http.all("*/proxy/dataset/file", datasetGenerator.handleFileProxy),
  http.head("*/api/bucket/:bucket/dataset/:name/preview", datasetGenerator.handleFilePreviewHead),
  http.get("*/api/bucket/:bucket/dataset/:name/preview", datasetGenerator.handleFilePreviewGet),

  // Profile and credentials
  getGetNotificationSettingsApiProfileSettingsGetMockHandler(profileGenerator.handleGetSettings),
  http.post("*/api/profile/settings", profileGenerator.handlePostSettings),
  getGetUserCredentialApiCredentialsGetMockHandler(profileGenerator.handleGetCredentials),
  http.post("*/api/credentials/:name", profileGenerator.handlePostCredential),
  getDeleteUsersCredentialApiCredentialsCredNameDeleteMockHandler(profileGenerator.handleDeleteCredential),

  // Version
  getGetVersionApiVersionGetMockHandler({ major: "1", minor: "0", revision: "0", hash: "mock-abc123" }),

  // Task summary (occupancy page)
  http.get("*/api/task", taskSummaryGenerator.handleGetTaskSummary),

  // Orval-generated faker handlers as fallback (MSW first-match wins)
  ...getFastAPIMock(),

  // HMR recursion guard — must be last. Detects when passthrough hits the same
  // server during HMR and returns 503 to break the infinite loop.
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

// HMR: push fresh handlers onto the running MSW server when Turbopack re-evaluates this module.
if (globalThis.__mswServer) {
  try {
    globalThis.__mswServer.resetHandlers(...handlers);
  } catch (error) {
    console.error("[MSW] HMR: Failed to reset handlers:", error);
  }
}
