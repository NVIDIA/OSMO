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

import { useMemo } from "react";
import { usePage } from "@/components/chrome";
import { LogViewerContainer } from "@/components/log-viewer";
import { ScenarioSelector, useScenario } from "./scenario-selector";

/**
 * Mock workflow ID for the playground.
 */
const MOCK_WORKFLOW_ID = "log-viewer-playground";

/**
 * Log Viewer Page Content (Client Component)
 *
 * Contains all the client-side logic for the log viewer experimental page.
 * Wrapped in Suspense by the parent Server Component page.
 */
export function LogViewerPageContent() {
  // Read scenario from URL (ScenarioSelector writes to same URL param)
  const { devParams, liveDevParams } = useScenario();

  // Memoize header actions to prevent infinite re-render loop
  // usePage uses headerActions as a dependency, so a new JSX element triggers updates
  const headerActions = useMemo(() => <ScenarioSelector />, []);

  // Register page with scenario selector in header
  usePage({
    title: "Log Viewer",
    breadcrumbs: [{ label: "Experimental", href: "/experimental" }],
    headerActions,
  });

  return (
    <div className="flex h-full flex-col p-4">
      <div className="relative flex-1">
        <LogViewerContainer
          workflowId={MOCK_WORKFLOW_ID}
          devParams={devParams}
          liveDevParams={liveDevParams}
          scope="workflow"
          className="h-full"
          viewerClassName="h-full"
        />
      </div>
    </div>
  );
}
