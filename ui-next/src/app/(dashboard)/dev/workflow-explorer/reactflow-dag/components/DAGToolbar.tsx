// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * DAGToolbar Component
 *
 * Toolbar with workflow pattern selector for demo/dev purposes.
 * Layout controls have been moved to DAGControls in the canvas.
 */

"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WorkflowPattern } from "../../mock-workflow-v2";

interface DAGToolbarProps {
  /** Current workflow pattern */
  workflowPattern: WorkflowPattern;
  /** Pattern change callback */
  onPatternChange: (pattern: WorkflowPattern) => void;
}

export function DAGToolbar({
  workflowPattern,
  onPatternChange,
}: DAGToolbarProps) {
  return (
    <nav
      className="flex items-center px-6 py-3 border-b border-zinc-800"
      aria-label="Workflow pattern selector"
    >
      <span className="text-xs text-zinc-500 mr-3">Demo Pattern:</span>
      <Tabs
        value={workflowPattern}
        onValueChange={(v) => onPatternChange(v as WorkflowPattern)}
      >
        <TabsList className="bg-zinc-800/50">
          <TabsTrigger value="linear" className="data-[state=active]:bg-zinc-700">
            Linear
          </TabsTrigger>
          <TabsTrigger value="diamond" className="data-[state=active]:bg-zinc-700">
            Diamond
          </TabsTrigger>
          <TabsTrigger value="parallel" className="data-[state=active]:bg-zinc-700">
            Parallel
          </TabsTrigger>
          <TabsTrigger value="complex" className="data-[state=active]:bg-zinc-700">
            Complex
          </TabsTrigger>
          <TabsTrigger value="massiveParallel" className="data-[state=active]:bg-zinc-700">
            200 Tasks
          </TabsTrigger>
          <TabsTrigger value="manyGroups" className="data-[state=active]:bg-zinc-700">
            100 Groups
          </TabsTrigger>
          <TabsTrigger value="multiRoot" className="data-[state=active]:bg-zinc-700">
            Multi-Root
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </nav>
  );
}
