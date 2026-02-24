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

import { useViewTransition } from "@/hooks/use-view-transition";
import NextLink from "next/link";
import { useCallback, type ComponentProps } from "react";

/**
 * Custom Link wrapper that disables prefetching by default and supports View Transitions.
 *
 * Prefetching is opt-in: use `prefetch={true}` to enable it explicitly.
 * View Transitions are enabled by default for internal links.
 *
 * @example
 * // Default: No prefetch, with View Transition
 * <Link href="/workflows">Workflows</Link>
 *
 * @example
 * // Opt-in: Explicit prefetch
 * <Link href="/dashboard" prefetch={true}>Dashboard</Link>
 */
export function Link({ prefetch = false, onClick, ...props }: ComponentProps<typeof NextLink>) {
  const { startTransition } = useViewTransition();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Call original onClick if provided
      onClick?.(e);

      // If default was prevented or it's a special click (cmd/ctrl), don't intercept
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }

      // Only transition for internal links
      const href = props.href.toString();
      const isInternal = href.startsWith("/") || href.startsWith(window.location.origin);

      if (isInternal) {
        // We don't prevent default because NextLink needs to handle the actual navigation.
        // Instead, we just wrap the start of the transition.
        // Note: This is a "best effort" transition for route changes.
        startTransition(() => {
          // No-op callback, the actual DOM update happens via Next.js navigation
          // which is triggered by the default link behavior.
        });
      }
    },
    [onClick, props.href, startTransition],
  );

  return (
    <NextLink
      prefetch={prefetch}
      onClick={handleClick}
      {...props}
    />
  );
}
