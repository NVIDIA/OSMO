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
 * DAGToolbar Component
 *
 * Toolbar with workflow pattern selector for demo/dev purposes.
 * Layout controls have been moved to DAGControls in the canvas.
 */

"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/tabs";
import type { WorkflowPattern } from "../../mock-workflow-v2";

interface DAGToolbarProps {
  /** Current workflow pattern */
  workflowPattern: WorkflowPattern;
  /** Pattern change callback */
  onPatternChange: (pattern: WorkflowPattern) => void;
}

export function DAGToolbar({ workflowPattern, onPatternChange }: DAGToolbarProps) {
  return (
    <nav
      className="flex items-center border-b border-gray-200 px-6 py-3 dark:border-zinc-800"
      aria-label="Workflow pattern selector"
    >
      <span className="mr-3 text-xs text-gray-500 dark:text-zinc-500">Demo Pattern:</span>
      <Tabs
        value={workflowPattern}
        onValueChange={(v) => onPatternChange(v as WorkflowPattern)}
      >
        <TabsList className="bg-gray-100/50 dark:bg-zinc-800/50">
          <TabsTrigger
            value="linear"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-700"
          >
            Linear
          </TabsTrigger>
          <TabsTrigger
            value="diamond"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-700"
          >
            Diamond
          </TabsTrigger>
          <TabsTrigger
            value="parallel"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-700"
          >
            Parallel
          </TabsTrigger>
          <TabsTrigger
            value="complex"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-700"
          >
            Complex
          </TabsTrigger>
          <TabsTrigger
            value="massiveParallel"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-700"
          >
            200 Tasks
          </TabsTrigger>
          <TabsTrigger
            value="manyGroups"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-700"
          >
            100 Groups
          </TabsTrigger>
          <TabsTrigger
            value="multiRoot"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-700"
          >
            Multi-Root
          </TabsTrigger>
          <TabsTrigger
            value="showcase"
            className="data-[state=active]:bg-amber-100 dark:data-[state=active]:bg-amber-700"
          >
            Showcase
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </nav>
  );
}
