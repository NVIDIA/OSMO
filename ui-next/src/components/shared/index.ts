// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
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
 * These are more complex than shadcn primitives but less specialized
 * than feature-specific components.
 */

// Filter bar for filtering lists
export { FilterBar } from "./filter-bar";

// Capacity/usage visualization
export { CapacityBar, type CapacityBarProps } from "./capacity-bar";

// API error display (supports authAware prop for login prompts)
export { ApiError, type ApiErrorProps } from "./api-error";

// Error details (message + collapsible stack)
export { ErrorDetails } from "./error-details";
