/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
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

import { useSyncExternalStore } from "react";

/**
 * Hook that returns true after the component has mounted on the client.
 *
 * Uses useSyncExternalStore to guarantee hydration-safe behavior:
 * 1. Server render: returns false (via getServerSnapshot)
 * 2. First client render (hydration): returns false (matches server)
 * 3. After hydration: returns true (via getSnapshot)
 *
 * Use this to delay rendering of client-only content that would cause
 * hydration mismatches (e.g., @dnd-kit accessibility attributes, Date.now(),
 * browser-specific APIs).
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const mounted = useMounted();
 *
 *   // Only apply dnd-kit attributes after hydration
 *   const dndAttributes = mounted ? attributes : {};
 *
 *   return <div {...dndAttributes}>...</div>;
 * }
 * ```
 */

// No-op subscribe - the mounted state never changes after initial render
const emptySubscribe = () => () => {};

// Client always returns true (after hydration)
const getSnapshot = () => true;

// Server always returns false
const getServerSnapshot = () => false;

export function useMounted(): boolean {
  return useSyncExternalStore(emptySubscribe, getSnapshot, getServerSnapshot);
}
