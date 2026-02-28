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
 * SubmitWorkflowConfigPanel - Right column of the scroll-split layout.
 *
 * Contains a 2px scroll progress bar at the top and three scrollable
 * sections: Template Variables (01), Pool (02), Priority (03).
 */

"use client";

import { memo, useRef, useState, useCallback } from "react";
import { WorkflowPriority } from "@/lib/api/generated";
import { SubmitWorkflowTemplateVars } from "@/components/submit-workflow/submit-workflow-template-vars";
import { SubmitWorkflowPools } from "@/components/submit-workflow/submit-workflow-pools";
import { SubmitWorkflowPriority } from "@/components/submit-workflow/submit-workflow-priority";

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

interface SectionHeaderProps {
  step: number;
  title: string;
  subtitle?: string;
}

function SectionHeader({ step, title, subtitle }: SectionHeaderProps) {
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center gap-2">
        <div className="flex size-5 items-center justify-center rounded-full border border-zinc-300 bg-zinc-100 font-mono text-[10px] font-semibold text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {step}
        </div>
        <span className="font-mono text-[11px] font-semibold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
          {title}
        </span>
      </div>
      {subtitle && <p className="font-mono text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{subtitle}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SubmitWorkflowConfigPanelProps {
  templateVarNames: string[];
  templateVarValues: Record<string, string>;
  onTemplateVarChange: (name: string, value: string) => void;
  pool: string;
  onPoolChange: (pool: string) => void;
  priority: WorkflowPriority;
  onPriorityChange: (priority: WorkflowPriority) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SubmitWorkflowConfigPanel = memo(function SubmitWorkflowConfigPanel({
  templateVarNames,
  templateVarValues,
  onTemplateVarChange,
  pool,
  onPoolChange,
  priority,
  onPriorityChange,
}: SubmitWorkflowConfigPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollPct, setScrollPct] = useState(0);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setScrollPct(max > 0 ? (el.scrollTop / max) * 100 : 0);
  }, []);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-zinc-900">
      {/* Scroll progress bar */}
      <div className="h-0.5 shrink-0 bg-zinc-200 dark:bg-zinc-700/60">
        <div
          className="bg-nvidia h-full transition-[width] duration-100"
          style={{ width: `${scrollPct}%` }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(scrollPct)}
          aria-label="Scroll position"
        />
      </div>

      {/* Scrollable sections */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ scrollbarWidth: "thin" }}
      >
        {/* Section 01: Template Variables */}
        <section className="px-7 pt-7">
          <SectionHeader
            step={1}
            title="Template Variables"
            subtitle="Variables detected in spec — set override values below."
          />
          <SubmitWorkflowTemplateVars
            varNames={templateVarNames}
            varValues={templateVarValues}
            onValueChange={onTemplateVarChange}
          />
        </section>

        <div className="mx-7 mt-7 h-px bg-zinc-200 dark:bg-zinc-700/60" />

        {/* Section 02: Pool */}
        <section className="px-7 pt-7">
          <SectionHeader
            step={2}
            title="Pool"
            subtitle="Target compute pool. GPU availability shown in real-time."
          />
          <SubmitWorkflowPools
            selected={pool}
            onSelect={onPoolChange}
          />
        </section>

        <div className="mx-7 mt-7 h-px bg-zinc-200 dark:bg-zinc-700/60" />

        {/* Section 03: Priority */}
        <section className="px-7 pt-7 pb-7">
          <SectionHeader
            step={3}
            title="Priority"
            subtitle="LOW workflows may be preempted to free resources for higher priority jobs."
          />
          <SubmitWorkflowPriority
            priority={priority}
            onChange={onPriorityChange}
          />
        </section>
      </div>
    </div>
  );
});
