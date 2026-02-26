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

import { useNavigationProgress } from "@/stores/navigation-progress-store";

/**
 * Extract the pathname portion from an href string, stripping query and hash.
 * Handles both relative paths ("/foo?bar") and absolute URLs ("https://...").
 */
export function extractPathname(href: string): string {
  if (href.startsWith("/")) {
    return href.split("?")[0].split("#")[0];
  }
  try {
    return new URL(href).pathname;
  } catch {
    return href;
  }
}

/**
 * Start the progress bar if `href` resolves to a different pathname.
 * Reads directly from the store — usable in hooks and callbacks.
 */
export function startProgressIfNavigating(href: string, currentPathname: string): void {
  if (extractPathname(href) !== currentPathname) {
    useNavigationProgress.getState().start();
  }
}
