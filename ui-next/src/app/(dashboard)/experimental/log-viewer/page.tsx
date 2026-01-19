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

import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LogViewerPlayground } from "./log-viewer-playground";

/**
 * Log Viewer Experimental Page
 *
 * A dedicated playground for developing and testing the log viewer component.
 * This page is only accessible in development mode.
 */
export default function LogViewerExperimentalPage() {
  // Redirect to home in production
  if (process.env.NODE_ENV === "production") {
    redirect("/");
  }

  return (
    <Suspense fallback={<LogViewerLoadingSkeleton />}>
      <LogViewerPlayground />
    </Suspense>
  );
}

function LogViewerLoadingSkeleton() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="text-muted-foreground text-sm">Loading log viewer playground...</div>
    </div>
  );
}
