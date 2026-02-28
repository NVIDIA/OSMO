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
 * SubmitWorkflowContent - Full content for the Submit Workflow overlay.
 *
 * Layout (matching submit-E-scrollsplit.html):
 *   ┌─────────────────────────────────────────┐
 *   │ bar: "Submit workflow" · name · close   │
 *   ├────────────────────────┬────────────────┤
 *   │  YAML editor (55%)     │  Config form   │
 *   │  [draggable resizer]   │  ─────────────  │
 *   │                        │  01 Vars       │
 *   │                        │  02 Pool       │
 *   │                        │  03 Priority   │
 *   ├────────────────────────┴────────────────┤
 *   │ footer: summary · Cancel · Submit       │
 *   └─────────────────────────────────────────┘
 */

"use client";

import { memo, useRef, useState, useCallback, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { WorkflowPriority } from "@/lib/api/generated";
import { cn } from "@/lib/utils";
import { useSubmitWorkflowForm } from "@/components/submit-workflow/use-submit-workflow-form";
import { SubmitWorkflowEditorPanel } from "@/components/submit-workflow/submit-workflow-editor-panel";
import { SubmitWorkflowConfigPanel } from "@/components/submit-workflow/submit-workflow-config-panel";

// ---------------------------------------------------------------------------
// Priority display labels (for footer summary)
// ---------------------------------------------------------------------------

const PRIORITY_LABEL: Record<WorkflowPriority, string> = {
  [WorkflowPriority.LOW]: "Low",
  [WorkflowPriority.NORMAL]: "Normal",
  [WorkflowPriority.HIGH]: "High",
};

// ---------------------------------------------------------------------------
// Resizer hook
// ---------------------------------------------------------------------------

function useColumnResizer(initialPct = 55) {
  const [editorWidthPct, setEditorWidthPct] = useState(initialPct);
  const splitRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const startDrag = useCallback(() => {
    isDragging.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, []);

  const stopDrag = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current || !splitRef.current) return;
    const rect = splitRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setEditorWidthPct(Math.max(25, Math.min(75, pct)));
  }, []);

  useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", stopDrag);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", stopDrag);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [handleMouseMove, stopDrag]);

  return { editorWidthPct, splitRef, startDrag };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const SubmitWorkflowContent = memo(function SubmitWorkflowContent() {
  const form = useSubmitWorkflowForm();
  const { editorWidthPct, splitRef, startDrag } = useColumnResizer();

  return (
    <div className="flex h-full flex-col bg-white dark:bg-zinc-900">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="flex h-[50px] shrink-0 items-center gap-3.5 border-b border-zinc-200 bg-zinc-50 px-5 dark:border-zinc-700/60 dark:bg-zinc-950">
        {/* Label */}
        <span className="font-mono text-[11px] tracking-widest text-zinc-400 uppercase dark:text-zinc-500">
          Submit workflow
        </span>

        {/* Name field */}
        <div className="flex h-8 min-w-[200px] items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900">
          <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">name:</span>
          <span className="flex-1 truncate font-mono text-xs text-zinc-900 dark:text-zinc-100">
            {form.workflowName || <span className="text-zinc-400 dark:text-zinc-500">— edit YAML to set name —</span>}
          </span>
        </div>

        <div className="flex-1" />

        {/* Spec status badge */}
        {form.spec.trim().length > 0 && (
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
            <div
              className="bg-nvidia size-1.5 rounded-full"
              aria-hidden="true"
            />
            spec ready
            {form.templateVarNames.length > 0 && (
              <>
                {" "}
                · <span className="text-zinc-600 dark:text-zinc-300">{form.templateVarNames.length} vars</span>
              </>
            )}
          </div>
        )}

        {/* Close button */}
        <button
          type="button"
          onClick={form.handleClose}
          disabled={form.isPending}
          aria-label="Close submit workflow"
          className="flex size-7 items-center justify-center rounded border border-zinc-200 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <X
            className="size-3.5"
            aria-hidden="true"
          />
        </button>
      </div>

      {/* ── Split body ──────────────────────────────────────────── */}
      <div
        ref={splitRef}
        className="flex min-h-0 flex-1"
      >
        {/* Left: YAML editor */}
        <div
          className="flex flex-col"
          style={{ flexBasis: `${editorWidthPct}%`, flexShrink: 0 }}
        >
          <SubmitWorkflowEditorPanel
            value={form.spec}
            onChange={form.setSpec}
          />
        </div>

        {/* Resizer */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to resize panels"
          className={cn(
            "group relative z-10 w-1 shrink-0 cursor-col-resize",
            "hover:bg-nvidia/50 dark:hover:bg-nvidia/40 bg-zinc-200 transition-colors dark:bg-zinc-700/60",
          )}
          onMouseDown={startDrag}
        />

        {/* Right: Config panel */}
        <SubmitWorkflowConfigPanel
          templateVarNames={form.templateVarNames}
          templateVarValues={form.templateVarValues}
          onTemplateVarChange={form.setTemplateVarValue}
          pool={form.pool}
          onPoolChange={form.setPool}
          priority={form.priority}
          onPriorityChange={form.setPriority}
        />
      </div>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-t border-zinc-200 bg-zinc-50 px-7 dark:border-zinc-700/60 dark:bg-zinc-950">
        {/* Summary */}
        <div className="flex-1 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
          {form.pool ? (
            <>
              Pool: <span className="text-zinc-700 dark:text-zinc-200">{form.pool}</span>
              {" · "}Priority: <span className="text-zinc-700 dark:text-zinc-200">{PRIORITY_LABEL[form.priority]}</span>
              {form.templateVarNames.length > 0 && (
                <>
                  {" "}
                  · <span className="text-zinc-700 dark:text-zinc-200">{form.templateVarNames.length} vars</span>
                </>
              )}
            </>
          ) : (
            "Select a pool to continue"
          )}
        </div>

        {/* Error */}
        {form.error && (
          <div
            className="max-w-xs truncate rounded bg-red-50 px-3 py-1 font-mono text-[11px] text-red-700 dark:bg-red-900/30 dark:text-red-300"
            role="alert"
          >
            {form.error}
          </div>
        )}

        {/* Cancel */}
        <button
          type="button"
          onClick={form.handleClose}
          disabled={form.isPending}
          className="flex h-9 items-center gap-1.5 rounded-md border border-zinc-200 bg-transparent px-4 font-sans text-sm font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          Cancel
        </button>

        {/* Submit */}
        <button
          type="button"
          onClick={form.handleSubmit}
          disabled={!form.canSubmit}
          aria-label="Submit workflow"
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-md border px-4 font-sans text-sm font-bold transition-all",
            "border-nvidia bg-nvidia text-black",
            "hover:bg-nvidia-dark hover:shadow-[0_0_18px_rgba(118,185,0,0.3)]",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {form.isPending ? (
            <>
              <Loader2
                className="size-4 animate-spin"
                aria-hidden="true"
              />
              Submitting...
            </>
          ) : (
            "Submit Workflow"
          )}
        </button>
      </div>
    </div>
  );
});
