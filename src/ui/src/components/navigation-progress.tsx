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

"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useNavigationProgress } from "@/stores/navigation-progress-store";

/**
 * Top-of-viewport progress bar that provides visual feedback during route navigations.
 *
 * Mimics the browser's native loading indicator for client-side navigations.
 * Uses pure CSS animations (GPU-accelerated scaleX) for smooth performance.
 *
 * Lifecycle:
 *   1. Link click → store.start() → bar appears, animates toward 80%
 *   2. Route resolves → usePathname() changes → store.done() → bar fills to 100%, fades out
 *   3. After fade → store resets to idle
 */
export function NavigationProgress() {
  const status = useNavigationProgress((s) => s.status);
  const done = useNavigationProgress((s) => s.done);
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (pathname !== previousPathname.current) {
      previousPathname.current = pathname;
      done();
    }
  }, [pathname, done]);

  return (
    <div
      className="nav-progress"
      data-status={status}
      role="progressbar"
      aria-hidden={status === "idle"}
    />
  );
}
