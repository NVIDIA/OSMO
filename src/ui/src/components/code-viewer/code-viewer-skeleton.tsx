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
 * CodeViewerSkeleton - Loading skeleton for code viewer
 *
 * Shows predetermined line patterns to avoid Math.random in render.
 * Matches CodeMirror's appearance (line numbers + code content).
 */

"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/shadcn/skeleton";

/**
 * Predetermined widths — varied enough to look like real code, enough rows to
 * fill any typical viewport height (each row is ~24px; 50 rows covers ~1200px).
 * Values repeat intentionally; stable IDs are assigned at module scope.
 */
const SKELETON_ROWS = [
  "65%",
  "45%",
  "78%",
  "52%",
  "60%",
  "70%",
  "40%",
  "55%",
  "72%",
  "48%",
  "63%",
  "50%",
  "75%",
  "42%",
  "58%",
  "68%",
  "44%",
  "80%",
  "53%",
  "62%",
  "71%",
  "47%",
  "56%",
  "73%",
  "41%",
  "65%",
  "49%",
  "78%",
  "54%",
  "60%",
  "70%",
  "43%",
  "55%",
  "72%",
  "46%",
  "63%",
  "51%",
  "75%",
  "42%",
  "58%",
  "68%",
  "45%",
  "80%",
  "53%",
  "64%",
  "71%",
  "48%",
  "56%",
  "73%",
  "40%",
].map((width, rowIdx) => ({ id: `code-row-${rowIdx + 1}`, width }));

export const CodeViewerSkeleton = memo(function CodeViewerSkeleton({ className }: { className?: string }) {
  return (
    // flex flex-col here so flex-1 on the inner div actually stretches to fill
    <div
      className={cn("flex flex-col", className)}
      aria-label="Loading code"
    >
      <div className="bg-muted/30 flex-1 overflow-hidden p-4">
        <div className="space-y-2">
          {SKELETON_ROWS.map(({ id, width }) => (
            <div
              key={id}
              className="flex gap-4"
            >
              <Skeleton className="h-4 w-8" />
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
