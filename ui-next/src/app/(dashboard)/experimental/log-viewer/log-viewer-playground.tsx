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

import { useState, useCallback } from "react";
import { FlaskConical, Play, Pause, RotateCcw, BarChart3 } from "lucide-react";
import { usePage } from "@/components/chrome";
import { Button } from "@/components/shadcn/button";
import { ScenarioSelector, type LogScenario } from "./components/scenario-selector";
import { ContainerSizer, type ContainerSize } from "./components/container-sizer";
import { DebugPanel, type DebugStats } from "./components/debug-panel";

/**
 * Log Viewer Playground
 *
 * Main client component for the experimental log viewer page.
 * Provides controls for testing different scenarios and container sizes.
 */
export function LogViewerPlayground() {
  usePage({
    title: "Log Viewer",
    breadcrumbs: [{ label: "Experimental", href: "/experimental" }],
  });

  // Playground state
  const [scenario, setScenario] = useState<LogScenario>("normal");
  const [containerSize, setContainerSize] = useState<ContainerSize>("panel");
  const [isTailing, setIsTailing] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  // Mock debug stats - will be replaced with real stats when LogViewer is integrated
  const [debugStats] = useState<DebugStats>({
    entriesInMemory: 0,
    renderTimeMs: 0,
    indexSizeKb: 0,
    lastUpdate: null,
  });

  const handleStartTailing = useCallback(() => {
    setIsTailing(true);
  }, []);

  const handlePauseTailing = useCallback(() => {
    setIsTailing(false);
  }, []);

  const handleReset = useCallback(() => {
    setIsTailing(false);
    // Reset will trigger a re-fetch when LogViewer is integrated
  }, []);

  const handleToggleDebug = useCallback(() => {
    setShowDebug((prev) => !prev);
  }, []);

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-purple-500/10 p-2">
          <FlaskConical className="h-5 w-5 text-purple-400" />
        </div>
        <div>
          <h1 className="text-foreground text-lg font-semibold">Log Viewer Playground</h1>
          <p className="text-muted-foreground text-sm">
            Test the log viewer with different scenarios and configurations
          </p>
        </div>
      </div>

      {/* Controls Row */}
      <div className="border-border bg-card/50 flex flex-wrap items-center gap-4 rounded-lg border p-4">
        <ScenarioSelector
          value={scenario}
          onChange={setScenario}
        />

        <div className="bg-border h-8 w-px" />

        <ContainerSizer
          value={containerSize}
          onChange={setContainerSize}
        />

        <div className="bg-border h-8 w-px" />

        {/* Tailing Controls */}
        <div className="flex items-center gap-2">
          {isTailing ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePauseTailing}
            >
              <Pause className="mr-1.5 h-4 w-4" />
              Pause
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartTailing}
            >
              <Play className="mr-1.5 h-4 w-4" />
              Start Tailing
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Reset
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleDebug}
            data-active={showDebug}
          >
            <BarChart3 className="mr-1.5 h-4 w-4" />
            Stats
          </Button>
        </div>

        {/* Current state indicator */}
        <div className="ml-auto flex items-center gap-2">
          {isTailing && (
            <span className="flex items-center gap-1.5 text-sm text-green-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
              Tailing
            </span>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="relative flex-1">
        <LogViewerContainer
          size={containerSize}
          scenario={scenario}
          isTailing={isTailing}
        />

        {/* Debug Panel Overlay */}
        {showDebug && (
          <div className="absolute right-4 bottom-4">
            <DebugPanel stats={debugStats} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Container for the LogViewer component with configurable size
 */
function LogViewerContainer({
  size,
  scenario,
  isTailing,
}: {
  size: ContainerSize;
  scenario: LogScenario;
  isTailing: boolean;
}) {
  const containerStyles: Record<ContainerSize, string> = {
    panel: "w-[400px] h-[600px]",
    "half-screen": "w-1/2 h-full",
    "full-screen": "w-full h-full",
  };

  return (
    <div
      className={`border-border bg-card mx-auto flex items-center justify-center rounded-lg border ${containerStyles[size]}`}
    >
      {/* Placeholder for LogViewer component */}
      <div className="text-muted-foreground flex flex-col items-center gap-3 p-8 text-center">
        <div className="bg-muted rounded-lg p-4">
          <FlaskConical className="h-8 w-8 opacity-50" />
        </div>
        <div>
          <p className="text-foreground font-medium">LogViewer Component</p>
          <p className="mt-1 text-sm">
            Scenario: <code className="bg-muted rounded px-1 py-0.5">{scenario}</code>
          </p>
          <p className="text-sm">
            Tailing: <code className="bg-muted rounded px-1 py-0.5">{isTailing ? "On" : "Off"}</code>
          </p>
        </div>
        <p className="text-muted-foreground mt-2 max-w-xs text-xs">
          The LogViewer component will be rendered here once W4 (UI Components) is complete.
        </p>
      </div>
    </div>
  );
}
