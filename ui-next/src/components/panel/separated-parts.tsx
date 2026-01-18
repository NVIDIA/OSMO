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
 * SeparatedParts Component
 *
 * Utility for rendering a list of parts with separators between them.
 * Automatically filters out null/undefined parts and handles separator placement.
 *
 * Consolidates the repeated pattern of manually adding separator spans between
 * conditionally-rendered content pieces.
 */

"use client";

import { memo, type ReactNode, Children, isValidElement } from "react";
import { cn } from "@/lib/utils";

/** Separator styling constants */
const SEPARATOR_STYLES = {
  /** Default separator style (gray dot) */
  default: "text-gray-400 dark:text-zinc-600",
  /** Muted separator for less emphasis */
  muted: "text-gray-300 dark:text-zinc-700",
} as const;

export interface SeparatedPartsProps {
  /** Content parts to render with separators between them */
  children: ReactNode;
  /** Separator character (default: "·") */
  separator?: string;
  /** Separator variant */
  variant?: keyof typeof SEPARATOR_STYLES;
  /** Additional className for the container */
  className?: string;
  /** Additional className for separators */
  separatorClassName?: string;
}

/**
 * Renders children with separators between valid (non-null) elements.
 *
 * @example
 * ```tsx
 * <SeparatedParts>
 *   <span>Status: Running</span>
 *   {duration && <span>{formatDuration(duration)}</span>}
 *   {retryId > 0 && <span>Retry #{retryId}</span>}
 * </SeparatedParts>
 * // Renders: "Status: Running · 5m 23s · Retry #2" (if all conditions met)
 * // Or: "Status: Running · 5m 23s" (if retryId is 0)
 * ```
 */
export const SeparatedParts = memo(function SeparatedParts({
  children,
  separator = "·",
  variant = "default",
  className,
  separatorClassName,
}: SeparatedPartsProps) {
  // Children.toArray already filters out null, undefined, boolean values
  // We just need to filter out empty strings
  const validChildren = Children.toArray(children).filter((child) => child !== "");

  if (validChildren.length === 0) return null;

  const separatorClass = cn(SEPARATOR_STYLES[variant], separatorClassName);

  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      {validChildren.map((child, index) => (
        <span
          key={isValidElement(child) && child.key !== null ? child.key : index}
          className="contents"
        >
          {index > 0 && <span className={separatorClass}>{separator}</span>}
          {child}
        </span>
      ))}
    </span>
  );
});
