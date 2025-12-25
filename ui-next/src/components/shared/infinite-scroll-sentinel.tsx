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

"use client";

import { useEffect, useRef } from "react";

interface InfiniteScrollSentinelProps {
  /** Called when sentinel becomes visible */
  onIntersect: () => void;
  /** Whether intersection should trigger callback */
  enabled?: boolean;
  /** Root margin for earlier triggering (default: "200px") */
  rootMargin?: string;
  /** Optional className for styling */
  className?: string;
  /** Optional content to show (loading indicator, etc.) */
  children?: React.ReactNode;
}

/**
 * Invisible sentinel element that triggers loading when scrolled into view.
 *
 * Place at the end of a scrollable list. When it becomes visible,
 * it calls onIntersect() to load more data.
 *
 * Uses IntersectionObserver for efficient scroll detection without
 * adding scroll event listeners.
 *
 * @example
 * ```tsx
 * <div className="overflow-auto">
 *   {items.map(item => <Row key={item.id} item={item} />)}
 *   <InfiniteScrollSentinel
 *     onIntersect={fetchNextPage}
 *     enabled={hasNextPage && !isFetchingNextPage}
 *   >
 *     {isFetchingNextPage && <Spinner />}
 *   </InfiniteScrollSentinel>
 * </div>
 * ```
 */
export function InfiniteScrollSentinel({
  onIntersect,
  enabled = true,
  rootMargin = "200px",
  className,
  children,
}: InfiniteScrollSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          onIntersect();
        }
      },
      { rootMargin },
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [enabled, onIntersect, rootMargin]);

  return (
    <div
      ref={sentinelRef}
      className={className}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}
