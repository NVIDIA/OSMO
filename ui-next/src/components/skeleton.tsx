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
 * Skeleton Component
 *
 * A loading placeholder that mimics the shape of content while data is loading.
 * Uses animate-pulse for a subtle breathing effect.
 *
 * @example
 * // Simple usage with size classes
 * <Skeleton className="h-8 w-24" />
 *
 * // Circular skeleton (e.g., avatars)
 * <Skeleton className="h-10 w-10 rounded-full" />
 *
 * // Text line skeleton
 * <Skeleton className="h-4 w-48" />
 */

import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Additional CSS classes */
  className?: string;
}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded bg-zinc-100 dark:bg-zinc-800", className)}
      {...props}
    />
  );
}
