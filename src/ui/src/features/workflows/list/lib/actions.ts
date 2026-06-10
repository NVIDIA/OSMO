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
 * Workflow Server Actions
 *
 * Server-side mutations for workflows. These run on the server and can:
 * - Access server-only secrets
 * - Make direct backend calls (no CORS)
 * - Revalidate cached data after mutations
 *
 * Usage in Client Components:
 * ```tsx
 * import { cancelWorkflow, retryWorkflow } from '@/features/workflows/list/lib/actions';
 *
 * // In a button onClick or form action:
 * await cancelWorkflow(workflowName);
 * ```
 *
 * Benefits:
 * - Progressive enhancement (forms work without JS)
 * - Type-safe mutations with end-to-end TypeScript
 * - Automatic cache revalidation via revalidatePath/revalidateTag
 * - Server-side error handling
 */

"use server";

import { revalidatePath, updateTag, refresh } from "next/cache";
import { customFetch } from "@/lib/api/fetcher";
import type { ActionResult } from "@/lib/server-actions";

// =============================================================================
// Helper Functions
// =============================================================================

async function makeWorkflowAction(endpoint: string, method: "POST" | "DELETE" = "POST"): Promise<ActionResult> {
  try {
    await customFetch(endpoint, { method });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

function getCancelWorkflowEndpoint(workflowName: string, options?: { message?: string; force?: boolean }): string {
  const params = new URLSearchParams();
  if (options?.message) {
    params.set("message", options.message);
  }
  if (options?.force !== undefined) {
    params.set("force", String(options.force));
  }

  const queryString = params.toString();
  return `/api/workflow/${encodeURIComponent(workflowName)}/cancel${queryString ? `?${queryString}` : ""}`;
}

// =============================================================================
// Server Actions
// =============================================================================

/**
 * Cancel a running workflow.
 *
 * @param workflowName - The workflow name to cancel
 * @param options - Optional cancellation parameters
 * @param options.message - Reason for cancellation (shown in audit logs)
 * @param options.force - Force cancellation even if graceful shutdown fails
 * @returns Result indicating success or error
 */
export async function cancelWorkflow(
  workflowName: string,
  options?: { message?: string; force?: boolean },
): Promise<ActionResult> {
  const result = await makeWorkflowAction(getCancelWorkflowEndpoint(workflowName, options));

  if (result.success) {
    // Revalidate workflow data after successful cancellation
    // updateTag updates the cache without requiring a profile (Next.js 16+)
    updateTag("workflows");
    updateTag(`workflow-${workflowName}`);
    revalidatePath(`/workflows/${workflowName}`, "page");
    revalidatePath("/workflows", "page");
    // Refresh client cache to ensure immediate updates
    refresh();
  }

  return result;
}

export interface BulkCancelWorkflowEntryResult {
  workflowName: string;
  success: boolean;
  error?: string;
}

export interface BulkCancelWorkflowResult extends ActionResult {
  results: BulkCancelWorkflowEntryResult[];
  successCount: number;
  failureCount: number;
}

/**
 * Cancel multiple workflows independently.
 *
 * @param workflowNames - Workflow names to cancel
 * @param options - Optional cancellation parameters
 * @returns Per-workflow cancellation results
 */
export async function bulkCancelWorkflows(
  workflowNames: string[],
  options?: { message?: string; force?: boolean },
): Promise<BulkCancelWorkflowResult> {
  const uniqueWorkflowNames = Array.from(new Set(workflowNames));
  if (uniqueWorkflowNames.length === 0) {
    return {
      success: false,
      error: "No cancelable workflows selected",
      results: [],
      successCount: 0,
      failureCount: 0,
    };
  }

  const results = await Promise.all(
    uniqueWorkflowNames.map(async (workflowName): Promise<BulkCancelWorkflowEntryResult> => {
      const result = await makeWorkflowAction(getCancelWorkflowEndpoint(workflowName, options));
      return result.success
        ? { workflowName, success: true }
        : { workflowName, success: false, error: result.error ?? "Unknown error" };
    }),
  );

  const successCount = results.filter((result) => result.success).length;
  const failureCount = results.length - successCount;

  if (successCount > 0) {
    updateTag("workflows");
    for (const result of results) {
      if (!result.success) continue;
      updateTag(`workflow-${result.workflowName}`);
      revalidatePath(`/workflows/${result.workflowName}`, "page");
    }
    revalidatePath("/workflows", "page");
    refresh();
  }

  return {
    success: failureCount === 0,
    error: failureCount > 0 ? `${failureCount} workflow${failureCount === 1 ? "" : "s"} failed to cancel` : undefined,
    results,
    successCount,
    failureCount,
  };
}

/**
 * Retry a failed workflow.
 *
 * @param workflowName - The workflow name to retry
 * @returns Result indicating success or error
 */
export async function retryWorkflow(workflowName: string): Promise<ActionResult> {
  const result = await makeWorkflowAction(`/api/workflow/${encodeURIComponent(workflowName)}/retry`);

  if (result.success) {
    // Revalidate workflow data after successful retry
    updateTag("workflows");
    updateTag(`workflow-${workflowName}`);
    revalidatePath(`/workflows/${workflowName}`, "page");
    revalidatePath("/workflows", "page");
    refresh();
  }

  return result;
}

/**
 * Delete a workflow.
 *
 * @param workflowName - The workflow name to delete
 * @returns Result indicating success or error
 */
export async function deleteWorkflow(workflowName: string): Promise<ActionResult> {
  const result = await makeWorkflowAction(`/api/workflow/${encodeURIComponent(workflowName)}`, "DELETE");

  if (result.success) {
    // Revalidate workflow list after deletion
    updateTag("workflows");
    revalidatePath("/workflows", "page");
    refresh();
  }

  return result;
}

/**
 * Retry a specific task group within a workflow.
 *
 * @param workflowName - The workflow name
 * @param groupName - The group name to retry
 * @returns Result indicating success or error
 */
export async function retryTaskGroup(workflowName: string, groupName: string): Promise<ActionResult> {
  const result = await makeWorkflowAction(
    `/api/workflow/${encodeURIComponent(workflowName)}/groups/${encodeURIComponent(groupName)}/retry`,
  );

  if (result.success) {
    // Revalidate workflow data after successful group retry
    updateTag(`workflow-${workflowName}`);
    revalidatePath(`/workflows/${workflowName}`, "page");
    refresh();
  }

  return result;
}

/**
 * Cancel a specific task group within a workflow.
 *
 * @param workflowName - The workflow name
 * @param groupName - The group name to cancel
 * @returns Result indicating success or error
 */
export async function cancelTaskGroup(workflowName: string, groupName: string): Promise<ActionResult> {
  const result = await makeWorkflowAction(
    `/api/workflow/${encodeURIComponent(workflowName)}/groups/${encodeURIComponent(groupName)}/cancel`,
  );

  if (result.success) {
    // Revalidate workflow data after successful group cancellation
    updateTag(`workflow-${workflowName}`);
    revalidatePath(`/workflows/${workflowName}`, "page");
    refresh();
  }

  return result;
}

// =============================================================================
// Resubmit Types
// =============================================================================

export interface ResubmitResult extends ActionResult {
  /** New workflow name returned by the backend on success */
  newWorkflowName?: string;
}

export interface ResubmitParams {
  /** ID of the original workflow to resubmit */
  workflowId: string;
  /** Target pool for execution */
  poolName: string;
  /** Execution priority */
  priority: string;
  /**
   * Optional custom spec (if user edited and changed it)
   * - undefined: Backend fetches original spec via workflow_id (efficient)
   * - string: Backend uses this custom spec (ignores workflow_id)
   *
   * Backend constraint: EITHER template_spec OR workflow_id, never both.
   */
  spec?: string;
}

// =============================================================================
// Resubmit Server Action
// =============================================================================

/**
 * Resubmit a workflow to a (potentially different) pool with a given priority.
 *
 * Uses the existing submission endpoint:
 *   POST /api/pool/{pool_name}/workflow
 *
 * Backend constraint: EITHER template_spec OR workflow_id can be provided, never both.
 * - If spec is provided: sends template_spec in body (custom workflow)
 * - If spec is NOT provided: sends workflow_id query param (reuses original spec)
 *
 * @param params - Resubmit configuration (workflowId, poolName, priority, optional spec)
 * @returns Result with the new workflow name on success, or error message
 */
export async function resubmitWorkflow(params: ResubmitParams): Promise<ResubmitResult> {
  const { workflowId, poolName, priority, spec } = params;

  const queryParams = new URLSearchParams();
  queryParams.set("priority", priority);

  // Backend constraint: EITHER template_spec OR workflow_id, never both
  if (!spec) {
    // No custom spec: send workflow_id to reuse original spec
    queryParams.set("workflow_id", workflowId);
  }

  const endpoint = `/api/pool/${encodeURIComponent(poolName)}/workflow?${queryParams.toString()}`;

  try {
    const init: RequestInit = { method: "POST" };

    if (spec) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify({ file: spec, set_variables: [] });
    }

    const response = await customFetch<{ data: { name?: string }; status: number }>(endpoint, init);

    const newName = response?.data?.name;

    // No cache revalidation needed - creating a new workflow doesn't affect:
    // - Current workflow page (unchanged)
    // - New workflow page (will fetch fresh when user navigates to it)
    // - Workflows list (will fetch fresh when user navigates to it)

    return { success: true, newWorkflowName: newName };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to resubmit workflow",
    };
  }
}
