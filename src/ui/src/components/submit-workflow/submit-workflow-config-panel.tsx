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
 * Contains three collapsible sections (Template Variables, Pool, Priority)
 * and a fixed action bar at the bottom with Cancel and Submit buttons.
 */

"use client";

import { memo, useState } from "react";
import { Loader2 } from "lucide-react";
import { WorkflowPriority } from "@/lib/api/generated";
import { cn } from "@/lib/utils";
import { SubmitWorkflowTemplateVars } from "@/components/submit-workflow/submit-workflow-template-vars";
import { CollapsibleSection } from "@/components/workflow/collapsible-section";
import { PoolPicker } from "@/components/workflow/pool-picker";
import { PriorityPicker, PRIORITY_LABELS } from "@/components/workflow/priority-picker";

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
  error: string | null;
  isPending: boolean;
  canSubmit: boolean;
  onClose: () => void;
  onSubmit: () => void;
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
  error,
  isPending,
  canSubmit,
  onClose,
  onSubmit,
}: SubmitWorkflowConfigPanelProps) {
  const [varsOpen, setVarsOpen] = useState(true);
  const [poolOpen, setPoolOpen] = useState(true);
  const [priorityOpen, setPriorityOpen] = useState(true);

  const varsSelectedValue =
    templateVarNames.length > 0
      ? `${templateVarNames.length} ${templateVarNames.length === 1 ? "var" : "vars"}`
      : undefined;

  return (
    <div
      className="flex flex-1 flex-col bg-white dark:bg-zinc-900"
      style={{ minWidth: "var(--submit-overlay-config-min-width)" }}
    >
      {/* Scrollable sections */}
      <div
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
        style={{ scrollbarWidth: "thin" }}
      >
        <CollapsibleSection
          step={1}
          title="Template Variables"
          open={varsOpen}
          onOpenChange={setVarsOpen}
          selectedValue={varsSelectedValue}
        >
          <SubmitWorkflowTemplateVars
            varNames={templateVarNames}
            varValues={templateVarValues}
            onValueChange={onTemplateVarChange}
          />
        </CollapsibleSection>

        <CollapsibleSection
          step={2}
          title="Target Pool"
          open={poolOpen}
          onOpenChange={setPoolOpen}
          selectedValue={pool || undefined}
        >
          <PoolPicker
            pool={pool}
            onChange={onPoolChange}
          />
        </CollapsibleSection>

        <CollapsibleSection
          step={3}
          title="Priority Level"
          open={priorityOpen}
          onOpenChange={setPriorityOpen}
          selectedValue={PRIORITY_LABELS[priority]}
        >
          <PriorityPicker
            priority={priority}
            onChange={onPriorityChange}
          />
        </CollapsibleSection>
      </div>

      {/* Action bar */}
      <div className="flex shrink-0 flex-col gap-2 border-t border-zinc-200 px-7 py-4 dark:border-zinc-700/60">
        {error && (
          <div
            className="rounded bg-red-50 px-3 py-1.5 font-mono text-[11px] text-red-700 dark:bg-red-900/30 dark:text-red-300"
            role="alert"
          >
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex h-9 flex-1 items-center justify-center rounded-md border border-zinc-200 bg-transparent font-sans text-sm font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label="Submit workflow"
            className={cn(
              "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border font-sans text-sm font-bold transition-all",
              "border-nvidia bg-nvidia text-black",
              "hover:bg-nvidia-dark hover:shadow-[0_0_18px_rgba(118,185,0,0.3)]",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            {isPending ? (
              <>
                <Loader2
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
                Submitting...
              </>
            ) : (
              "Submit"
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
