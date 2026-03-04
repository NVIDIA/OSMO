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

import { memo, useState, type ReactNode } from "react";
import { Loader2, TriangleAlert, CircleCheck, CircleX, ChevronDown } from "lucide-react";
import { WorkflowPriority } from "@/lib/api/generated";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { CollapsibleSection } from "@/components/workflow/collapsible-section";
import { PoolPicker } from "@/components/workflow/pool-picker";
import { PriorityPicker, PRIORITY_LABELS } from "@/components/workflow/priority-picker";
import type { LocalpathWarnings } from "@/components/submit-workflow/use-submit-workflow-form";

/** Inline code token styled to stand out against the red error banner background. */
function Token({ children }: { children: ReactNode }) {
  return <code className="rounded bg-red-100 px-0.5 font-mono dark:bg-red-950/60">{children}</code>;
}

/** Renders the submit button label with a spinner when an operation is in progress. */
function SubmitButtonContent({ isPending, isValidatePending }: { isPending: boolean; isValidatePending: boolean }) {
  if (isPending) {
    return (
      <>
        <Loader2
          className="size-4 animate-spin"
          aria-hidden="true"
        />
        Submitting...
      </>
    );
  }
  if (isValidatePending) {
    return (
      <>
        <Loader2
          className="size-4 animate-spin"
          aria-hidden="true"
        />
        Validating...
      </>
    );
  }
  return <>Submit</>;
}

export interface SubmitWorkflowConfigPanelProps {
  pool: string;
  onPoolChange: (pool: string) => void;
  priority: WorkflowPriority;
  onPriorityChange: (priority: WorkflowPriority) => void;
  localpathWarnings: LocalpathWarnings;
  error: string | null;
  isPending: boolean;
  canSubmit: boolean;
  onClose: () => void;
  onSubmit: () => void;
  // Dry run / preview
  isDryRunPending: boolean;
  dryRunError: string | null;
  canDryRun: boolean;
  onDryRun: () => void;
  // Validation (via Submit combo dropdown)
  isValidatePending: boolean;
  validationOk: boolean | null;
  validationError: string | null;
  canValidate: boolean;
  onValidate: () => void;
}

export const SubmitWorkflowConfigPanel = memo(function SubmitWorkflowConfigPanel({
  pool,
  onPoolChange,
  priority,
  onPriorityChange,
  localpathWarnings,
  error,
  isPending,
  canSubmit,
  onClose,
  onSubmit,
  isDryRunPending,
  dryRunError,
  canDryRun,
  onDryRun,
  isValidatePending,
  validationOk,
  validationError,
  canValidate,
  onValidate,
}: SubmitWorkflowConfigPanelProps) {
  const [poolOpen, setPoolOpen] = useState(true);
  const [priorityOpen, setPriorityOpen] = useState(true);

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
          step={2}
          title="Priority Level"
          open={priorityOpen}
          onOpenChange={setPriorityOpen}
          selectedValue={PRIORITY_LABELS[priority]}
          isLast
        >
          <PriorityPicker
            priority={priority}
            onChange={onPriorityChange}
          />
        </CollapsibleSection>
      </div>

      {/* Action bar */}
      <div className="flex shrink-0 flex-col gap-2 border-t border-zinc-200 px-7 py-4 dark:border-zinc-700/60">
        {/* Localpath blocking errors — one banner per violation */}
        {localpathWarnings.hasFileLocalpath && (
          <div
            className="flex flex-col gap-1 rounded border border-red-200 bg-red-50 px-3 py-2 dark:border-red-700/50 dark:bg-red-900/20"
            role="alert"
            aria-live="polite"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-red-800 dark:text-red-300">
              <TriangleAlert
                className="size-3 shrink-0"
                aria-hidden="true"
              />
              Local file injection not supported
            </div>
            <p className="text-[11px] text-red-700 dark:text-red-400">
              <Token>files[].localpath</Token> requires filesystem access. Replace with <Token>contents:</Token> to
              inline the file, or submit via <Token>osmo workflow submit</Token>.
            </p>
          </div>
        )}
        {localpathWarnings.hasDatasetLocalpath && (
          <div
            className="flex flex-col gap-1 rounded border border-red-200 bg-red-50 px-3 py-2 dark:border-red-700/50 dark:bg-red-900/20"
            role="alert"
            aria-live="polite"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-red-800 dark:text-red-300">
              <TriangleAlert
                className="size-3 shrink-0"
                aria-hidden="true"
              />
              Local dataset path not supported
            </div>
            <p className="text-[11px] text-red-700 dark:text-red-400">
              <Token>dataset.localpath</Token> requires filesystem access. Upload the dataset first, or submit via{" "}
              <Token>osmo workflow submit</Token>.
            </p>
          </div>
        )}

        {/* Dry run error */}
        {dryRunError && (
          <div className="flex items-start gap-1.5 rounded bg-red-50 px-3 py-1.5 font-mono text-[11px] text-red-700 dark:bg-red-900/30 dark:text-red-300">
            <CircleX
              className="mt-px size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span className="min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap">{dryRunError}</span>
          </div>
        )}

        {/* Validation result */}
        {validationOk === true && (
          <div className="flex items-center gap-1.5 text-[11px] text-green-700 dark:text-green-400">
            <CircleCheck
              className="size-3.5 shrink-0"
              aria-hidden="true"
            />
            Workflow spec is valid
          </div>
        )}
        {validationError && (
          <div className="flex items-start gap-1.5 rounded bg-red-50 px-3 py-1.5 font-mono text-[11px] text-red-700 dark:bg-red-900/30 dark:text-red-300">
            <CircleX
              className="mt-px size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span className="min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap">{validationError}</span>
          </div>
        )}

        {/* Submit error */}
        {error && (
          <div
            className="rounded bg-red-50 px-3 py-1.5 font-mono text-[11px] text-red-700 dark:bg-red-900/30 dark:text-red-300"
            role="alert"
          >
            <span className="[overflow-wrap:anywhere] whitespace-pre-wrap">{error}</span>
          </div>
        )}

        {/* Primary action row */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex h-9 flex-1 items-center justify-center rounded-md border border-zinc-200 bg-transparent font-sans text-sm font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            Cancel
          </button>

          {/* Preview = dry run */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onDryRun}
                disabled={!canDryRun}
                aria-label="Preview rendered workflow after template substitution"
                className={cn(
                  "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border font-sans text-sm font-semibold transition-all",
                  "border-zinc-300 bg-transparent text-zinc-700",
                  "hover:border-zinc-400 hover:bg-zinc-50",
                  "dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                )}
              >
                {isDryRunPending ? (
                  <>
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                    Previewing...
                  </>
                ) : (
                  "Preview"
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>Preview rendered spec with variables substituted</TooltipContent>
          </Tooltip>

          {/* Submit + Validate combo */}
          <div className="flex flex-1">
            <Button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit || isValidatePending}
              aria-label="Submit workflow"
              className="btn-nvidia flex-1 rounded-r-none font-bold"
            >
              <SubmitButtonContent
                isPending={isPending}
                isValidatePending={isValidatePending}
              />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  disabled={!canSubmit || isValidatePending}
                  aria-label="More workflow options"
                  className="btn-nvidia rounded-l-none border-l border-l-black/15 px-2 font-bold"
                >
                  <ChevronDown
                    className="size-4"
                    aria-hidden="true"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={onValidate}
                  disabled={!canValidate || isValidatePending}
                >
                  {isValidatePending ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2
                        className="size-3.5 animate-spin"
                        aria-hidden="true"
                      />
                      Validating...
                    </span>
                  ) : (
                    "Validate"
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
});
