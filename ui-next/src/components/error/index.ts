/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Error Components
 *
 * Shared components for displaying and handling errors:
 * - ApiError: Inline error display for API failures
 * - ErrorDetails: Collapsible error message with stack trace
 * - InlineErrorBoundary: Error boundary that doesn't disrupt layout
 * - RouteError: Full-page error display for Next.js error.tsx
 */

export { ApiError, type ApiErrorProps } from "./api-error";
export { ErrorDetails } from "./error-details";
export {
  InlineErrorBoundary,
  InlineFallback,
  type InlineErrorBoundaryProps,
  type InlineFallbackProps,
} from "./inline-error-boundary";
export { RouteError, type RouteErrorProps } from "./route-error";
