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

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSubmitWorkflowStore } from "@/stores/submit-workflow-store";
import "@/components/submit-workflow/submit-workflow.css";

// Code-split the feature content. Always mounted so the chunk (CodeMirror, form
// state) loads in the background on page init rather than racing with the enter
// animation on first open. The container's visibility:hidden + pointer-events:none
// keeps it invisible and non-interactive until the overlay opens.
const SubmitWorkflowContent = dynamic(
  () =>
    import("@/components/submit-workflow/submit-workflow-content").then((m) => ({
      default: m.SubmitWorkflowContent,
    })),
  { ssr: false },
);

// 4-phase lifecycle:
//   closed → opening → open → closing → closed
//
// The container div stays in the DOM at all times so phase transitions are
// driven by data-state attribute changes, not DOM insertion/removal.
//
// Both enter and exit use CSS TRANSITIONS. Transitions are triggered by
// computed-value changes and are immune to the style-recalc that occurs when
// SubmitWorkflowContent's dynamic chunk loads. Child transitionend events are
// filtered by e.target === e.currentTarget (they bubble, but their target is
// the child, not this container).
//
// Enter: opacity fast (120ms), transform slower (260ms) → advance on "transform"
// Exit:  transform fast (150ms), opacity slower (300ms) → advance on "opacity"
type Phase = "closed" | "opening" | "open" | "closing";

export function SubmitWorkflowOverlay() {
  const { isOpen, close } = useSubmitWorkflowStore();
  const [phase, setPhase] = useState<Phase>("closed");

  // React's "adjusting state when a prop changes" pattern — during render, not
  // inside an effect, so the phase update is batched with the isOpen change and
  // committed in a single pass (no extra paint between closed and opening).
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      if (phase === "closed" || phase === "closing") setPhase("opening");
    } else {
      if (phase === "open" || phase === "opening") setPhase("closing");
    }
  }

  // Keyboard handler: only active when the overlay is fully open.
  useEffect(() => {
    if (phase !== "open") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [phase, close]);

  // Both enter and exit are CSS transitions — one handler covers both phases.
  // Guard: e.target === e.currentTarget rejects bubbled child transitionend events.
  // Guard: propertyName picks the SLOWER property for each phase so the phase
  //        only advances once both properties have finished:
  //   opening → "transform" (260ms, slower than opacity 120ms)
  //   closing → "opacity"   (300ms, slower than transform 150ms)
  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (phase === "opening" && e.propertyName === "transform") setPhase("open");
      if (phase === "closing" && e.propertyName === "opacity") setPhase("closed");
    },
    [phase],
  );

  return (
    <div
      className="submit-overlay absolute inset-0 z-10 overflow-hidden"
      data-state={phase}
      onTransitionEnd={handleTransitionEnd}
      role="dialog"
      aria-modal="true"
      aria-label="Submit workflow"
      aria-hidden={phase === "closed" || phase === "closing"}
    >
      <SubmitWorkflowContent />
    </div>
  );
}
