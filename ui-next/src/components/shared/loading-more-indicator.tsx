/**
 * SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
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

import { Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingMoreIndicatorProps {
  /** Whether currently loading */
  isLoading: boolean;
  /** Whether there are more items to load */
  hasMore: boolean;
  /** Number of items currently loaded */
  loadedCount?: number;
  /** Total number of items available */
  totalCount?: number;
  /** Optional className */
  className?: string;
}

/**
 * Loading indicator for infinite scroll tables.
 *
 * Shows a subtle loading spinner when actively fetching more data,
 * and an "end of results" indicator when all items have been loaded.
 */
export function LoadingMoreIndicator({
  isLoading,
  hasMore,
  loadedCount,
  totalCount,
  className,
}: LoadingMoreIndicatorProps) {
  // Don't show anything if no items loaded yet
  if (loadedCount === 0) return null;

  // Show loading spinner when actively fetching more
  if (isLoading) {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-2 py-4 text-sm text-zinc-500 dark:text-zinc-400",
          className,
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  // Show end of results when all items have been loaded
  if (!hasMore && loadedCount && loadedCount > 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-1.5 py-4 text-xs text-zinc-400 dark:text-zinc-500",
          className,
        )}
      >
        <Check className="h-3.5 w-3.5" />
        <span>You've reached the end</span>
      </div>
    );
  }

  // No indicator when more items available - pagination is seamless
  return null;
}
