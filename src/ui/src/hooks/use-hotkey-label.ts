//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

"use client";

import { useMounted } from "@/hooks/use-mounted";
import { formatHotkey, isMac } from "@/lib/utils";

/**
 * Hydration-safe wrapper around `formatHotkey()` for rendered text.
 *
 * `formatHotkey()` uses the module-level `isMac` constant, which is `false`
 * on the server and `true` on Mac clients. Rendering its output directly
 * causes hydration mismatch (#418) because the server HTML ("Ctrl+B")
 * differs from the client's first render ("⌘B").
 *
 * This hook returns the non-Mac format during SSR and first client render
 * (matching the server), then switches to the platform-correct format
 * after hydration completes.
 *
 * For non-rendered uses (event handlers, useEffect), use `formatHotkey()` directly.
 */
export function useFormattedHotkey(hotkey: string): string {
  const mounted = useMounted();
  return formatHotkey(hotkey, mounted ? isMac : false);
}

/**
 * Hydration-safe version of `modKey` for rendered text.
 *
 * Returns "Ctrl" during SSR and first client render, then switches to
 * "⌘" on Mac after hydration.
 */
export function useModKey(): string {
  const mounted = useMounted();
  return mounted && isMac ? "⌘" : "Ctrl";
}
