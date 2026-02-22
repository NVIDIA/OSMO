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

/**
 * CodeViewerSkeleton - Loading skeleton for code viewer
 *
 * Shows predetermined line patterns to avoid Math.random in render.
 * Matches CodeMirror's appearance (line numbers + code content).
 */

"use client";

import { memo } from "react";
import { Skeleton } from "@/components/shadcn/skeleton";

/** Predetermined widths to avoid impure Math.random in render */
const SKELETON_WIDTHS = ["65%", "45%", "78%", "52%", "60%", "70%", "40%", "55%"];

export const CodeViewerSkeleton = memo(function CodeViewerSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={className}
      aria-label="Loading code"
    >
      {/* Use theme-aware background that matches editor chrome */}
      <div className="bg-muted/30 flex-1 p-4">
        <div className="space-y-2">
          {SKELETON_WIDTHS.map((width, i) => (
            <div
              key={i}
              className="flex gap-4"
            >
              {/* Line numbers - use default skeleton styling (SSR-safe) */}
              <Skeleton className="h-4 w-8" />
              {/* Code content */}
              <Skeleton
                className="h-4"
                style={{ width }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
