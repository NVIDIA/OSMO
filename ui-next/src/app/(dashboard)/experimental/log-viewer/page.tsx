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

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LogViewerSkeleton } from "@/components/log-viewer";
import { LogViewerPageContent } from "./components/log-viewer-page-content";

/**
 * Log Viewer Experimental Page (Server Component)
 *
 * A dedicated playground for developing and testing the log viewer component.
 * Uses the reusable LogViewerContainer with scenario-based mock data.
 *
 * STREAMING ARCHITECTURE:
 * 1. Server immediately sends Chrome shell + LogViewerSkeleton
 * 2. LogViewerPageContent hydrates in background
 * 3. Once hydrated, content replaces skeleton
 * 4. Data streams in via React Query
 *
 * This ensures instant visual feedback on hard refresh.
 */
export default function LogViewerExperimentalPage() {
  // Redirect to home in production (server-side, no client JS needed)
  if (process.env.NODE_ENV === "production") {
    redirect("/");
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-full flex-col p-4">
          <div className="border-border bg-card relative flex-1 overflow-hidden rounded-lg border">
            <LogViewerSkeleton className="h-full" />
          </div>
        </div>
      }
    >
      <LogViewerPageContent />
    </Suspense>
  );
}
