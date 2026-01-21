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
import { redirect } from "next/navigation";
import { usePage } from "@/components/chrome";
import { LogViewerContainer } from "@/components/log-viewer";
import { ScenarioSelector, useScenario } from "./components/scenario-selector";

/**
 * Mock workflow ID for the playground.
 */
const MOCK_WORKFLOW_ID = "log-viewer-playground";

/**
 * Log Viewer Experimental Page
 *
 * A dedicated playground for developing and testing the log viewer component.
 * Uses the reusable LogViewerContainer with scenario-based mock data.
 */
export default function LogViewerExperimentalPage() {
  // Redirect to home in production
  if (process.env.NODE_ENV === "production") {
    redirect("/");
  }

  // Read scenario from URL (ScenarioSelector writes to same URL param)
  const { devParams, tailDevParams } = useScenario();

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
          tailDevParams={tailDevParams}
          scope="workflow"
          className="h-full"
          viewerClassName="h-full"
        />
      </div>
    </div>
  );
}
