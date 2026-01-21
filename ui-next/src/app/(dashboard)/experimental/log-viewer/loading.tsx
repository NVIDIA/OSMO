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

import { LogViewerSkeleton } from "@/components/log-viewer";

/**
 * Log Viewer loading skeleton.
 *
 * This loading.tsx enables Next.js streaming:
 * - Server sends Chrome shell + this skeleton immediately
 * - Page component streams in when ready
 * - Skeleton is replaced with real content
 *
 * The skeleton matches the exact LogViewer layout to prevent CLS.
 */
export default function Loading() {
  return (
    <div className="flex h-full flex-col p-4">
      <div className="border-border bg-card relative flex-1 overflow-hidden rounded-lg border">
        <LogViewerSkeleton className="h-full" />
      </div>
    </div>
  );
}
