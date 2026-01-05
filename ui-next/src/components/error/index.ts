/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
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
