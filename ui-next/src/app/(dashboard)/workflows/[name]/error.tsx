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

"use client";

import { RouteError } from "@/components/error/route-error";

/**
 * Route-level error boundary for workflow detail page.
 *
 * This is a backstop for errors that escape component-level boundaries.
 * Most errors should be caught by granular boundaries in:
 * - DAG visualization (InlineErrorBoundary)
 * - Panel content (InlineErrorBoundary)
 * - Shell container (InlineErrorBoundary)
 * - Dialogs (InlineErrorBoundary)
 *
 * This should rarely trigger - if it does frequently, add more granular boundaries.
 */
export default function WorkflowDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="Unable to Display Workflow"
      description="An unexpected error occurred while loading the workflow detail page."
      backLink={{ href: "/workflows", label: "Back to Workflows" }}
      logPrefix="Workflow detail route"
    />
  );
}
