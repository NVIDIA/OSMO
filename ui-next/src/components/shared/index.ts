// Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Shared Components
 *
 * Reusable UI components used across multiple feature areas.
 * These are domain-agnostic primitives that can be used for any entity type.
 */

// Capacity/usage visualization (generic progress bar)
export { CapacityBar, type CapacityBarProps } from "./capacity-bar";

// API error display (supports authAware prop for login prompts)
export { ApiError, type ApiErrorProps } from "./api-error";

// Error details (message + collapsible stack)
export { ErrorDetails } from "./error-details";

// Inline error boundary (uses react-error-boundary)
export { InlineErrorBoundary, InlineFallback, type InlineErrorBoundaryProps } from "./inline-error-boundary";

// Loading indicator for infinite scroll tables
export { LoadingMoreIndicator } from "./loading-more-indicator";
