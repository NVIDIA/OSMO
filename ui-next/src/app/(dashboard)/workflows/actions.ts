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
 * import { cancelWorkflow, retryWorkflow } from '@/app/(dashboard)/workflows/actions';
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
import { ServerApiError } from "@/lib/api/server/config";
import { customFetch } from "@/lib/api/fetcher";

// =============================================================================
// Types
// =============================================================================

export interface ActionResult {
  success: boolean;
  error?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

async function makeWorkflowAction(endpoint: string, method: "POST" | "DELETE" = "POST"): Promise<ActionResult> {
  try {
    // Use customFetch which calls the clean fetch path (no MSW imports)
    await customFetch({
      url: endpoint,
      method,
    });

    return { success: true };
  } catch (error) {
    if (error instanceof ServerApiError) {
      return { success: false, error: error.message };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

// =============================================================================
// Server Actions
// =============================================================================

/**
 * Cancel a running workflow.
 *
 * @param workflowName - The workflow name to cancel
 * @returns Result indicating success or error
 */
export async function cancelWorkflow(workflowName: string): Promise<ActionResult> {
  const result = await makeWorkflowAction(`/api/workflow/${encodeURIComponent(workflowName)}/cancel`);

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
