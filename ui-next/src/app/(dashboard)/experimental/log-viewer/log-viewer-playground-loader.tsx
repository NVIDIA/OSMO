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

import dynamic from "next/dynamic";

/**
 * Client-side loader for the LogViewerPlayground.
 *
 * Uses dynamic import with SSR disabled to avoid hydration mismatches
 * from Radix UI components (Select, ToggleGroup) that render differently
 * on server vs client due to portal usage and state management.
 */
const LogViewerPlayground = dynamic(() => import("./log-viewer-playground").then((m) => m.LogViewerPlayground), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center p-6">
      <div className="text-muted-foreground text-sm">Loading log viewer playground...</div>
    </div>
  ),
});

export function LogViewerPlaygroundLoader() {
  return <LogViewerPlayground />;
}
