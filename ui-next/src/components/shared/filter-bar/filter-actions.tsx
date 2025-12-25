// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FilterActionsProps {
  /** Action components (toggles, buttons, etc.) */
  children: ReactNode;
  /** Additional class name */
  className?: string;
}

/**
 * Right-aligned actions container for FilterBar.
 *
 * Use this to group action elements (like toggles) that should appear
 * on the right side of the filter bar.
 *
 * @example
 * ```tsx
 * <FilterBar.Actions>
 *   <FilterBar.Toggle ... />
 *   <Button>Export</Button>
 * </FilterBar.Actions>
 * ```
 */
export function FilterActions({ children, className }: FilterActionsProps) {
  return <div className={cn("ml-auto flex items-center gap-3", className)}>{children}</div>;
}
