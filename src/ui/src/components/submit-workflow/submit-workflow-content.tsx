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
 *   ┌─────────────────────────────────────────┐
 *   │ bar: "Submit Workflow"           close  │
 *   ├────────────────────────┬────────────────┤
 *   │  YAML editor (55%)     │  Config form   │
 *   │  [draggable resizer]   │  01 Vars       │
 *   │                        │  02 Pool       │
 *   │                        │  03 Priority   │
 *   │                        │  ─────────────  │
 *   │                        │  Cancel Submit │
 *   └────────────────────────┴────────────────┘
 */

"use client";

import { memo, useRef, useState, useCallback, useEffect } from "react";
import { GripVertical, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSubmitWorkflowForm } from "@/components/submit-workflow/use-submit-workflow-form";
import { useSubmitWorkflowStore } from "@/stores/submit-workflow-store";
import { SubmitWorkflowEditorPanel } from "@/components/submit-workflow/submit-workflow-editor-panel";
import { SubmitWorkflowConfigPanel } from "@/components/submit-workflow/submit-workflow-config-panel";
import { SourcePicker } from "@/components/submit-workflow/source-picker";

// ---------------------------------------------------------------------------
// Constants — must match --submit-overlay-*-min-width in globals.css
// ---------------------------------------------------------------------------

const SUBMIT_PANEL = {
  /** Minimum YAML editor width in pixels (YAML readable at this width) */
  EDITOR_MIN_WIDTH_PX: 360,
  /** Minimum config panel width in pixels (pool + priority pickers fit at this width) */
  CONFIG_MIN_WIDTH_PX: 280,
} as const;

// ---------------------------------------------------------------------------
// Resizer hook
// ---------------------------------------------------------------------------

function useColumnResizer(initialPct = 55) {
  const [editorWidthPct, setEditorWidthPct] = useState(initialPct);
  const [isDragging, setIsDragging] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const startDrag = useCallback(() => {
    isDraggingRef.current = true;
    setIsDragging(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, []);

  const stopDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current || !splitRef.current) return;
    const rect = splitRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const maxEditorPx = rect.width - SUBMIT_PANEL.CONFIG_MIN_WIDTH_PX;
    const clampedPx = Math.max(SUBMIT_PANEL.EDITOR_MIN_WIDTH_PX, Math.min(maxEditorPx, x));
    setEditorWidthPct((clampedPx / rect.width) * 100);
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

  return { editorWidthPct, isDragging, splitRef, startDrag };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const SubmitWorkflowContent = memo(function SubmitWorkflowContent() {
  const form = useSubmitWorkflowForm();
  const { editorWidthPct, isDragging, splitRef, startDrag } = useColumnResizer();
  const isOpen = useSubmitWorkflowStore((s) => s.isOpen);

  // Show source picker until the user picks a source, then keep it dismissed
  // for the rest of the session (even if spec is cleared on close). Resets when
  // the overlay reopens so the next session starts fresh at the source picker.
  const [showSourcePicker, setShowSourcePicker] = useState(true);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) setShowSourcePicker(true);
  }

  const handleSourceSelect = useCallback(
    (spec: string) => {
      form.setSpec(spec);
      setShowSourcePicker(false);
    },
    [form],
  );

  return (
    <div className="flex h-full flex-col bg-white dark:bg-zinc-900">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="flex h-[50px] shrink-0 items-center gap-3.5 border-b border-zinc-200 bg-zinc-50 pr-2 pl-5 dark:border-zinc-700/60 dark:bg-zinc-950">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Submit Workflow</span>

        <div className="flex-1" />

        {/* Close button */}
        <button
          type="button"
          onClick={form.handleClose}
          disabled={form.isPending}
          aria-label="Close submit workflow"
          className="flex size-8 items-center justify-center text-zinc-400 transition-colors hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-500 dark:hover:text-zinc-200"
        >
          <X
            className="size-4"
            aria-hidden="true"
          />
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────────── */}
      {showSourcePicker ? (
        /* Source picker spans the full width before a spec is chosen */
        <SourcePicker onSelect={handleSourceSelect} />
      ) : (
        /* Split view: editor + resizer + config */
        <div
          ref={splitRef}
          className="flex min-h-0 flex-1"
        >
          {/* Left: YAML editor */}
          <div
            className="flex flex-col"
            style={{ flexBasis: `${editorWidthPct}%`, flexShrink: 1, minWidth: SUBMIT_PANEL.EDITOR_MIN_WIDTH_PX }}
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
            className="group relative z-10 w-4 shrink-0 cursor-col-resize"
            onMouseDown={startDrag}
          >
            {/* Vertical line */}
            <div
              className={cn(
                "absolute inset-y-0 left-0 w-0.5 transition-colors",
                isDragging
                  ? "bg-blue-500"
                  : "bg-zinc-200 group-hover:bg-zinc-300 dark:bg-zinc-700 dark:group-hover:bg-zinc-600",
              )}
            />
            {/* Grip handle */}
            <div
              className={cn(
                "absolute top-1/2 left-px z-10 -translate-x-1/2 -translate-y-1/2",
                "rounded-sm bg-zinc-100 px-px py-1 shadow-md transition-opacity duration-150",
                "dark:bg-zinc-800",
                isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
              aria-hidden="true"
            >
              <GripVertical
                className="size-3 text-zinc-400 dark:text-zinc-500"
                strokeWidth={1.5}
              />
            </div>
          </div>

          {/* Right: Config panel */}
          <SubmitWorkflowConfigPanel
            templateVarNames={form.templateVarNames}
            templateVarValues={form.templateVarValues}
            onTemplateVarChange={form.setTemplateVarValue}
            pool={form.pool}
            onPoolChange={form.setPool}
            priority={form.priority}
            onPriorityChange={form.setPriority}
            error={form.error}
            isPending={form.isPending}
            canSubmit={form.canSubmit}
            onClose={form.handleClose}
            onSubmit={form.handleSubmit}
          />
        </div>
      )}
    </div>
  );
});
