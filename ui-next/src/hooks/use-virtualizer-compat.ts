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
 * React Compiler Compatible Virtualizer Hook
 *
 * The standard useVirtualizer from @tanstack/react-virtual returns functions
 * that cannot be safely memoized by React Compiler, and uses flushSync which
 * can crash in React 18+ when called during render/lifecycle methods.
 *
 * This hook uses the lower-level Virtualizer class directly with startTransition
 * for all updates, making it compatible with both React Compiler and React 18+.
 */

import { useState, useLayoutEffect, startTransition } from "react";
import {
  Virtualizer,
  observeElementOffset,
  observeElementRect,
  elementScroll,
  type VirtualizerOptions,
} from "@tanstack/react-virtual";

/**
 * Custom useVirtualizer that is React Compiler compatible and avoids flushSync.
 *
 * @param options - Virtualizer options (same as useVirtualizer, minus observer functions)
 * @returns Virtualizer instance
 */
export function useVirtualizerCompat<TScrollElement extends Element, TItemElement extends Element>(
  options: Omit<
    VirtualizerOptions<TScrollElement, TItemElement>,
    "observeElementRect" | "observeElementOffset" | "scrollToFn"
  > & {
    observeElementRect?: VirtualizerOptions<TScrollElement, TItemElement>["observeElementRect"];
    observeElementOffset?: VirtualizerOptions<TScrollElement, TItemElement>["observeElementOffset"];
    scrollToFn?: VirtualizerOptions<TScrollElement, TItemElement>["scrollToFn"];
  },
): Virtualizer<TScrollElement, TItemElement> {
  const [, rerender] = useState({});

  const resolvedOptions: VirtualizerOptions<TScrollElement, TItemElement> = {
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    ...options,
    // Override onChange to NEVER use flushSync - use startTransition instead
    onChange: (instance) => {
      startTransition(() => {
        rerender({});
      });
      options.onChange?.(instance, false); // Always pass false to downstream handlers
    },
  };

  const [instance] = useState(() => new Virtualizer<TScrollElement, TItemElement>(resolvedOptions));

  instance.setOptions(resolvedOptions);

  useLayoutEffect(() => {
    return instance._didMount();
  }, [instance]);

  useLayoutEffect(() => {
    return instance._willUpdate();
  });

  return instance;
}
